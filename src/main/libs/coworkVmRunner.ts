import { app } from 'electron';
import { spawn, type ChildProcessByStdio } from 'child_process';
import fs from 'fs';
import net from 'net';
import path from 'path';
import type { Readable } from 'stream';
import { StringDecoder } from 'string_decoder';
import { v4 as uuidv4 } from 'uuid';
import type { SandboxRuntimeInfo } from './coworkSandboxRuntime';
import { coworkLog } from './coworkLogger';

// 协作沙箱路径配置类型定义
export type CoworkSandboxPaths = {
  baseDir: string;      // 基础目录
  ipcDir: string;       // IPC通信目录
  requestsDir: string;  // 请求目录
  responsesDir: string; // 响应目录
  streamsDir: string;   // 流数据目录
};

// 沙箱启动器模式类型
export type SandboxLauncherMode = 'direct' | 'launchctl';

// 沙箱请求信息类型
export type SandboxRequestInfo = {
  requestId: string;    // 请求ID
  requestPath: string;  // 请求路径
  streamPath: string;   // 流路径
};

// 沙箱工作目录映射类型
export type SandboxCwdMapping = {
  hostPath: string;  // 主机路径
  guestPath: string; // 虚拟机内路径
  mountTag: string;  // 挂载标签
};

// 沙箱额外挂载配置类型
export type SandboxExtraMount = {
  hostPath: string; // 主机路径
  mountTag: string; // 挂载标签
};

/**
 * 确保协作沙箱目录存在
 * 创建沙箱运行所需的目录结构，包括IPC通信目录及其子目录
 * @param sessionId - 会话ID
 * @returns 沙箱路径配置对象
 */
export function ensureCoworkSandboxDirs(sessionId: string): CoworkSandboxPaths {
  const baseDir = path.join(app.getPath('userData'), 'cowork', 'sandbox');
  const ipcDir = path.join(baseDir, 'ipc', sessionId);
  const requestsDir = path.join(ipcDir, 'requests');
  const responsesDir = path.join(ipcDir, 'responses');
  const streamsDir = path.join(ipcDir, 'streams');

  // 递归创建所有必需的目录
  fs.mkdirSync(requestsDir, { recursive: true });
  fs.mkdirSync(responsesDir, { recursive: true });
  fs.mkdirSync(streamsDir, { recursive: true });

  return {
    baseDir,
    ipcDir,
    requestsDir,
    responsesDir,
    streamsDir,
  };
}

/**
 * 解析沙箱工作目录映射
 * 在所有平台上，将主机目录挂载到虚拟机内的 /workspace/project 路径
 * 这确保了Alpine虚拟机内部具有一致的Linux路径
 * @param cwd - 当前工作目录
 * @returns 沙箱工作目录映射对象
 */
export function resolveSandboxCwd(cwd: string): SandboxCwdMapping {
  // 在所有平台上，将主机目录挂载到虚拟机内的 /workspace/project
  // 这确保了Alpine虚拟机内部具有一致的Linux路径
  return {
    hostPath: cwd,
    guestPath: '/workspace/project',
    mountTag: 'work',
  };
}

// 技能同步忽略列表 - 这些目录和文件不会被同步到沙箱
const SKILL_SYNC_IGNORE = new Set([
  'node_modules', '.git', '__pycache__', 'dist', '.DS_Store', 'Thumbs.db',
  '.server.pid', '.server.log', '.connection',
]);
const SKILL_SYNC_MAX_FILE_SIZE = 1 * 1024 * 1024; // 最大文件大小限制：1 MB

/**
 * 收集技能文件以传输到沙箱虚拟机
 * 遍历技能目录，跳过大型/临时目录和大文件
 * 返回包含 { path, data } 条目的数组，路径使用正斜杠的相对路径格式
 * @param skillsRoot - 技能根目录路径
 * @returns 包含路径和数据的文件数组
 */
export function collectSkillFilesForSandbox(
  skillsRoot: string
): { path: string; data: Buffer }[] {
  const result: { path: string; data: Buffer }[] = [];
  if (!fs.existsSync(skillsRoot)) {
    coworkLog('WARN', 'collectSkillFiles', `技能根目录不存在: ${skillsRoot}`);
    return result;
  }

  coworkLog('INFO', 'collectSkillFiles', `正在扫描技能根目录: ${skillsRoot}`);

  /**
   * 递归扫描目录
   * @param dir - 当前扫描目录
   * @param base - 基础路径前缀
   */
  function scan(dir: string, base: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      // 跳过忽略列表中的目录和文件
      if (SKILL_SYNC_IGNORE.has(entry.name)) continue;
      const fullPath = path.join(dir, entry.name);
      const relPath = base ? `${base}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        scan(fullPath, relPath);
      } else if (entry.isFile()) {
        try {
          const stat = fs.statSync(fullPath);
          // 只同步小于最大文件大小限制的文件
          if (stat.size <= SKILL_SYNC_MAX_FILE_SIZE) {
            result.push({ path: relPath, data: fs.readFileSync(fullPath) });
          } else {
            coworkLog('WARN', 'collectSkillFiles', `跳过超大文件: ${relPath} (${stat.size} 字节)`);
          }
        } catch { /* 跳过无法读取的文件 */ }
      }
    }
  }

  scan(skillsRoot, '');
  coworkLog('INFO', 'collectSkillFiles', `已从 ${skillsRoot} 收集 ${result.length} 个文件`, {
    files: result.map(f => f.path).join(', '),
  });
  return result;
}

/**
 * 构建沙箱请求
 * 创建请求文件并返回请求信息
 * @param paths - 沙箱路径配置
 * @param input - 请求数据
 * @returns 沙箱请求信息
 */
export function buildSandboxRequest(
  paths: CoworkSandboxPaths,
  input: Record<string, unknown>
): SandboxRequestInfo {
  const requestId = uuidv4();
  const requestPath = path.join(paths.requestsDir, `${requestId}.json`);
  const streamPath = path.join(paths.streamsDir, `${requestId}.log`);
  fs.writeFileSync(requestPath, JSON.stringify(input));
  return { requestId, requestPath, streamPath };
}

/**
 * 获取首选的虚拟化加速类型
 * 根据环境变量和操作系统平台返回最优的加速方案
 * @returns 加速类型字符串，如果不可用则返回null
 */
function getPreferredAccel(): string | null {
  // 优先使用环境变量中指定的加速类型
  if (process.env.COWORK_SANDBOX_ACCEL) {
    return process.env.COWORK_SANDBOX_ACCEL;
  }
  // macOS平台使用Hypervisor.framework
  if (process.platform === 'darwin') {
    return 'hvf';
  }
  // Windows平台使用Windows Hypervisor Platform
  if (process.platform === 'win32') {
    return 'whpx';
  }
  // Linux平台使用KVM
  if (process.platform === 'linux') {
    return 'kvm';
  }
  return null;
}

/**
 * 解析运行时根目录
 * @param runtimeBinary - 运行时二进制文件路径
 * @returns 运行时根目录路径
 */
function resolveRuntimeRoot(runtimeBinary: string): string {
  return path.resolve(path.dirname(runtimeBinary), '..');
}

/**
 * 解析ARM64架构固件路径
 * 为ARM64虚拟机准备EDK2固件文件
 * @param options - 包含运行时信息和IPC目录的配置对象
 * @returns 固件代码和变量文件路径，如果不是ARM64架构则返回null
 */
function resolveAarch64Firmware(options: {
  runtime: SandboxRuntimeInfo;
  ipcDir: string;
}): { codePath: string; varsPath: string } | null {
  // 仅处理ARM64架构
  if (options.runtime.arch !== 'arm64') return null;
  const runtimeRoot = resolveRuntimeRoot(options.runtime.runtimeBinary);
  const codePath = path.join(runtimeRoot, 'share', 'qemu', 'edk2-aarch64-code.fd');
  const varsTemplate = path.join(runtimeRoot, 'share', 'qemu', 'edk2-arm-vars.fd');
  // 检查固件文件是否存在
  if (!fs.existsSync(codePath) || !fs.existsSync(varsTemplate)) {
    return null;
  }

  // 复制变量模板到IPC目录
  const varsPath = path.join(options.ipcDir, 'edk2-vars.fd');
  if (!fs.existsSync(varsPath)) {
    try {
      fs.copyFileSync(varsTemplate, varsPath);
    } catch (error) {
      console.warn('准备QEMU变量文件失败:', error);
    }
  }
  return { codePath, varsPath };
}

/**
 * 构建QEMU命令行参数
 * 根据运行时配置和平台特性生成完整的QEMU启动参数
 * @param options - QEMU配置选项
 * @returns QEMU命令行参数数组
 */
function buildQemuArgs(options: {
  runtime: SandboxRuntimeInfo;
  ipcDir: string;
  cwdMapping: SandboxCwdMapping;
  extraMounts?: SandboxExtraMount[];
  accelOverride?: string | null;
  ipcPort?: number;
  skillsDir?: string;
}): string[] {
  // 基础QEMU参数：内存、CPU核心、无图形界面、快照模式
  const args: string[] = [
    '-m', '4096',
    '-smp', '2',
    '-nographic',
    '-snapshot',
  ];

  // 设置虚拟化加速
  const accel = options.accelOverride !== undefined
    ? options.accelOverride
    : getPreferredAccel();
  if (accel) {
    const accelArg = accel === 'tcg' ? 'tcg,thread=multi' : accel;
    args.push('-accel', accelArg);
  }

  // ARM64架构特殊配置
  if (options.runtime.arch === 'arm64') {
    const cpu = accel && accel !== 'tcg' ? 'host' : 'cortex-a57';
    args.push('-machine', 'virt', '-cpu', cpu);

    const kernelPath = options.runtime.kernelPath;
    const initrdPath = options.runtime.initrdPath;
    const hasKernel = Boolean(kernelPath && initrdPath && fs.existsSync(kernelPath) && fs.existsSync(initrdPath));

    if (hasKernel) {
      // 使用内核直接引导方式
      args.push(
        '-kernel', kernelPath as string,
        '-initrd', initrdPath as string,
        '-append',
        [
          'root=/dev/vda2',
          'rootfstype=ext4',
          'rw',
          'console=ttyAMA0,115200',
          'loglevel=4',
          'init=/sbin/init',
          'quiet',
        ].join(' ')
      );
    } else {
      // 使用UEFI固件引导方式
      const firmware = resolveAarch64Firmware(options);
      if (firmware) {
        args.push(
          '-drive', `if=pflash,format=raw,readonly=on,file=${firmware.codePath}`,
          '-drive', `if=pflash,format=raw,file=${firmware.varsPath}`
        );
      }
    }
  }

  // 配置磁盘和网络设备
  args.push(
    '-drive', `file=${options.runtime.imagePath},if=virtio,format=qcow2`,
    '-netdev', 'user,id=net0',
    '-device', 'virtio-net,netdev=net0'
  );

  if (options.runtime.platform === 'win32') {
    // Windows平台的QEMU不支持virtfs（9p文件系统）
    // 改用virtio-serial作为双向IPC通道
    if (options.ipcPort) {
      args.push(
        '-device', 'virtio-serial-pci',
        '-chardev', `socket,id=ipc,host=127.0.0.1,port=${options.ipcPort},server=on,wait=off`,
        '-device', 'virtserialport,chardev=ipc,name=ipc.0'
      );
    }
  } else {
    // macOS / Linux：使用virtfs（9p）进行目录共享
    args.push(
      '-virtfs',
      `local,path=${options.ipcDir},mount_tag=ipc,security_model=none`
    );
    args.push(
      '-virtfs',
      `local,path=${options.cwdMapping.hostPath},mount_tag=${options.cwdMapping.mountTag},security_model=none`
    );
    // 挂载额外的目录
    for (const mount of options.extraMounts ?? []) {
      args.push(
        '-virtfs',
        `local,path=${mount.hostPath},mount_tag=${mount.mountTag},security_model=none`
      );
    }
    // 如果没有显式指定额外挂载，则挂载技能目录
    const hasExplicitExtraMounts = (options.extraMounts ?? []).length > 0;
    if (!hasExplicitExtraMounts && options.skillsDir && fs.existsSync(options.skillsDir)) {
      args.push(
        '-virtfs',
        `local,path=${options.skillsDir},mount_tag=skills,security_model=none`
      );
    }
  }

  // 配置串口输出到日志文件
  args.push(
    '-serial',
    `file:${path.join(options.ipcDir, 'serial.log')}`
  );

  return args;
}

/**
 * 查找可用的TCP端口
 * 通过临时绑定到端口0来在127.0.0.1上查找空闲端口
 * @returns Promise，解析为可用端口号
 */
export function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as net.AddressInfo;
      const port = addr.port;
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

/**
 * 启动协作沙箱虚拟机
 * 根据配置生成QEMU参数并启动虚拟机进程
 * @param options - 虚拟机启动配置选项
 * @returns 子进程对象
 */
export function spawnCoworkSandboxVm(options: {
  runtime: SandboxRuntimeInfo;
  ipcDir: string;
  cwdMapping: SandboxCwdMapping;
  extraMounts?: SandboxExtraMount[];
  accelOverride?: string | null;
  launcher?: SandboxLauncherMode;
  ipcPort?: number;
  skillsDir?: string;
}): ChildProcessByStdio<null, Readable, Readable> {
  const args = buildQemuArgs(options);

  coworkLog('INFO', 'spawnSandboxVm', '正在启动QEMU', {
    runtimeBinary: options.runtime.runtimeBinary,
    runtimeExists: fs.existsSync(options.runtime.runtimeBinary),
    imageExists: fs.existsSync(options.runtime.imagePath),
    ipcPort: options.ipcPort ?? null,
    launcher: options.launcher ?? 'direct',
    accelOverride: options.accelOverride ?? null,
    args: args.join(' '),
  });

  // macOS平台使用launchctl以当前用户身份启动
  if (options.launcher === 'launchctl' && process.platform === 'darwin') {
    const uid = typeof process.getuid === 'function' ? process.getuid() : null;
    if (uid !== null) {
      return spawn('/bin/launchctl', ['asuser', String(uid), options.runtime.runtimeBinary, ...args], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    }
  }
  return spawn(options.runtime.runtimeBinary, args, { stdio: ['ignore', 'pipe', 'pipe'] });
}

// ---------------------------------------------------------------------------
// VirtioSerialBridge — Windows virtio-serial IPC的TCP桥接器
// ---------------------------------------------------------------------------
// QEMU将虚拟机内的virtio-serial端口暴露为TCP服务器。桥接器作为TCP客户端
// 连接，并翻译JSON行消息：
//   虚拟机 → 主机：心跳、流数据、响应 → 写入本地ipcDir文件
//   主机 → 虚拟机：请求、权限响应 → 通过TCP发送
// 这使得主机端现有的文件轮询代码（waitForVmReady、readSandboxStream）
// 无需修改即可正常工作。
// ---------------------------------------------------------------------------

/**
 * Virtio串口桥接器类
 * 用于Windows平台的virtio-serial IPC通信
 */
export class VirtioSerialBridge {
  private socket: net.Socket | null = null;
  private buffer = '';
  private ipcDir: string;
  private hostCwd: string | null = null;
  private connected = false;
  // 分块传输缓冲区：transferId -> { chunks, totalChunks, path }
  private pendingTransfers: Map<string, {
    chunks: Map<number, Buffer>;
    totalChunks: number;
    path: string;
  }> = new Map();

  constructor(ipcDir: string, hostCwd?: string) {
    this.ipcDir = ipcDir;
    this.hostCwd = hostCwd ?? null;
  }

  /**
   * 更新主机工作目录（用于文件同步，例如多轮对话续接时）
   * @param hostCwd - 主机当前工作目录
   */
  setHostCwd(hostCwd: string): void {
    this.hostCwd = hostCwd;
  }

  /**
   * 尝试连接到QEMU的virtio-serial TCP服务器（带重试）
   * QEMU在启动后可能需要片刻才能开始监听
   * @param port - TCP端口号
   * @param timeoutMs - 超时时间（毫秒），默认30000
   */
  async connect(port: number, timeoutMs = 30000): Promise<void> {
    const start = Date.now();
    const retryDelay = 500;
    let attempts = 0;
    let lastError: string | undefined;

    coworkLog('INFO', 'VirtioSerialBridge', `正在连接QEMU串口，端口 ${port}`, {
      timeoutMs,
    });

    while (Date.now() - start < timeoutMs) {
      attempts++;
      try {
        await this.tryConnect(port);
        this.connected = true;
        coworkLog('INFO', 'VirtioSerialBridge', `已连接到QEMU串口，端口 ${port}`, {
          attempts,
          elapsed: Date.now() - start,
        });
        console.log(`[VirtioSerialBridge] 已连接到QEMU串口，端口 ${port}`);
        return;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        await new Promise(r => setTimeout(r, retryDelay));
      }
    }

    coworkLog('ERROR', 'VirtioSerialBridge', `连接端口 ${port} 失败`, {
      attempts,
      elapsed: Date.now() - start,
      lastError,
    });
    throw new Error(`[VirtioSerialBridge] 在 ${timeoutMs} 毫秒内未能连接到端口 ${port}`);
  }

  /**
   * 尝试单次连接
   * @param port - TCP端口号
   */
  private tryConnect(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const sock = net.createConnection({ host: '127.0.0.1', port }, () => {
        this.socket = sock;
        this.setupReader(sock);
        resolve();
      });
      sock.on('error', reject);
    });
  }

  /**
   * 设置数据读取器
   * 处理来自socket的数据流，按行解析JSON消息
   * @param sock - TCP socket连接
   */
  private setupReader(sock: net.Socket): void {
    const decoder = new StringDecoder('utf8');

    sock.on('data', (chunk: Buffer) => {
      this.buffer += decoder.write(chunk);
      let idx: number;
      // 按换行符分割消息
      while ((idx = this.buffer.indexOf('\n')) !== -1) {
        const line = this.buffer.slice(0, idx).trim();
        this.buffer = this.buffer.slice(idx + 1);
        if (line) this.handleLine(line);
      }
    });
    sock.on('close', () => {
      // 处理缓冲区中剩余的数据
      const tail = decoder.end();
      if (tail) {
        this.buffer += tail;
      }
      const finalLine = this.buffer.trim();
      if (finalLine) {
        this.handleLine(finalLine);
      }
      this.buffer = '';
      this.connected = false;
      console.warn('[VirtioSerialBridge] 连接已关闭');
    });
    sock.on('error', (err) => {
      console.warn('[VirtioSerialBridge] Socket错误:', err.message);
    });
  }

  /**
   * 处理单行消息
   * 解析JSON并根据消息类型分发到对应的处理器
   * @param line - JSON格式的消息行
   */
  private handleLine(line: string): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(line);
    } catch {
      return; // 跳过非JSON行（例如内核启动消息）
    }

    const msgType = String(msg.type ?? '');

    // 处理心跳消息
    if (msgType === 'heartbeat') {
      try {
        fs.writeFileSync(path.join(this.ipcDir, 'heartbeat'), JSON.stringify(msg));
      } catch { /* 尽力而为 */ }
      return;
    }

    // 处理流数据消息
    if (msgType === 'stream') {
      const requestId = String(msg.requestId ?? '');
      const streamLine = String(msg.line ?? '');
      if (requestId && streamLine) {
        const streamPath = path.join(this.ipcDir, 'streams', `${requestId}.log`);
        try {
          fs.appendFileSync(streamPath, streamLine + '\n');
        } catch { /* 尽力而为 */ }
      }
      return;
    }

    // 处理文件同步消息
    if (msgType === 'file_sync') {
      this.handleFileSync(msg);
      return;
    }

    // 处理文件同步分块消息
    if (msgType === 'file_sync_chunk') {
      this.handleFileSyncChunk(msg);
      return;
    }

    // 处理文件同步完成消息
    if (msgType === 'file_sync_complete') {
      this.handleFileSyncComplete(msg);
      return;
    }
  }

  // -------------------------------------------------------------------------
  // 文件同步处理器 — 虚拟机到主机的文件传输
  // -------------------------------------------------------------------------

  /**
   * 验证并将虚拟机相对路径解析为主机绝对路径
   * 如果路径无效或逃逸主机工作目录则返回null
   * @param relativePath - 相对路径
   * @returns 主机绝对路径，如果无效则返回null
   */
  private resolveHostPath(relativePath: string): string | null {
    if (!this.hostCwd) return null;
    if (!relativePath) return null;

    // 将虚拟机的正斜杠规范化为平台分隔符
    const normalized = relativePath.replace(/\//g, path.sep);
    const resolved = path.resolve(this.hostCwd, normalized);

    // 安全检查：确保解析后的路径保持在hostCwd内
    const resolvedCwd = path.resolve(this.hostCwd);
    if (!resolved.startsWith(resolvedCwd + path.sep) && resolved !== resolvedCwd) {
      console.warn(`[VirtioSerialBridge] 拒绝路径遍历攻击: ${relativePath}`);
      return null;
    }

    return resolved;
  }

  /**
   * 处理文件同步消息
   * 将虚拟机传输的文件写入主机文件系统
   * @param msg - 文件同步消息对象
   */
  private handleFileSync(msg: Record<string, unknown>): void {
    const relativePath = String(msg.path ?? '');
    const data = String(msg.data ?? '');

    const hostPath = this.resolveHostPath(relativePath);
    if (!hostPath) return;

    try {
      // 确保父目录存在
      fs.mkdirSync(path.dirname(hostPath), { recursive: true });
      // 解码base64并写入文件
      fs.writeFileSync(hostPath, Buffer.from(data, 'base64'));
      console.log(`[VirtioSerialBridge] 文件已同步: ${relativePath}`);
    } catch (error) {
      console.warn(`[VirtioSerialBridge] 文件同步错误 ${relativePath}:`, error);
    }
  }

  /**
   * 处理文件同步分块消息
   * 接收并缓存文件分块数据
   * @param msg - 分块消息对象
   */
  private handleFileSyncChunk(msg: Record<string, unknown>): void {
    const transferId = String(msg.transferId ?? '');
    const relativePath = String(msg.path ?? '');
    const chunkIndex = Number(msg.chunkIndex ?? 0);
    const totalChunks = Number(msg.totalChunks ?? 0);
    const data = String(msg.data ?? '');

    if (!transferId || !relativePath || !data) return;

    // 提前验证路径
    if (!this.resolveHostPath(relativePath)) return;

    // 初始化传输记录
    if (!this.pendingTransfers.has(transferId)) {
      this.pendingTransfers.set(transferId, {
        chunks: new Map(),
        totalChunks,
        path: relativePath,
      });
    }

    const transfer = this.pendingTransfers.get(transferId)!;
    transfer.chunks.set(chunkIndex, Buffer.from(data, 'base64'));

    // 如果所有分块都已接收，立即组装并写入
    if (transfer.chunks.size === transfer.totalChunks) {
      this.assembleAndWriteChunked(transferId);
    }
  }

  /**
   * 处理文件同步完成消息
   * 触发分块文件的最终组装
   * @param msg - 完成消息对象
   */
  private handleFileSyncComplete(msg: Record<string, unknown>): void {
    const transferId = String(msg.transferId ?? '');
    if (!transferId) return;

    const transfer = this.pendingTransfers.get(transferId);
    if (transfer && transfer.chunks.size === transfer.totalChunks) {
      this.assembleAndWriteChunked(transferId);
    }

    // 超时后清理未完成的传输
    setTimeout(() => {
      if (this.pendingTransfers.has(transferId)) {
        console.warn(`[VirtioSerialBridge] 清理未完成的传输 ${transferId}`);
        this.pendingTransfers.delete(transferId);
      }
    }, 30000);
  }

  /**
   * 组装分块数据并写入文件
   * 将所有分块按顺序合并后写入主机文件系统
   * @param transferId - 传输ID
   */
  private assembleAndWriteChunked(transferId: string): void {
    const transfer = this.pendingTransfers.get(transferId);
    if (!transfer) return;

    const hostPath = this.resolveHostPath(transfer.path);
    if (!hostPath) {
      this.pendingTransfers.delete(transferId);
      return;
    }

    try {
      fs.mkdirSync(path.dirname(hostPath), { recursive: true });

      // 按顺序组装分块
      const buffers: Buffer[] = [];
      for (let i = 0; i < transfer.totalChunks; i++) {
        const chunk = transfer.chunks.get(i);
        if (!chunk) {
          console.warn(`[VirtioSerialBridge] 传输 ${transferId} 缺少分块 ${i}`);
          this.pendingTransfers.delete(transferId);
          return;
        }
        buffers.push(chunk);
      }

      fs.writeFileSync(hostPath, Buffer.concat(buffers));
      console.log(`[VirtioSerialBridge] 分块文件已同步: ${transfer.path}`);
    } catch (error) {
      console.warn(`[VirtioSerialBridge] 分块文件写入错误 ${transfer.path}:`, error);
    } finally {
      this.pendingTransfers.delete(transferId);
    }
  }

  /**
   * 通过串口向虚拟机发送沙箱请求
   * @param requestId - 请求ID
   * @param data - 请求数据
   */
  sendRequest(requestId: string, data: Record<string, unknown>): void {
    this.sendLine({ type: 'request', requestId, data });
  }

  /**
   * 通过串口向虚拟机发送权限响应
   * @param requestId - 请求ID
   * @param result - 权限检查结果
   */
  sendPermissionResponse(requestId: string, result: Record<string, unknown>): void {
    this.sendLine({ type: 'permission_response', requestId, result });
  }

  /**
   * 通过串口向虚拟机发送主机工具响应
   * @param requestId - 请求ID
   * @param payload - 响应负载
   */
  sendHostToolResponse(requestId: string, payload: Record<string, unknown>): void {
    this.sendLine({
      type: 'host_tool_response',
      requestId,
      ...payload,
    });
  }

  /**
   * 通过串口将文件从主机推送到虚拟机
   * 用于在Windows平台（不支持9p）将技能文件传输到沙箱中
   * @param basePath - 基础路径
   * @param relativePath - 相对路径
   * @param data - 文件数据
   */
  pushFile(basePath: string, relativePath: string, data: Buffer): void {
    coworkLog('INFO', 'VirtioSerialBridge', `推送文件: ${relativePath} (${data.length} 字节) -> ${basePath}/${relativePath}`);
    const CHUNK_SIZE = 512 * 1024; // 每个分块512 KB
    // 使用正斜杠以保持跨平台路径一致性
    const syncPath = relativePath.replace(/\\/g, '/');

    if (data.length <= CHUNK_SIZE) {
      // 小文件直接发送
      this.sendLine({
        type: 'push_file',
        basePath,
        path: syncPath,
        data: data.toString('base64'),
      });
    } else {
      // 大文件分块传输
      const transferId = uuidv4();
      const totalChunks = Math.ceil(data.length / CHUNK_SIZE);
      for (let i = 0; i < totalChunks; i++) {
        const start = i * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, data.length);
        this.sendLine({
          type: 'push_file_chunk',
          transferId,
          basePath,
          path: syncPath,
          chunkIndex: i,
          totalChunks,
          data: data.subarray(start, end).toString('base64'),
        });
      }
      // 发送传输完成消息
      this.sendLine({
        type: 'push_file_complete',
        transferId,
        basePath,
        path: syncPath,
        totalChunks,
      });
    }
  }

  /**
   * 发送单行JSON数据
   * @param data - 要发送的数据对象
   */
  private sendLine(data: Record<string, unknown>): void {
    if (this.socket && this.connected) {
      this.socket.write(JSON.stringify(data) + '\n');
    } else {
      coworkLog('WARN', 'VirtioSerialBridge', `发送失败（未连接）: type=${String(data.type ?? 'unknown')}`);
    }
  }

  /**
   * 关闭连接并清理资源
   */
  close(): void {
    this.socket?.destroy();
    this.socket = null;
    this.connected = false;
    this.pendingTransfers.clear();
  }
}
