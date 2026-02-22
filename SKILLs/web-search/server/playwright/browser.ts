/**
 * 浏览器启动器 - 管理 Chrome 浏览器生命周期
 */

import { spawn, ChildProcess } from 'child_process';
import { existsSync, mkdirSync, accessSync, constants } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { BrowserConfig } from '../config';

export interface BrowserInstance {
  process: ChildProcess;
  pid: number;
  cdpPort: number;
  startTime: number;
}

/**
 * 跨平台检测基于 Chromium 的浏览器可执行文件路径
 */
export function getChromePath(): string {
  const platform = process.platform;
  const paths: string[] = [];

  if (platform === 'darwin') {
    // macOS 系统
    paths.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      join(process.env.HOME || '', 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
    );
  } else if (platform === 'win32') {
    // Windows 系统
    const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
    const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    paths.push(
      join(programFiles, 'Google\\Chrome\\Application\\chrome.exe'),
      join(programFilesX86, 'Google\\Chrome\\Application\\chrome.exe'),
      join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
      join(programFiles, 'Microsoft\\Edge\\Application\\msedge.exe'),
      join(programFilesX86, 'Microsoft\\Edge\\Application\\msedge.exe'),
      join(process.env.LOCALAPPDATA || '', 'Microsoft\\Edge\\Application\\msedge.exe')
    );
  } else {
    // Linux 系统
    paths.push(
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/usr/bin/microsoft-edge',
      '/usr/bin/microsoft-edge-stable',
      '/snap/bin/chromium'
    );
  }

  for (const path of paths) {
    if (existsSync(path)) {
      return path;
    }
  }

  throw new Error(
    '未找到基于 Chromium 的浏览器（Chrome/Edge/Chromium）。请安装其中之一后重试。'
  );
}

function isDirectoryWritable(path: string): boolean {
  if (!existsSync(path)) {
    return false;
  }

  try {
    accessSync(path, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveRuntimeChromeFlags(configFlags: string[] = []): string[] {
  const runtimeFlags = [...configFlags];

  if (process.platform === 'linux') {
    if (!isDirectoryWritable('/dev/shm')) {
      console.warn('[浏览器] /dev/shm 不可用，启用 --disable-dev-shm-usage');
      runtimeFlags.push('--disable-dev-shm-usage');
    }

    if (!isDirectoryWritable('/dev/mqueue')) {
      console.warn('[浏览器] 当前环境中 /dev/mqueue 不可用');
    }

    if (typeof process.getuid === 'function' && process.getuid() === 0) {
      console.warn('[浏览器] 以 root 用户运行，启用 --no-sandbox');
      runtimeFlags.push('--no-sandbox');
    }
  }

  return Array.from(new Set(runtimeFlags));
}

function resolveHeadlessMode(configHeadless: boolean): boolean {
  if (configHeadless) {
    return true;
  }

  if (process.platform !== 'linux') {
    return false;
  }

  const hasDisplay = Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY || process.env.MIR_SOCKET);
  if (hasDisplay) {
    return false;
  }

  console.warn('[浏览器] 未检测到 Linux 显示环境，强制使用无头模式');
  return true;
}

/**
 * 等待 CDP 端口变为可用状态
 */
async function waitForCDP(port: number, browserProcess: ChildProcess, timeoutMs: number = 10000): Promise<void> {
  const startTime = Date.now();
  let attempts = 0;

  while (Date.now() - startTime < timeoutMs) {
    if (browserProcess.exitCode !== null || browserProcess.signalCode !== null) {
      const exitCode = browserProcess.exitCode ?? 'null';
      const signal = browserProcess.signalCode ?? 'none';
      throw new Error(`Chrome 进程在 CDP 准备就绪前退出（退出码=${exitCode}，信号=${signal}）`);
    }

    attempts++;
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`, {
        signal: AbortSignal.timeout(2000)
      });
      if (response.ok) {
        console.log(`[浏览器] CDP 在 ${attempts} 次尝试后准备就绪（耗时 ${Date.now() - startTime}毫秒）`);
        return;
      }
      console.log(`[浏览器] CDP 第 ${attempts} 次尝试：响应不正常（状态码 ${response.status}）`);
    } catch {
      // 端口尚未就绪，继续等待
      if (attempts % 5 === 0) {
        console.log(`[浏览器] CDP 第 ${attempts} 次尝试：仍在等待...（已耗时 ${Date.now() - startTime}毫秒）`);
      }
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  throw new Error(`CDP 端口 ${port} 在 ${timeoutMs}毫秒后仍未就绪（共尝试 ${attempts} 次）`);
}

/**
 * 启动启用 CDP 的 Chrome 浏览器
 */
export async function launchBrowser(config: BrowserConfig): Promise<BrowserInstance> {
  const chromePath = config.chromePath || getChromePath();
  const cdpPort = config.cdpPort;
  const runtimeChromeFlags = resolveRuntimeChromeFlags(config.chromeFlags || []);
  const runtimeHeadless = resolveHeadlessMode(config.headless);

  // 如果未提供用户数据目录，则创建临时用户数据目录
  const userDataDir = config.userDataDir || join(tmpdir(), `chrome-cdp-${Date.now()}`);
  if (!existsSync(userDataDir)) {
    mkdirSync(userDataDir, { recursive: true });
  }

  // 构建 Chrome 启动参数
  const args = [
    `--remote-debugging-port=${cdpPort}`,
    '--remote-debugging-address=127.0.0.1',
    `--user-data-dir=${userDataDir}`, // 始终使用隔离的用户数据目录
    ...runtimeChromeFlags
  ];

  if (runtimeHeadless) {
    args.push('--headless=new');
  }

  console.log(`[浏览器] 正在启动 Chrome，路径：${chromePath}`);
  console.log(`[浏览器] CDP 端口：${cdpPort}`);
  console.log(`[浏览器] 用户数据目录：${userDataDir}`);
  console.log(`[浏览器] 无头模式：${runtimeHeadless}`);
  console.log(`[浏览器] 启动标志：${runtimeChromeFlags.join(' ') || '（无）'}`);

  // 启动 Chrome 进程
  const browserProcess = spawn(chromePath, args, {
    detached: false,
    stdio: ['ignore', 'pipe', 'pipe'] // 捕获标准输出和标准错误
  });
  const recentStderr: string[] = [];

  // 记录 Chrome 输出以便调试
  if (browserProcess.stdout) {
    browserProcess.stdout.on('data', (data) => {
      console.log(`[浏览器标准输出] ${data.toString().trim()}`);
    });
  }
  if (browserProcess.stderr) {
    browserProcess.stderr.on('data', (data) => {
      const message = data.toString().trim();
      console.log(`[浏览器标准错误] ${message}`);
      if (!message) {
        return;
      }

      for (const line of message.split('\n').map((item: string) => item.trim()).filter(Boolean)) {
        recentStderr.push(line);
      }
      while (recentStderr.length > 12) {
        recentStderr.shift();
      }
    });
  }

  if (!browserProcess.pid) {
    throw new Error('启动 Chrome 进程失败');
  }

  console.log(`[浏览器] Chrome 已启动，进程ID：${browserProcess.pid}`);

  // 等待 CDP 准备就绪
  try {
    await waitForCDP(cdpPort, browserProcess, 20000); // 超时时间增加到 20 秒
    console.log(`[浏览器] CDP 在端口 ${cdpPort} 上准备就绪`);
  } catch (error) {
    browserProcess.kill();
    const baseMessage = error instanceof Error ? error.message : String(error);
    if (recentStderr.length > 0) {
      const tail = recentStderr.slice(-5).join(' | ');
      throw new Error(`${baseMessage}。最近的浏览器标准错误：${tail}`);
    }
    throw error;
  }

  return {
    process: browserProcess,
    pid: browserProcess.pid,
    cdpPort,
    startTime: Date.now()
  };
}

/**
 * 关闭浏览器实例
 */
export async function closeBrowser(instance: BrowserInstance): Promise<void> {
  if (instance.process && !instance.process.killed) {
    console.log(`[浏览器] 正在关闭浏览器（进程ID：${instance.pid}）`);
    instance.process.kill('SIGTERM');

    // 等待优雅关闭
    await new Promise<void>(resolve => {
      const timeout = setTimeout(() => {
        if (!instance.process.killed) {
          console.log(`[浏览器] 强制终止浏览器（进程ID：${instance.pid}）`);
          instance.process.kill('SIGKILL');
        }
        resolve();
      }, 5000);

      instance.process.on('exit', () => {
        clearTimeout(timeout);
        resolve();
      });
    });

    console.log(`[浏览器] 浏览器已关闭`);
  }
}

/**
 * 检查浏览器是否正在运行
 */
export function isBrowserRunning(instance: BrowserInstance | null): boolean {
  if (!instance) {
    return false;
  }
  return instance.process && !instance.process.killed;
}
