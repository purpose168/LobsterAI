import { app } from 'electron';
import { existsSync } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { coworkLog } from './coworkLogger';

export type ClaudeSdkModule = typeof import('@anthropic-ai/claude-agent-sdk');

let claudeSdkPromise: Promise<ClaudeSdkModule> | null = null;

const CLAUDE_SDK_PATH_PARTS = ['@anthropic-ai', 'claude-agent-sdk'];

function getClaudeSdkPath(): string {
  if (app.isPackaged) {
    return join(
      process.resourcesPath,
      'app.asar.unpacked',
      'node_modules',
      ...CLAUDE_SDK_PATH_PARTS,
      'sdk.mjs'
    );
  }

  // 在开发环境中，尝试在项目根目录的 node_modules 中查找 SDK
  // app.getAppPath() 可能指向 dist-electron 或其他构建输出目录
  // 我们需要在项目根目录中查找
  const appPath = app.getAppPath();
  // 如果 appPath 以 dist-electron 结尾，则向上一级
  const rootDir = appPath.endsWith('dist-electron')
    ? join(appPath, '..')
    : appPath;

  const sdkPath = join(
    rootDir,
    'node_modules',
    ...CLAUDE_SDK_PATH_PARTS,
    'sdk.mjs'
  );

  console.log('[ClaudeSDK] 解析的 SDK 路径:', sdkPath);
  return sdkPath;
}

export function loadClaudeSdk(): Promise<ClaudeSdkModule> {
  if (!claudeSdkPromise) {
    // 使用运行时动态导入，以便 CJS 构建可以加载 SDK 的 ESM 入口。
    const dynamicImport = new Function('specifier', 'return import(specifier)') as (
      specifier: string
    ) => Promise<ClaudeSdkModule>;
    const sdkPath = getClaudeSdkPath();
    const sdkUrl = pathToFileURL(sdkPath).href;
    const sdkExists = existsSync(sdkPath);

    coworkLog('INFO', 'loadClaudeSdk', '正在加载 Claude SDK', {
      sdkPath,
      sdkUrl,
      sdkExists,
      isPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
    });

    claudeSdkPromise = dynamicImport(sdkUrl).catch((error) => {
      coworkLog('ERROR', 'loadClaudeSdk', '加载 Claude SDK 失败', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        sdkPath,
        sdkExists,
      });
      claudeSdkPromise = null;
      throw error;
    });
  }

  return claudeSdkPromise;
}
