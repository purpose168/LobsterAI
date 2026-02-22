/**
 * 技能服务管理器 - 管理技能的后台服务
 */

import { execSync, spawn, spawnSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { app } from 'electron';

/**
 * 解析用户在 macOS/Linux 上的登录 shell PATH。
 * macOS 上打包后的 Electron 应用不会继承用户的 shell 配置文件，
 * 因此除非显式解析，否则 node/npm 不会在 PATH 中。
 */
function resolveUserShellPath(): string | null {
  if (process.platform === 'win32') return null;

  try {
    const shell = process.env.SHELL || '/bin/bash';
    // 使用登录交互式 shell 来加载配置文件，然后打印 PATH
    const result = execSync(`${shell} -ilc 'echo __PATH__=$PATH'`, {
      encoding: 'utf-8',
      timeout: 5000,
      env: { ...process.env },
    });
    const match = result.match(/__PATH__=(.+)/);
    return match ? match[1].trim() : null;
  } catch (error) {
    console.warn('[技能服务] 解析用户 shell PATH 失败:', error);
    return null;
  }
}

/**
 * 构建用于启动技能服务脚本的环境变量。
 * 将用户的 shell PATH 与当前进程环境合并。
 */
function buildSkillServiceEnv(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env };

  if (app.isPackaged) {
    if (!env.HOME) {
      env.HOME = app.getPath('home');
    }

    const userPath = resolveUserShellPath();
    if (userPath) {
      env.PATH = userPath;
      console.log('[技能服务] 已为技能服务解析用户 shell PATH');
    } else {
      // 备用方案：追加常见的 node 安装路径
      const commonPaths = [
        '/usr/local/bin',
        '/opt/homebrew/bin',
        `${env.HOME}/.nvm/current/bin`,
        `${env.HOME}/.volta/bin`,
        `${env.HOME}/.fnm/current/bin`,
      ];
      env.PATH = [env.PATH, ...commonPaths].filter(Boolean).join(':');
      console.log('[技能服务] 使用备用 PATH 启动技能服务');
    }
  }

  // 暴露 Electron 可执行文件路径，以便技能脚本可以使用 ELECTRON_RUN_AS_NODE 运行 JS
  // 即使系统未安装 Node.js 也能运行。
  env.LOBSTERAI_ELECTRON_PATH = process.execPath;

  return env;
}

export class SkillServiceManager {
  private webSearchPid: number | null = null;
  private skillEnv: Record<string, string | undefined> | null = null;

  private hasWebSearchRuntimeScriptSupport(skillPath: string): boolean {
    const startServerScript = path.join(skillPath, 'scripts', 'start-server.sh');
    const searchScript = path.join(skillPath, 'scripts', 'search.sh');
    if (!fs.existsSync(startServerScript)) {
      return false;
    }
    if (!fs.existsSync(searchScript)) {
      return false;
    }
    try {
      const startScript = fs.readFileSync(startServerScript, 'utf-8');
      const searchScriptContent = fs.readFileSync(searchScript, 'utf-8');
      return startScript.includes('WEB_SEARCH_FORCE_REPAIR')
        && startScript.includes('detect_healthy_bridge_server')
        && searchScriptContent.includes('ACTIVE_SERVER_URL')
        && searchScriptContent.includes('try_switch_to_local_server');
    } catch {
      return false;
    }
  }

  private isWebSearchRuntimeHealthy(skillPath: string): boolean {
    const requiredPaths = [
      path.join(skillPath, 'scripts', 'start-server.sh'),
      path.join(skillPath, 'scripts', 'search.sh'),
      path.join(skillPath, 'dist', 'server', 'index.js'),
      path.join(skillPath, 'node_modules', 'iconv-lite', 'encodings', 'index.js'),
    ];
    return requiredPaths.every(requiredPath => fs.existsSync(requiredPath))
      && this.hasWebSearchRuntimeScriptSupport(skillPath);
  }

  private hasCommand(command: string, env: NodeJS.ProcessEnv): boolean {
    const checker = process.platform === 'win32' ? 'where' : 'which';
    const result = spawnSync(checker, [command], { stdio: 'ignore', env });
    return result.status === 0;
  }

  private repairWebSearchRuntimeFromBundled(skillPath: string): void {
    if (!app.isPackaged) return;

    const candidates = [
      path.join(process.resourcesPath, 'SKILLs', 'web-search'),
      path.join(app.getAppPath(), 'SKILLs', 'web-search'),
    ];

    const bundledPath = candidates.find(candidate => candidate !== skillPath && fs.existsSync(candidate));
    if (!bundledPath) {
      return;
    }

    try {
      fs.cpSync(bundledPath, skillPath, {
        recursive: true,
        dereference: true,
        force: true,
        errorOnExist: false,
      });
      console.log('[技能服务] 已从打包资源修复网页搜索运行时');
    } catch (error) {
      console.warn('[技能服务] 从打包资源修复网页搜索运行时失败:', error);
    }
  }

  private resolveNodeRuntime(
    env: NodeJS.ProcessEnv
  ): { command: string; args: string[]; extraEnv?: NodeJS.ProcessEnv } {
    if (!app.isPackaged && this.hasCommand('node', env)) {
      return { command: 'node', args: [] };
    }

    return {
      command: process.execPath,
      args: [],
      extraEnv: { ELECTRON_RUN_AS_NODE: '1' },
    };
  }

  private ensureWebSearchRuntimeReady(skillPath: string): void {
    if (this.isWebSearchRuntimeHealthy(skillPath)) {
      return;
    }

    this.repairWebSearchRuntimeFromBundled(skillPath);
    if (this.isWebSearchRuntimeHealthy(skillPath)) {
      return;
    }

    const nodeModules = path.join(skillPath, 'node_modules');
    const distDir = path.join(skillPath, 'dist');
    const env = this.skillEnv as NodeJS.ProcessEnv ?? process.env;
    const npmAvailable = this.hasCommand('npm', env);

    const shouldInstallDeps = !fs.existsSync(nodeModules) || !this.isWebSearchRuntimeHealthy(skillPath);
    if (shouldInstallDeps) {
      if (!npmAvailable) {
        throw new Error('网页搜索运行时不完整，且 npm 不可用，无法修复');
      }
      console.log('[技能服务] 正在安装/修复网页搜索依赖...');
      execSync('npm install', { cwd: skillPath, stdio: 'ignore', env });
    }

    if (!fs.existsSync(distDir)) {
      if (!npmAvailable) {
        throw new Error('网页搜索 dist 文件缺失，且 npm 不可用，无法重新构建');
      }
      console.log('[技能服务] 正在编译网页搜索 TypeScript...');
      execSync('npm run build', { cwd: skillPath, stdio: 'ignore', env });
    }

    if (!this.isWebSearchRuntimeHealthy(skillPath)) {
      throw new Error('尝试修复后网页搜索运行时仍然不健康');
    }
  }

  /**
   * 启动所有技能服务
   */
  async startAll(): Promise<void> {
    console.log('[技能服务] 正在启动技能服务...');

    // 为所有服务启动解析一次环境变量
    this.skillEnv = buildSkillServiceEnv();

    try {
      await this.startWebSearchService();
    } catch (error) {
      console.error('[技能服务] 启动服务时出错:', error);
    }
  }

  /**
   * 停止所有技能服务
   */
  async stopAll(): Promise<void> {
    console.log('[技能服务] 正在停止技能服务...');

    try {
      await this.stopWebSearchService();
    } catch (error) {
      console.error('[技能服务] 停止服务时出错:', error);
    }
  }

  /**
   * 启动网页搜索桥接服务器
   */
  async startWebSearchService(): Promise<void> {
    try {
      const skillPath = this.getWebSearchPath();
      if (!skillPath) {
        console.log('[技能服务] 未找到网页搜索技能，跳过');
        return;
      }

      // 检查是否已在运行
      if (this.isWebSearchServiceRunning()) {
        console.log('[技能服务] 网页搜索服务已在运行');
        return;
      }

      console.log('[技能服务] 正在启动网页搜索桥接服务器...');

      await this.startWebSearchServiceProcess(skillPath);

      // 等待服务器启动
      await new Promise(resolve => setTimeout(resolve, 3000));

      // 检查服务器是否成功启动
      const pidFile = path.join(skillPath, '.server.pid');
      if (fs.existsSync(pidFile)) {
        const pid = parseInt(fs.readFileSync(pidFile, 'utf-8').trim());
        this.webSearchPid = pid;
        console.log(`[技能服务] 网页搜索桥接服务器已启动 (进程ID: ${pid})`);
      } else {
        console.warn('[技能服务] 网页搜索桥接服务器可能未正确启动');
      }
    } catch (error) {
      console.error('[技能服务] 启动网页搜索服务失败:', error);
    }
  }

  private async startWebSearchServiceProcess(skillPath: string): Promise<void> {
    const pidFile = path.join(skillPath, '.server.pid');
    const logFile = path.join(skillPath, '.server.log');
    const serverEntry = path.join(skillPath, 'dist', 'server', 'index.js');
    this.ensureWebSearchRuntimeReady(skillPath);
    const baseEnv = this.skillEnv as NodeJS.ProcessEnv ?? process.env;
    const runtime = this.resolveNodeRuntime(baseEnv);
    const env = {
      ...baseEnv,
      ...(runtime.extraEnv ?? {}),
      LOBSTERAI_ELECTRON_PATH: process.execPath,
    };

    // Node/Electron 会同步验证标准输入输出流。使用文件描述符来避免
    // createWriteStream 尚未打开文件描述符时的竞态条件。
    const logFd = fs.openSync(logFile, 'a');
    let child;
    try {
      child = spawn(runtime.command, [...runtime.args, serverEntry], {
        cwd: skillPath,
        detached: true,
        stdio: ['ignore', logFd, logFd],
        env,
      });
    } finally {
      fs.closeSync(logFd);
    }

    fs.writeFileSync(pidFile, child.pid!.toString());
    child.unref();

    const runtimeLabel = runtime.command === process.execPath ? 'electron-node' : 'node';
    console.log(`[技能服务] 网页搜索桥接服务器正在启动 (进程ID: ${child.pid}, 运行时: ${runtimeLabel})`);
    console.log(`[技能服务] 日志文件: ${logFile}`);
  }

  /**
   * 停止网页搜索桥接服务器
   */
  async stopWebSearchService(): Promise<void> {
    try {
      const skillPath = this.getWebSearchPath();
      if (!skillPath) {
        return;
      }

      if (!this.isWebSearchServiceRunning()) {
        console.log('[技能服务] 网页搜索服务未运行');
        return;
      }

      console.log('[技能服务] 正在停止网页搜索桥接服务器...');

      if (this.webSearchPid) {
        try {
          process.kill(this.webSearchPid, 'SIGTERM');
        } catch (error) {
          console.warn('[技能服务] 终止进程失败:', error);
        }
      }

      const pidFile = path.join(skillPath, '.server.pid');
      if (fs.existsSync(pidFile)) {
        fs.unlinkSync(pidFile);
      }

      // 等待优雅关闭
      await new Promise(resolve => setTimeout(resolve, 2000));

      console.log('[技能服务] 网页搜索桥接服务器已停止');
      this.webSearchPid = null;
    } catch (error) {
      console.error('[技能服务] 停止网页搜索服务失败:', error);
    }
  }

  /**
   * 检查网页搜索服务是否正在运行
   */
  isWebSearchServiceRunning(): boolean {
    if (this.webSearchPid === null) {
      // 尝试从文件读取进程ID
      const skillPath = this.getWebSearchPath();
      if (!skillPath) {
        return false;
      }

      const pidFile = path.join(skillPath, '.server.pid');
      if (fs.existsSync(pidFile)) {
        try {
          const pid = parseInt(fs.readFileSync(pidFile, 'utf-8').trim());
          this.webSearchPid = pid;
        } catch (error) {
          return false;
        }
      } else {
        return false;
      }
    }

    // 检查进程是否实际在运行
    try {
      process.kill(this.webSearchPid, 0); // 信号 0 用于检查进程是否存在
      return true;
    } catch (error) {
      this.webSearchPid = null;
      return false;
    }
  }

  /**
   * 获取网页搜索技能路径
   */
  private getWebSearchPath(): string | null {
    const candidates: string[] = [];

    if (app.isPackaged) {
      // 打包后的应用优先使用 userData，以便脚本从真实文件系统路径运行。
      candidates.push(path.join(app.getPath('userData'), 'SKILLs', 'web-search'));
      candidates.push(path.join(process.resourcesPath, 'SKILLs', 'web-search'));
      candidates.push(path.join(app.getAppPath(), 'SKILLs', 'web-search'));
    } else {
      // 开发模式下，__dirname 是 dist-electron/，需要向上一级才能到达项目根目录
      const projectRoot = path.resolve(__dirname, '..');
      candidates.push(path.join(projectRoot, 'SKILLs', 'web-search'));
      candidates.push(path.join(app.getAppPath(), 'SKILLs', 'web-search'));
    }

    return candidates.find(skillPath => fs.existsSync(skillPath)) ?? null;
  }

  /**
   * 获取服务状态
   */
  getStatus(): { webSearch: boolean } {
    return {
      webSearch: this.isWebSearchServiceRunning()
    };
  }

  /**
   * 网页搜索服务健康检查
   */
  async checkWebSearchHealth(): Promise<boolean> {
    try {
      const response = await fetch('http://127.0.0.1:8923/api/health', {
        method: 'GET',
        signal: AbortSignal.timeout(3000)
      });
      return response.ok;
    } catch (error) {
      return false;
    }
  }
}

// 单例实例
let serviceManager: SkillServiceManager | null = null;

export function getSkillServiceManager(): SkillServiceManager {
  if (!serviceManager) {
    serviceManager = new SkillServiceManager();
  }
  return serviceManager;
}
