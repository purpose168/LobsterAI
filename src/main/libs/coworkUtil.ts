import { app, session } from 'electron';
import { execSync } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, chmodSync } from 'fs';
import { delimiter, dirname, join } from 'path';
import type { SDKResultMessage } from '@anthropic-ai/claude-agent-sdk';
import { loadClaudeSdk } from './claudeSdk';
import { buildEnvForConfig, getClaudeCodePath, getCurrentApiConfig } from './claudeSettings';
import type { OpenAICompatProxyTarget } from './coworkOpenAICompatProxy';
import { getInternalApiBaseURL } from './coworkOpenAICompatProxy';
import { coworkLog } from './coworkLogger';

function appendEnvPath(current: string | undefined, additions: string[]): string | undefined {
  const items = new Set<string>();

  for (const entry of additions) {
    if (entry) {
      items.add(entry);
    }
  }

  if (current) {
    for (const entry of current.split(delimiter)) {
      if (entry) {
        items.add(entry);
      }
    }
  }

  return items.size > 0 ? Array.from(items).join(delimiter) : current;
}

/**
 * 缓存的用户 shell PATH。解析一次后在多次调用中复用。
 */
let cachedUserShellPath: string | null | undefined;

/**
 * 在 macOS/Linux 上解析用户的登录 shell PATH。
 * macOS 上的打包 Electron 应用不会继承用户的 shell 配置文件，
 * 因此除非我们解析它，否则 node/npm 和其他工具将不在 PATH 中。
 */
function resolveUserShellPath(): string | null {
  if (cachedUserShellPath !== undefined) return cachedUserShellPath;

  if (process.platform === 'win32') {
    cachedUserShellPath = null;
    return null;
  }

  try {
    const shell = process.env.SHELL || '/bin/bash';
    const result = execSync(`${shell} -ilc 'echo __PATH__=$PATH'`, {
      encoding: 'utf-8',
      timeout: 5000,
      env: { ...process.env },
    });
    const match = result.match(/__PATH__=(.+)/);
    cachedUserShellPath = match ? match[1].trim() : null;
  } catch (error) {
    console.warn('[coworkUtil] 解析用户 shell PATH 失败:', error);
    cachedUserShellPath = null;
  }

  return cachedUserShellPath;
}

/**
 * Windows 上缓存的 git-bash 路径。解析一次后复用。
 */
let cachedGitBashPath: string | null | undefined;

function normalizeWindowsPath(input: string | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim().replace(/\r/g, '');
  if (!trimmed) return null;

  const unquoted = trimmed.replace(/^["']+|["']+$/g, '');
  if (!unquoted) return null;

  return unquoted.replace(/\//g, '\\');
}

function listWindowsCommandPaths(command: string): string[] {
  try {
    const output = execSync(command, { encoding: 'utf-8', timeout: 5000 });
    const parsed = output
      .split(/\r?\n/)
      .map((line) => normalizeWindowsPath(line))
      .filter((line): line is string => Boolean(line && existsSync(line)));
    return Array.from(new Set(parsed));
  } catch {
    return [];
  }
}

function listGitInstallPathsFromRegistry(): string[] {
  const registryKeys = [
    'HKCU\\Software\\GitForWindows',
    'HKLM\\Software\\GitForWindows',
    'HKLM\\Software\\WOW6432Node\\GitForWindows',
  ];

  const installRoots: string[] = [];

  for (const key of registryKeys) {
    try {
      const output = execSync(`reg query "${key}" /v InstallPath`, { encoding: 'utf-8', timeout: 5000 });
      for (const line of output.split(/\r?\n/)) {
        const match = line.match(/InstallPath\s+REG_\w+\s+(.+)$/i);
        const root = normalizeWindowsPath(match?.[1]);
        if (root) {
          installRoots.push(root);
        }
      }
    } catch {
      // 注册表键可能不存在
    }
  }

  return Array.from(new Set(installRoots));
}

function getWindowsGitToolDirs(bashPath: string): string[] {
  const normalized = bashPath.replace(/\//g, '\\');
  const lower = normalized.toLowerCase();
  let gitRoot: string | null = null;

  if (lower.endsWith('\\usr\\bin\\bash.exe')) {
    gitRoot = normalized.slice(0, -'\\usr\\bin\\bash.exe'.length);
  } else if (lower.endsWith('\\bin\\bash.exe')) {
    gitRoot = normalized.slice(0, -'\\bin\\bash.exe'.length);
  }

  if (!gitRoot) {
    const bashDir = dirname(normalized);
    return [bashDir].filter((dir) => existsSync(dir));
  }

  const candidates = [
    join(gitRoot, 'cmd'),
    join(gitRoot, 'mingw64', 'bin'),
    join(gitRoot, 'usr', 'bin'),
    join(gitRoot, 'bin'),
  ];

  return candidates.filter((dir) => existsSync(dir));
}

function ensureWindowsElectronNodeShim(electronPath: string): string | null {
  if (process.platform !== 'win32') {
    return null;
  }

  try {
    const shimDir = join(app.getPath('userData'), 'cowork', 'bin');
    mkdirSync(shimDir, { recursive: true });

    const nodeSh = join(shimDir, 'node');
    const nodeCmd = join(shimDir, 'node.cmd');

    const nodeShContent = [
      '#!/usr/bin/env bash',
      'if [ -z "${LOBSTERAI_ELECTRON_PATH:-}" ]; then',
      '  echo "LOBSTERAI_ELECTRON_PATH 未设置" >&2',
      '  exit 127',
      'fi',
      'exec env ELECTRON_RUN_AS_NODE=1 "${LOBSTERAI_ELECTRON_PATH}" "$@"',
      '',
    ].join('\n');

    const nodeCmdContent = [
      '@echo off',
      'if "%LOBSTERAI_ELECTRON_PATH%"=="" (',
      '  echo LOBSTERAI_ELECTRON_PATH 未设置 1>&2',
      '  exit /b 127',
      ')',
      'set ELECTRON_RUN_AS_NODE=1',
      '"%LOBSTERAI_ELECTRON_PATH%" %*',
      '',
    ].join('\r\n');

    writeFileSync(nodeSh, nodeShContent, 'utf8');
    writeFileSync(nodeCmd, nodeCmdContent, 'utf8');
    try {
      chmodSync(nodeSh, 0o755);
    } catch {
      // 忽略不支持 POSIX 模式的 Windows 文件系统上的 chmod 错误
    }

    return shimDir;
  } catch (error) {
    coworkLog('WARN', 'resolveNodeShim', `准备 Electron Node 垫片失败: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/**
 * 在 Windows 上解析 git-bash 路径。
 * Claude Code CLI 需要 git-bash 来执行 shell 工具。
 * 检查顺序：环境变量 > 常见安装路径 > PATH 查找 > 捆绑的 PortableGit 回退。
 */
function resolveWindowsGitBashPath(): string | null {
  if (cachedGitBashPath !== undefined) return cachedGitBashPath;

  if (process.platform !== 'win32') {
    cachedGitBashPath = null;
    return null;
  }

  // 1. 显式环境变量（用户覆盖）
  const envPath = normalizeWindowsPath(process.env.CLAUDE_CODE_GIT_BASH_PATH);
  if (envPath && existsSync(envPath)) {
    coworkLog('INFO', 'resolveGitBash', `使用 CLAUDE_CODE_GIT_BASH_PATH: ${envPath}`);
    cachedGitBashPath = envPath;
    return envPath;
  }

  // 2. 常见的 Git for Windows 安装路径（优先用户/系统安装）
  const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
  const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const localAppData = process.env.LOCALAPPDATA || '';
  const userProfile = process.env.USERPROFILE || '';

  const candidates = [
    join(programFiles, 'Git', 'bin', 'bash.exe'),
    join(programFiles, 'Git', 'usr', 'bin', 'bash.exe'),
    join(programFilesX86, 'Git', 'bin', 'bash.exe'),
    join(programFilesX86, 'Git', 'usr', 'bin', 'bash.exe'),
    join(localAppData, 'Programs', 'Git', 'bin', 'bash.exe'),
    join(localAppData, 'Programs', 'Git', 'usr', 'bin', 'bash.exe'),
    join(userProfile, 'scoop', 'apps', 'git', 'current', 'bin', 'bash.exe'),
    join(userProfile, 'scoop', 'apps', 'git', 'current', 'usr', 'bin', 'bash.exe'),
    'C:\\Git\\bin\\bash.exe',
    'C:\\Git\\usr\\bin\\bash.exe',
  ];

  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) {
      coworkLog('INFO', 'resolveGitBash', `在以下位置找到 git-bash: ${candidate}`);
      cachedGitBashPath = candidate;
      return candidate;
    }
  }

  // 3. 从注册表查询 Git for Windows 安装根目录
  const registryInstallRoots = listGitInstallPathsFromRegistry();
  for (const installRoot of registryInstallRoots) {
    const registryCandidates = [
      join(installRoot, 'bin', 'bash.exe'),
      join(installRoot, 'usr', 'bin', 'bash.exe'),
    ];
    for (const candidate of registryCandidates) {
      if (existsSync(candidate)) {
        coworkLog('INFO', 'resolveGitBash', `通过注册表找到 git-bash: ${candidate}`);
        cachedGitBashPath = candidate;
        return candidate;
      }
    }
  }

  // 4. 尝试 `where bash`
  const bashPaths = listWindowsCommandPaths('where bash');
  for (const bashPath of bashPaths) {
    if (bashPath.toLowerCase().endsWith('\\bash.exe')) {
      coworkLog('INFO', 'resolveGitBash', `通过 PATH 找到 bash: ${bashPath}`);
      cachedGitBashPath = bashPath;
      return bashPath;
    }
  }

  // 5. 尝试 `where git` 并从 git 位置推导 bash
  const gitPaths = listWindowsCommandPaths('where git');
  for (const gitPath of gitPaths) {
    const gitRoot = dirname(dirname(gitPath));
    const bashCandidates = [
      join(gitRoot, 'bin', 'bash.exe'),
      join(gitRoot, 'usr', 'bin', 'bash.exe'),
    ];
    for (const candidate of bashCandidates) {
      if (existsSync(candidate)) {
        coworkLog('INFO', 'resolveGitBash', `通过 PATH git 找到 bash: ${candidate}`);
        cachedGitBashPath = candidate;
        return candidate;
      }
    }
  }

  // 6. 捆绑的 PortableGit 回退。
  // - 打包应用：resources/mingit
  // - 开发模式：项目 resources/mingit（用于本地 Windows 开发而无需系统 Git 安装）
  const bundledRoots = app.isPackaged
    ? [join(process.resourcesPath, 'mingit')]
    : [
      join(__dirname, '..', '..', 'resources', 'mingit'),
      join(process.cwd(), 'resources', 'mingit'),
    ];
  for (const root of bundledRoots) {
    // 在 Windows 上优先使用 bin/bash.exe；直接调用 usr/bin/bash.exe 可能会遗漏 Git 工具链 PATH
    const bundledPaths = [
      join(root, 'bin', 'bash.exe'),
      join(root, 'usr', 'bin', 'bash.exe'),
    ];
    for (const p of bundledPaths) {
      if (existsSync(p)) {
        coworkLog('INFO', 'resolveGitBash', `使用捆绑的 PortableGit: ${p}`);
        cachedGitBashPath = p;
        return p;
      }
    }
  }

  coworkLog('WARN', 'resolveGitBash', '在此系统上未找到 git-bash');
  cachedGitBashPath = null;
  return null;
}

function applyPackagedEnvOverrides(env: Record<string, string | undefined>): void {
  // 在 Windows 上，解析 git-bash 并确保 Git 工具链目录在 PATH 中可用
  if (process.platform === 'win32') {
    env.LOBSTERAI_ELECTRON_PATH = process.execPath;

    const configuredBashPath = normalizeWindowsPath(env.CLAUDE_CODE_GIT_BASH_PATH);
    const bashPath = configuredBashPath && existsSync(configuredBashPath)
      ? configuredBashPath
      : resolveWindowsGitBashPath();

    if (bashPath) {
      env.CLAUDE_CODE_GIT_BASH_PATH = bashPath;
      const gitToolDirs = getWindowsGitToolDirs(bashPath);
      env.PATH = appendEnvPath(env.PATH, gitToolDirs);
      coworkLog('INFO', 'resolveGitBash', `注入 Windows Git 工具链 PATH 条目: ${gitToolDirs.join(', ')}`);
    }

    const shimDir = ensureWindowsElectronNodeShim(process.execPath);
    if (shimDir) {
      env.PATH = appendEnvPath(env.PATH, [shimDir]);
      coworkLog('INFO', 'resolveNodeShim', `注入 Electron Node 垫片 PATH 条目: ${shimDir}`);
    }
  }

  if (!app.isPackaged) {
    return;
  }

  if (!env.HOME) {
    env.HOME = app.getPath('home');
  }

  // 解析用户的 shell PATH，以便 node、npm 和其他工具可被找到
  const userPath = resolveUserShellPath();
  if (userPath) {
    env.PATH = userPath;
  } else {
    // 回退：追加常见的 node 安装路径
    const home = env.HOME || app.getPath('home');
    const commonPaths = [
      '/usr/local/bin',
      '/opt/homebrew/bin',
      `${home}/.nvm/current/bin`,
      `${home}/.volta/bin`,
      `${home}/.fnm/current/bin`,
    ];
    env.PATH = [env.PATH, ...commonPaths].filter(Boolean).join(delimiter);
  }

  const resourcesPath = process.resourcesPath;
  const nodePaths = [
    join(resourcesPath, 'app.asar', 'node_modules'),
    join(resourcesPath, 'app.asar.unpacked', 'node_modules'),
  ].filter((nodePath) => existsSync(nodePath));

  if (nodePaths.length > 0) {
    env.NODE_PATH = appendEnvPath(env.NODE_PATH, nodePaths);
  }
}

/**
 * 从 Electron 会话解析系统代理配置
 * @param targetUrl 要解析代理的目标 URL
 */
async function resolveSystemProxy(targetUrl: string): Promise<string | null> {
  try {
    const proxyResult = await session.defaultSession.resolveProxy(targetUrl);
    if (!proxyResult || proxyResult === 'DIRECT') {
      return null;
    }

    // proxyResult 格式："PROXY host:port" 或 "SOCKS5 host:port"
    const match = proxyResult.match(/^(PROXY|SOCKS5?)\s+(.+)$/i);
    if (match) {
      const [, type, hostPort] = match;
      const prefix = type.toUpperCase().startsWith('SOCKS') ? 'socks5' : 'http';
      return `${prefix}://${hostPort}`;
    }

    return null;
  } catch (error) {
    console.error('解析系统代理失败:', error);
    return null;
  }
}

/**
 * 获取 SKILLs 目录路径（同时处理开发和生产环境）
 */
export function getSkillsRoot(): string {
  if (app.isPackaged) {
    // 在生产环境中，SKILLs 被复制到 userData
    return join(app.getPath('userData'), 'SKILLs');
  }

  // 在开发环境中，__dirname 可能因打包输出而变化（例如 dist-electron/ 或 dist-electron/libs/）。
  // 从几个稳定的锚点解析并选择第一个存在的 SKILLs 目录。
  const envRoots = [process.env.LOBSTERAI_SKILLS_ROOT, process.env.SKILLS_ROOT]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));
  const candidates = [
    ...envRoots,
    join(app.getAppPath(), 'SKILLs'),
    join(process.cwd(), 'SKILLs'),
    join(__dirname, '..', 'SKILLs'),
    join(__dirname, '..', '..', 'SKILLs'),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  // 首次运行开发环境的最终回退，此时 SKILLs 可能尚不存在
  return join(app.getAppPath(), 'SKILLs');
}

/**
 * 获取增强的环境变量（包括代理配置）
 * 异步函数，用于获取系统代理并注入到环境变量中
 */
export async function getEnhancedEnv(target: OpenAICompatProxyTarget = 'local'): Promise<Record<string, string | undefined>> {
  const config = getCurrentApiConfig(target);
  const env = config
    ? buildEnvForConfig(config)
    : { ...process.env };

  applyPackagedEnvOverrides(env);

  // 为技能脚本注入 SKILLs 目录路径
  const skillsRoot = getSkillsRoot();
  env.SKILLS_ROOT = skillsRoot;
  env.LOBSTERAI_SKILLS_ROOT = skillsRoot; // 替代名称，更清晰
  env.LOBSTERAI_ELECTRON_PATH = process.execPath;

  // 为技能脚本注入内部 API 基础 URL（例如计划任务创建）
  const internalApiBaseURL = getInternalApiBaseURL();
  if (internalApiBaseURL) {
    env.LOBSTERAI_API_BASE_URL = internalApiBaseURL;
  }

  // 如果代理环境变量已存在，则跳过系统代理解析
  if (env.http_proxy || env.HTTP_PROXY || env.https_proxy || env.HTTPS_PROXY) {
    return env;
  }

  // 从系统设置解析代理
  const proxyUrl = await resolveSystemProxy('https://openrouter.ai');
  if (proxyUrl) {
    env.http_proxy = proxyUrl;
    env.https_proxy = proxyUrl;
    env.HTTP_PROXY = proxyUrl;
    env.HTTPS_PROXY = proxyUrl;
    console.log('为子进程注入系统代理:', proxyUrl);
  }

  return env;
}

/**
 * 确保在给定的工作目录中存在 cowork 临时目录
 * @param cwd 工作目录路径
 * @returns 临时目录的路径
 */
export function ensureCoworkTempDir(cwd: string): string {
  const tempDir = join(cwd, '.cowork-temp');
  if (!existsSync(tempDir)) {
    try {
      mkdirSync(tempDir, { recursive: true });
      console.log('已创建 cowork 临时目录:', tempDir);
    } catch (error) {
      console.error('创建 cowork 临时目录失败:', error);
      // 如果无法创建临时目录，则回退到 cwd
      return cwd;
    }
  }
  return tempDir;
}

/**
 * 获取设置了 TMPDIR 的增强环境变量（指向 cowork 临时目录）
 * 这确保 Claude Agent SDK 在用户的工作目录中创建临时文件
 * @param cwd 工作目录路径
 */
export async function getEnhancedEnvWithTmpdir(
  cwd: string,
  target: OpenAICompatProxyTarget = 'local'
): Promise<Record<string, string | undefined>> {
  const env = await getEnhancedEnv(target);
  const tempDir = ensureCoworkTempDir(cwd);

  // 为所有平台设置临时目录环境变量
  env.TMPDIR = tempDir;  // macOS, Linux
  env.TMP = tempDir;     // Windows
  env.TEMP = tempDir;    // Windows

  return env;
}

export async function generateSessionTitle(userIntent: string | null): Promise<string> {
  if (!userIntent) return '新会话';

  const claudeCodePath = getClaudeCodePath();
  const currentEnv = await getEnhancedEnv();

  // 确保 child_process.fork() 将 cli.js 作为 Node 运行，而不是作为另一个 Electron 应用
  if (app.isPackaged) {
    currentEnv.ELECTRON_RUN_AS_NODE = '1';
  }

  try {
    const { unstable_v2_prompt } = await loadClaudeSdk();
    const promptOptions: Record<string, unknown> = {
      model: getCurrentApiConfig()?.model || 'claude-sonnet',
      env: currentEnv,
      pathToClaudeCodeExecutable: claudeCodePath,
    };

    const result: SDKResultMessage = await unstable_v2_prompt(
      `根据下面的用户输入，为这个对话生成一个简短、清晰的标题（最多 50 个字符）。
重要：标题必须与用户输入使用相同的语言。如果用户用中文写作，输出中文标题。如果用户用英文写作，输出英文标题。
用户输入：${userIntent}
只输出标题，不要其他内容。`,
      promptOptions as any
    );

    if (result.subtype === 'success') {
      return result.result;
    }

    console.error('Claude SDK 返回了非成功结果:', result);
    return '新会话';
  } catch (error) {
    console.error('生成会话标题失败:', error);
    console.error('Claude Code 路径:', claudeCodePath);
    console.error('是否已打包:', app.isPackaged);
    console.error('资源路径:', process.resourcesPath);

    if (userIntent) {
      const words = userIntent.trim().split(/\s+/).slice(0, 5);
      return words.join(' ').toUpperCase() + (userIntent.trim().split(/\s+/).length > 5 ? '...' : '');
    }

    return '新会话';
  }
}
