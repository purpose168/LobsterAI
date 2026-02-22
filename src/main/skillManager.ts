import { app, BrowserWindow, session } from 'electron';
import { spawn, spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import extractZip from 'extract-zip';
import { SqliteStore } from './sqliteStore';

// 技能记录类型定义
export type SkillRecord = {
  id: string;              // 技能唯一标识符
  name: string;            // 技能名称
  description: string;     // 技能描述
  enabled: boolean;        // 是否启用
  isOfficial: boolean;     // 是否为官方技能
  isBuiltIn: boolean;      // 是否为内置技能
  updatedAt: number;       // 最后更新时间戳
  prompt: string;          // 技能提示词
  skillPath: string;       // 技能文件路径
};

// 技能状态映射类型
type SkillStateMap = Record<string, { enabled: boolean }>;

// 邮件连接性检查代码类型
type EmailConnectivityCheckCode = 'imap_connection' | 'smtp_connection';
// 邮件连接性检查级别类型
type EmailConnectivityCheckLevel = 'pass' | 'fail';
// 邮件连接性判定结果类型
type EmailConnectivityVerdict = 'pass' | 'fail';

// 邮件连接性检查结果类型
type EmailConnectivityCheck = {
  code: EmailConnectivityCheckCode;   // 检查代码
  level: EmailConnectivityCheckLevel;  // 检查级别
  message: string;                     // 检查消息
  durationMs: number;                  // 持续时间（毫秒）
};

// 邮件连接性测试结果类型
type EmailConnectivityTestResult = {
  testedAt: number;                    // 测试时间戳
  verdict: EmailConnectivityVerdict;   // 判定结果
  checks: EmailConnectivityCheck[];    // 检查项列表
};

// 技能默认配置类型
type SkillDefaultConfig = {
  order?: number;      // 排序顺序
  enabled?: boolean;   // 是否启用
};

// 技能配置类型
type SkillsConfig = {
  version: number;                          // 配置版本号
  description?: string;                     // 配置描述
  defaults: Record<string, SkillDefaultConfig>;  // 默认配置映射
};

// 常量定义
const SKILLS_DIR_NAME = 'SKILLs';           // 技能目录名称
const SKILL_FILE_NAME = 'SKILL.md';         // 技能文件名称
const SKILLS_CONFIG_FILE = 'skills.config.json';  // 技能配置文件名
const SKILL_STATE_KEY = 'skills_state';     // 技能状态存储键
const WATCH_DEBOUNCE_MS = 250;              // 监听防抖时间（毫秒）

// Frontmatter（前置元数据）正则表达式
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/**
 * 解析 Frontmatter（前置元数据）
 * @param raw 原始字符串
 * @returns 包含 frontmatter 和 content 的对象
 */
const parseFrontmatter = (raw: string): { frontmatter: Record<string, string>; content: string } => {
  // 移除 BOM 标记
  const normalized = raw.replace(/^\uFEFF/, '');
  const match = normalized.match(FRONTMATTER_RE);
  if (!match) {
    return { frontmatter: {}, content: normalized };
  }

  // 解析 frontmatter 键值对
  const frontmatter: Record<string, string> = {};
  const lines = match[1].split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const kv = trimmed.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1];
    const value = (kv[2] ?? '').trim().replace(/^['"]|['"]$/g, '');
    frontmatter[key] = value;
  }

  const content = normalized.slice(match[0].length);
  return { frontmatter, content };
};

/**
 * 判断字符串是否为真值
 * @param value 待判断的字符串
 * @returns 是否为真值
 */
const isTruthy = (value?: string): boolean => {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === 'true' || normalized === 'yes' || normalized === '1';
};

/**
 * 从内容中提取描述
 * @param content 技能内容
 * @returns 提取的描述文本
 */
const extractDescription = (content: string): string => {
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    return trimmed.replace(/^#+\s*/, '');
  }
  return '';
};

/**
 * 规范化文件夹名称
 * @param name 原始名称
 * @returns 规范化后的名称
 */
const normalizeFolderName = (name: string): string => {
  const normalized = name.replace(/[^a-zA-Z0-9-_]+/g, '-').replace(/^-+|-+$/g, '');
  return normalized || 'skill';
};

/**
 * 判断文件是否为 ZIP 文件
 * @param filePath 文件路径
 * @returns 是否为 ZIP 文件
 */
const isZipFile = (filePath: string): boolean => path.extname(filePath).toLowerCase() === '.zip';

/**
 * 在根目录内解析目标路径（防止路径遍历攻击）
 * @param root 根目录
 * @param target 目标路径
 * @returns 解析后的绝对路径
 * @throws 如果目标路径超出根目录范围
 */
const resolveWithin = (root: string, target: string): string => {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(root, target);
  if (resolvedTarget === resolvedRoot) return resolvedTarget;
  if (!resolvedTarget.startsWith(resolvedRoot + path.sep)) {
    throw new Error('无效的目标路径');
  }
  return resolvedTarget;
};

/**
 * 追加环境变量路径
 * @param current 当前 PATH 环境变量
 * @param entries 要追加的路径列表
 * @returns 合并后的 PATH 环境变量
 */
const appendEnvPath = (current: string | undefined, entries: string[]): string => {
  const delimiter = process.platform === 'win32' ? ';' : ':';
  const existing = (current || '').split(delimiter).filter(Boolean);
  const merged = [...existing];
  entries.forEach(entry => {
    if (!entry || merged.includes(entry)) return;
    merged.push(entry);
  });
  return merged.join(delimiter);
};

/**
 * 列出 Windows 命令路径
 * @param command 要查找的命令
 * @returns 命令路径列表
 */
const listWindowsCommandPaths = (command: string): string[] => {
  if (process.platform !== 'win32') return [];

  try {
    const result = spawnSync('cmd.exe', ['/d', '/s', '/c', command], {
      encoding: 'utf8',
      windowsHide: true,
    });
    if (result.status !== 0) return [];
    return result.stdout
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
};

/**
 * 解析 Windows Git 可执行文件路径
 * @returns Git 可执行文件路径，如果未找到则返回 null
 */
const resolveWindowsGitExecutable = (): string | null => {
  if (process.platform !== 'win32') return null;

  // 获取系统环境变量
  const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
  const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const localAppData = process.env.LOCALAPPDATA || '';
  const userProfile = process.env.USERPROFILE || '';

  // 常见 Git 安装路径候选
  const installedCandidates = [
    path.join(programFiles, 'Git', 'cmd', 'git.exe'),
    path.join(programFiles, 'Git', 'bin', 'git.exe'),
    path.join(programFilesX86, 'Git', 'cmd', 'git.exe'),
    path.join(programFilesX86, 'Git', 'bin', 'git.exe'),
    path.join(localAppData, 'Programs', 'Git', 'cmd', 'git.exe'),
    path.join(localAppData, 'Programs', 'Git', 'bin', 'git.exe'),
    path.join(userProfile, 'scoop', 'apps', 'git', 'current', 'cmd', 'git.exe'),
    path.join(userProfile, 'scoop', 'apps', 'git', 'current', 'bin', 'git.exe'),
    'C:\\Git\\cmd\\git.exe',
    'C:\\Git\\bin\\git.exe',
  ];

  // 检查已安装的 Git
  for (const candidate of installedCandidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }

  // 使用 where 命令查找
  const whereCandidates = listWindowsCommandPaths('where git');
  for (const candidate of whereCandidates) {
    const normalized = candidate.trim();
    if (!normalized) continue;
    if (normalized.toLowerCase().endsWith('git.exe') && fs.existsSync(normalized)) {
      return normalized;
    }
  }

  // 检查捆绑的 PortableGit
  const bundledRoots = app.isPackaged
    ? [path.join(process.resourcesPath, 'mingit')]
    : [
      path.join(__dirname, '..', '..', 'resources', 'mingit'),
      path.join(process.cwd(), 'resources', 'mingit'),
    ];

  for (const root of bundledRoots) {
    const bundledCandidates = [
      path.join(root, 'cmd', 'git.exe'),
      path.join(root, 'bin', 'git.exe'),
      path.join(root, 'mingw64', 'bin', 'git.exe'),
      path.join(root, 'usr', 'bin', 'git.exe'),
    ];
    for (const candidate of bundledCandidates) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  }

  return null;
};

/**
 * 解析 Git 命令
 * @returns 包含命令和环境变量的对象
 */
const resolveGitCommand = (): { command: string; env?: NodeJS.ProcessEnv } => {
  if (process.platform !== 'win32') {
    return { command: 'git' };
  }

  const gitExe = resolveWindowsGitExecutable();
  if (!gitExe) {
    return { command: 'git' };
  }

  // 配置 Git 相关的环境变量
  const env: NodeJS.ProcessEnv = { ...process.env };
  const gitDir = path.dirname(gitExe);
  const gitRoot = path.dirname(gitDir);
  const candidateDirs = [
    gitDir,
    path.join(gitRoot, 'cmd'),
    path.join(gitRoot, 'bin'),
    path.join(gitRoot, 'mingw64', 'bin'),
    path.join(gitRoot, 'usr', 'bin'),
  ].filter(dir => fs.existsSync(dir));

  env.PATH = appendEnvPath(env.PATH, candidateDirs);
  return { command: gitExe, env };
};

/**
 * 运行命令
 * @param command 命令
 * @param args 参数列表
 * @param options 选项（工作目录和环境变量）
 * @returns Promise，成功时 resolve，失败时 reject
 */
const runCommand = (
  command: string,
  args: string[],
  options?: { cwd?: string; env?: NodeJS.ProcessEnv }
): Promise<void> => new Promise((resolve, reject) => {
  const child = spawn(command, args, {
    cwd: options?.cwd,
    env: options?.env,
    windowsHide: true,
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', chunk => {
    stderr += chunk.toString();
  });
  child.on('error', error => reject(error));
  child.on('close', code => {
    if (code === 0) {
      resolve();
      return;
    }
    reject(new Error(stderr.trim() || `命令执行失败，退出码：${code}`));
  });
});

// 技能脚本运行结果类型
type SkillScriptRunResult = {
  success: boolean;        // 是否成功
  exitCode: number | null; // 退出码
  stdout: string;          // 标准输出
  stderr: string;          // 标准错误输出
  durationMs: number;      // 执行时长（毫秒）
  timedOut: boolean;       // 是否超时
  error?: string;          // 错误消息
  spawnErrorCode?: string; // spawn 错误代码
};

/**
 * 运行脚本并设置超时
 * @param options 脚本运行选项
 * @returns 脚本运行结果
 */
const runScriptWithTimeout = (options: {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
}): Promise<SkillScriptRunResult> => new Promise((resolve) => {
  const startedAt = Date.now();
  const child = spawn(options.command, options.args, {
    cwd: options.cwd,
    env: options.env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let settled = false;
  let timedOut = false;
  let stdout = '';
  let stderr = '';
  let forceKillTimer: NodeJS.Timeout | null = null;

  // 结算函数，确保只调用一次
  const settle = (result: SkillScriptRunResult) => {
    if (settled) return;
    settled = true;
    resolve(result);
  };

  // 设置超时定时器
  const timeoutTimer = setTimeout(() => {
    timedOut = true;
    child.kill('SIGTERM');
    forceKillTimer = setTimeout(() => {
      child.kill('SIGKILL');
    }, 2000);
  }, options.timeoutMs);

  // 收集标准输出
  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString();
  });
  // 收集标准错误输出
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  // 处理错误事件
  child.on('error', (error: NodeJS.ErrnoException) => {
    clearTimeout(timeoutTimer);
    if (forceKillTimer) clearTimeout(forceKillTimer);
    settle({
      success: false,
      exitCode: null,
      stdout: stdout.trim(),
      stderr: stderr.trim(),
      durationMs: Date.now() - startedAt,
      timedOut,
      error: error.message,
      spawnErrorCode: error.code,
    });
  });

  // 处理进程关闭事件
  child.on('close', (exitCode) => {
    clearTimeout(timeoutTimer);
    if (forceKillTimer) clearTimeout(forceKillTimer);
    settle({
      success: !timedOut && exitCode === 0,
      exitCode,
      stdout: stdout.trim(),
      stderr: stderr.trim(),
      durationMs: Date.now() - startedAt,
      timedOut,
      error: timedOut ? `命令在 ${options.timeoutMs} 毫秒后超时` : undefined,
    });
  });
});

/**
 * 安全清理路径
 * @param targetPath 要清理的目标路径
 */
const cleanupPathSafely = (targetPath: string | null): void => {
  if (!targetPath) return;
  try {
    fs.rmSync(targetPath, {
      recursive: true,
      force: true,
      maxRetries: process.platform === 'win32' ? 5 : 0,
      retryDelay: process.platform === 'win32' ? 200 : 0,
    });
  } catch (error) {
    console.warn('[技能] 清理临时目录失败:', targetPath, error);
  }
};

/**
 * 列出技能目录
 * @param root 根目录
 * @returns 技能目录列表
 */
const listSkillDirs = (root: string): string[] => {
  if (!fs.existsSync(root)) return [];
  const skillFile = path.join(root, SKILL_FILE_NAME);
  if (fs.existsSync(skillFile)) {
    return [root];
  }

  const entries = fs.readdirSync(root);
  return entries
    .map(entry => path.join(root, entry))
    .filter((entryPath) => {
      try {
        const stat = fs.lstatSync(entryPath);
        if (!stat.isDirectory() && !stat.isSymbolicLink()) {
          return false;
        }
        return fs.existsSync(path.join(entryPath, SKILL_FILE_NAME));
      } catch {
        return false;
      }
    });
};

/**
 * 从源路径收集技能目录
 * @param source 源路径
 * @returns 技能目录列表
 */
const collectSkillDirsFromSource = (source: string): string[] => {
  const resolved = path.resolve(source);
  if (fs.existsSync(path.join(resolved, SKILL_FILE_NAME))) {
    return [resolved];
  }

  // 检查嵌套的 SKILLs 目录
  const nestedRoot = path.join(resolved, SKILLS_DIR_NAME);
  if (fs.existsSync(nestedRoot) && fs.statSync(nestedRoot).isDirectory()) {
    const nestedSkills = listSkillDirs(nestedRoot);
    if (nestedSkills.length > 0) {
      return nestedSkills;
    }
  }

  // 检查直接子目录
  const directSkills = listSkillDirs(resolved);
  if (directSkills.length > 0) {
    return directSkills;
  }

  return collectSkillDirsRecursively(resolved);
};

/**
 * 递归收集技能目录
 * @param root 根目录
 * @returns 技能目录列表
 */
const collectSkillDirsRecursively = (root: string): string[] => {
  const resolvedRoot = path.resolve(root);
  if (!fs.existsSync(resolvedRoot)) return [];

  const matchedDirs: string[] = [];
  const queue: string[] = [resolvedRoot];
  const seen = new Set<string>();

  // 广度优先搜索
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    const normalized = path.resolve(current);
    if (seen.has(normalized)) continue;
    seen.add(normalized);

    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(normalized);
    } catch {
      continue;
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) continue;

    // 检查是否包含 SKILL.md 文件
    if (fs.existsSync(path.join(normalized, SKILL_FILE_NAME))) {
      matchedDirs.push(normalized);
      continue;
    }

    // 遍历子目录
    let entries: string[] = [];
    try {
      entries = fs.readdirSync(normalized);
    } catch {
      continue;
    }

    for (const entry of entries) {
      // 跳过 .git 和 node_modules 目录
      if (!entry || entry === '.git' || entry === 'node_modules') continue;
      queue.push(path.join(normalized, entry));
    }
  }

  return matchedDirs;
};

/**
 * 从源 URL 推导仓库名称
 * @param source 源 URL
 * @returns 仓库名称
 */
const deriveRepoName = (source: string): string => {
  const cleaned = source.replace(/[#?].*$/, '');
  const base = cleaned.split('/').filter(Boolean).pop() || 'skill';
  return normalizeFolderName(base.replace(/\.git$/, ''));
};

// 规范化的 Git 源类型
type NormalizedGitSource = {
  repoUrl: string;          // 仓库 URL
  sourceSubpath?: string;   // 源子路径
  ref?: string;             // 引用（分支/标签/提交）
  repoNameHint?: string;    // 仓库名称提示
};

// GitHub 仓库源类型
type GithubRepoSource = {
  owner: string;  // 仓库所有者
  repo: string;   // 仓库名称
};

/**
 * 提取错误消息
 * @param error 错误对象
 * @returns 错误消息字符串
 */
const extractErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
};

/**
 * 解析 GitHub 仓库源
 * @param repoUrl 仓库 URL
 * @returns GitHub 仓库源对象，如果不是 GitHub 仓库则返回 null
 */
const parseGithubRepoSource = (repoUrl: string): GithubRepoSource | null => {
  const trimmed = repoUrl.trim();

  // 匹配 SSH 格式的 URL
  const sshMatch = trimmed.match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?\/?$/i);
  if (sshMatch) {
    return {
      owner: sshMatch[1],
      repo: sshMatch[2],
    };
  }

  try {
    const parsedUrl = new URL(trimmed);
    if (!['github.com', 'www.github.com'].includes(parsedUrl.hostname.toLowerCase())) {
      return null;
    }

    const segments = parsedUrl.pathname
      .replace(/\.git$/i, '')
      .split('/')
      .filter(Boolean);
    if (segments.length < 2) {
      return null;
    }

    return {
      owner: segments[0],
      repo: segments[1],
    };
  } catch {
    return null;
  }
};

/**
 * 下载 GitHub 归档文件
 * @param source GitHub 仓库源
 * @param tempRoot 临时目录根路径
 * @param ref 引用（分支/标签/提交）
 * @returns 解压后的目录路径
 */
const downloadGithubArchive = async (
  source: GithubRepoSource,
  tempRoot: string,
  ref?: string
): Promise<string> => {
  const encodedRef = ref ? encodeURIComponent(ref) : '';
  const archiveUrlCandidates: Array<{ url: string; headers: Record<string, string> }> = [];

  // 构建候选下载 URL
  if (encodedRef) {
    archiveUrlCandidates.push(
      {
        url: `https://github.com/${source.owner}/${source.repo}/archive/refs/heads/${encodedRef}.zip`,
        headers: { 'User-Agent': 'LobsterAI 技能下载器' },
      },
      {
        url: `https://github.com/${source.owner}/${source.repo}/archive/refs/tags/${encodedRef}.zip`,
        headers: { 'User-Agent': 'LobsterAI 技能下载器' },
      },
      {
        url: `https://github.com/${source.owner}/${source.repo}/archive/${encodedRef}.zip`,
        headers: { 'User-Agent': 'LobsterAI 技能下载器' },
      }
    );
  }

  archiveUrlCandidates.push({
    url: `https://api.github.com/repos/${source.owner}/${source.repo}/zipball${encodedRef ? `/${encodedRef}` : ''}`,
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'LobsterAI 技能下载器',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });

  let buffer: Buffer | null = null;
  let lastError: string | null = null;

  // 尝试下载归档文件
  for (const candidate of archiveUrlCandidates) {
    try {
      const response = await session.defaultSession.fetch(candidate.url, {
        method: 'GET',
        headers: candidate.headers,
      });

      if (!response.ok) {
        const detail = (await response.text()).trim();
        lastError = `归档下载失败（${response.status} ${response.statusText}）${detail ? `: ${detail}` : ''}`;
        continue;
      }

      buffer = Buffer.from(await response.arrayBuffer());
      break;
    } catch (error) {
      lastError = extractErrorMessage(error);
    }
  }

  if (!buffer) {
    throw new Error(lastError || '归档下载失败');
  }

  // 解压归档文件
  const zipPath = path.join(tempRoot, 'github-archive.zip');
  const extractRoot = path.join(tempRoot, 'github-archive');
  fs.writeFileSync(zipPath, buffer);
  fs.mkdirSync(extractRoot, { recursive: true });
  await extractZip(zipPath, { dir: extractRoot });

  // 查找解压后的目录
  const extractedDirs = fs.readdirSync(extractRoot)
    .map(entry => path.join(extractRoot, entry))
    .filter(entryPath => {
      try {
        return fs.statSync(entryPath).isDirectory();
      } catch {
        return false;
      }
    });

  if (extractedDirs.length === 1) {
    return extractedDirs[0];
  }

  return extractRoot;
};

/**
 * 规范化 GitHub 子路径
 * @param value 子路径值
 * @returns 规范化后的子路径，如果无效则返回 null
 */
const normalizeGithubSubpath = (value: string): string | null => {
  const trimmed = value.trim().replace(/^\/+|\/+$/g, '');
  if (!trimmed) return null;
  const segments = trimmed
    .split('/')
    .filter(Boolean)
    .map(segment => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    });
  // 检查是否包含路径遍历字符
  if (segments.some(segment => segment === '.' || segment === '..')) {
    return null;
  }
  return segments.join('/');
};

/**
 * 解析 GitHub tree 或 blob URL
 * @param source 源 URL
 * @returns 规范化的 Git 源对象，如果不是有效的 GitHub tree/blob URL 则返回 null
 */
const parseGithubTreeOrBlobUrl = (source: string): NormalizedGitSource | null => {
  try {
    const parsedUrl = new URL(source);
    if (!['github.com', 'www.github.com'].includes(parsedUrl.hostname)) {
      return null;
    }

    const segments = parsedUrl.pathname.split('/').filter(Boolean);
    if (segments.length < 5) {
      return null;
    }

    const [owner, repoRaw, mode, ref, ...rest] = segments;
    if (!owner || !repoRaw || !ref || (mode !== 'tree' && mode !== 'blob')) {
      return null;
    }

    const repo = repoRaw.replace(/\.git$/i, '');
    const sourceSubpath = normalizeGithubSubpath(rest.join('/'));
    if (!repo || !sourceSubpath) {
      return null;
    }

    return {
      repoUrl: `https://github.com/${owner}/${repo}.git`,
      sourceSubpath,
      ref: decodeURIComponent(ref),
      repoNameHint: repo,
    };
  } catch {
    return null;
  }
};

/**
 * 检查 web-search 技能是否损坏
 * @param skillRoot 技能根目录
 * @returns 是否损坏
 */
const isWebSearchSkillBroken = (skillRoot: string): boolean => {
  const startServerScript = path.join(skillRoot, 'scripts', 'start-server.sh');
  const searchScript = path.join(skillRoot, 'scripts', 'search.sh');
  const serverEntry = path.join(skillRoot, 'dist', 'server', 'index.js');
  const requiredPaths = [
    startServerScript,
    searchScript,
    serverEntry,
    path.join(skillRoot, 'node_modules', 'iconv-lite', 'encodings', 'index.js'),
  ];

  // 检查必需文件是否存在
  if (requiredPaths.some(requiredPath => !fs.existsSync(requiredPath))) {
    return true;
  }

  try {
    const startScript = fs.readFileSync(startServerScript, 'utf-8');
    const searchScriptContent = fs.readFileSync(searchScript, 'utf-8');
    const serverEntryContent = fs.readFileSync(serverEntry, 'utf-8');
    // 检查关键代码片段是否存在
    if (!startScript.includes('WEB_SEARCH_FORCE_REPAIR')) {
      return true;
    }
    if (!startScript.includes('detect_healthy_bridge_server')) {
      return true;
    }
    if (!searchScriptContent.includes('ACTIVE_SERVER_URL')) {
      return true;
    }
    if (!searchScriptContent.includes('try_switch_to_local_server')) {
      return true;
    }
    if (!searchScriptContent.includes('build_search_payload')) {
      return true;
    }
    if (!searchScriptContent.includes('@query_file')) {
      return true;
    }
    if (!serverEntryContent.includes('decodeJsonRequestBody')) {
      return true;
    }
    if (!serverEntryContent.includes("TextDecoder('gb18030'")) {
      return true;
    }
  } catch {
    return true;
  }

  return false;
};

/**
 * 技能管理器类
 * 负责技能的加载、下载、删除、配置和监听等功能
 */
export class SkillManager {
  private watchers: fs.FSWatcher[] = [];      // 文件监听器列表
  private notifyTimer: NodeJS.Timeout | null = null;  // 通知定时器

  constructor(private getStore: () => SqliteStore) {}

  /**
   * 获取技能根目录路径
   * @returns 技能根目录的绝对路径
   */
  getSkillsRoot(): string {
    return path.resolve(app.getPath('userData'), SKILLS_DIR_NAME);
  }

  /**
   * 确保技能根目录存在
   * @returns 技能根目录路径
   */
  ensureSkillsRoot(): string {
    const root = this.getSkillsRoot();
    if (!fs.existsSync(root)) {
      fs.mkdirSync(root, { recursive: true });
    }
    return root;
  }

  /**
   * 同步捆绑的技能到用户数据目录
   */
  syncBundledSkillsToUserData(): void {
    if (!app.isPackaged) {
      return;
    }

    const userRoot = this.ensureSkillsRoot();
    const bundledRoot = this.getBundledSkillsRoot();
    if (!bundledRoot || bundledRoot === userRoot || !fs.existsSync(bundledRoot)) {
      return;
    }

    try {
      const bundledSkillDirs = listSkillDirs(bundledRoot);
      bundledSkillDirs.forEach((dir) => {
        const id = path.basename(dir);
        const targetDir = path.join(userRoot, id);
        const targetExists = fs.existsSync(targetDir);
        const shouldRepair = id === 'web-search' && targetExists && isWebSearchSkillBroken(targetDir);
        if (targetExists && !shouldRepair) return;
        try {
          fs.cpSync(dir, targetDir, {
            recursive: true,
            dereference: true,
            force: shouldRepair,
            errorOnExist: false,
          });
          if (shouldRepair) {
            console.log('[技能] 已修复用户数据中的捆绑技能 "web-search"');
          }
        } catch (error) {
          console.warn(`[技能] 同步捆绑技能 "${id}" 失败:`, error);
        }
      });

      // 同步配置文件
      const bundledConfig = path.join(bundledRoot, SKILLS_CONFIG_FILE);
      const targetConfig = path.join(userRoot, SKILLS_CONFIG_FILE);
      if (fs.existsSync(bundledConfig) && !fs.existsSync(targetConfig)) {
        fs.cpSync(bundledConfig, targetConfig, { dereference: false });
      }
    } catch (error) {
      console.warn('[技能] 同步捆绑技能失败:', error);
    }
  }

  /**
   * 列出所有技能
   * @returns 技能记录列表
   */
  listSkills(): SkillRecord[] {
    const primaryRoot = this.ensureSkillsRoot();
    const state = this.loadSkillStateMap();
    const roots = this.getSkillRoots(primaryRoot);
    const orderedRoots = roots.filter(root => root !== primaryRoot).concat(primaryRoot);
    const defaults = this.loadSkillsDefaults(roots);
    const builtInSkillIds = this.listBuiltInSkillIds();
    const skillMap = new Map<string, SkillRecord>();

    // 遍历所有技能根目录
    orderedRoots.forEach(root => {
      if (!fs.existsSync(root)) return;
      const skillDirs = listSkillDirs(root);
      skillDirs.forEach(dir => {
        const skill = this.parseSkillDir(dir, state, defaults, builtInSkillIds.has(path.basename(dir)));
        if (!skill) return;
        skillMap.set(skill.id, skill);
      });
    });

    const skills = Array.from(skillMap.values());

    // 按配置顺序和名称排序
    skills.sort((a, b) => {
      const orderA = defaults[a.id]?.order ?? 999;
      const orderB = defaults[b.id]?.order ?? 999;
      if (orderA !== orderB) return orderA - orderB;
      return a.name.localeCompare(b.name);
    });
    return skills;
  }

  /**
   * 构建自动路由提示词
   * @returns 自动路由提示词，如果没有启用的技能则返回 null
   */
  buildAutoRoutingPrompt(): string | null {
    const skills = this.listSkills();
    const enabled = skills.filter(s => s.enabled && s.prompt);
    if (enabled.length === 0) return null;

    const skillEntries = enabled
      .map(s => `  <skill><id>${s.id}</id><name>${s.name}</name><description>${s.description}</description><location>${s.skillPath}</location></skill>`)
      .join('\n');

    return [
      '## 技能（必读）',
      '回复前：扫描 <available_skills> <description> 条目。',
      '- 如果恰好有一个技能明显适用：使用 Read 工具读取其 <location> 处的 SKILL.md，然后遵循它。',
      '- 如果多个技能可能适用：选择最具体的一个，然后读取并遵循它。',
      '- 如果没有明显适用的技能：不要读取任何 SKILL.md。',
      '- 对于选定的技能，将 <location> 视为规范的 SKILL.md 路径。',
      '- 根据 SKILL.md 所在目录（dirname(<location>)）解析其提到的相对路径，而不是工作区根目录。',
      '约束：预先最多读取一个技能；只有当第一个技能明确引用其他技能时才读取额外的技能。',
      '',
      '<available_skills>',
      skillEntries,
      '</available_skills>',
    ].join('\n');
  }

  /**
   * 设置技能启用状态
   * @param id 技能 ID
   * @param enabled 是否启用
   * @returns 更新后的技能列表
   */
  setSkillEnabled(id: string, enabled: boolean): SkillRecord[] {
    const state = this.loadSkillStateMap();
    state[id] = { enabled };
    this.saveSkillStateMap(state);
    this.notifySkillsChanged();
    return this.listSkills();
  }

  /**
   * 删除技能
   * @param id 技能 ID
   * @returns 更新后的技能列表
   * @throws 如果技能 ID 无效或技能为内置技能
   */
  deleteSkill(id: string): SkillRecord[] {
    const root = this.ensureSkillsRoot();
    if (id !== path.basename(id)) {
      throw new Error('无效的技能 ID');
    }
    if (this.isBuiltInSkillId(id)) {
      throw new Error('内置技能无法删除');
    }

    const targetDir = resolveWithin(root, id);
    if (!fs.existsSync(targetDir)) {
      throw new Error('技能未找到');
    }

    fs.rmSync(targetDir, { recursive: true, force: true });
    const state = this.loadSkillStateMap();
    delete state[id];
    this.saveSkillStateMap(state);
    this.startWatching();
    this.notifySkillsChanged();
    return this.listSkills();
  }

  /**
   * 下载技能
   * @param source 技能源（本地路径、ZIP 文件或 Git 仓库 URL）
   * @returns 下载结果，包含成功标志、技能列表或错误消息
   */
  async downloadSkill(source: string): Promise<{ success: boolean; skills?: SkillRecord[]; error?: string }> {
    let cleanupPath: string | null = null;
    try {
      const trimmed = source.trim();
      if (!trimmed) {
        return { success: false, error: '缺少技能源' };
      }

      const root = this.ensureSkillsRoot();
      let localSource = trimmed;
      // 检查是否为本地文件
      if (fs.existsSync(localSource)) {
        const stat = fs.statSync(localSource);
        if (stat.isFile()) {
          if (isZipFile(localSource)) {
            // 解压 ZIP 文件
            const tempRoot = fs.mkdtempSync(path.join(app.getPath('temp'), 'lobsterai-skill-zip-'));
            await extractZip(localSource, { dir: tempRoot });
            localSource = tempRoot;
            cleanupPath = tempRoot;
          } else if (path.basename(localSource) === SKILL_FILE_NAME) {
            // 如果是 SKILL.md 文件，使用其父目录
            localSource = path.dirname(localSource);
          } else {
            return { success: false, error: '技能源必须是目录、ZIP 文件或 SKILL.md 文件' };
          }
        }
      } else {
        // 处理 Git 仓库源
        const normalized = this.normalizeGitSource(trimmed);
        if (!normalized) {
          return { success: false, error: '无效的技能源。请使用 owner/repo、仓库 URL 或 GitHub tree/blob URL。' };
        }
        const tempRoot = fs.mkdtempSync(path.join(app.getPath('temp'), 'lobsterai-skill-'));
        cleanupPath = tempRoot;
        const repoName = normalizeFolderName(normalized.repoNameHint || deriveRepoName(normalized.repoUrl));
        const clonePath = path.join(tempRoot, repoName);
        const cloneArgs = ['clone', '--depth', '1'];
        if (normalized.ref) {
          cloneArgs.push('--branch', normalized.ref);
        }
        cloneArgs.push(normalized.repoUrl, clonePath);
        const gitRuntime = resolveGitCommand();
        const githubSource = parseGithubRepoSource(normalized.repoUrl);
        let downloadedSourceRoot = clonePath;
        try {
          await runCommand(gitRuntime.command, cloneArgs, { env: gitRuntime.env });
        } catch (error) {
          const errno = (error as NodeJS.ErrnoException | null)?.code;
          if (githubSource) {
            try {
              // Git 克隆失败时尝试下载 GitHub 归档
              downloadedSourceRoot = await downloadGithubArchive(githubSource, tempRoot, normalized.ref);
            } catch (archiveError) {
              const gitMessage = extractErrorMessage(error);
              const archiveMessage = extractErrorMessage(archiveError);
              if (errno === 'ENOENT' && process.platform === 'win32') {
                throw new Error(
                  '未找到 Git 可执行文件。请安装 Git for Windows 或重新安装捆绑 PortableGit 的 LobsterAI。'
                  + ` 归档回退也失败：${archiveMessage}`
                );
              }
              throw new Error(`Git 克隆失败：${gitMessage}。归档回退失败：${archiveMessage}`);
            }
          } else if (errno === 'ENOENT' && process.platform === 'win32') {
            throw new Error('未找到 Git 可执行文件。请安装 Git for Windows 或重新安装捆绑 PortableGit 的 LobsterAI。');
          } else {
            throw error;
          }
        }

        // 处理子路径
        if (normalized.sourceSubpath) {
          const scopedSource = resolveWithin(downloadedSourceRoot, normalized.sourceSubpath);
          if (!fs.existsSync(scopedSource)) {
            return { success: false, error: `仓库中未找到路径 "${normalized.sourceSubpath}"` };
          }
          const scopedStat = fs.statSync(scopedSource);
          if (scopedStat.isFile()) {
            if (path.basename(scopedSource) === SKILL_FILE_NAME) {
              localSource = path.dirname(scopedSource);
            } else {
              return { success: false, error: 'GitHub 路径必须指向目录或 SKILL.md 文件' };
            }
          } else {
            localSource = scopedSource;
          }
        } else {
          localSource = downloadedSourceRoot;
        }

      }

      // 收集技能目录
      const skillDirs = collectSkillDirsFromSource(localSource);
      if (skillDirs.length === 0) {
        cleanupPathSafely(cleanupPath);
        cleanupPath = null;
        return { success: false, error: '源中未找到 SKILL.md 文件' };
      }

      // 复制技能到目标目录
      for (const skillDir of skillDirs) {
        const folderName = normalizeFolderName(path.basename(skillDir));
        let targetDir = resolveWithin(root, folderName);
        let suffix = 1;
        while (fs.existsSync(targetDir)) {
          targetDir = resolveWithin(root, `${folderName}-${suffix}`);
          suffix += 1;
        }
        fs.cpSync(skillDir, targetDir, { recursive: true, dereference: false });
      }

      cleanupPathSafely(cleanupPath);
      cleanupPath = null;

      this.startWatching();
      this.notifySkillsChanged();
      return { success: true, skills: this.listSkills() };
    } catch (error) {
      cleanupPathSafely(cleanupPath);
      return { success: false, error: error instanceof Error ? error.message : '下载技能失败' };
    }
  }

  /**
   * 开始监听技能目录变化
   */
  startWatching(): void {
    this.stopWatching();
    const primaryRoot = this.ensureSkillsRoot();
    const roots = this.getSkillRoots(primaryRoot);

    const watchHandler = () => this.scheduleNotify();
    roots.forEach(root => {
      if (!fs.existsSync(root)) return;
      try {
        this.watchers.push(fs.watch(root, watchHandler));
      } catch (error) {
        console.warn('[技能] 监听技能根目录失败:', root, error);
      }

      // 监听各个技能目录
      const skillDirs = listSkillDirs(root);
      skillDirs.forEach(dir => {
        try {
          this.watchers.push(fs.watch(dir, watchHandler));
        } catch (error) {
          console.warn('[技能] 监听技能目录失败:', dir, error);
        }
      });
    });
  }

  /**
   * 停止监听技能目录变化
   */
  stopWatching(): void {
    this.watchers.forEach(watcher => watcher.close());
    this.watchers = [];
    if (this.notifyTimer) {
      clearTimeout(this.notifyTimer);
      this.notifyTimer = null;
    }
  }

  /**
   * 处理工作目录变化
   */
  handleWorkingDirectoryChange(): void {
    this.startWatching();
    this.notifySkillsChanged();
  }

  /**
   * 调度通知（防抖）
   */
  private scheduleNotify(): void {
    if (this.notifyTimer) {
      clearTimeout(this.notifyTimer);
    }
    this.notifyTimer = setTimeout(() => {
      this.startWatching();
      this.notifySkillsChanged();
    }, WATCH_DEBOUNCE_MS);
  }

  /**
   * 通知所有窗口技能已变化
   */
  private notifySkillsChanged(): void {
    BrowserWindow.getAllWindows().forEach(win => {
      if (!win.isDestroyed()) {
        win.webContents.send('skills:changed');
      }
    });
  }

  /**
   * 解析技能目录
   * @param dir 目录路径
   * @param state 技能状态映射
   * @param defaults 默认配置
   * @param isBuiltIn 是否为内置技能
   * @returns 技能记录，如果解析失败则返回 null
   */
  private parseSkillDir(
    dir: string,
    state: SkillStateMap,
    defaults: Record<string, SkillDefaultConfig>,
    isBuiltIn: boolean
  ): SkillRecord | null {
    const skillFile = path.join(dir, SKILL_FILE_NAME);
    if (!fs.existsSync(skillFile)) return null;
    try {
      const raw = fs.readFileSync(skillFile, 'utf8');
      const { frontmatter, content } = parseFrontmatter(raw);
      const name = (frontmatter.name || path.basename(dir)).trim() || path.basename(dir);
      const description = (frontmatter.description || extractDescription(content) || name).trim();
      const isOfficial = isTruthy(frontmatter.official) || isTruthy(frontmatter.isOfficial);
      const updatedAt = fs.statSync(skillFile).mtimeMs;
      const id = path.basename(dir);
      const prompt = content.trim();
      const defaultEnabled = defaults[id]?.enabled ?? true;
      const enabled = state[id]?.enabled ?? defaultEnabled;
      return { id, name, description, enabled, isOfficial, isBuiltIn, updatedAt, prompt, skillPath: skillFile };
    } catch (error) {
      console.warn('[技能] 解析技能失败:', dir, error);
      return null;
    }
  }

  /**
   * 列出内置技能 ID
   * @returns 内置技能 ID 集合
   */
  private listBuiltInSkillIds(): Set<string> {
    const builtInRoot = this.getBundledSkillsRoot();
    if (!builtInRoot || !fs.existsSync(builtInRoot)) {
      return new Set();
    }
    return new Set(listSkillDirs(builtInRoot).map(dir => path.basename(dir)));
  }

  /**
   * 判断是否为内置技能 ID
   * @param id 技能 ID
   * @returns 是否为内置技能
   */
  private isBuiltInSkillId(id: string): boolean {
    return this.listBuiltInSkillIds().has(id);
  }

  /**
   * 加载技能状态映射
   * @returns 技能状态映射
   */
  private loadSkillStateMap(): SkillStateMap {
    const store = this.getStore();
    const raw = store.get(SKILL_STATE_KEY) as SkillStateMap | SkillRecord[] | undefined;
    // 迁移旧格式数据
    if (Array.isArray(raw)) {
      const migrated: SkillStateMap = {};
      raw.forEach(skill => {
        migrated[skill.id] = { enabled: skill.enabled };
      });
      store.set(SKILL_STATE_KEY, migrated);
      return migrated;
    }
    return raw ?? {};
  }

  /**
   * 保存技能状态映射
   * @param map 技能状态映射
   */
  private saveSkillStateMap(map: SkillStateMap): void {
    this.getStore().set(SKILL_STATE_KEY, map);
  }

  /**
   * 加载技能默认配置
   * @param roots 技能根目录列表
   * @returns 合并后的默认配置
   */
  private loadSkillsDefaults(roots: string[]): Record<string, SkillDefaultConfig> {
    const merged: Record<string, SkillDefaultConfig> = {};

    // 以相反顺序从根目录加载，使高优先级根目录覆盖低优先级根目录
    // roots[0] 是用户目录（最高优先级），roots[1] 是应用捆绑目录（较低优先级）
    const reversedRoots = [...roots].reverse();

    for (const root of reversedRoots) {
      const configPath = path.join(root, SKILLS_CONFIG_FILE);
      if (!fs.existsSync(configPath)) continue;

      try {
        const raw = fs.readFileSync(configPath, 'utf8');
        const config = JSON.parse(raw) as SkillsConfig;
        if (config.defaults && typeof config.defaults === 'object') {
          for (const [id, settings] of Object.entries(config.defaults)) {
            merged[id] = { ...merged[id], ...settings };
          }
        }
      } catch (error) {
        console.warn('[技能] 加载技能配置失败:', configPath, error);
      }
    }

    return merged;
  }

  /**
   * 获取技能根目录列表
   * @param primaryRoot 主根目录（可选）
   * @returns 技能根目录列表
   */
  private getSkillRoots(primaryRoot?: string): string[] {
    const resolvedPrimary = primaryRoot ?? this.getSkillsRoot();
    const roots = [resolvedPrimary];
    const appRoot = this.getBundledSkillsRoot();
    if (appRoot !== resolvedPrimary && fs.existsSync(appRoot)) {
      roots.push(appRoot);
    }
    return roots;
  }

  /**
   * 获取捆绑技能根目录
   * @returns 捆绑技能根目录路径
   */
  private getBundledSkillsRoot(): string {
    if (app.isPackaged) {
      // 生产环境中，捆绑的技能应位于 Resources/SKILLs
      const resourcesRoot = path.resolve(process.resourcesPath, SKILLS_DIR_NAME);
      if (fs.existsSync(resourcesRoot)) {
        return resourcesRoot;
      }

      // 针对 SKILLs 位于 app.asar 内的旧版本包的回退方案
      return path.resolve(app.getAppPath(), SKILLS_DIR_NAME);
    }

    // 开发环境中，使用项目根目录（dist-electron 的父目录）
    // __dirname 是 dist-electron/，所以需要向上一级到达项目根目录
    const projectRoot = path.resolve(__dirname, '..');
    return path.resolve(projectRoot, SKILLS_DIR_NAME);
  }

  /**
   * 获取技能配置
   * @param skillId 技能 ID
   * @returns 配置结果，包含成功标志、配置对象或错误消息
   */
  getSkillConfig(skillId: string): { success: boolean; config?: Record<string, string>; error?: string } {
    try {
      const skillDir = this.resolveSkillDir(skillId);
      const envPath = path.join(skillDir, '.env');
      if (!fs.existsSync(envPath)) {
        return { success: true, config: {} };
      }
      const raw = fs.readFileSync(envPath, 'utf8');
      const config: Record<string, string> = {};
      // 解析 .env 文件
      for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx < 0) continue;
        const key = trimmed.slice(0, eqIdx).trim();
        const value = trimmed.slice(eqIdx + 1).trim();
        config[key] = value;
      }
      return { success: true, config };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '读取技能配置失败' };
    }
  }

  /**
   * 设置技能配置
   * @param skillId 技能 ID
   * @param config 配置对象
   * @returns 设置结果，包含成功标志和可选的错误消息
   */
  setSkillConfig(skillId: string, config: Record<string, string>): { success: boolean; error?: string } {
    try {
      const skillDir = this.resolveSkillDir(skillId);
      const envPath = path.join(skillDir, '.env');
      const lines = Object.entries(config)
        .filter(([key]) => key.trim())
        .map(([key, value]) => `${key}=${value}`);
      fs.writeFileSync(envPath, lines.join('\n') + '\n', 'utf8');
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '写入技能配置失败' };
    }
  }

  /**
   * 测试邮件连接性
   * @param skillId 技能 ID
   * @param config 配置对象
   * @returns 测试结果，包含成功标志、测试结果或错误消息
   */
  async testEmailConnectivity(
    skillId: string,
    config: Record<string, string>
  ): Promise<{ success: boolean; result?: EmailConnectivityTestResult; error?: string }> {
    try {
      const skillDir = this.resolveSkillDir(skillId);
      const imapScript = path.join(skillDir, 'scripts', 'imap.js');
      const smtpScript = path.join(skillDir, 'scripts', 'smtp.js');
      if (!fs.existsSync(imapScript) || !fs.existsSync(smtpScript)) {
        return { success: false, error: '未找到邮件连接性测试脚本' };
      }

      // 准备环境变量覆盖
      const envOverrides = Object.fromEntries(
        Object.entries(config ?? {})
          .filter(([key]) => key.trim())
          .map(([key, value]) => [key, String(value ?? '')])
      );

      // 运行 IMAP 测试
      const imapResult = await this.runSkillScriptWithEnv(
        skillDir,
        imapScript,
        ['list-mailboxes'],
        envOverrides,
        20000
      );
      // 运行 SMTP 测试
      const smtpResult = await this.runSkillScriptWithEnv(
        skillDir,
        smtpScript,
        ['verify'],
        envOverrides,
        20000
      );

      // 构建检查结果
      const checks: EmailConnectivityCheck[] = [
        this.buildEmailConnectivityCheck('imap_connection', imapResult),
        this.buildEmailConnectivityCheck('smtp_connection', smtpResult),
      ];
      const verdict: EmailConnectivityVerdict = checks.every(check => check.level === 'pass') ? 'pass' : 'fail';

      return {
        success: true,
        result: {
          testedAt: Date.now(),
          verdict,
          checks,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '测试邮件连接性失败',
      };
    }
  }

  /**
   * 解析技能目录路径
   * @param skillId 技能 ID
   * @returns 技能目录路径
   * @throws 如果技能未找到
   */
  private resolveSkillDir(skillId: string): string {
    const skills = this.listSkills();
    const skill = skills.find(s => s.id === skillId);
    if (!skill) {
      throw new Error('技能未找到');
    }
    return path.dirname(skill.skillPath);
  }

  /**
   * 获取脚本运行时候选列表
   * @returns 运行时候选列表
   */
  private getScriptRuntimeCandidates(): Array<{ command: string; extraEnv?: NodeJS.ProcessEnv }> {
    const candidates: Array<{ command: string; extraEnv?: NodeJS.ProcessEnv }> = [];
    if (!app.isPackaged) {
      candidates.push({ command: 'node' });
    }
    candidates.push({
      command: process.execPath,
      extraEnv: { ELECTRON_RUN_AS_NODE: '1' },
    });
    return candidates;
  }

  /**
   * 使用环境变量运行技能脚本
   * @param skillDir 技能目录
   * @param scriptPath 脚本路径
   * @param scriptArgs 脚本参数
   * @param envOverrides 环境变量覆盖
   * @param timeoutMs 超时时间（毫秒）
   * @returns 脚本运行结果
   */
  private async runSkillScriptWithEnv(
    skillDir: string,
    scriptPath: string,
    scriptArgs: string[],
    envOverrides: Record<string, string>,
    timeoutMs: number
  ): Promise<SkillScriptRunResult> {
    let lastResult: SkillScriptRunResult | null = null;

    for (const runtime of this.getScriptRuntimeCandidates()) {
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        ...runtime.extraEnv,
        ...envOverrides,
      };
      const result = await runScriptWithTimeout({
        command: runtime.command,
        args: [scriptPath, ...scriptArgs],
        cwd: skillDir,
        env,
        timeoutMs,
      });
      lastResult = result;

      // 如果运行时不存在，尝试下一个候选
      if (result.spawnErrorCode === 'ENOENT') {
        continue;
      }
      return result;
    }

    return lastResult ?? {
      success: false,
      exitCode: null,
      stdout: '',
      stderr: '',
      durationMs: 0,
      timedOut: false,
      error: '运行技能脚本失败',
    };
  }

  /**
   * 解析脚本消息
   * @param stdout 标准输出
   * @returns 解析出的消息，如果解析失败则返回 null
   */
  private parseScriptMessage(stdout: string): string | null {
    if (!stdout) {
      return null;
    }
    try {
      const parsed = JSON.parse(stdout);
      if (parsed && typeof parsed === 'object' && typeof parsed.message === 'string' && parsed.message.trim()) {
        return parsed.message.trim();
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * 获取输出的最后一行
   * @param text 文本内容
   * @returns 最后一行文本
   */
  private getLastOutputLine(text: string): string {
    return text
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean)
      .slice(-1)[0] || '';
  }

  /**
   * 构建邮件连接性检查结果
   * @param code 检查代码
   * @param result 脚本运行结果
   * @returns 邮件连接性检查对象
   */
  private buildEmailConnectivityCheck(
    code: EmailConnectivityCheckCode,
    result: SkillScriptRunResult
  ): EmailConnectivityCheck {
    const label = code === 'imap_connection' ? 'IMAP' : 'SMTP';

    if (result.success) {
      const parsedMessage = this.parseScriptMessage(result.stdout);
      return {
        code,
        level: 'pass',
        message: parsedMessage || `${label} 连接成功`,
        durationMs: result.durationMs,
      };
    }

    const message = result.timedOut
      ? `${label} 连接性检查超时`
      : result.error
        || this.getLastOutputLine(result.stderr)
        || this.getLastOutputLine(result.stdout)
        || `${label} 连接失败`;

    return {
      code,
      level: 'fail',
      message,
      durationMs: result.durationMs,
    };
  }

  /**
   * 规范化 Git 源
   * @param source 源字符串
   * @returns 规范化的 Git 源对象，如果无效则返回 null
   */
  private normalizeGitSource(source: string): NormalizedGitSource | null {
    const githubTreeOrBlob = parseGithubTreeOrBlobUrl(source);
    if (githubTreeOrBlob) {
      return githubTreeOrBlob;
    }

    // 匹配 owner/repo 格式
    if (/^[\w.-]+\/[\w.-]+$/.test(source)) {
      return {
        repoUrl: `https://github.com/${source}.git`,
      };
    }
    // 匹配 HTTP/HTTPS/SSH URL
    if (source.startsWith('http://') || source.startsWith('https://') || source.startsWith('git@')) {
      return {
        repoUrl: source,
      };
    }
    // 匹配 .git 结尾的 URL
    if (source.endsWith('.git')) {
      return {
        repoUrl: source,
      };
    }
    return null;
  }
}
