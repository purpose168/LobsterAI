import { app, session } from 'electron';
import { createHash } from 'crypto';
import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { createGunzip } from 'zlib';
import { spawnSync } from 'child_process';
import { coworkLog } from './coworkLogger';

export type CoworkSandboxStatus = {
  supported: boolean;
  runtimeReady: boolean;
  imageReady: boolean;
  downloading: boolean;
  progress?: CoworkSandboxProgress;
  error?: string | null;
};

export type CoworkSandboxProgress = {
  stage: 'runtime' | 'image';
  received: number;
  total?: number;
  percent?: number;
  url?: string;
};

export type SandboxRuntimeInfo = {
  platform: NodeJS.Platform;
  arch: NodeJS.Architecture;
  runtimeBinary: string;
  imagePath: string;
  kernelPath?: string | null;
  initrdPath?: string | null;
  baseDir: string;
};

type SandboxCheckResult = { ok: true; runtimeInfo: SandboxRuntimeInfo } | { ok: false; error: string };

const SANDBOX_BASE_URL = process.env.COWORK_SANDBOX_BASE_URL || '';
const SANDBOX_RUNTIME_VERSION = process.env.COWORK_SANDBOX_RUNTIME_VERSION || 'v0.1.3';
const SANDBOX_IMAGE_VERSION = process.env.COWORK_SANDBOX_IMAGE_VERSION || 'v0.1.3';

const SANDBOX_RUNTIME_URL = process.env.COWORK_SANDBOX_RUNTIME_URL;
const SANDBOX_IMAGE_URL = process.env.COWORK_SANDBOX_IMAGE_URL;
const SANDBOX_IMAGE_URL_ARM64 = process.env.COWORK_SANDBOX_IMAGE_URL_ARM64;
const SANDBOX_IMAGE_URL_AMD64 = process.env.COWORK_SANDBOX_IMAGE_URL_AMD64;
const SANDBOX_KERNEL_URL = process.env.COWORK_SANDBOX_KERNEL_URL;
const SANDBOX_KERNEL_URL_ARM64 = process.env.COWORK_SANDBOX_KERNEL_URL_ARM64;
const SANDBOX_KERNEL_URL_AMD64 = process.env.COWORK_SANDBOX_KERNEL_URL_AMD64;
const SANDBOX_INITRD_URL = process.env.COWORK_SANDBOX_INITRD_URL;
const SANDBOX_INITRD_URL_ARM64 = process.env.COWORK_SANDBOX_INITRD_URL_ARM64;
const SANDBOX_INITRD_URL_AMD64 = process.env.COWORK_SANDBOX_INITRD_URL_AMD64;
const SANDBOX_KERNEL_PATH = process.env.COWORK_SANDBOX_KERNEL_PATH;
const SANDBOX_KERNEL_PATH_ARM64 = process.env.COWORK_SANDBOX_KERNEL_PATH_ARM64;
const SANDBOX_KERNEL_PATH_AMD64 = process.env.COWORK_SANDBOX_KERNEL_PATH_AMD64;
const SANDBOX_INITRD_PATH = process.env.COWORK_SANDBOX_INITRD_PATH;
const SANDBOX_INITRD_PATH_ARM64 = process.env.COWORK_SANDBOX_INITRD_PATH_ARM64;
const SANDBOX_INITRD_PATH_AMD64 = process.env.COWORK_SANDBOX_INITRD_PATH_AMD64;

const SANDBOX_RUNTIME_SHA256 = process.env.COWORK_SANDBOX_RUNTIME_SHA256;
const SANDBOX_IMAGE_SHA256 = process.env.COWORK_SANDBOX_IMAGE_SHA256;
const SANDBOX_IMAGE_SHA256_ARM64 = process.env.COWORK_SANDBOX_IMAGE_SHA256_ARM64;
const SANDBOX_IMAGE_SHA256_AMD64 = process.env.COWORK_SANDBOX_IMAGE_SHA256_AMD64;

// 不同架构的默认沙箱资源
// 注意：macOS 二进制文件是静态链接的，Windows 需要完整的 QEMU 安装
const DEFAULT_SANDBOX_RUNTIME_URL_DARWIN_ARM64 = 'https://ydhardwarecommon.nosdn.127.net/f23e57c47e4356c31b5bf1012f10a53e.gz';
const DEFAULT_SANDBOX_RUNTIME_URL_DARWIN_AMD64 = 'https://ydhardwarecommon.nosdn.127.net/20a9f6a34705ca51dbd9fb8c7695c1e5.gz';
const DEFAULT_SANDBOX_RUNTIME_URL_WIN32_AMD64 = 'https://ydhardwarecommon.nosdn.127.net/02a016878c4457bd819e11e55b7b6884.gz';

const DEFAULT_SANDBOX_IMAGE_URL_ARM64 = 'https://ydhardwarecommon.nosdn.127.net/59d9df60ce9c0463c54e3043af60cb10.qcow2';
const DEFAULT_SANDBOX_IMAGE_URL_AMD64 = 'https://ydhardwarecommon.nosdn.127.net/42bf8972948823142f5f5729872c925b.qcow2';

const downloadState: {
  runtime: Promise<string> | null;
  image: Promise<string> | null;
  progress?: CoworkSandboxProgress;
  error: string | null;
} = {
  runtime: null,
  image: null,
  progress: undefined,
  error: null,
};

// 缓存已解析的系统 QEMU 路径（仅限 Windows），以便 getSandboxStatus()
// 在使用系统安装的 QEMU 时可以报告 runtimeReady=true。
let _resolvedSystemQemuPath: string | null = null;

const sandboxEvents = new EventEmitter();

function emitProgress(progress: CoworkSandboxProgress): void {
  downloadState.progress = progress;
  sandboxEvents.emit('progress', progress);
}

export function onSandboxProgress(listener: (progress: CoworkSandboxProgress) => void): () => void {
  sandboxEvents.on('progress', listener);
  return () => sandboxEvents.off('progress', listener);
}

function getPlatformKey(): string | null {
  if (!['darwin', 'win32', 'linux'].includes(process.platform)) {
    return null;
  }
  if (!['x64', 'arm64'].includes(process.arch)) {
    return null;
  }
  return `${process.platform}-${process.arch}`;
}

function getRuntimeBinaryName(): string {
  const isWindows = process.platform === 'win32';
  if (process.arch === 'arm64') {
    return isWindows ? 'qemu-system-aarch64.exe' : 'qemu-system-aarch64';
  }
  return isWindows ? 'qemu-system-x86_64.exe' : 'qemu-system-x86_64';
}

function getSandboxPaths() {
  const baseDir = path.join(app.getPath('userData'), 'cowork', 'sandbox');
  const runtimeDir = path.join(baseDir, 'runtime', `${SANDBOX_RUNTIME_VERSION}`);
  const imageDir = path.join(baseDir, 'images', `${SANDBOX_IMAGE_VERSION}`);
  const runtimeBinary = path.join(runtimeDir, getRuntimeBinaryName());
  const imagePath = path.join(imageDir, `linux-${process.arch}.qcow2`);
  return { baseDir, runtimeDir, imageDir, runtimeBinary, imagePath };
}

function getRuntimeUrl(platformKey: string): string | null {
  if (SANDBOX_RUNTIME_URL) {
    return SANDBOX_RUNTIME_URL;
  }
  if (platformKey === 'darwin-arm64' && DEFAULT_SANDBOX_RUNTIME_URL_DARWIN_ARM64) {
    return DEFAULT_SANDBOX_RUNTIME_URL_DARWIN_ARM64;
  }
  if (platformKey === 'darwin-x64' && DEFAULT_SANDBOX_RUNTIME_URL_DARWIN_AMD64) {
    return DEFAULT_SANDBOX_RUNTIME_URL_DARWIN_AMD64;
  }
  // Windows x64：使用来自 CDN 的 NSIS 安装程序包
  if (platformKey === 'win32-x64' && DEFAULT_SANDBOX_RUNTIME_URL_WIN32_AMD64) {
    return DEFAULT_SANDBOX_RUNTIME_URL_WIN32_AMD64;
  }
  // Windows arm64：尚无默认 URL
  if (platformKey.startsWith('win32')) {
    return null;
  }
  if (!SANDBOX_BASE_URL) {
    return null;
  }
  return `${SANDBOX_BASE_URL}/${SANDBOX_RUNTIME_VERSION}/runtime-${platformKey}.tar.gz`;
}

function getArchVariant(): 'amd64' | 'arm64' | null {
  if (process.arch === 'x64') {
    return 'amd64';
  }
  if (process.arch === 'arm64') {
    return 'arm64';
  }
  return null;
}

function getImageUrl(): string | null {
  const archVariant = getArchVariant();
  if (archVariant === 'arm64' && (SANDBOX_IMAGE_URL_ARM64 || DEFAULT_SANDBOX_IMAGE_URL_ARM64)) {
    return SANDBOX_IMAGE_URL_ARM64 || DEFAULT_SANDBOX_IMAGE_URL_ARM64;
  }
  if (archVariant === 'amd64' && (SANDBOX_IMAGE_URL_AMD64 || DEFAULT_SANDBOX_IMAGE_URL_AMD64)) {
    return SANDBOX_IMAGE_URL_AMD64 || DEFAULT_SANDBOX_IMAGE_URL_AMD64;
  }
  if (SANDBOX_IMAGE_URL) {
    return SANDBOX_IMAGE_URL;
  }
  if (!SANDBOX_BASE_URL) {
    return null;
  }
  return `${SANDBOX_BASE_URL}/${SANDBOX_IMAGE_VERSION}/image-linux-${process.arch}.qcow2`;
}

function getImageSha256(): string | null {
  const archVariant = getArchVariant();
  if (archVariant === 'arm64' && SANDBOX_IMAGE_SHA256_ARM64) {
    return SANDBOX_IMAGE_SHA256_ARM64;
  }
  if (archVariant === 'amd64' && SANDBOX_IMAGE_SHA256_AMD64) {
    return SANDBOX_IMAGE_SHA256_AMD64;
  }
  return SANDBOX_IMAGE_SHA256 || null;
}

function getKernelUrl(): string | null {
  const archVariant = getArchVariant();
  if (archVariant === 'arm64' && SANDBOX_KERNEL_URL_ARM64) {
    return SANDBOX_KERNEL_URL_ARM64;
  }
  if (archVariant === 'amd64' && SANDBOX_KERNEL_URL_AMD64) {
    return SANDBOX_KERNEL_URL_AMD64;
  }
  return SANDBOX_KERNEL_URL || null;
}

function getInitrdUrl(): string | null {
  const archVariant = getArchVariant();
  if (archVariant === 'arm64' && SANDBOX_INITRD_URL_ARM64) {
    return SANDBOX_INITRD_URL_ARM64;
  }
  if (archVariant === 'amd64' && SANDBOX_INITRD_URL_AMD64) {
    return SANDBOX_INITRD_URL_AMD64;
  }
  return SANDBOX_INITRD_URL || null;
}

function getKernelPathOverride(): string | null {
  const archVariant = getArchVariant();
  if (archVariant === 'arm64' && SANDBOX_KERNEL_PATH_ARM64) {
    return SANDBOX_KERNEL_PATH_ARM64;
  }
  if (archVariant === 'amd64' && SANDBOX_KERNEL_PATH_AMD64) {
    return SANDBOX_KERNEL_PATH_AMD64;
  }
  return SANDBOX_KERNEL_PATH || null;
}

function getInitrdPathOverride(): string | null {
  const archVariant = getArchVariant();
  if (archVariant === 'arm64' && SANDBOX_INITRD_PATH_ARM64) {
    return SANDBOX_INITRD_PATH_ARM64;
  }
  if (archVariant === 'amd64' && SANDBOX_INITRD_PATH_AMD64) {
    return SANDBOX_INITRD_PATH_AMD64;
  }
  return SANDBOX_INITRD_PATH || null;
}

async function downloadFile(url: string, destination: string, stage: CoworkSandboxProgress['stage']): Promise<void> {
  const response = await session.defaultSession.fetch(url);
  if (!response.ok) {
    throw new Error(`下载失败 (${response.status}): ${url}`);
  }

  await fs.promises.mkdir(path.dirname(destination), { recursive: true });

  if (!response.body) {
    const data = Buffer.from(await response.arrayBuffer());
    await fs.promises.writeFile(destination, data);
    emitProgress({
      stage,
      received: data.length,
      total: data.length,
      percent: 1,
      url,
    });
    return;
  }

  const totalHeader = response.headers.get('content-length');
  const total = totalHeader ? Number(totalHeader) : undefined;
  let received = 0;
  emitProgress({
    stage,
    received,
    total: total && Number.isFinite(total) ? total : undefined,
    percent: total && Number.isFinite(total) ? 0 : undefined,
    url,
  });

  const nodeStream = Readable.fromWeb(response.body as any);
  nodeStream.on('data', (chunk: Buffer) => {
    received += chunk.length;
    emitProgress({
      stage,
      received,
      total: total && Number.isFinite(total) ? total : undefined,
      percent: total && Number.isFinite(total) ? received / total : undefined,
      url,
    });
  });

  await pipeline(nodeStream, fs.createWriteStream(destination));

  emitProgress({
    stage,
    received,
    total: total && Number.isFinite(total) ? total : undefined,
    percent: total && Number.isFinite(total) ? 1 : undefined,
    url,
  });
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  const stream = fs.createReadStream(filePath);
  await new Promise<void>((resolve, reject) => {
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve());
    stream.on('error', reject);
  });
  return hash.digest('hex');
}

async function verifySha256(filePath: string, expected?: string | null): Promise<void> {
  if (!expected) return;
  const actual = await sha256File(filePath);
  if (actual.toLowerCase() !== expected.toLowerCase()) {
    throw new Error(`${path.basename(filePath)} 的校验和不匹配`);
  }
}

function extractTarArchive(archivePath: string, destDir: string): void {
  const result = spawnSync('tar', ['-xf', archivePath, '-C', destDir], { stdio: 'pipe' });
  if (result.status !== 0) {
    throw new Error(result.stderr?.toString() || '解压 tar 归档文件失败');
  }
}

function extractArchive(archivePath: string, destDir: string): void {
  if (archivePath.endsWith('.zip')) {
    if (process.platform === 'win32') {
      const result = spawnSync(
        'powershell',
        ['-NoProfile', '-Command', `Expand-Archive -Force "${archivePath}" "${destDir}"`],
        { stdio: 'pipe' }
      );
      if (result.status !== 0) {
        throw new Error(result.stderr?.toString() || '解压 zip 归档文件失败');
      }
    } else {
      const result = spawnSync('unzip', ['-q', archivePath, '-d', destDir], { stdio: 'pipe' });
      if (result.status !== 0) {
        throw new Error(result.stderr?.toString() || '解压 zip 归档文件失败');
      }
    }
    return;
  }

  if (archivePath.endsWith('.tar')) {
    extractTarArchive(archivePath, destDir);
    return;
  }

  if (archivePath.endsWith('.tar.gz') || archivePath.endsWith('.tgz')) {
    const result = spawnSync('tar', ['-xzf', archivePath, '-C', destDir], { stdio: 'pipe' });
    if (result.status !== 0) {
      throw new Error(result.stderr?.toString() || '解压 tar 归档文件失败');
    }
    return;
  }

  throw new Error('不支持的运行时归档格式');
}

async function extractGzipBinary(archivePath: string, targetPath: string): Promise<void> {
  await pipeline(
    fs.createReadStream(archivePath),
    createGunzip(),
    fs.createWriteStream(targetPath)
  );
}

async function isTarFile(filePath: string): Promise<boolean> {
  try {
    const handle = await fs.promises.open(filePath, 'r');
    const buffer = Buffer.alloc(262);
    await handle.read(buffer, 0, 262, 0);
    await handle.close();
    const magic = buffer.subarray(257, 262).toString('utf8');
    return magic === 'ustar';
  } catch (error) {
    console.warn('探测沙箱运行时归档文件失败:', error);
    return false;
  }
}

async function isGzipFile(filePath: string): Promise<boolean> {
  try {
    const handle = await fs.promises.open(filePath, 'r');
    const buffer = Buffer.alloc(2);
    await handle.read(buffer, 0, 2, 0);
    await handle.close();
    return buffer[0] === 0x1f && buffer[1] === 0x8b;
  } catch (error) {
    console.warn('探测沙箱运行时二进制文件失败:', error);
    return false;
  }
}

async function isPEFile(filePath: string): Promise<boolean> {
  try {
    const handle = await fs.promises.open(filePath, 'r');
    const buffer = Buffer.alloc(2);
    await handle.read(buffer, 0, 2, 0);
    await handle.close();
    // MZ 魔数，用于 PE/COFF 可执行文件
    return buffer[0] === 0x4d && buffer[1] === 0x5a;
  } catch (error) {
    console.warn('探测文件 PE 头失败:', error);
    return false;
  }
}

/**
 * 以交互方式启动 NSIS 安装程序（类似于双击）并等待其完成。
 * 使用 PowerShell Start-Process，该命令内部调用 ShellExecute，
 * 能够正确处理 UAC 提升权限 —— 用户将看到标准的 Windows 提升权限提示和安装程序界面。
 */
async function runNsisInstaller(installerPath: string, targetDir: string): Promise<void> {
  await fs.promises.mkdir(targetDir, { recursive: true });

  console.log(`[沙箱] 正在以交互方式启动 QEMU 安装程序: ${installerPath}`);
  console.log(`[沙箱] 建议的安装目录: ${targetDir}`);

  // Start-Process 使用 ShellExecute，可以自动处理 UAC 提升权限。
  // -Wait 会阻塞直到安装程序退出。
  // /D= 在 NSIS UI 中预设安装目录（用户仍可更改）。
  const result = spawnSync('powershell.exe', [
    '-NoProfile', '-Command',
    `Start-Process -FilePath '${installerPath}' -ArgumentList '/D=${targetDir}' -Wait`,
  ], { stdio: 'pipe', timeout: 600000 }); // 10-minute timeout

  if (result.error) {
    throw new Error(`启动安装程序失败: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const stderr = result.stderr?.toString().trim() || '';
    throw new Error(
      `安装程序失败（退出代码 ${result.status}）: ${stderr || '用户可能取消了安装或拒绝了提升权限请求。'}`
    );
  }

  console.log('[沙箱] QEMU 安装程序进程已完成');
}

function resolveRuntimeBinary(runtimeDir: string, expectedPath: string): string | null {
  if (fs.existsSync(expectedPath)) {
    return expectedPath;
  }

  if (!fs.existsSync(runtimeDir)) {
    return null;
  }

  const targetName = path.basename(expectedPath);
  const stack = [runtimeDir];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(entryPath);
      } else if (entry.isFile() && entry.name === targetName) {
        return entryPath;
      }
    }
  }

  return null;
}

/**
 * 尝试在 Windows 系统路径中查找 QEMU
 */
function findSystemQemu(): string | null {
  if (process.platform !== 'win32') {
    return null;
  }

  const qemuName = getRuntimeBinaryName();

  // 检查 QEMU 是否在 PATH 中
  const result = spawnSync('where', [qemuName], { stdio: 'pipe' });
  if (result.status === 0 && result.stdout) {
    const paths = result.stdout.toString().trim().split('\n');
    for (const qemuPath of paths) {
      const trimmedPath = qemuPath.trim();
      if (fs.existsSync(trimmedPath)) {
        // 通过测试 --version 来验证其是否可执行
        const testResult = spawnSync(trimmedPath, ['--version'], { stdio: 'pipe', timeout: 5000 });
        if (testResult.status === 0 || testResult.status === 3221225781) {
          // 状态码 0 = 成功，3221225781 = DLL 问题但二进制文件存在
          // 对于 DLL 问题，我们仍然返回路径，但验证将在稍后失败
          return trimmedPath;
        }
      }
    }
  }

  // 检查常见安装路径
  const commonPaths = [
    'C:\\Program Files\\qemu',
    'C:\\Program Files (x86)\\qemu',
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'qemu'),
  ];

  for (const basePath of commonPaths) {
    const qemuPath = path.join(basePath, qemuName);
    if (fs.existsSync(qemuPath)) {
      return qemuPath;
    }
  }

  return null;
}

/**
 * 验证 QEMU 二进制文件是否可以实际运行（不仅仅是存在）
 */
function validateQemuBinary(binaryPath: string): { valid: boolean; error?: string } {
  if (!fs.existsSync(binaryPath)) {
    return { valid: false, error: '未找到二进制文件' };
  }

  // 尝试运行 --version 以验证二进制文件是否正常工作
  const result = spawnSync(binaryPath, ['--version'], { stdio: 'pipe', timeout: 5000 });

  // 退出代码 0 表示成功
  if (result.status === 0) {
    return { valid: true };
  }

  // 退出代码 3221225781 (0xC0000135) = STATUS_DLL_NOT_FOUND
  if (result.status === 3221225781) {
    return {
      valid: false,
      error: 'QEMU 二进制文件缺少所需的 DLL 文件。请正确安装 QEMU 或使用完整的 QEMU 安装包。',
    };
  }

  // 其他非零退出代码
  if (result.status !== null && result.status !== 0) {
    return {
      valid: false,
      error: `QEMU 二进制文件运行失败（退出代码: ${result.status}）。${result.stderr?.toString() || ''}`.trim(),
    };
  }

  // 超时或信号
  if (result.error) {
    return {
      valid: false,
      error: `运行 QEMU 失败: ${result.error.message}`,
    };
  }

  return { valid: false, error: '验证 QEMU 二进制文件时出现未知错误' };
}

/**
 * 检查 QEMU 二进制文件是否已编译支持 virtfs（9p 文件系统）。
 * 沙箱依赖 `-virtfs` 进行主机与虚拟机之间的文件共享；如果没有它，
 * 虚拟机将无法与主机通信。
 *
 * 在 Windows 上，virtfs 通常不受支持，因此我们跳过此检查，
 * 并使用 virtio-serial 作为替代的 IPC 通道。
 */
function checkQemuVirtfsSupport(binaryPath: string): boolean {
  // 在 Windows 上，QEMU 通常不支持 virtfs（9p 文件系统）
  // 我们改用 virtio-serial IPC，因此跳过此检查
  if (process.platform === 'win32') {
    return true; // 返回 true 以允许使用 Windows QEMU
  }

  const result = spawnSync(binaryPath, ['-help'], { stdio: 'pipe', timeout: 5000 });
  if (result.status === 0 && result.stdout) {
    return result.stdout.toString().includes('-virtfs');
  }
  return false;
}

function hasHypervisorEntitlement(output: string): boolean {
  return output.includes('com.apple.security.hypervisor');
}

function ensureHypervisorEntitlement(binaryPath: string, runtimeDir: string): void {
  if (process.platform !== 'darwin') return;

  const probe = spawnSync('codesign', ['-d', '--entitlements', ':-', binaryPath], { stdio: 'pipe' });
  if (probe.status === 0) {
    const stdout = probe.stdout?.toString() || '';
    const stderr = probe.stderr?.toString() || '';
    if (hasHypervisorEntitlement(stdout) || hasHypervisorEntitlement(stderr)) {
      return;
    }
  }

  const entitlementsPath = path.join(runtimeDir, 'entitlements.hypervisor.plist');
  const entitlements = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    '  <key>com.apple.security.hypervisor</key>',
    '  <true/>',
    '</dict>',
    '</plist>',
    '',
  ].join('\n');
  try {
    fs.writeFileSync(entitlementsPath, entitlements);
  } catch (error) {
    console.warn('写入虚拟机监控程序权限文件失败:', error);
    return;
  }

  const sign = spawnSync(
    'codesign',
    ['-s', '-', '--force', '--entitlements', entitlementsPath, binaryPath],
    { stdio: 'pipe' }
  );
  if (sign.status !== 0) {
    const stderr = sign.stderr?.toString() || sign.stdout?.toString() || 'Unknown codesign error';
    console.warn('为 HVF 签名沙箱运行时代码失败:', stderr.trim());
  }
}

async function ensureRuntime(): Promise<string> {
  const platformKey = getPlatformKey();
  if (!platformKey) {
    throw new Error('此平台不支持沙箱虚拟机。');
  }

  const { runtimeDir, runtimeBinary } = getSandboxPaths();
  const resolvedBinary = resolveRuntimeBinary(runtimeDir, runtimeBinary);
  if (resolvedBinary) {
    if (await isGzipFile(resolvedBinary)) {
      const tempPath = `${resolvedBinary}.tmp`;
      await extractGzipBinary(resolvedBinary, tempPath);
      if (await isTarFile(tempPath)) {
        extractTarArchive(tempPath, runtimeDir);
        await fs.promises.unlink(tempPath);
        try {
          await fs.promises.unlink(resolvedBinary);
        } catch (error) {
          console.warn('删除沙箱运行时 gzip 归档文件失败:', error);
        }
      } else {
        await fs.promises.rename(tempPath, resolvedBinary);
      }
    } else if (await isTarFile(resolvedBinary)) {
      extractTarArchive(resolvedBinary, runtimeDir);
      try {
        await fs.promises.unlink(resolvedBinary);
      } catch (error) {
        console.warn('删除沙箱运行时 tar 归档文件失败:', error);
      }
    }

    const finalResolved = resolveRuntimeBinary(runtimeDir, runtimeBinary);
    if (!finalResolved) {
      throw new Error('解压后未找到沙箱运行时二进制文件。');
    }

    // 记录验证结果但不删除或重新下载 —— 如果二进制文件
    // 损坏，错误将在虚拟机实际启动时显现。
    const validation = validateQemuBinary(finalResolved);
    if (!validation.valid) {
      console.warn(`[沙箱] QEMU 二进制文件验证警告: ${validation.error}`);
    }

    if (process.platform !== 'win32') {
      try {
        fs.chmodSync(finalResolved, 0o755);
      } catch (error) {
        console.warn('修改沙箱运行时二进制文件权限失败:', error);
      }
    }
    ensureHypervisorEntitlement(finalResolved, runtimeDir);
    return finalResolved;
  }

  // 在 Windows 上，尝试在下载之前查找系统安装的 QEMU
  if (process.platform === 'win32') {
    const systemQemu = findSystemQemu();
    if (systemQemu) {
      console.log(`[沙箱] 在系统中找到 QEMU: ${systemQemu}`);
      const validation = validateQemuBinary(systemQemu);
      if (validation.valid) {
        // 在 Windows 上，checkQemuVirtfsSupport 总是返回 true，因为我们使用 virtio-serial IPC 替代
        if (checkQemuVirtfsSupport(systemQemu)) {
          console.log('[沙箱] 使用系统安装的 QEMU');
          _resolvedSystemQemuPath = systemQemu;
          return systemQemu;
        }
        // 由于上面的检查，此分支在 Windows 上永远不会被执行
        console.warn('[沙箱] 系统 QEMU 缺少 virtfs (9p) 支持，将下载兼容版本');
      } else {
        console.warn(`[沙箱] 找到系统 QEMU 但无效: ${validation.error}`);
      }
    }
  }

  const url = getRuntimeUrl(platformKey);
  if (!url) {
    let errorMsg: string;
    if (platformKey === 'win32-x64' || platformKey === 'win32-arm64') {
      errorMsg = [
        'Windows 沙箱需要安装 QEMU。',
        '',
        '请使用以下方法之一安装 QEMU：',
        '1. 从以下地址下载并安装: https://qemu.weilnetz.de/w64/',
        '2. 通过 scoop 安装: scoop install qemu',
        '3. 通过 chocolatey 安装: choco install qemu',
        '',
        '安装后，QEMU 应该在您的系统 PATH 中可用。',
        '或者，将 COWORK_SANDBOX_RUNTIME_URL 环境变量设置为 QEMU 安装包 URL。',
      ].join('\n');
    } else {
      errorMsg = '沙箱运行时下载 URL 未配置。';
    }
    throw new Error(errorMsg);
  }

  const archivePath = path.join(runtimeDir, `runtime-${platformKey}.download`);
  await fs.promises.mkdir(runtimeDir, { recursive: true });

  await downloadFile(url, archivePath, 'runtime');
  await verifySha256(archivePath, SANDBOX_RUNTIME_SHA256);

  if (url.endsWith('.zip') || url.endsWith('.tar.gz') || url.endsWith('.tgz')) {
    extractArchive(archivePath, runtimeDir);
    await fs.promises.unlink(archivePath);
  } else if (url.endsWith('.gz')) {
    const tempPath = `${runtimeBinary}.download`;
    await extractGzipBinary(archivePath, tempPath);
    await fs.promises.unlink(archivePath);
    if (await isTarFile(tempPath)) {
      extractTarArchive(tempPath, runtimeDir);
      await fs.promises.unlink(tempPath);
    } else if (process.platform === 'win32' && await isPEFile(tempPath)) {
      // 解压后的文件是 Windows 可执行文件 —— 判断它是 QEMU 二进制文件
      // 本身还是安装程序（NSIS/Inno 等）
      const fileStats = await fs.promises.stat(tempPath);
      console.log(`[沙箱] 解压后的 PE 文件: ${fileStats.size} 字节`);

      // 快速检查：尝试 --version 以查看它是否已经是 QEMU 二进制文件
      const versionProbe = spawnSync(tempPath, ['--version'], { stdio: 'pipe', timeout: 5000 });
      const versionOutput = versionProbe.stdout?.toString().trim() || '';
      console.log(`[沙箱] PE --version 探测: 退出=${versionProbe.status}, 输出="${versionOutput.slice(0, 120)}"`);

      if (versionProbe.status === 0 && versionOutput.toLowerCase().includes('qemu')) {
        // 它是 QEMU 二进制文件本身，不是安装程序
        console.log('[沙箱] 下载的文件是 QEMU 二进制文件，直接重命名');
        await fs.promises.rename(tempPath, runtimeBinary);
      } else {
        // 视为安装程序（NSIS）
        const installerPath = path.join(runtimeDir, 'qemu-installer.exe');
        await fs.promises.rename(tempPath, installerPath);
        try {
          console.log(`[沙箱] 正在运行 QEMU NSIS 安装程序到: ${runtimeDir}`);
          await runNsisInstaller(installerPath, runtimeDir);
          console.log('[沙箱] QEMU NSIS 安装程序成功完成');
        } catch (error) {
          // 记录目录内容以便调试
          try {
            const entries = fs.readdirSync(runtimeDir);
            console.log(`[沙箱] 安装失败后的运行时目录内容: ${JSON.stringify(entries)}`);
          } catch { /* ignore */ }
          try { await fs.promises.unlink(installerPath); } catch { /* ignore */ }
          throw new Error(
            `安装 QEMU 失败: ${error instanceof Error ? error.message : String(error)}`
          );
        }
        // 记录安装成功后的目录内容
        try {
          const entries = fs.readdirSync(runtimeDir);
          console.log(`[沙箱] 安装后的运行时目录内容: ${JSON.stringify(entries)}`);
        } catch { /* ignore */ }
        // 清理安装程序可执行文件
        try {
          await fs.promises.unlink(installerPath);
        } catch (error) {
          console.warn('[沙箱] 安装后删除 QEMU 安装程序失败:', error);
        }
      }
    } else {
      await fs.promises.rename(tempPath, runtimeBinary);
    }
  } else {
    const targetPath = runtimeBinary;
    await fs.promises.rename(archivePath, targetPath);
  }

  const finalBinary = resolveRuntimeBinary(runtimeDir, runtimeBinary);
  if (!finalBinary) {
    // 记录目录内容以帮助诊断为何未找到二进制文件
    try {
      const listDir = (dir: string, prefix = ''): string[] => {
        const results: string[] = [];
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          results.push(`${prefix}${entry.name}${entry.isDirectory() ? '/' : ''}`);
          if (entry.isDirectory()) {
            results.push(...listDir(full, prefix + '  '));
          }
        }
        return results;
      };
      console.log(`[沙箱] 未找到二进制文件。正在查找: ${path.basename(runtimeBinary)}`);
      console.log(`[沙箱] 运行时目录树:\n${listDir(runtimeDir).join('\n')}`);
    } catch { /* ignore */ }
    throw new Error('解压后未找到沙箱运行时二进制文件。');
  }
  console.log(`[沙箱] 已解析的运行时二进制文件: ${finalBinary}`);

  // 记录验证结果但不阻塞 —— 错误将在虚拟机启动时显现
  const validation = validateQemuBinary(finalBinary);
  if (!validation.valid) {
    console.warn(`[沙箱] QEMU 二进制文件验证警告: ${validation.error}`);
  }

  if (process.platform !== 'win32') {
    try {
      fs.chmodSync(finalBinary, 0o755);
    } catch (error) {
      console.warn('修改沙箱运行时二进制文件权限失败:', error);
    }
  }
  ensureHypervisorEntitlement(finalBinary, runtimeDir);

  return finalBinary;
}

async function ensureImage(): Promise<string> {
  const { imageDir, imagePath } = getSandboxPaths();
  if (fs.existsSync(imagePath)) {
    return imagePath;
  }

  const url = getImageUrl();
  if (!url) {
    const errorMsg = process.platform === 'win32'
      ? 'Windows 沙箱镜像尚未配置。请设置 COWORK_SANDBOX_IMAGE_URL 或 COWORK_SANDBOX_BASE_URL 环境变量，或等待默认 Windows 镜像支持。'
      : '沙箱镜像下载 URL 未配置。';
    throw new Error(errorMsg);
  }

  await fs.promises.mkdir(imageDir, { recursive: true });
  const downloadPath = `${imagePath}.download`;
  await downloadFile(url, downloadPath, 'image');
  await verifySha256(downloadPath, getImageSha256());
  await fs.promises.rename(downloadPath, imagePath);
  return imagePath;
}

async function ensureKernel(): Promise<string | null> {
  const override = getKernelPathOverride();
  if (override && fs.existsSync(override)) {
    return override;
  }

  const archVariant = getArchVariant();
  if (!archVariant) return null;

  const { imageDir } = getSandboxPaths();
  const kernelPath = path.join(imageDir, `vmlinuz-virt-${archVariant}`);
  if (fs.existsSync(kernelPath)) {
    return kernelPath;
  }

  const url = getKernelUrl();
  if (!url) return null;
  await fs.promises.mkdir(imageDir, { recursive: true });
  const downloadPath = `${kernelPath}.download`;
  await downloadFile(url, downloadPath, 'image');
  await fs.promises.rename(downloadPath, kernelPath);
  return kernelPath;
}

async function ensureInitrd(): Promise<string | null> {
  const override = getInitrdPathOverride();
  if (override && fs.existsSync(override)) {
    return override;
  }

  const archVariant = getArchVariant();
  if (!archVariant) return null;

  const { imageDir } = getSandboxPaths();
  const initrdPath = path.join(imageDir, `initramfs-virt-${archVariant}`);
  if (fs.existsSync(initrdPath)) {
    return initrdPath;
  }

  const url = getInitrdUrl();
  if (!url) return null;
  await fs.promises.mkdir(imageDir, { recursive: true });
  const downloadPath = `${initrdPath}.download`;
  await downloadFile(url, downloadPath, 'image');
  await fs.promises.rename(downloadPath, initrdPath);
  return initrdPath;
}

function getExistingKernelPath(): string | null {
  const override = getKernelPathOverride();
  if (override && fs.existsSync(override)) {
    return override;
  }

  const archVariant = getArchVariant();
  if (!archVariant) return null;

  const { imageDir } = getSandboxPaths();
  const kernelPath = path.join(imageDir, `vmlinuz-virt-${archVariant}`);
  return fs.existsSync(kernelPath) ? kernelPath : null;
}

function getExistingInitrdPath(): string | null {
  const override = getInitrdPathOverride();
  if (override && fs.existsSync(override)) {
    return override;
  }

  const archVariant = getArchVariant();
  if (!archVariant) return null;

  const { imageDir } = getSandboxPaths();
  const initrdPath = path.join(imageDir, `initramfs-virt-${archVariant}`);
  return fs.existsSync(initrdPath) ? initrdPath : null;
}

function resolveAvailableRuntimeBinary(): string | null {
  const { runtimeDir, runtimeBinary } = getSandboxPaths();
  const localRuntime = resolveRuntimeBinary(runtimeDir, runtimeBinary);
  if (localRuntime) {
    return localRuntime;
  }

  // 在 Windows 上，还要检查系统安装的 QEMU（例如 C:\Program Files\qemu\）
  if (process.platform === 'win32') {
    if (_resolvedSystemQemuPath && fs.existsSync(_resolvedSystemQemuPath)) {
      return _resolvedSystemQemuPath;
    }
    const systemQemu = findSystemQemu();
    if (systemQemu) {
      const validation = validateQemuBinary(systemQemu);
      if (validation.valid && checkQemuVirtfsSupport(systemQemu)) {
        _resolvedSystemQemuPath = systemQemu;
        return systemQemu;
      }
    }
  }

  return null;
}

// ensureSandboxReady 的单例 Promise，用于防止并发安装。
// 两个同时运行的 NSIS 安装程序写入同一目录会导致死锁。
let _ensureSandboxReadyPromise: Promise<SandboxCheckResult> | null = null;

export function ensureSandboxReady(): Promise<SandboxCheckResult> {
  if (_ensureSandboxReadyPromise) {
    return _ensureSandboxReadyPromise;
  }
  _ensureSandboxReadyPromise = _ensureSandboxReadyImpl();
  _ensureSandboxReadyPromise.finally(() => {
    _ensureSandboxReadyPromise = null;
  });
  return _ensureSandboxReadyPromise;
}

async function _ensureSandboxReadyImpl(): Promise<SandboxCheckResult> {
  const platformKey = getPlatformKey();
  if (!platformKey) {
    return { ok: false, error: '此平台不支持沙箱虚拟机。' };
  }

  coworkLog('INFO', 'ensureSandboxReady', '正在检查沙箱就绪状态', {
    platformKey,
    platform: process.platform,
    arch: process.arch,
  });

  try {
    if (!downloadState.runtime) {
      downloadState.runtime = ensureRuntime();
    }
    const runtimeBinary = await downloadState.runtime;
    downloadState.runtime = null;

    if (!downloadState.image) {
      downloadState.image = ensureImage();
    }
    const imagePath = await downloadState.image;
    downloadState.image = null;

    let kernelPath: string | null = null;
    let initrdPath: string | null = null;
    try {
      kernelPath = await ensureKernel();
      initrdPath = await ensureInitrd();
    } catch (error) {
      console.warn('下载沙箱内核/initrd 失败:', error);
    }

    const { baseDir } = getSandboxPaths();
    downloadState.error = null;
    downloadState.progress = undefined;

    coworkLog('INFO', 'ensureSandboxReady', '沙箱已就绪', {
      runtimeBinary,
      runtimeExists: fs.existsSync(runtimeBinary),
      imagePath,
      imageExists: fs.existsSync(imagePath),
      kernelPath,
      initrdPath,
    });

    return {
      ok: true,
      runtimeInfo: {
        platform: process.platform,
        arch: process.arch,
        runtimeBinary,
        imagePath,
        kernelPath,
        initrdPath,
        baseDir,
      },
    };
  } catch (error) {
    downloadState.error = error instanceof Error ? error.message : String(error);
    downloadState.runtime = null;
    downloadState.image = null;
    coworkLog('ERROR', 'ensureSandboxReady', '沙箱未就绪', {
      error: downloadState.error,
    });
    return { ok: false, error: downloadState.error };
  }
}

export function getSandboxRuntimeInfoIfReady():
{ ok: true; runtimeInfo: SandboxRuntimeInfo } | { ok: false; error: string } {
  const platformKey = getPlatformKey();
  if (!platformKey) {
    return { ok: false, error: '此平台不支持沙箱虚拟机。' };
  }

  const runtimeBinary = resolveAvailableRuntimeBinary();
  if (!runtimeBinary) {
    return { ok: false, error: '沙箱运行时未安装。' };
  }

  const { baseDir, imagePath } = getSandboxPaths();
  if (!fs.existsSync(imagePath)) {
    return { ok: false, error: '沙箱镜像未安装。' };
  }

  return {
    ok: true,
    runtimeInfo: {
      platform: process.platform,
      arch: process.arch,
      runtimeBinary,
      imagePath,
      kernelPath: getExistingKernelPath(),
      initrdPath: getExistingInitrdPath(),
      baseDir,
    },
  };
}

export function getSandboxStatus(): CoworkSandboxStatus {
  const platformKey = getPlatformKey();
  if (!platformKey) {
    return {
      supported: false,
      runtimeReady: false,
      imageReady: false,
      downloading: Boolean(downloadState.runtime || downloadState.image),
      error: downloadState.error,
    };
  }

  const { imagePath } = getSandboxPaths();
  const runtimeReady = Boolean(resolveAvailableRuntimeBinary());

  const imageReady = fs.existsSync(imagePath);

  return {
    supported: true,
    runtimeReady,
    imageReady,
    downloading: Boolean(downloadState.runtime || downloadState.image),
    progress: downloadState.progress,
    error: downloadState.error,
  };
}
