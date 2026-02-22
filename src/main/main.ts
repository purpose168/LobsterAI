import { app, BrowserWindow, ipcMain, session, nativeTheme, dialog, shell, nativeImage, systemPreferences, Menu } from 'electron';
import type { WebContents } from 'electron';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { SqliteStore } from './sqliteStore';
import { CoworkStore } from './coworkStore';
import { CoworkRunner } from './libs/coworkRunner';
import { SkillManager } from './skillManager';
import type { PermissionResult } from '@anthropic-ai/claude-agent-sdk';
import { getCurrentApiConfig, resolveCurrentApiConfig, setStoreGetter } from './libs/claudeSettings';
import { saveCoworkApiConfig } from './libs/coworkConfigStore';
import { generateSessionTitle } from './libs/coworkUtil';
import { ensureSandboxReady, getSandboxStatus, onSandboxProgress } from './libs/coworkSandboxRuntime';
import { startCoworkOpenAICompatProxy, stopCoworkOpenAICompatProxy, setScheduledTaskDeps } from './libs/coworkOpenAICompatProxy';
import { IMGatewayManager, IMPlatform, IMGatewayConfig } from './im';
import { APP_NAME } from './appConstants';
import { getSkillServiceManager } from './skillServices';
import { createTray, destroyTray, updateTrayMenu } from './trayManager';
import { isAutoLaunched, getAutoLaunchEnabled, setAutoLaunchEnabled } from './autoLaunchManager';
import { ScheduledTaskStore } from './scheduledTaskStore';
import { Scheduler } from './libs/scheduler';
import { initLogger, getLogFilePath } from './logger';

// 设置应用程序名称
app.name = APP_NAME;
app.setName(APP_NAME);

const LEGACY_APP_NAMES = ['OctoBot', 'octobot'];
const INVALID_FILE_NAME_PATTERN = /[<>:"/\\|?*\u0000-\u001F]/g;
const MIN_MEMORY_USER_MEMORIES_MAX_ITEMS = 1;
const MAX_MEMORY_USER_MEMORIES_MAX_ITEMS = 60;
const IPC_MESSAGE_CONTENT_MAX_CHARS = 120_000;
const IPC_UPDATE_CONTENT_MAX_CHARS = 120_000;
const IPC_STRING_MAX_CHARS = 4_000;
const IPC_MAX_DEPTH = 5;
const IPC_MAX_KEYS = 80;
const IPC_MAX_ITEMS = 40;
const MAX_INLINE_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const MIME_EXTENSION_MAP: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/bmp': '.bmp',
  'application/pdf': '.pdf',
  'text/plain': '.txt',
  'text/markdown': '.md',
  'application/json': '.json',
  'text/csv': '.csv',
};

const sanitizeExportFileName = (value: string): string => {
  const sanitized = value.replace(INVALID_FILE_NAME_PATTERN, ' ').replace(/\s+/g, ' ').trim();
  return sanitized || 'cowork-session';
};

const sanitizeAttachmentFileName = (value?: string): string => {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return 'attachment';
  const fileName = path.basename(raw);
  const sanitized = fileName.replace(INVALID_FILE_NAME_PATTERN, ' ').replace(/\s+/g, ' ').trim();
  return sanitized || 'attachment';
};

const inferAttachmentExtension = (fileName: string, mimeType?: string): string => {
  const fromName = path.extname(fileName).toLowerCase();
  if (fromName) {
    return fromName;
  }
  if (typeof mimeType === 'string') {
    const normalized = mimeType.toLowerCase().split(';')[0].trim();
    return MIME_EXTENSION_MAP[normalized] ?? '';
  }
  return '';
};

const resolveInlineAttachmentDir = (cwd?: string): string => {
  const trimmed = typeof cwd === 'string' ? cwd.trim() : '';
  if (trimmed) {
    const resolved = path.resolve(trimmed);
    if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
      return path.join(resolved, '.cowork-temp', 'attachments', 'manual');
    }
  }
  return path.join(app.getPath('temp'), 'lobsterai', 'attachments');
};

const ensurePngFileName = (value: string): string => {
  return value.toLowerCase().endsWith('.png') ? value : `${value}.png`;
};

const truncateIpcString = (value: string, maxChars: number): string => {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}\n...[在主进程IPC转发中已截断]`;
};

const sanitizeIpcPayload = (value: unknown, depth = 0, seen?: WeakSet<object>): unknown => {
  const localSeen = seen ?? new WeakSet<object>();
  if (
    value === null
    || typeof value === 'number'
    || typeof value === 'boolean'
    || typeof value === 'undefined'
  ) {
    return value;
  }
  if (typeof value === 'string') {
    return truncateIpcString(value, IPC_STRING_MAX_CHARS);
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (typeof value === 'function') {
    return '[函数]';
  }
  if (depth >= IPC_MAX_DEPTH) {
    return '[深度截断]';
  }
  if (Array.isArray(value)) {
    const result = value.slice(0, IPC_MAX_ITEMS).map((entry) => sanitizeIpcPayload(entry, depth + 1, localSeen));
    if (value.length > IPC_MAX_ITEMS) {
      result.push(`[项目截断:${value.length - IPC_MAX_ITEMS}]`);
    }
    return result;
  }
  if (typeof value === 'object') {
    if (localSeen.has(value as object)) {
      return '[循环引用]';
    }
    localSeen.add(value as object);
    const entries = Object.entries(value as Record<string, unknown>);
    const result: Record<string, unknown> = {};
    for (const [key, entry] of entries.slice(0, IPC_MAX_KEYS)) {
      result[key] = sanitizeIpcPayload(entry, depth + 1, localSeen);
    }
    if (entries.length > IPC_MAX_KEYS) {
      result.__truncated_keys__ = entries.length - IPC_MAX_KEYS;
    }
    return result;
  }
  return String(value);
};

const sanitizeCoworkMessageForIpc = (message: any): any => {
  if (!message || typeof message !== 'object') {
    return message;
  }
  return {
    ...message,
    content: typeof message.content === 'string'
      ? truncateIpcString(message.content, IPC_MESSAGE_CONTENT_MAX_CHARS)
      : '',
    metadata: message.metadata ? sanitizeIpcPayload(message.metadata) : undefined,
  };
};

const sanitizePermissionRequestForIpc = (request: any): any => {
  if (!request || typeof request !== 'object') {
    return request;
  }
  return {
    ...request,
    toolInput: sanitizeIpcPayload(request.toolInput ?? {}),
  };
};

type CaptureRect = { x: number; y: number; width: number; height: number };

const normalizeCaptureRect = (rect?: Partial<CaptureRect> | null): CaptureRect | null => {
  if (!rect) return null;
  const normalized = {
    x: Math.max(0, Math.round(typeof rect.x === 'number' ? rect.x : 0)),
    y: Math.max(0, Math.round(typeof rect.y === 'number' ? rect.y : 0)),
    width: Math.max(0, Math.round(typeof rect.width === 'number' ? rect.width : 0)),
    height: Math.max(0, Math.round(typeof rect.height === 'number' ? rect.height : 0)),
  };
  return normalized.width > 0 && normalized.height > 0 ? normalized : null;
};

const resolveTaskWorkingDirectory = (workspaceRoot: string): string => {
  const resolvedWorkspaceRoot = path.resolve(workspaceRoot);
  fs.mkdirSync(resolvedWorkspaceRoot, { recursive: true });
  if (!fs.statSync(resolvedWorkspaceRoot).isDirectory()) {
    throw new Error(`所选工作区不是目录: ${resolvedWorkspaceRoot}`);
  }
  return resolvedWorkspaceRoot;
};

const resolveExistingTaskWorkingDirectory = (workspaceRoot: string): string => {
  const trimmed = workspaceRoot.trim();
  if (!trimmed) {
    throw new Error('请在提交前选择任务文件夹。');
  }
  const resolvedWorkspaceRoot = path.resolve(trimmed);
  if (!fs.existsSync(resolvedWorkspaceRoot) || !fs.statSync(resolvedWorkspaceRoot).isDirectory()) {
    throw new Error(`任务文件夹不存在或不是目录: ${resolvedWorkspaceRoot}`);
  }
  return resolvedWorkspaceRoot;
};

const getDefaultExportImageName = (defaultFileName?: string): string => {
  const normalized = typeof defaultFileName === 'string' && defaultFileName.trim()
    ? defaultFileName.trim()
    : `cowork-session-${Date.now()}`;
  return ensurePngFileName(sanitizeExportFileName(normalized));
};

const savePngWithDialog = async (
  webContents: WebContents,
  pngData: Buffer,
  defaultFileName?: string,
): Promise<{ success: boolean; canceled?: boolean; path?: string; error?: string }> => {
  const defaultName = getDefaultExportImageName(defaultFileName);
  const ownerWindow = BrowserWindow.fromWebContents(webContents);
  const saveOptions = {
    title: '导出会话图片',
    defaultPath: path.join(app.getPath('downloads'), defaultName),
    filters: [{ name: 'PNG 图片', extensions: ['png'] }],
  };
  const saveResult = ownerWindow
    ? await dialog.showSaveDialog(ownerWindow, saveOptions)
    : await dialog.showSaveDialog(saveOptions);

  if (saveResult.canceled || !saveResult.filePath) {
    return { success: true, canceled: true };
  }

  const outputPath = ensurePngFileName(saveResult.filePath);
  await fs.promises.writeFile(outputPath, pngData);
  return { success: true, canceled: false, path: outputPath };
};

const configureUserDataPath = (): void => {
  const appDataPath = app.getPath('appData');
  const preferredUserDataPath = path.join(appDataPath, APP_NAME);
  const currentUserDataPath = app.getPath('userData');

  if (currentUserDataPath !== preferredUserDataPath) {
    app.setPath('userData', preferredUserDataPath);
    console.log(`[主进程] userData路径已更新: ${currentUserDataPath} -> ${preferredUserDataPath}`);
  }
};

const migrateLegacyUserData = (): void => {
  const appDataPath = app.getPath('appData');
  const userDataPath = app.getPath('userData');
  const legacyRoots = LEGACY_APP_NAMES
    .map(name => path.join(appDataPath, name))
    .filter(legacyPath => legacyPath !== userDataPath && fs.existsSync(legacyPath));

  if (legacyRoots.length === 0) {
    return;
  }

  if (!fs.existsSync(userDataPath)) {
    fs.mkdirSync(userDataPath, { recursive: true });
  }

  for (const legacyRoot of legacyRoots) {
    try {
      const entries = fs.readdirSync(legacyRoot);
      for (const entry of entries) {
        const sourcePath = path.join(legacyRoot, entry);
        const targetPath = path.join(userDataPath, entry);
        if (fs.existsSync(targetPath)) {
          continue;
        }
        fs.cpSync(sourcePath, targetPath, {
          recursive: true,
          dereference: true,
          force: false,
          errorOnExist: false,
        });
      }
      console.log(`[主进程] 已从旧版目录迁移缺失的用户数据: ${legacyRoot}`);
    } catch (error) {
      console.warn(`[主进程] 从 ${legacyRoot} 迁移旧版用户数据失败:`, error);
    }
  }
};

configureUserDataPath();
initLogger();

const isDev = process.env.NODE_ENV === 'development';
const isLinux = process.platform === 'linux';
const isMac = process.platform === 'darwin';
const isWindows = process.platform === 'win32';
const DEV_SERVER_URL = process.env.ELECTRON_START_URL || 'http://localhost:5175';
const enableVerboseLogging =
  process.env.ELECTRON_ENABLE_LOGGING === '1' ||
  process.env.ELECTRON_ENABLE_LOGGING === 'true';
const disableGpu =
  process.env.LOBSTERAI_DISABLE_GPU === '1' ||
  process.env.LOBSTERAI_DISABLE_GPU === 'true' ||
  process.env.ELECTRON_DISABLE_GPU === '1' ||
  process.env.ELECTRON_DISABLE_GPU === 'true';
const reloadOnChildProcessGone =
  process.env.ELECTRON_RELOAD_ON_CHILD_PROCESS_GONE === '1' ||
  process.env.ELECTRON_RELOAD_ON_CHILD_PROCESS_GONE === 'true';
const TITLEBAR_HEIGHT = 48;
const TITLEBAR_COLORS = {
  dark: { color: '#0F1117', symbolColor: '#E4E5E9' },
  // 将浅色标题栏与应用浅色表面静音色调对齐，以减少视觉对比度
  light: { color: '#F3F4F6', symbolColor: '#1A1D23' },
} as const;

const safeDecodeURIComponent = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const normalizeWindowsShellPath = (inputPath: string): string => {
  if (!isWindows) return inputPath;

  const trimmed = inputPath.trim();
  if (!trimmed) return inputPath;

  let normalized = trimmed;
  if (/^file:\/\//i.test(normalized)) {
    normalized = safeDecodeURIComponent(normalized.replace(/^file:\/\//i, ''));
  }

  if (/^\/[A-Za-z]:/.test(normalized)) {
    normalized = normalized.slice(1);
  }

  const unixDriveMatch = normalized.match(/^[/\\]([A-Za-z])[/\\](.+)$/);
  if (unixDriveMatch) {
    const drive = unixDriveMatch[1].toUpperCase();
    const rest = unixDriveMatch[2].replace(/[/\\]+/g, '\\');
    return `${drive}:\\${rest}`;
  }

  if (/^[A-Za-z]:[/\\]/.test(normalized)) {
    const drive = normalized[0].toUpperCase();
    const rest = normalized.slice(1).replace(/\//g, '\\');
    return `${drive}${rest}`;
  }

  return normalized;
};

// ==================== macOS 权限 ====================

/**
 * 在 macOS 上通过尝试访问日历应用来检查日历权限
 * 返回值: 'authorized' | 'denied' | 'restricted' | 'not-determined'
 * 在 Windows 上，检查 Outlook 是否可用
 * 在 Linux 上，返回 'not-supported'
 */
const checkCalendarPermission = async (): Promise<string> => {
  if (process.platform === 'darwin') {
    try {
      // 尝试访问日历来检查权限
      const { exec } = require('child_process');
      const util = require('util');
      const execAsync = util.promisify(exec);

      // 快速测试以查看是否可以访问日历
      await execAsync('osascript -l JavaScript -e \'Application("Calendar").name()\'', { timeout: 5000 });
      console.log('[权限] macOS 日历访问权限: 已授权');
      return 'authorized';
    } catch (error: any) {
      // 检查是否为权限错误
      if (error.stderr?.includes('不能获取对象') ||
          error.stderr?.includes('not authorized') ||
          error.stderr?.includes('Permission denied')) {
        console.log('[权限] macOS 日历访问权限: 未确定（需要权限）');
        return 'not-determined';
      }
      console.warn('[权限] 检查 macOS 日历权限失败:', error);
      return 'not-determined';
    }
  }

  if (process.platform === 'win32') {
    // Windows 没有像 macOS 那样的系统级日历权限
    // 相反，我们检查 Outlook 是否可用
    try {
      const { exec } = require('child_process');
      const util = require('util');
      const execAsync = util.promisify(exec);

      // 检查 Outlook COM 对象是否可访问
      const checkScript = `
        try {
          $Outlook = New-Object -ComObject Outlook.Application
          $Outlook.Version
        } catch { exit 1 }
      `;
      await execAsync('powershell -Command "' + checkScript + '"', { timeout: 10000 });
      console.log('[权限] Windows Outlook 可用');
      return 'authorized';
    } catch (error) {
      console.log('[权限] Windows Outlook 不可用或无法访问');
      return 'not-determined';
    }
  }

  return 'not-supported';
};

/**
 * 在 macOS 上请求日历权限
 * 在 Windows 上，尝试初始化 Outlook COM 对象
 */
const requestCalendarPermission = async (): Promise<boolean> => {
  if (process.platform === 'darwin') {
    try {
      // 在 macOS 上，我们通过尝试访问日历来触发权限
      // 如果需要，系统将显示权限对话框
      const { exec } = require('child_process');
      const util = require('util');
      const execAsync = util.promisify(exec);

      await execAsync('osascript -l JavaScript -e \'Application("Calendar").calendars()[0].name()\'', { timeout: 10000 });
      return true;
    } catch (error) {
      console.warn('[权限] 请求 macOS 日历权限失败:', error);
      return false;
    }
  }

  if (process.platform === 'win32') {
    // Windows 没有 COM 对象的权限对话框
    // 我们只是检查 Outlook 是否可用
    const status = await checkCalendarPermission();
    return status === 'authorized';
  }

  return false;
};



// 配置应用
if (isLinux) {
  app.commandLine.appendSwitch('no-sandbox');
  app.commandLine.appendSwitch('disable-dev-shm-usage');
}
if (disableGpu) {
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('disable-software-rasterizer');
  // 禁用硬件加速
  app.disableHardwareAcceleration();
}
if (enableVerboseLogging) {
  app.commandLine.appendSwitch('enable-logging');
  app.commandLine.appendSwitch('v', '1');
}

// 配置网络服务
app.on('ready', () => {
  // 配置网络服务重启策略
  app.configureHostResolver({
    enableBuiltInResolver: true,
    secureDnsMode: 'off'
  });
});

// 添加错误处理
app.on('render-process-gone', (_event, webContents, details) => {
  console.error('渲染进程已退出:', details);
  const shouldReload =
    details.reason === 'crashed' ||
    details.reason === 'killed' ||
    details.reason === 'oom' ||
    details.reason === 'launch-failed' ||
    details.reason === 'integrity-failure';
  if (shouldReload) {
    scheduleReload(`渲染进程退出 (${details.reason})`, webContents);
  }
});

app.on('child-process-gone', (_event, details) => {
  console.error('子进程已退出:', details);
  if (reloadOnChildProcessGone && (details.type === 'GPU' || details.type === 'Utility')) {
    scheduleReload(`子进程退出 (${details.type}/${details.reason})`);
  }
});

// 处理未捕获的异常
process.on('uncaughtException', (error) => {
  console.error('未捕获的异常:', error);
});

process.on('unhandledRejection', (error) => {
  console.error('未处理的 Promise 拒绝:', error);
});

let store: SqliteStore | null = null;
let coworkStore: CoworkStore | null = null;
let coworkRunner: CoworkRunner | null = null;
let skillManager: SkillManager | null = null;
let imGatewayManager: IMGatewayManager | null = null;
let scheduledTaskStore: ScheduledTaskStore | null = null;
let scheduler: Scheduler | null = null;
let storeInitPromise: Promise<SqliteStore> | null = null;

const initStore = async (): Promise<SqliteStore> => {
  if (!storeInitPromise) {
    if (!app.isReady()) {
      throw new Error('应用未就绪时就访问了存储。');
    }
    storeInitPromise = SqliteStore.create(app.getPath('userData'));
  }
  return storeInitPromise;
};

const getStore = (): SqliteStore => {
  if (!store) {
    throw new Error('存储未初始化。请先调用 initStore()。');
  }
  return store;
};

const getCoworkStore = () => {
  if (!coworkStore) {
    const sqliteStore = getStore();
    coworkStore = new CoworkStore(sqliteStore.getDatabase(), sqliteStore.getSaveFunction());
    const cleaned = coworkStore.autoDeleteNonPersonalMemories();
    if (cleaned > 0) {
      console.info(`[cowork-memory] Auto-deleted ${cleaned} non-personal/procedural memories`);
    }
  }
  return coworkStore;
};

const getCoworkRunner = () => {
  if (!coworkRunner) {
    coworkRunner = new CoworkRunner(getCoworkStore());

    // 设置事件监听器以转发到渲染进程
    coworkRunner.on('message', (sessionId: string, message: any) => {
      const safeMessage = sanitizeCoworkMessageForIpc(message);
      const windows = BrowserWindow.getAllWindows();
      windows.forEach(win => {
        if (!win.isDestroyed()) {
          try {
            win.webContents.send('cowork:stream:message', { sessionId, message: safeMessage });
          } catch (error) {
            console.error('转发协作消息失败:', error);
          }
        }
      });
    });

    coworkRunner.on('messageUpdate', (sessionId: string, messageId: string, content: string) => {
      const safeContent = truncateIpcString(content, IPC_UPDATE_CONTENT_MAX_CHARS);
      const windows = BrowserWindow.getAllWindows();
      windows.forEach(win => {
        if (!win.isDestroyed()) {
          try {
            win.webContents.send('cowork:stream:messageUpdate', { sessionId, messageId, content: safeContent });
          } catch (error) {
            console.error('转发协作消息更新失败:', error);
          }
        }
      });
    });

    coworkRunner.on('permissionRequest', (sessionId: string, request: any) => {
      if (coworkRunner?.getSessionConfirmationMode(sessionId) === 'text') {
        return;
      }
      const safeRequest = sanitizePermissionRequestForIpc(request);
      const windows = BrowserWindow.getAllWindows();
      windows.forEach(win => {
        if (!win.isDestroyed()) {
          try {
            win.webContents.send('cowork:stream:permission', { sessionId, request: safeRequest });
          } catch (error) {
            console.error('转发协作权限请求失败:', error);
          }
        }
      });
    });

    coworkRunner.on('complete', (sessionId: string, claudeSessionId: string | null) => {
      const windows = BrowserWindow.getAllWindows();
      windows.forEach(win => {
        if (!win.isDestroyed()) {
          win.webContents.send('cowork:stream:complete', { sessionId, claudeSessionId });
        }
      });
    });

    coworkRunner.on('error', (sessionId: string, error: string) => {
      const windows = BrowserWindow.getAllWindows();
      windows.forEach(win => {
        if (!win.isDestroyed()) {
          win.webContents.send('cowork:stream:error', { sessionId, error });
        }
      });
    });
  }
  return coworkRunner;
};

const getSkillManager = () => {
  if (!skillManager) {
    skillManager = new SkillManager(getStore);
  }
  return skillManager;
};

const getIMGatewayManager = () => {
  if (!imGatewayManager) {
    const sqliteStore = getStore();

    // 获取协作模式的依赖项
    const runner = getCoworkRunner();
    const store = getCoworkStore();

    imGatewayManager = new IMGatewayManager(
      sqliteStore.getDatabase(),
      sqliteStore.getSaveFunction(),
      {
        coworkRunner: runner,
        coworkStore: store,
      }
    );

    // 使用 LLM 配置提供程序进行初始化
    imGatewayManager.initialize({
      getLLMConfig: async () => {
        const appConfig = sqliteStore.get<any>('app_config');
        if (!appConfig) return null;

        // 查找第一个启用的提供商
        const providers = appConfig.providers || {};
        for (const [providerName, providerConfig] of Object.entries(providers) as [string, any][]) {
          if (providerConfig.enabled && providerConfig.apiKey) {
            const model = providerConfig.models?.[0]?.id;
            return {
              apiKey: providerConfig.apiKey,
              baseUrl: providerConfig.baseUrl,
              model: model,
              provider: providerName,
            };
          }
        }

        // 回退到旧版 API 配置
        if (appConfig.api?.key) {
          return {
            apiKey: appConfig.api.key,
            baseUrl: appConfig.api.baseUrl,
            model: appConfig.model?.defaultModel,
          };
        }

        return null;
      },
      getSkillsPrompt: async () => {
        return getSkillManager().buildAutoRoutingPrompt();
      },
    });

    // 将 IM 事件转发到渲染进程
    imGatewayManager.on('statusChange', (status) => {
      const windows = BrowserWindow.getAllWindows();
      windows.forEach(win => {
        if (!win.isDestroyed()) {
          win.webContents.send('im:status:change', status);
        }
      });
    });

    imGatewayManager.on('message', (message) => {
      const windows = BrowserWindow.getAllWindows();
      windows.forEach(win => {
        if (!win.isDestroyed()) {
          win.webContents.send('im:message:received', message);
        }
      });
    });

    imGatewayManager.on('error', ({ platform, error }) => {
      console.error(`[IM 网关] ${platform} 错误:`, error);
    });
  }
  return imGatewayManager;
};

const getScheduledTaskStore = () => {
  if (!scheduledTaskStore) {
    const sqliteStore = getStore();
    scheduledTaskStore = new ScheduledTaskStore(sqliteStore.getDatabase(), sqliteStore.getSaveFunction());
  }
  return scheduledTaskStore;
};

const getScheduler = () => {
  if (!scheduler) {
    scheduler = new Scheduler({
      scheduledTaskStore: getScheduledTaskStore(),
      coworkStore: getCoworkStore(),
      getCoworkRunner,
      getIMGatewayManager: () => {
        try { return getIMGatewayManager(); } catch { return null; }
      },
      getSkillsPrompt: async () => {
        return getSkillManager().buildAutoRoutingPrompt();
      },
    });
  }
  return scheduler;
};

// 获取正确的预加载脚本路径
const PRELOAD_PATH = app.isPackaged 
  ? path.join(__dirname, 'preload.js')
  : path.join(__dirname, '../dist-electron/preload.js');

// 获取应用图标路径（Windows 使用 .ico，其他平台使用 .png）
const getAppIconPath = (): string | undefined => {
  if (process.platform !== 'win32' && process.platform !== 'linux') return undefined;
  const basePath = app.isPackaged
    ? path.join(process.resourcesPath, 'tray')
    : path.join(__dirname, '..', 'resources', 'tray');
  return process.platform === 'win32'
    ? path.join(basePath, 'tray-icon.ico')
    : path.join(basePath, 'tray-icon.png');
};

// 保存对主窗口的引用
let mainWindow: BrowserWindow | null = null;

onSandboxProgress((progress) => {
  const windows = BrowserWindow.getAllWindows();
  windows.forEach((win) => {
    win.webContents.send('cowork:sandbox:downloadProgress', progress);
  });
});
let isQuitting = false;

// 存储活跃的流式请求控制器
const activeStreamControllers = new Map<string, AbortController>();
let lastReloadAt = 0;
const MIN_RELOAD_INTERVAL_MS = 5000;

const resolveThemeFromConfig = (config?: { theme?: string }): 'light' | 'dark' => {
  if (config?.theme === 'dark') {
    return 'dark';
  }
  if (config?.theme === 'light') {
    return 'light';
  }
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
};

const getInitialTheme = (): 'light' | 'dark' => {
  const config = getStore().get('app_config') as { theme?: string } | undefined;
  return resolveThemeFromConfig(config);
};

const getTitleBarOverlayOptions = () => {
  const config = getStore().get('app_config') as { theme?: string } | undefined;
  const theme = resolveThemeFromConfig(config);
  return {
    color: TITLEBAR_COLORS[theme].color,
    symbolColor: TITLEBAR_COLORS[theme].symbolColor,
    height: TITLEBAR_HEIGHT,
  };
};

const updateTitleBarOverlay = () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (!isMac && !isWindows) {
    mainWindow.setTitleBarOverlay(getTitleBarOverlayOptions());
  }
  // 同时更新窗口背景色以匹配主题
  const config = getStore().get('app_config') as { theme?: string } | undefined;
  const theme = resolveThemeFromConfig(config);
  mainWindow.setBackgroundColor(theme === 'dark' ? '#0F1117' : '#F8F9FB');
};

const emitWindowState = () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.webContents.isDestroyed()) return;
  mainWindow.webContents.send('window:state-changed', {
    isMaximized: mainWindow.isMaximized(),
    isFullscreen: mainWindow.isFullScreen(),
    isFocused: mainWindow.isFocused(),
  });
};

const showSystemMenu = (position?: { x?: number; y?: number }) => {
  if (!isWindows) return;
  if (!mainWindow || mainWindow.isDestroyed()) return;

  const isMaximized = mainWindow.isMaximized();
  const menu = Menu.buildFromTemplate([
    { label: '还原', enabled: isMaximized, click: () => mainWindow.restore() },
    { role: 'minimize' },
    { label: '最大化', enabled: !isMaximized, click: () => mainWindow.maximize() },
    { type: 'separator' },
    { role: 'close' },
  ]);

  menu.popup({
    window: mainWindow,
    x: Math.max(0, Math.round(position?.x ?? 0)),
    y: Math.max(0, Math.round(position?.y ?? 0)),
  });
};

const scheduleReload = (reason: string, webContents?: WebContents) => {
  const target = webContents ?? mainWindow?.webContents;
  if (!target || target.isDestroyed()) {
    return;
  }
  const now = Date.now();
  if (now - lastReloadAt < MIN_RELOAD_INTERVAL_MS) {
    console.warn(`跳过重新加载 (${reason}); 上次重新加载是在 ${now - lastReloadAt} 毫秒前。`);
    return;
  }
  lastReloadAt = now;
  console.warn(`由于 ${reason} 正在重新加载窗口`);
  target.reloadIgnoringCache();
};


// 确保应用程序只有一个实例
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, commandLine, workingDirectory) => {
    console.log('[主进程] 第二实例事件', { commandLine, workingDirectory });
    // 如果尝试启动第二个实例，则聚焦到主窗口
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      if (!mainWindow.isVisible()) mainWindow.show();
      if (!mainWindow.isFocused()) mainWindow.focus();
    }
  });

  // IPC 处理程序
  ipcMain.handle('store:get', (_event, key) => {
    return getStore().get(key);
  });

  ipcMain.handle('store:set', (_event, key, value) => {
    getStore().set(key, value);
  });

  ipcMain.handle('store:remove', (_event, key) => {
    getStore().delete(key);
  });

  // 网络状态变更处理程序
  // 首先移除任何现有监听器以避免重复注册
  ipcMain.removeAllListeners('network:status-change');
  ipcMain.on('network:status-change', (_event, status: 'online' | 'offline') => {
    console.log(`[主进程] 网络状态已变更: ${status}`);

    if (status === 'online' && imGatewayManager) {
      console.log('[主进程] 网络已恢复，正在重新连接 IM 网关...');
      imGatewayManager.reconnectAllDisconnected();
    }
  });

  // Log IPC handlers
  ipcMain.handle('log:getPath', () => {
    return getLogFilePath();
  });

  ipcMain.handle('log:openFolder', () => {
    const logPath = getLogFilePath();
    if (logPath) {
      shell.showItemInFolder(logPath);
    }
  });

  // 自动启动 IPC 处理程序
  ipcMain.handle('app:getAutoLaunch', () => {
    return { enabled: getAutoLaunchEnabled() };
  });

  ipcMain.handle('app:setAutoLaunch', (_event, enabled: unknown) => {
    if (typeof enabled !== 'boolean') {
      return { success: false, error: '无效参数: enabled 必须为布尔值' };
    }
    try {
      setAutoLaunchEnabled(enabled);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '设置自动启动失败',
      };
    }
  });

  // 窗口控制 IPC 处理程序
  ipcMain.on('window-minimize', () => {
    mainWindow?.minimize();
  });

  ipcMain.on('window-maximize', () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow?.maximize();
    }
  });

  ipcMain.on('window-close', () => {
    mainWindow?.close();
  });

  ipcMain.handle('window:isMaximized', () => {
    return mainWindow?.isMaximized() ?? false;
  });

  ipcMain.on('window:showSystemMenu', (_event, position: { x?: number; y?: number } | undefined) => {
    showSystemMenu(position);
  });

  ipcMain.handle('app:getVersion', () => app.getVersion());
  ipcMain.handle('app:getSystemLocale', () => app.getLocale());

  // 技能 IPC 处理程序
  ipcMain.handle('skills:list', () => {
    try {
      const skills = getSkillManager().listSkills();
      return { success: true, skills };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '加载技能失败' };
    }
  });

  ipcMain.handle('skills:setEnabled', (_event, options: { id: string; enabled: boolean }) => {
    try {
      const skills = getSkillManager().setSkillEnabled(options.id, options.enabled);
      return { success: true, skills };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '更新技能失败' };
    }
  });

  ipcMain.handle('skills:delete', (_event, id: string) => {
    try {
      const skills = getSkillManager().deleteSkill(id);
      return { success: true, skills };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '删除技能失败' };
    }
  });

  ipcMain.handle('skills:download', async (_event, source: string) => {
    return getSkillManager().downloadSkill(source);
  });

  ipcMain.handle('skills:getRoot', () => {
    try {
      const root = getSkillManager().getSkillsRoot();
      return { success: true, path: root };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '解析技能根目录失败' };
    }
  });

  ipcMain.handle('skills:autoRoutingPrompt', () => {
    try {
      const prompt = getSkillManager().buildAutoRoutingPrompt();
      return { success: true, prompt };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '构建自动路由提示失败' };
    }
  });

  ipcMain.handle('skills:getConfig', (_event, skillId: string) => {
    return getSkillManager().getSkillConfig(skillId);
  });

  ipcMain.handle('skills:setConfig', (_event, skillId: string, config: Record<string, string>) => {
    return getSkillManager().setSkillConfig(skillId, config);
  });

  ipcMain.handle('skills:testEmailConnectivity', async (
    _event,
    skillId: string,
    config: Record<string, string>
  ) => {
    return getSkillManager().testEmailConnectivity(skillId, config);
  });

  // 协作 IPC 处理程序
  ipcMain.handle('cowork:session:start', async (_event, options: {
    prompt: string;
    cwd?: string;
    systemPrompt?: string;
    title?: string;
    activeSkillIds?: string[];
  }) => {
    try {
      const coworkStoreInstance = getCoworkStore();
      const config = coworkStoreInstance.getConfig();
      const systemPrompt = options.systemPrompt ?? config.systemPrompt;
      const selectedWorkspaceRoot = (options.cwd || config.workingDirectory || '').trim();

      if (!selectedWorkspaceRoot) {
        return {
          success: false,
          error: '请在提交前选择任务文件夹。',
        };
      }

      // 从提示的第一行生成标题
      const fallbackTitle = options.prompt.split('\n')[0].slice(0, 50) || '新会话';
      const title = options.title?.trim() || fallbackTitle;
      const taskWorkingDirectory = resolveTaskWorkingDirectory(selectedWorkspaceRoot);

      const session = coworkStoreInstance.createSession(
        title,
        taskWorkingDirectory,
        systemPrompt,
        config.executionMode || 'local',
        options.activeSkillIds || []
      );
      const runner = getCoworkRunner();

      // 在启动异步任务之前将会话状态更新为 'running'
      // 这确保前端立即收到正确的状态
      coworkStoreInstance.updateSession(session.id, { status: 'running' });
      coworkStoreInstance.addMessage(session.id, {
        type: 'user',
        content: options.prompt,
        metadata: options.activeSkillIds?.length ? { skillIds: options.activeSkillIds } : undefined,
      });

      // 异步启动会话（跳过初始用户消息，因为我们已经添加了它）
      runner.startSession(session.id, options.prompt, {
        skipInitialUserMessage: true,
        skillIds: options.activeSkillIds,
        workspaceRoot: selectedWorkspaceRoot,
        confirmationMode: 'modal',
      }).catch(error => {
        console.error('协作会话错误:', error);
      });

      const sessionWithMessages = coworkStoreInstance.getSession(session.id) || {
        ...session,
        status: 'running' as const,
      };
      return { success: true, session: sessionWithMessages };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '启动会话失败',
      };
    }
  });

  ipcMain.handle('cowork:session:continue', async (_event, options: {
    sessionId: string;
    prompt: string;
    systemPrompt?: string;
    activeSkillIds?: string[];
  }) => {
    try {
      const runner = getCoworkRunner();
      runner.continueSession(options.sessionId, options.prompt, { systemPrompt: options.systemPrompt, skillIds: options.activeSkillIds }).catch(error => {
        console.error('协作继续错误:', error);
      });

      const session = getCoworkStore().getSession(options.sessionId);
      return { success: true, session };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '继续会话失败',
      };
    }
  });

  ipcMain.handle('cowork:session:stop', async (_event, sessionId: string) => {
    try {
      const runner = getCoworkRunner();
      runner.stopSession(sessionId);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '停止会话失败',
      };
    }
  });

  ipcMain.handle('cowork:session:delete', async (_event, sessionId: string) => {
    try {
      const coworkStoreInstance = getCoworkStore();
      coworkStoreInstance.deleteSession(sessionId);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '删除会话失败',
      };
    }
  });

  ipcMain.handle('cowork:session:pin', async (_event, options: { sessionId: string; pinned: boolean }) => {
    try {
      const coworkStoreInstance = getCoworkStore();
      coworkStoreInstance.setSessionPinned(options.sessionId, options.pinned);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '更新会话置顶失败',
      };
    }
  });

  ipcMain.handle('cowork:session:rename', async (_event, options: { sessionId: string; title: string }) => {
    try {
      const title = options.title.trim();
      if (!title) {
        return { success: false, error: '标题为必填项' };
      }
      const coworkStoreInstance = getCoworkStore();
      coworkStoreInstance.updateSession(options.sessionId, { title });
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '重命名会话失败',
      };
    }
  });

  ipcMain.handle('cowork:session:get', async (_event, sessionId: string) => {
    try {
      const session = getCoworkStore().getSession(sessionId);
      return { success: true, session };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '获取会话失败',
      };
    }
  });

  ipcMain.handle('cowork:session:list', async () => {
    try {
      const sessions = getCoworkStore().listSessions();
      return { success: true, sessions };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '列出会话失败',
      };
    }
  });

  ipcMain.handle('cowork:session:exportResultImage', async (
    event,
    options: {
      rect: { x: number; y: number; width: number; height: number };
      defaultFileName?: string;
    }
  ) => {
    try {
      const { rect, defaultFileName } = options || {};
      const captureRect = normalizeCaptureRect(rect);
      if (!captureRect) {
        return { success: false, error: '需要捕获区域' };
      }

      const image = await event.sender.capturePage(captureRect);
      return savePngWithDialog(event.sender, image.toPNG(), defaultFileName);
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '导出会话图片失败',
      };
    }
  });

  ipcMain.handle('cowork:session:captureImageChunk', async (
    event,
    options: {
      rect: { x: number; y: number; width: number; height: number };
    }
  ) => {
    try {
      const captureRect = normalizeCaptureRect(options?.rect);
      if (!captureRect) {
        return { success: false, error: '需要捕获区域' };
      }

      const image = await event.sender.capturePage(captureRect);
      const pngBuffer = image.toPNG();

      return {
        success: true,
        width: captureRect.width,
        height: captureRect.height,
        pngBase64: pngBuffer.toString('base64'),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '捕获会话图片块失败',
      };
    }
  });

  ipcMain.handle('cowork:session:saveResultImage', async (
    event,
    options: {
      pngBase64: string;
      defaultFileName?: string;
    }
  ) => {
    try {
      const base64 = typeof options?.pngBase64 === 'string' ? options.pngBase64.trim() : '';
      if (!base64) {
        return { success: false, error: '需要图片数据' };
      }

      const pngBuffer = Buffer.from(base64, 'base64');
      if (pngBuffer.length <= 0) {
        return { success: false, error: '无效的图片数据' };
      }

      return savePngWithDialog(event.sender, pngBuffer, options?.defaultFileName);
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '保存会话图片失败',
      };
    }
  });

  ipcMain.handle('cowork:permission:respond', async (_event, options: {
    requestId: string;
    result: PermissionResult;
  }) => {
    try {
      const runner = getCoworkRunner();
      runner.respondToPermission(options.requestId, options.result);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '响应权限失败',
      };
    }
  });

  ipcMain.handle('cowork:config:get', async () => {
    try {
      const config = getCoworkStore().getConfig();
      return { success: true, config };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '获取配置失败',
      };
    }
  });

  ipcMain.handle('cowork:sandbox:status', async () => {
    return getSandboxStatus();
  });
  ipcMain.handle('cowork:memory:listEntries', async (_event, input: {
    query?: string;
    status?: 'created' | 'stale' | 'deleted' | 'all';
    includeDeleted?: boolean;
    limit?: number;
    offset?: number;
  }) => {
    try {
      const entries = getCoworkStore().listUserMemories({
        query: input?.query?.trim() || undefined,
        status: input?.status || 'all',
        includeDeleted: Boolean(input?.includeDeleted),
        limit: input?.limit,
        offset: input?.offset,
      });
      return { success: true, entries };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '列出内存条目失败',
      };
    }
  });
  ipcMain.handle('cowork:memory:createEntry', async (_event, input: {
    text: string;
    confidence?: number;
    isExplicit?: boolean;
  }) => {
    try {
      const entry = getCoworkStore().createUserMemory({
        text: input.text,
        confidence: input.confidence,
        isExplicit: input?.isExplicit,
      });
      return { success: true, entry };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '创建内存条目失败',
      };
    }
  });
  ipcMain.handle('cowork:memory:updateEntry', async (_event, input: {
    id: string;
    text?: string;
    confidence?: number;
    status?: 'created' | 'stale' | 'deleted';
    isExplicit?: boolean;
  }) => {
    try {
      const entry = getCoworkStore().updateUserMemory({
        id: input.id,
        text: input.text,
        confidence: input.confidence,
        status: input.status,
        isExplicit: input.isExplicit,
      });
      if (!entry) {
        return { success: false, error: '未找到内存条目' };
      }
      return { success: true, entry };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '更新内存条目失败',
      };
    }
  });
  ipcMain.handle('cowork:memory:deleteEntry', async (_event, input: {
    id: string;
  }) => {
    try {
      const success = getCoworkStore().deleteUserMemory(input.id);
      return success
        ? { success: true }
        : { success: false, error: '未找到内存条目' };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '删除内存条目失败',
      };
    }
  });
  ipcMain.handle('cowork:memory:getStats', async () => {
    try {
      const stats = getCoworkStore().getUserMemoryStats();
      return { success: true, stats };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '获取内存统计失败',
      };
    }
  });
  ipcMain.handle('cowork:sandbox:install', async () => {
    const result = await ensureSandboxReady();
    return {
      success: result.ok,
      status: getSandboxStatus(),
      error: result.ok ? undefined : ('error' in result ? result.error : undefined),
    };
  });

  ipcMain.handle('cowork:config:set', async (_event, config: {
    workingDirectory?: string;
    executionMode?: 'auto' | 'local' | 'sandbox';
    memoryEnabled?: boolean;
    memoryImplicitUpdateEnabled?: boolean;
    memoryLlmJudgeEnabled?: boolean;
    memoryGuardLevel?: 'strict' | 'standard' | 'relaxed';
    memoryUserMemoriesMaxItems?: number;
  }) => {
    try {
      const normalizedExecutionMode =
        config.executionMode && String(config.executionMode) === 'container'
          ? 'sandbox'
          : config.executionMode;
      const normalizedMemoryEnabled = typeof config.memoryEnabled === 'boolean'
        ? config.memoryEnabled
        : undefined;
      const normalizedMemoryImplicitUpdateEnabled = typeof config.memoryImplicitUpdateEnabled === 'boolean'
        ? config.memoryImplicitUpdateEnabled
        : undefined;
      const normalizedMemoryLlmJudgeEnabled = typeof config.memoryLlmJudgeEnabled === 'boolean'
        ? config.memoryLlmJudgeEnabled
        : undefined;
      const normalizedMemoryGuardLevel = config.memoryGuardLevel === 'strict'
        || config.memoryGuardLevel === 'standard'
        || config.memoryGuardLevel === 'relaxed'
        ? config.memoryGuardLevel
        : undefined;
      const normalizedMemoryUserMemoriesMaxItems =
        typeof config.memoryUserMemoriesMaxItems === 'number' && Number.isFinite(config.memoryUserMemoriesMaxItems)
          ? Math.max(
            MIN_MEMORY_USER_MEMORIES_MAX_ITEMS,
            Math.min(MAX_MEMORY_USER_MEMORIES_MAX_ITEMS, Math.floor(config.memoryUserMemoriesMaxItems))
          )
        : undefined;
      const normalizedConfig = {
        ...config,
        executionMode: normalizedExecutionMode,
        memoryEnabled: normalizedMemoryEnabled,
        memoryImplicitUpdateEnabled: normalizedMemoryImplicitUpdateEnabled,
        memoryLlmJudgeEnabled: normalizedMemoryLlmJudgeEnabled,
        memoryGuardLevel: normalizedMemoryGuardLevel,
        memoryUserMemoriesMaxItems: normalizedMemoryUserMemoriesMaxItems,
      };
      const previousWorkingDir = getCoworkStore().getConfig().workingDirectory;
      getCoworkStore().setConfig(normalizedConfig);
      if (normalizedConfig.workingDirectory !== undefined && normalizedConfig.workingDirectory !== previousWorkingDir) {
        getSkillManager().handleWorkingDirectoryChange();
      }
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '设置配置失败',
      };
    }
  });

  // ==================== 计划任务 IPC 处理程序 ====================

  ipcMain.handle('scheduledTask:list', async () => {
    try {
      const tasks = getScheduledTaskStore().listTasks();
      return { success: true, tasks };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '列出任务失败' };
    }
  });

  ipcMain.handle('scheduledTask:get', async (_event, id: string) => {
    try {
      const task = getScheduledTaskStore().getTask(id);
      return { success: true, task };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '获取任务失败' };
    }
  });

  ipcMain.handle('scheduledTask:create', async (_event, input: any) => {
    try {
      const coworkConfig = getCoworkStore().getConfig();
      const normalizedInput = input && typeof input === 'object' ? { ...input } : {};
      const candidateWorkingDirectory = typeof normalizedInput.workingDirectory === 'string' && normalizedInput.workingDirectory.trim()
        ? normalizedInput.workingDirectory
        : coworkConfig.workingDirectory;
      normalizedInput.workingDirectory = resolveExistingTaskWorkingDirectory(candidateWorkingDirectory);

      const task = getScheduledTaskStore().createTask(normalizedInput);
      getScheduler().reschedule();
      return { success: true, task };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '创建任务失败' };
    }
  });

  ipcMain.handle('scheduledTask:update', async (_event, id: string, input: any) => {
    try {
      const scheduledTaskStore = getScheduledTaskStore();
      const existingTask = scheduledTaskStore.getTask(id);
      if (!existingTask) {
        return { success: false, error: `未找到任务: ${id}` };
      }

      const coworkConfig = getCoworkStore().getConfig();
      const normalizedInput = input && typeof input === 'object' ? { ...input } : {};
      const candidateWorkingDirectory = typeof normalizedInput.workingDirectory === 'string'
        ? (normalizedInput.workingDirectory.trim() || existingTask.workingDirectory || coworkConfig.workingDirectory)
        : (existingTask.workingDirectory || coworkConfig.workingDirectory);
      normalizedInput.workingDirectory = resolveExistingTaskWorkingDirectory(candidateWorkingDirectory);

      const task = scheduledTaskStore.updateTask(id, normalizedInput);
      getScheduler().reschedule();
      return { success: true, task };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '更新任务失败' };
    }
  });

  ipcMain.handle('scheduledTask:delete', async (_event, id: string) => {
    try {
      getScheduler().stopTask(id);
      const result = getScheduledTaskStore().deleteTask(id);
      getScheduler().reschedule();
      return { success: true, result };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '删除任务失败' };
    }
  });

  ipcMain.handle('scheduledTask:toggle', async (_event, id: string, enabled: boolean) => {
    try {
      const { task, warning } = getScheduledTaskStore().toggleTask(id, enabled);
      getScheduler().reschedule();
      return { success: true, task, warning };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '切换任务失败' };
    }
  });

  ipcMain.handle('scheduledTask:runManually', async (_event, id: string) => {
    try {
      getScheduler().runManually(id).catch((err) => {
        console.error(`[IPC] 手动运行 ${id} 失败:`, err);
      });
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '运行任务失败' };
    }
  });

  ipcMain.handle('scheduledTask:stop', async (_event, id: string) => {
    try {
      const result = getScheduler().stopTask(id);
      return { success: true, result };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '停止任务失败' };
    }
  });

  ipcMain.handle('scheduledTask:listRuns', async (_event, taskId: string, limit?: number, offset?: number) => {
    try {
      const runs = getScheduledTaskStore().listRuns(taskId, limit, offset);
      return { success: true, runs };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '列出运行记录失败' };
    }
  });

  ipcMain.handle('scheduledTask:countRuns', async (_event, taskId: string) => {
    try {
      const count = getScheduledTaskStore().countRuns(taskId);
      return { success: true, count };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '统计运行记录失败' };
    }
  });

  ipcMain.handle('scheduledTask:listAllRuns', async (_event, limit?: number, offset?: number) => {
    try {
      const runs = getScheduledTaskStore().listAllRuns(limit, offset);
      return { success: true, runs };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '列出所有运行记录失败' };
    }
  });

  // ==================== 权限 IPC 处理程序 ====================

  ipcMain.handle('permissions:checkCalendar', async () => {
    try {
      const status = await checkCalendarPermission();
      
      // 开发模式: 如果未确定则自动请求权限
      // 这提供了更好的开发体验而不影响生产环境
      if (isDev && status === 'not-determined' && process.platform === 'darwin') {
        console.log('[权限] 开发模式: 自动请求日历权限...');
        try {
          await requestCalendarPermission();
          const newStatus = await checkCalendarPermission();
          console.log('[权限] 开发模式: 请求后的权限状态:', newStatus);
          return { success: true, status: newStatus, autoRequested: true };
        } catch (requestError) {
          console.warn('[权限] 开发模式: 自动请求失败:', requestError);
        }
      }
      
      return { success: true, status };
    } catch (error) {
      console.error('[主进程] 检查日历权限错误:', error);
      return { success: false, error: error instanceof Error ? error.message : '检查权限失败' };
    }
  });

  ipcMain.handle('permissions:requestCalendar', async () => {
    try {
      // 请求权限并检查状态
      const granted = await requestCalendarPermission();
      const status = await checkCalendarPermission();
      return { success: true, granted, status };
    } catch (error) {
      console.error('[主进程] 请求日历权限错误:', error);
      return { success: false, error: error instanceof Error ? error.message : '请求权限失败' };
    }
  });

  // ==================== IM 网关 IPC 处理程序 ====================

  ipcMain.handle('im:config:get', async () => {
    try {
      const config = getIMGatewayManager().getConfig();
      return { success: true, config };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '获取 IM 配置失败',
      };
    }
  });

  ipcMain.handle('im:config:set', async (_event, config: Partial<IMGatewayConfig>) => {
    try {
      getIMGatewayManager().setConfig(config);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '设置 IM 配置失败',
      };
    }
  });

  ipcMain.handle('im:gateway:start', async (_event, platform: IMPlatform) => {
    try {
      // 持久化启用状态
      const manager = getIMGatewayManager();
      manager.setConfig({ [platform]: { enabled: true } });
      await manager.startGateway(platform);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '启动网关失败',
      };
    }
  });

  ipcMain.handle('im:gateway:stop', async (_event, platform: IMPlatform) => {
    try {
      // 持久化禁用状态
      const manager = getIMGatewayManager();
      manager.setConfig({ [platform]: { enabled: false } });
      await manager.stopGateway(platform);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '停止网关失败',
      };
    }
  });

  ipcMain.handle('im:gateway:test', async (
    _event,
    platform: IMPlatform,
    configOverride?: Partial<IMGatewayConfig>
  ) => {
    try {
      const result = await getIMGatewayManager().testGateway(platform, configOverride);
      return { success: true, result };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '测试网关连接失败',
      };
    }
  });

  ipcMain.handle('im:status:get', async () => {
    try {
      const status = getIMGatewayManager().getStatus();
      return { success: true, status };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '获取 IM 状态失败',
      };
    }
  });

  ipcMain.handle('generate-session-title', async (_event, userInput: string | null) => {
    return generateSessionTitle(userInput);
  });

  ipcMain.handle('get-recent-cwds', async (_event, limit?: number) => {
    const boundedLimit = limit ? Math.min(Math.max(limit, 1), 20) : 8;
    return getCoworkStore().listRecentCwds(boundedLimit);
  });

  ipcMain.handle('get-api-config', async () => {
    return getCurrentApiConfig();
  });

  ipcMain.handle('check-api-config', async () => {
    const { config, error } = resolveCurrentApiConfig();
    return { hasConfig: config !== null, config, error };
  });

  ipcMain.handle('save-api-config', async (_event, config: {
    apiKey: string;
    baseURL: string;
    model: string;
    apiType?: 'anthropic' | 'openai';
  }) => {
    try {
      saveCoworkApiConfig(config);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '保存 API 配置失败',
      };
    }
  });

  // 对话框处理程序
  ipcMain.handle('dialog:selectDirectory', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { success: true, path: null };
    }
    return { success: true, path: result.filePaths[0] };
  });

  ipcMain.handle('dialog:selectFile', async (_event, options?: { title?: string; filters?: { name: string; extensions: string[] }[] }) => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      title: options?.title,
      filters: options?.filters,
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { success: true, path: null };
    }
    return { success: true, path: result.filePaths[0] };
  });

  ipcMain.handle(
    'dialog:saveInlineFile',
    async (
      _event,
      options?: { dataBase64?: string; fileName?: string; mimeType?: string; cwd?: string }
    ) => {
      try {
        const dataBase64 = typeof options?.dataBase64 === 'string' ? options.dataBase64.trim() : '';
        if (!dataBase64) {
          return { success: false, path: null, error: '缺少文件数据' };
        }

        const buffer = Buffer.from(dataBase64, 'base64');
        if (!buffer.length) {
          return { success: false, path: null, error: '无效的文件数据' };
        }
        if (buffer.length > MAX_INLINE_ATTACHMENT_BYTES) {
          return {
            success: false,
            path: null,
            error: `文件过大（最大 ${Math.floor(MAX_INLINE_ATTACHMENT_BYTES / (1024 * 1024))}MB）`,
          };
        }

        const dir = resolveInlineAttachmentDir(options?.cwd);
        await fs.promises.mkdir(dir, { recursive: true });

        const safeFileName = sanitizeAttachmentFileName(options?.fileName);
        const extension = inferAttachmentExtension(safeFileName, options?.mimeType);
        const baseName = extension ? safeFileName.slice(0, -extension.length) : safeFileName;
        const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const finalName = `${baseName || 'attachment'}-${uniqueSuffix}${extension}`;
        const outputPath = path.join(dir, finalName);

        await fs.promises.writeFile(outputPath, buffer);
        return { success: true, path: outputPath };
      } catch (error) {
        return {
          success: false,
          path: null,
          error: error instanceof Error ? error.message : '保存内联文件失败',
        };
      }
    }
  );

  // Shell 处理程序 - 打开文件/文件夹
  ipcMain.handle('shell:openPath', async (_event, filePath: string) => {
    try {
      const normalizedPath = normalizeWindowsShellPath(filePath);
      const result = await shell.openPath(normalizedPath);
      if (result) {
        // 如果返回非空字符串，表示打开失败
        return { success: false, error: result };
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '未知错误' };
    }
  });

  ipcMain.handle('shell:showItemInFolder', async (_event, filePath: string) => {
    try {
      const normalizedPath = normalizeWindowsShellPath(filePath);
      shell.showItemInFolder(normalizedPath);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '未知错误' };
    }
  });

  ipcMain.handle('shell:openExternal', async (_event, url: string) => {
    try {
      await shell.openExternal(url);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '未知错误' };
    }
  });

  // API 代理处理程序 - 解决 CORS 问题
  ipcMain.handle('api:fetch', async (_event, options: {
    url: string;
    method: string;
    headers: Record<string, string>;
    body?: string;
  }) => {
    try {
      const response = await session.defaultSession.fetch(options.url, {
        method: options.method,
        headers: options.headers,
        body: options.body,
      });

      const contentType = response.headers.get('content-type') || '';
      let data: string | object;

      if (contentType.includes('text/event-stream')) {
        // SSE 流式响应，返回完整的文本
        data = await response.text();
      } else if (contentType.includes('application/json')) {
        data = await response.json();
      } else {
        data = await response.text();
      }

      return {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries()),
        data,
      };
    } catch (error) {
      return {
        ok: false,
        status: 0,
        statusText: error instanceof Error ? error.message : '网络错误',
        headers: {},
        data: null,
        error: error instanceof Error ? error.message : '未知错误',
      };
    }
  });

  // SSE 流式 API 代理
  ipcMain.handle('api:stream', async (event, options: {
    url: string;
    method: string;
    headers: Record<string, string>;
    body?: string;
    requestId: string;
  }) => {
    const controller = new AbortController();

    // 存储 controller 以便后续取消
    activeStreamControllers.set(options.requestId, controller);

    try {
      const response = await session.defaultSession.fetch(options.url, {
        method: options.method,
        headers: options.headers,
        body: options.body,
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorData = await response.text();
        activeStreamControllers.delete(options.requestId);
        return {
          ok: false,
          status: response.status,
          statusText: response.statusText,
          error: errorData,
        };
      }

      if (!response.body) {
        activeStreamControllers.delete(options.requestId);
        return {
          ok: false,
          status: response.status,
          statusText: '无响应体',
        };
      }

      // 读取流式响应并通过 IPC 发送
      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      const readStream = async () => {
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) {
              event.sender.send(`api:stream:${options.requestId}:done`);
              break;
            }
            const chunk = decoder.decode(value);
            event.sender.send(`api:stream:${options.requestId}:data`, chunk);
          }
        } catch (error) {
          if (error instanceof Error && error.name === 'AbortError') {
            event.sender.send(`api:stream:${options.requestId}:abort`);
          } else {
            event.sender.send(`api:stream:${options.requestId}:error`,
              error instanceof Error ? error.message : '流错误');
          }
        } finally {
          activeStreamControllers.delete(options.requestId);
        }
      };

      // 异步读取流，立即返回成功状态
      readStream();

      return {
        ok: true,
        status: response.status,
        statusText: response.statusText,
      };
    } catch (error) {
      activeStreamControllers.delete(options.requestId);
      return {
        ok: false,
        status: 0,
        statusText: error instanceof Error ? error.message : '网络错误',
        error: error instanceof Error ? error.message : '未知错误',
      };
    }
  });

  // 取消流式请求
  ipcMain.handle('api:stream:cancel', (_event, requestId: string) => {
    const controller = activeStreamControllers.get(requestId);
    if (controller) {
      controller.abort();
      activeStreamControllers.delete(requestId);
      return true;
    }
    return false;
  });

  // 设置 Content Security Policy
  const setContentSecurityPolicy = () => {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      const devPort = process.env.ELECTRON_START_URL?.match(/:(\d+)/)?.[1] || '5175';
      const cspDirectives = [
        "default-src 'self'",
        isDev ? `script-src 'self' 'unsafe-inline' http://localhost:${devPort} ws://localhost:${devPort}` : "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: https: http:",
        // 允许连接到所有域名，不做限制
        "connect-src *",
        "font-src 'self' data:",
        "media-src 'self'",
        "worker-src 'self' blob:",
        "frame-src 'self'"
      ];

      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': cspDirectives.join('; ')
        }
      });
    });
  };

  // 创建主窗口
  const createWindow = () => {
    // 如果窗口已经存在，就不再创建新窗口
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      if (!mainWindow.isVisible()) mainWindow.show();
      if (!mainWindow.isFocused()) mainWindow.focus();
      return;
    }

    mainWindow = new BrowserWindow({
      width: 1200,
      height: 800,
      title: APP_NAME,
      icon: getAppIconPath(),
      ...(isMac
        ? {
            titleBarStyle: 'hiddenInset' as const,
            trafficLightPosition: { x: 12, y: 20 },
          }
        : isWindows
          ? {
              frame: false,
              titleBarStyle: 'hidden' as const,
            }
          : {
            titleBarStyle: 'hidden' as const,
            titleBarOverlay: getTitleBarOverlayOptions(),
          }),
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        preload: PRELOAD_PATH,
        backgroundThrottling: false,
        devTools: isDev,
        spellcheck: false,
        enableWebSQL: false,
        autoplayPolicy: 'document-user-activation-required',
        disableDialogs: true,
        navigateOnDragDrop: false
      },
      backgroundColor: getInitialTheme() === 'dark' ? '#0F1117' : '#F8F9FB',
      show: false,
      autoHideMenuBar: true,
      enableLargerThanScreen: false
    });

    // 设置 macOS Dock 图标（开发模式下 Electron 默认图标不是应用 Logo）
    if (isMac && isDev) {
      const iconPath = path.join(__dirname, '../build/icons/png/512x512.png');
      if (fs.existsSync(iconPath)) {
        app.dock.setIcon(nativeImage.createFromPath(iconPath));
      }
    }

    // 禁用窗口菜单
    mainWindow.setMenu(null);

    // 设置窗口的最小尺寸
    mainWindow.setMinimumSize(800, 600);

    // 设置窗口加载超时
    const loadTimeout = setTimeout(() => {
      if (mainWindow && mainWindow.webContents.isLoadingMainFrame()) {
        console.log('Window load timed out, attempting to reload...');
        scheduleReload('load-timeout');
      }
    }, 30000);

    // 清除超时
    mainWindow.webContents.once('did-finish-load', () => {
      clearTimeout(loadTimeout);
    });
    mainWindow.webContents.on('did-finish-load', () => {
      emitWindowState();
    });

    // [关键代码] 显式告诉 Electron 使用系统的代理配置
    // 这会涵盖绝大多数 VPN（如 Clash, V2Ray 等开启了"系统代理"模式的情况）
    mainWindow.webContents.session.setProxy({ mode: 'system' }).then(() => {
      console.log('已设置为跟随系统代理');
    });

    // 处理窗口关闭
    mainWindow.on('close', (e) => {
      // 在开发环境中，关闭应该真正退出，以便 `npm run electron:dev`
      // 从干净的进程重新启动。在生产环境中我们保持托盘行为。
      if (mainWindow && !isQuitting && !isDev) {
        e.preventDefault();
        mainWindow.hide();
      }
    });

    // 处理渲染进程崩溃或退出
    mainWindow.webContents.on('render-process-gone', (_event, details) => {
      console.error('窗口渲染进程已退出:', details);
      scheduleReload('webContents崩溃');
    });

    if (isDev) {
      // 开发环境
      const maxRetries = 3;
      let retryCount = 0;

      const tryLoadURL = () => {
        mainWindow?.loadURL(DEV_SERVER_URL).catch((err) => {
          console.error('加载 URL 失败:', err);
          retryCount++;
          
          if (retryCount < maxRetries) {
            console.log(`正在重试加载 URL (${retryCount}/${maxRetries})...`);
            setTimeout(tryLoadURL, 3000);
          } else {
            console.error('达到最大重试次数后仍无法加载 URL');
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.loadFile(path.join(__dirname, '../resources/error.html'));
            }
          }
        });
      };

      tryLoadURL();
      
      // 打开开发者工具
      mainWindow.webContents.openDevTools();
    } else {
      // 生产环境
      mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
    }

    // 添加错误处理
    mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
      console.error('页面加载失败:', errorCode, errorDescription);
      // 如果加载失败，尝试重新加载
      if (isDev) {
        setTimeout(() => {
          scheduleReload('加载失败');
        }, 3000);
      }
    });

    // 当窗口关闭时，清除引用
    mainWindow.on('closed', () => {
      mainWindow = null;
    });

    const forwardWindowState = () => emitWindowState();
    mainWindow.on('maximize', forwardWindowState);
    mainWindow.on('unmaximize', forwardWindowState);
    mainWindow.on('enter-full-screen', forwardWindowState);
    mainWindow.on('leave-full-screen', forwardWindowState);
    mainWindow.on('focus', forwardWindowState);
    mainWindow.on('blur', forwardWindowState);

    // 等待内容加载完成后再显示窗口
    mainWindow.once('ready-to-show', () => {
      emitWindowState();
      // 开机自启时不显示窗口，仅显示托盘图标
      if (!isAutoLaunched()) {
        mainWindow?.show();
      }
      // 窗口就绪后创建系统托盘
      createTray(() => mainWindow, getStore());

      // 启动调度器
      getScheduler().start();
    });
  };

  let isCleanupFinished = false;
  let isCleanupInProgress = false;

  const runAppCleanup = async (): Promise<void> => {
    console.log('[主进程] 应用正在退出，开始清理...');
    destroyTray();
    skillManager?.stopWatching();

    // 停止协作会话而不阻塞关闭
    if (coworkRunner) {
      console.log('[主进程] 正在停止协作会话...');
      coworkRunner.stopAllSessions();
    }

    await stopCoworkOpenAICompatProxy().catch((error) => {
      console.error('停止 OpenAI 兼容代理失败:', error);
    });

    // 停止技能服务
    const skillServices = getSkillServiceManager();
    await skillServices.stopAll();

    // 优雅地停止所有 IM 网关
    if (imGatewayManager) {
      await imGatewayManager.stopAll().catch(err => {
        console.error('[IM 网关] 退出时停止网关错误:', err);
      });
    }

    // 停止调度器
    if (scheduler) {
      scheduler.stop();
    }
  };

  app.on('before-quit', (e) => {
    if (isCleanupFinished) return;

    e.preventDefault();
    if (isCleanupInProgress) {
      return;
    }

    isCleanupInProgress = true;
    isQuitting = true;

    void runAppCleanup()
      .catch((error) => {
        console.error('[主进程] 清理错误:', error);
      })
      .finally(() => {
        isCleanupFinished = true;
        isCleanupInProgress = false;
        app.exit(0);
      });
  });

  const handleTerminationSignal = (signal: NodeJS.Signals) => {
    if (isCleanupFinished || isCleanupInProgress) {
      return;
    }
    console.log(`[主进程] 收到 ${signal} 信号，退出前运行清理...`);
    isCleanupInProgress = true;
    isQuitting = true;
    void runAppCleanup()
      .catch((error) => {
        console.error(`[主进程] ${signal} 期间清理错误:`, error);
      })
      .finally(() => {
        isCleanupFinished = true;
        isCleanupInProgress = false;
        app.exit(0);
      });
  };

  process.once('SIGINT', () => handleTerminationSignal('SIGINT'));
  process.once('SIGTERM', () => handleTerminationSignal('SIGTERM'));

  // 初始化应用
  const initApp = async () => {
    await app.whenReady();

    migrateLegacyUserData();

    // 注意: 日历权限在请求日历操作时按需检查
    // 我们不在启动时触发权限对话框以避免打扰用户

    // 确保默认工作目录存在
    const defaultProjectDir = path.join(os.homedir(), 'lobsterai', 'project');
    if (!fs.existsSync(defaultProjectDir)) {
      fs.mkdirSync(defaultProjectDir, { recursive: true });
      console.log('已创建默认项目目录:', defaultProjectDir);
    }

    store = await initStore();
    // 防御性恢复: 应用可能在执行期间被强制关闭，并在数据库中留下
    // 过期的运行标志。在启动时将它们标准化。
    const resetCount = getCoworkStore().resetRunningSessions();
    if (resetCount > 0) {
      console.log(`[主进程] 已重置 ${resetCount} 个卡住的协作会话状态: running -> idle`);
    }
    // 将存储获取器注入到 claudeSettings
    setStoreGetter(() => store);
    const manager = getSkillManager();
    manager.syncBundledSkillsToUserData();
    manager.startWatching();

    // 启动技能服务
    const skillServices = getSkillServiceManager();
    await skillServices.startAll();

    // [关键代码] 显式告诉 Electron 使用系统的代理配置
    // 这会涵盖绝大多数 VPN（如 Clash, V2Ray 等开启了"系统代理"模式的情况）
    await session.defaultSession.setProxy({ mode: 'system' });
    console.log('已设置为跟随系统代理');

    await startCoworkOpenAICompatProxy().catch((error) => {
      console.error('启动 OpenAI 兼容代理失败:', error);
    });

    // 将计划任务依赖项注入代理服务器
    setScheduledTaskDeps({ getScheduledTaskStore, getScheduler });

    // 设置安全策略
    setContentSecurityPolicy();

    // 创建窗口
    createWindow();

    // 自动重新连接重启前已启用的 IM 机器人
    getIMGatewayManager().startAllEnabled().catch((error) => {
      console.error('[IM] 自动启动已启用的网关失败:', error);
    });

    // 首次启动时默认开启开机自启动（先写标记再设置，避免崩溃后重复设置）
    if (!getStore().get('auto_launch_initialized')) {
      getStore().set('auto_launch_initialized', true);
      setAutoLaunchEnabled(true);
    }

    let lastLanguage = getStore().get<{ language?: string }>('app_config')?.language;
    getStore().onDidChange('app_config', () => {
      updateTitleBarOverlay();
      // 仅在语言变更时刷新托盘菜单文本
      const currentLanguage = getStore().get<{ language?: string }>('app_config')?.language;
      if (currentLanguage !== lastLanguage) {
        lastLanguage = currentLanguage;
        updateTrayMenu(() => mainWindow, getStore());
      }
    });

    // 在 macOS 上，当点击 dock 图标时显示已有窗口或重新创建
    app.on('activate', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (!mainWindow.isVisible()) mainWindow.show();
        if (!mainWindow.isFocused()) mainWindow.focus();
        return;
      }
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  };

  // 启动应用
  initApp().catch(console.error);

  // 当所有窗口关闭时退出应用
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
} 
