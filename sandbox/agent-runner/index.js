#!/usr/bin/env node
'use strict';

// ============================================================================
// 模块依赖导入
// ============================================================================
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { spawnSync } = require('child_process');
const { randomUUID } = require('crypto');
const { setTimeout: sleep } = require('timers/promises');
const { z } = require('zod');

// ============================================================================
// 常量定义
// ============================================================================

// IPC（进程间通信）根目录路径
const IPC_ROOT = '/workspace/ipc';
// 日志文件路径
const LOG_PATH = '/tmp/agentd.log';
// 请求目录路径
const REQUESTS_DIR = path.join(IPC_ROOT, 'requests');
// 响应目录路径
const RESPONSES_DIR = path.join(IPC_ROOT, 'responses');
// 流数据目录路径
const STREAMS_DIR = path.join(IPC_ROOT, 'streams');
// 心跳文件路径
const HEARTBEAT_PATH = path.join(IPC_ROOT, 'heartbeat');

// 轮询间隔（毫秒）
const POLL_INTERVAL_MS = 300;
// 心跳间隔（毫秒）
const HEARTBEAT_INTERVAL_MS = 5000;
// 控制台设备路径列表
const CONSOLE_PATHS = ['/dev/console', '/dev/ttyAMA0', '/dev/ttyS0'];

// Virtio-serial 设备路径（按顺序检查）
const SERIAL_DEVICE_PATHS = ['/dev/virtio-ports/ipc.0', '/dev/vport0p1'];

// ---------------------------------------------------------------------------
// 文件同步常量（通过 virtio-serial 实现客户机到主机的文件传输）
// ---------------------------------------------------------------------------
// 工作区项目目录
const WORKSPACE_PROJECT = '/workspace/project';
// 文件同步块大小：512 KB
const FILE_SYNC_CHUNK_SIZE = 512 * 1024;
// 文件同步最大文件大小：100 MB
const FILE_SYNC_MAX_SIZE = 100 * 1024 * 1024;
// 文件同步扫描间隔（毫秒）
const FILE_SYNC_INTERVAL_MS = 1000;
// 文件同步忽略的目录和文件
const FILE_SYNC_IGNORE = ['.git', 'node_modules', '__pycache__', '.DS_Store', 'Thumbs.db'];
// 工具路径搜索忽略的目录
const TOOL_PATH_SEARCH_IGNORE = new Set(['.git', 'node_modules', '.cowork-temp', '__pycache__']);
// 临时工作区前缀
const TMP_WORKSPACE_PREFIX = '/tmp/workspace/';
// 临时工作区技能前缀
const TMP_WORKSPACE_SKILLS_PREFIX = '/tmp/workspace/skills/';
// 技能标记
const SKILLS_MARKER = '/skills/';
// 权限响应超时时间（毫秒）
const PERMISSION_RESPONSE_TIMEOUT_MS = 60_000;
// 删除工具名称集合
const DELETE_TOOL_NAMES = new Set(['delete', 'remove', 'unlink', 'rmdir']);
// 被阻止的内置 Web 工具集合
const BLOCKED_BUILTIN_WEB_TOOLS = new Set(['websearch', 'webfetch']);
// 工具输入路径键名正则表达式
const TOOL_INPUT_PATH_KEY_RE = /(^|_)(path|paths|file|files|dir|dirs|directory|directories|cwd|target|targets|source|sources|output|outputs|dest|destination)$/i;
// 删除命令正则表达式
const DELETE_COMMAND_RE = /\b(rm|rmdir|unlink|del|erase|remove-item)\b/i;
// find 删除命令正则表达式
const FIND_DELETE_COMMAND_RE = /\bfind\b[\s\S]*\s-delete\b/i;
// git clean 命令正则表达式
const GIT_CLEAN_COMMAND_RE = /\bgit\s+clean\b/i;
// 安全审批允许选项
const SAFETY_APPROVAL_ALLOW_OPTION = '允许本次操作';
// 安全审批拒绝选项
const SAFETY_APPROVAL_DENY_OPTION = '拒绝本次操作';
// 提示中显示的最大策略路径数量
const MAX_POLICY_PATHS_IN_PROMPT = 3;
// 路径敏感的工具名称集合
const PATH_SENSITIVE_TOOL_NAMES = new Set([
  'read',
  'write',
  'edit',
  'multiedit',
  'ls',
  'glob',
  'grep',
  'delete',
  'remove',
  'move',
  'copy',
  'rename',
]);

// ---------------------------------------------------------------------------
// IPC 模式：'file'（9p 共享文件系统）或 'serial'（Windows 上的 virtio-serial）
// ---------------------------------------------------------------------------
let ipcMode = 'file';
let serialFd = null;

/**
 * 向控制台追加消息
 * @param {string} message - 要追加的消息
 */
function appendConsole(message) {
  const line = `[agentd] ${message}\n`;
  for (const consolePath of CONSOLE_PATHS) {
    try {
      fs.appendFileSync(consolePath, line);
      return;
    } catch (error) {
      // 尝试下一个控制台路径
    }
  }
}

/**
 * 确保目录存在，如果不存在则创建
 * @param {string} dirPath - 目录路径
 */
function ensureDir(dirPath) {
  try {
    fs.mkdirSync(dirPath, { recursive: true });
  } catch (error) {
    console.error('创建目录失败:', dirPath, error);
  }
}

/**
 * 追加日志消息到日志文件
 * @param {string} message - 日志消息
 */
function appendLog(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  try {
    fs.appendFileSync(LOG_PATH, line);
  } catch (error) {
    // 尽力而为的日志记录
  }
  appendConsole(message);
  if (ipcMode === 'file' && isMounted(IPC_ROOT)) {
    try {
      fs.appendFileSync(path.join(IPC_ROOT, 'agentd.log'), line);
    } catch (error) {
      // 尽力而为的日志记录
    }
  }
}

/**
 * 安全地读取 JSON 文件
 * @param {string} filePath - 文件路径
 * @returns {Object|null} 解析后的 JSON 对象，失败时返回 null
 */
function safeReadJson(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    return null;
  }
}

/**
 * 获取 Claude SDK 版本
 * @returns {string} SDK 版本号，未知时返回 'unknown'
 */
function getClaudeSdkVersion() {
  try {
    return require('@anthropic-ai/claude-agent-sdk/package.json')?.version || 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * 构建后备 MCP 服务器工厂函数
 * @returns {Function|null} MCP 服务器工厂函数，失败时返回 null
 */
function buildFallbackMcpServerFactory() {
  try {
    const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
    if (typeof McpServer !== 'function') {
      return null;
    }
    return (options) => {
      const server = new McpServer(
        {
          name: options.name,
          version: options.version || '1.0.0',
        },
        {
          capabilities: {
            tools: options.tools ? {} : undefined,
          },
        }
      );
      if (Array.isArray(options.tools)) {
        for (const toolDef of options.tools) {
          server.tool(toolDef.name, toolDef.description, toolDef.inputSchema, toolDef.handler);
        }
      }
      return {
        type: 'sdk',
        name: options.name,
        instance: server,
      };
    };
  } catch {
    return null;
  }
}

/**
 * 检查文件是否存在
 * @param {string} targetPath - 目标路径
 * @returns {boolean} 文件存在返回 true，否则返回 false
 */
function fileExists(targetPath) {
  try {
    return fs.existsSync(targetPath);
  } catch {
    return false;
  }
}

/**
 * 判断是否应该尝试上传后备路径
 * @param {string} filePath - 文件路径
 * @returns {boolean} 需要尝试上传返回 true，否则返回 false
 */
function shouldTryUploadFallback(filePath) {
  if (typeof filePath !== 'string') return false;
  const normalized = filePath.replace(/\\/g, '/');
  if (!normalized.startsWith('/tmp/')) return false;
  return !fileExists(filePath);
}

/**
 * 检查路径是否为目录
 * @param {string} targetPath - 目标路径
 * @returns {boolean} 是目录返回 true，否则返回 false
 */
function isDirectory(targetPath) {
  if (!targetPath || !path.isAbsolute(targetPath)) return false;
  try {
    return fs.statSync(targetPath).isDirectory();
  } catch {
    return false;
  }
}

/**
 * 构建路径搜索根目录列表
 * @param {string} cwd - 当前工作目录
 * @param {Object} requestEnv - 请求环境变量
 * @returns {string[]} 路径搜索根目录数组
 */
function buildPathSearchRoots(cwd, requestEnv) {
  const roots = new Set();
  const pushRoot = (targetPath) => {
    if (!isDirectory(targetPath)) return;
    roots.add(path.resolve(targetPath));
  };

  pushRoot(cwd);
  pushRoot(WORKSPACE_PROJECT);
  pushRoot('/workspace');
  if (requestEnv && typeof requestEnv === 'object') {
    if (typeof requestEnv.SKILLS_ROOT === 'string') {
      pushRoot(requestEnv.SKILLS_ROOT);
    }
    if (typeof requestEnv.LOBSTERAI_SKILLS_ROOT === 'string') {
      pushRoot(requestEnv.LOBSTERAI_SKILLS_ROOT);
    }
  }

  return Array.from(roots);
}

/**
 * 规范化路径字符串
 * @param {string} rawPath - 原始路径字符串
 * @returns {string|null} 规范化后的路径，无效时返回 null
 */
function normalizePathString(rawPath) {
  if (typeof rawPath !== 'string') return null;
  const trimmed = rawPath.trim();
  if (!trimmed) return null;

  let normalized = trimmed.replace(/\\/g, '/');
  if (/^file:\/\//i.test(normalized)) {
    try {
      normalized = decodeURIComponent(normalized.replace(/^file:\/\//i, ''));
      if (/^\/[A-Za-z]:/.test(normalized)) {
        normalized = normalized.slice(1);
      }
    } catch {
      return null;
    }
  }
  return normalized;
}

/**
 * 将主机工作区路径映射到客户机路径
 * @param {string} filePath - 文件路径
 * @param {string} cwd - 当前工作目录
 * @param {string} hostWorkspaceRoot - 主机工作区根目录
 * @returns {string|null} 映射后的路径，无效时返回 null
 */
function mapHostWorkspacePathToGuest(filePath, cwd, hostWorkspaceRoot) {
  if (!filePath || !cwd || !hostWorkspaceRoot) return null;
  const normalizedPath = normalizePathString(filePath);
  const normalizedHostRoot = normalizePathString(hostWorkspaceRoot);
  if (!normalizedPath || !normalizedHostRoot) return null;

  const hostRoot = normalizedHostRoot.replace(/\/+$/, '');
  if (!hostRoot) return null;

  if (normalizedPath !== hostRoot && !normalizedPath.startsWith(`${hostRoot}/`)) {
    return null;
  }

  const relative = normalizedPath.slice(hostRoot.length).replace(/^\/+/, '');
  const guestRoot = cwd.replace(/\\/g, '/').replace(/\/+$/, '');
  if (!guestRoot) return null;
  if (!relative) return guestRoot;
  return path.posix.join(guestRoot, relative);
}

/**
 * 根据基本名称查找文件
 * @param {string} rootDir - 根目录
 * @param {string} baseName - 基本文件名
 * @param {number} maxMatches - 最大匹配数量
 * @returns {string[]} 匹配的文件路径数组
 */
function findFilesByBaseName(rootDir, baseName, maxMatches = 2) {
  if (!rootDir || !baseName) return [];
  const matches = [];
  const queue = [rootDir];

  while (queue.length > 0 && matches.length < maxMatches) {
    const current = queue.shift();
    if (!current) continue;

    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (matches.length >= maxMatches) break;
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (TOOL_PATH_SEARCH_IGNORE.has(entry.name)) continue;
        queue.push(fullPath);
        continue;
      }
      if (entry.isFile() && entry.name === baseName) {
        matches.push(fullPath);
      }
    }
  }

  return matches;
}

/**
 * 解析后备路径
 * @param {string} filePath - 文件路径
 * @param {string[]} searchRoots - 搜索根目录列表
 * @param {Object} requestEnv - 请求环境变量
 * @returns {string|null} 解析后的路径，未找到时返回 null
 */
function resolveFallbackPath(filePath, searchRoots, requestEnv) {
  if (!shouldTryUploadFallback(filePath)) return null;
  const normalized = filePath.replace(/\\/g, '/');
  const normalizedLower = normalized.toLowerCase();

  if (normalized.startsWith(TMP_WORKSPACE_PREFIX)) {
    const workspaceCandidate = path.posix.join('/workspace', normalized.slice(TMP_WORKSPACE_PREFIX.length));
    if (fileExists(workspaceCandidate)) {
      return workspaceCandidate;
    }
  }

  if (normalizedLower.startsWith(TMP_WORKSPACE_SKILLS_PREFIX) && requestEnv && typeof requestEnv === 'object') {
    const skillsRoot = typeof requestEnv.SKILLS_ROOT === 'string'
      ? requestEnv.SKILLS_ROOT
      : typeof requestEnv.LOBSTERAI_SKILLS_ROOT === 'string'
        ? requestEnv.LOBSTERAI_SKILLS_ROOT
        : null;
    if (skillsRoot && path.isAbsolute(skillsRoot)) {
      const skillsCandidate = path.join(skillsRoot, normalized.slice(TMP_WORKSPACE_SKILLS_PREFIX.length));
      if (fileExists(skillsCandidate)) {
        return skillsCandidate;
      }
    }
  }

  if (!Array.isArray(searchRoots) || searchRoots.length === 0) return null;

  const baseName = path.basename(filePath);
  if (!baseName) return null;

  for (const root of searchRoots) {
    const directPath = path.join(root, baseName);
    if (fileExists(directPath)) {
      return directPath;
    }
  }

  const matches = [];
  for (const root of searchRoots) {
    const remaining = 2 - matches.length;
    if (remaining <= 0) break;
    const rootMatches = findFilesByBaseName(root, baseName, remaining);
    for (const match of rootMatches) {
      if (!matches.includes(match)) {
        matches.push(match);
      }
    }
  }

  if (matches.length === 1 && fileExists(matches[0])) {
    return matches[0];
  }

  return null;
}

/**
 * 从环境变量解析技能根目录
 * @param {Object} requestEnv - 请求环境变量
 * @returns {string|null} 技能根目录路径，无效时返回 null
 */
function resolveSkillsRootFromEnv(requestEnv) {
  if (!requestEnv || typeof requestEnv !== 'object') return null;
  const skillsRoot = typeof requestEnv.SKILLS_ROOT === 'string'
    ? requestEnv.SKILLS_ROOT
    : typeof requestEnv.LOBSTERAI_SKILLS_ROOT === 'string'
      ? requestEnv.LOBSTERAI_SKILLS_ROOT
      : null;
  if (!skillsRoot || !path.isAbsolute(skillsRoot)) return null;
  return skillsRoot;
}

/**
 * 解析主机技能路径
 * @param {string} filePath - 文件路径
 * @param {Object} requestEnv - 请求环境变量
 * @returns {string|null} 解析后的路径，无效时返回 null
 */
function resolveHostSkillPath(filePath, requestEnv) {
  if (typeof filePath !== 'string' || !filePath.trim()) return null;
  const skillsRoot = resolveSkillsRootFromEnv(requestEnv);
  if (!skillsRoot) return null;

  const normalized = filePath.replace(/\\/g, '/');
  const markerIndex = normalized.toLowerCase().lastIndexOf(SKILLS_MARKER);
  const relative = markerIndex < 0
    ? ''
    : normalized.slice(markerIndex + SKILLS_MARKER.length).replace(/^\/+/, '');
  if (!relative) return null;

  const candidate = path.join(skillsRoot, ...relative.split('/'));
  if (!fileExists(candidate)) return null;
  return candidate;
}

/**
 * 规范化工具输入路径
 * @param {string} toolName - 工具名称
 * @param {Object} toolInput - 工具输入参数
 * @param {string} cwd - 当前工作目录
 * @param {Object} requestEnv - 请求环境变量
 * @param {string} hostWorkspaceRoot - 主机工作区根目录
 * @returns {Object} 规范化后的工具输入参数
 */
function normalizeToolInputPaths(toolName, toolInput, cwd, requestEnv, hostWorkspaceRoot) {
  if (!toolInput || typeof toolInput !== 'object') return toolInput;

  const input = { ...toolInput };
  const searchRoots = buildPathSearchRoots(cwd, requestEnv);
  const rewriteField = (field) => {
    const value = input[field];
    if (typeof value !== 'string' || !value.trim()) return;
    const mappedWorkspacePath = mapHostWorkspacePathToGuest(value, cwd, hostWorkspaceRoot);
    if (mappedWorkspacePath && mappedWorkspacePath !== value) {
      appendLog(`重写 ${toolName}.${field} 主机工作区路径: ${value} -> ${mappedWorkspacePath}`);
      input[field] = mappedWorkspacePath;
      return;
    }
    const skillPath = resolveHostSkillPath(value, requestEnv);
    if (skillPath && skillPath !== value) {
      appendLog(`重写 ${toolName}.${field} 主机技能路径: ${value} -> ${skillPath}`);
      input[field] = skillPath;
      return;
    }
    const fallback = resolveFallbackPath(value, searchRoots, requestEnv);
    if (!fallback) return;
    appendLog(`重写 ${toolName}.${field}: ${value} -> ${fallback}`);
    input[field] = fallback;
  };

  if (toolName === 'Read' || toolName === 'Write' || toolName === 'Edit' || toolName === 'MultiEdit') {
    rewriteField('file_path');
  }

  return input;
}

/**
 * 检查目标路径是否在基础路径内
 * @param {string} basePath - 基础路径
 * @param {string} targetPath - 目标路径
 * @returns {boolean} 在基础路径内返回 true，否则返回 false
 */
function isPathWithin(basePath, targetPath) {
  const normalizedBase = path.resolve(basePath);
  const normalizedTarget = path.resolve(targetPath);
  return normalizedTarget === normalizedBase || normalizedTarget.startsWith(`${normalizedBase}${path.sep}`);
}

/**
 * 从工具输入中提取命令
 * @param {Object} toolInput - 工具输入参数
 * @returns {string} 提取的命令字符串
 */
function extractToolCommand(toolInput) {
  const commandLike = toolInput.command ?? toolInput.cmd ?? toolInput.script;
  return typeof commandLike === 'string' ? commandLike : '';
}

/**
 * 将命令字符串分词
 * @param {string} command - 命令字符串
 * @returns {string[]} 分词后的数组
 */
function tokenizeCommand(command) {
  const matches = command.match(/"[^"]*"|'[^']*'|`[^`]*`|[^\s]+/g);
  return matches || [];
}

/**
 * 从命令中提取类路径标记
 * @param {string} command - 命令字符串
 * @returns {string[]} 类路径标记数组
 */
function extractPathLikeTokensFromCommand(command) {
  if (!command.trim()) return [];
  const tokens = tokenizeCommand(command);
  const pathTokens = [];
  for (const token of tokens) {
    let value = token.trim();
    if (!value) continue;
    value = value.replace(/^['"`]+|['"`]+$/g, '').replace(/[;,]+$/g, '');
    if (!value || value.startsWith('-')) continue;
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(value)) continue;
    if (/^[a-zA-Z]+:\/\//.test(value)) continue;
    if (value.startsWith('$') || value.startsWith('%')) continue;

    const hasPathHint = (
      value === '.'
      || value === '..'
      || value.startsWith('/')
      || value.startsWith('./')
      || value.startsWith('../')
      || value.startsWith('~/')
      || value.includes('/')
      || value.includes('\\')
      || /^[A-Za-z]:[\\/]/.test(value)
    );
    if (!hasPathHint) continue;
    pathTokens.push(value);
  }
  return pathTokens;
}

/**
 * 判断字符串是否可能是路径
 * @param {string} value - 待判断的字符串
 * @returns {boolean} 可能是路径返回 true，否则返回 false
 */
function isLikelyPathString(value) {
  if (!value || value.length > 1024) return false;
  if (value.includes('\n')) return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (/^[a-zA-Z]+:\/\//.test(trimmed) && !/^file:\/\//i.test(trimmed)) {
    return false;
  }
  return (
    /^file:\/\//i.test(trimmed)
    || trimmed === '.'
    || trimmed === '..'
    || trimmed.startsWith('/')
    || trimmed.startsWith('./')
    || trimmed.startsWith('../')
    || trimmed.startsWith('~/')
    || trimmed.includes('/')
    || trimmed.includes('\\')
    || /^[A-Za-z]:[\\/]/.test(trimmed)
  );
}

/**
 * 从工具输入中收集路径候选
 * @param {string} toolName - 工具名称
 * @param {*} value - 值
 * @param {string} keyHint - 键名提示
 * @param {Set} outSet - 输出集合
 */
function collectPathCandidatesFromInput(toolName, value, keyHint, outSet) {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return;
    if (keyHint && TOOL_INPUT_PATH_KEY_RE.test(keyHint)) {
      outSet.add(trimmed);
      return;
    }
    const normalizedToolName = String(toolName || '').toLowerCase();
    if (PATH_SENSITIVE_TOOL_NAMES.has(normalizedToolName) && isLikelyPathString(trimmed)) {
      outSet.add(trimmed);
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectPathCandidatesFromInput(toolName, item, keyHint, outSet);
    }
    return;
  }

  if (!value || typeof value !== 'object') {
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    collectPathCandidatesFromInput(toolName, child, key, outSet);
  }
}

/**
 * 解析路径候选
 * @param {string} candidate - 路径候选
 * @param {string} cwd - 当前工作目录
 * @returns {string|null} 解析后的路径，无效时返回 null
 */
function resolvePathCandidate(candidate, cwd) {
  if (!candidate) return null;
  const trimmed = String(candidate).trim();
  if (!trimmed) return null;

  let normalized = trimmed
    .replace(/^['"`]+|['"`]+$/g, '')
    .replace(/[;,]+$/g, '')
    .trim();
  if (!normalized || normalized.startsWith('-')) return null;
  if (/^file:\/\//i.test(normalized)) {
    try {
      normalized = decodeURIComponent(normalized.replace(/^file:\/\//i, ''));
      if (/^\/[A-Za-z]:/.test(normalized)) {
        normalized = normalized.slice(1);
      }
    } catch {
      return null;
    }
  } else if (/^[a-zA-Z]+:\/\//.test(normalized)) {
    return null;
  }
  if (normalized.startsWith('$') || normalized.startsWith('%')) return null;

  if (normalized.startsWith('~/')) {
    const home = process.env.HOME || '/root';
    normalized = path.join(home, normalized.slice(2));
  }

  const resolved = path.isAbsolute(normalized)
    ? path.resolve(normalized)
    : path.resolve(cwd, normalized);

  try {
    return fs.realpathSync(resolved);
  } catch {
    return resolved;
  }
}

/**
 * 获取工作区外的路径列表
 * @param {string} toolName - 工具名称
 * @param {Object} toolInput - 工具输入参数
 * @param {string} cwd - 当前工作目录
 * @param {string} workspaceRoot - 工作区根目录
 * @param {Object} requestEnv - 请求环境变量
 * @returns {string[]} 工作区外的路径数组
 */
function getOutsideWorkspacePaths(toolName, toolInput, cwd, workspaceRoot, requestEnv) {
  const candidates = new Set();
  collectPathCandidatesFromInput(toolName, toolInput, null, candidates);
  const skillsRoot = resolveSkillsRootFromEnv(requestEnv);

  if (toolName === 'Bash') {
    const command = extractToolCommand(toolInput);
    for (const token of extractPathLikeTokensFromCommand(command)) {
      candidates.add(token);
    }
  }

  if (candidates.size === 0) return [];

  const outside = new Set();
  for (const candidate of candidates) {
    const resolved = resolvePathCandidate(candidate, cwd);
    if (!resolved) continue;
    const inWorkspace = isPathWithin(workspaceRoot, resolved);
    const inSkillsRoot = Boolean(skillsRoot && isPathWithin(skillsRoot, resolved));
    if (!inWorkspace && !inSkillsRoot) {
      outside.add(resolved);
    }
  }
  return Array.from(outside);
}

/**
 * 判断是否为删除操作
 * @param {string} toolName - 工具名称
 * @param {Object} toolInput - 工具输入参数
 * @returns {boolean} 是删除操作返回 true，否则返回 false
 */
function isDeleteOperation(toolName, toolInput) {
  const normalizedName = String(toolName || '').toLowerCase();
  if (DELETE_TOOL_NAMES.has(normalizedName)) {
    return true;
  }

  if (normalizedName !== 'bash') {
    return false;
  }

  const command = extractToolCommand(toolInput);
  if (!command.trim()) {
    return false;
  }
  return DELETE_COMMAND_RE.test(command)
    || FIND_DELETE_COMMAND_RE.test(command)
    || GIT_CLEAN_COMMAND_RE.test(command);
}

/**
 * 判断是否为被阻止的内置 Web 工具
 * @param {string} toolName - 工具名称
 * @returns {boolean} 被阻止返回 true，否则返回 false
 */
function isBlockedBuiltinWebTool(toolName) {
  const normalized = String(toolName || '').trim().toLowerCase();
  if (!normalized) return false;

  const compact = normalized.replace(/[^a-z0-9]/g, '');
  if (BLOCKED_BUILTIN_WEB_TOOLS.has(compact)) {
    return true;
  }

  const segments = normalized.split(/[^a-z0-9]+/).filter(Boolean);
  if (segments.length >= 2) {
    const tail = `${segments[segments.length - 2]}${segments[segments.length - 1]}`;
    if (BLOCKED_BUILTIN_WEB_TOOLS.has(tail)) {
      return true;
    }
  }

  return false;
}

/**
 * 截断命令预览
 * @param {string} command - 命令字符串
 * @param {number} maxLength - 最大长度
 * @returns {string} 截断后的命令预览
 */
function truncateCommandPreview(command, maxLength = 120) {
  const compact = command.replace(/\s+/g, ' ').trim();
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, maxLength)}...`;
}

/**
 * 构建安全确认问题输入
 * @param {string} question - 问题文本
 * @param {string} requestedToolName - 请求的工具名称
 * @param {Object} requestedToolInput - 请求的工具输入参数
 * @returns {Object} 问题输入对象
 */
function buildSafetyQuestionInput(question, requestedToolName, requestedToolInput) {
  return {
    questions: [
      {
        header: '安全确认',
        question,
        options: [
          {
            label: SAFETY_APPROVAL_ALLOW_OPTION,
            description: '仅允许当前这一次操作继续执行。',
          },
          {
            label: SAFETY_APPROVAL_DENY_OPTION,
            description: '拒绝当前操作，保持文件安全边界。',
          },
        ],
      },
    ],
    answers: {},
    context: {
      requestedToolName,
      requestedToolInput,
    },
  };
}

/**
 * 判断是否为安全审批结果
 * @param {Object} result - 结果对象
 * @param {string} question - 问题文本
 * @returns {boolean} 是安全审批返回 true，否则返回 false
 */
function isSafetyApproval(result, question) {
  if (!result || result.behavior === 'deny') {
    return false;
  }
  if (!result.updatedInput || typeof result.updatedInput !== 'object') {
    return false;
  }
  const answers = result.updatedInput.answers;
  if (!answers || typeof answers !== 'object') {
    return false;
  }
  const rawAnswer = answers[question];
  if (typeof rawAnswer !== 'string') {
    return false;
  }
  return rawAnswer
    .split('|||')
    .map((value) => value.trim())
    .filter(Boolean)
    .includes(SAFETY_APPROVAL_ALLOW_OPTION);
}

/**
 * 请求安全审批
 * @param {Object} params - 参数对象
 * @returns {Promise<boolean>} 审批通过返回 true，否则返回 false
 */
async function requestSafetyApproval({
  emit,
  signal,
  question,
  requestedToolName,
  requestedToolInput,
}) {
  const permissionRequestId = randomUUID();
  const questionInput = buildSafetyQuestionInput(question, requestedToolName, requestedToolInput);
  emit({
    type: 'permission_request',
    requestId: permissionRequestId,
    toolName: 'AskUserQuestion',
    toolInput: questionInput,
  });

  const result = await waitForPermissionResponse(permissionRequestId, signal);
  if (signal?.aborted) {
    return false;
  }
  return isSafetyApproval(result, question);
}

/**
 * 强制执行工具安全策略
 * @param {Object} params - 参数对象
 * @returns {Promise<Object|null>} 策略结果对象，允许时返回 null
 */
async function enforceToolSafetyPolicy({
  emit,
  signal,
  toolName,
  toolInput,
  cwd,
  workspaceRoot,
  requestEnv,
}) {
  if (isDeleteOperation(toolName, toolInput)) {
    const commandPreview = toolName === 'Bash'
      ? truncateCommandPreview(extractToolCommand(toolInput))
      : '';
    const deleteDetail = commandPreview ? ` 命令: ${commandPreview}` : '';
    const deleteQuestion = `工具 "${toolName}" 将执行删除操作。根据安全策略，删除必须人工确认。是否允许本次操作？${deleteDetail}`;
    const approved = await requestSafetyApproval({
      emit,
      signal,
      question: deleteQuestion,
      requestedToolName: toolName,
      requestedToolInput: toolInput,
    });
    if (!approved) {
      return { behavior: 'deny', message: '删除操作已被用户拒绝。' };
    }
  }

  const outsidePaths = getOutsideWorkspacePaths(toolName, toolInput, cwd, workspaceRoot, requestEnv);
  if (outsidePaths.length === 0) {
    return null;
  }

  const preview = outsidePaths.slice(0, MAX_POLICY_PATHS_IN_PROMPT).join('、');
  const suffix = outsidePaths.length > MAX_POLICY_PATHS_IN_PROMPT
    ? ` 等 ${outsidePaths.length} 个路径`
    : '';
  const question = `工具 "${toolName}" 正在访问所选文件夹外的路径（${preview}${suffix}）。是否允许本次越界操作？`;
  const approved = await requestSafetyApproval({
    emit,
    signal,
    question,
    requestedToolName: toolName,
    requestedToolInput: toolInput,
  });
  if (!approved) {
    return { behavior: 'deny', message: '所选文件夹外的操作已被用户拒绝。' };
  }

  return null;
}

/**
 * 检查路径是否已挂载
 * @param {string} targetPath - 目标路径
 * @returns {boolean} 已挂载返回 true，否则返回 false
 */
function isMounted(targetPath) {
  try {
    const mounts = fs.readFileSync('/proc/mounts', 'utf8');
    return mounts.split('\n').some((line) => {
      const parts = line.split(' ');
      return parts.length >= 2 && parts[1] === targetPath;
    });
  } catch (error) {
    console.error('读取 /proc/mounts 失败:', error);
    return false;
  }
}

/**
 * 检查路径是否可写
 * @param {string} targetPath - 目标路径
 * @returns {boolean} 可写返回 true，否则返回 false
 */
function isPathWritable(targetPath) {
  if (!targetPath || !path.isAbsolute(targetPath)) return false;
  const probePath = path.join(
    targetPath,
    `.lobsterai-mount-probe-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
  try {
    fs.writeFileSync(probePath, 'ok');
    fs.unlinkSync(probePath);
    return true;
  } catch (error) {
    appendLog(`工作区写入探测失败于 ${targetPath}: ${error instanceof Error ? error.message : String(error)}`);
    try {
      if (fs.existsSync(probePath)) {
        fs.unlinkSync(probePath);
      }
    } catch {
      // 尽力清理
    }
    return false;
  }
}

/**
 * 确保挂载点已挂载
 * @param {string} tag - 挂载标签
 * @param {string} guestPath - 客户机路径
 * @returns {Object} 挂载状态对象
 */
function ensureMount(tag, guestPath) {
  const mountState = {
    tag,
    guestPath,
    mounted: false,
    error: null,
  };
  if (!tag || !guestPath) {
    mountState.error = '无效的挂载配置';
    return mountState;
  }
  ensureDir(guestPath);
  if (isMounted(guestPath)) {
    appendLog(`${guestPath} 已挂载`);
    mountState.mounted = true;
    return mountState;
  }

  tryModprobe(['9p', '9pnet', '9pnet_virtio']);

  appendLog(`正在挂载 ${tag} -> ${guestPath}`);
  const mountResult = spawnSync(
    'mount',
    ['-t', '9p', '-o', 'trans=virtio,version=9p2000.L,msize=65536', tag, guestPath],
    { stdio: 'pipe' }
  );
  if (mountResult.status !== 0) {
    const message = mountResult.stderr?.toString() || mountResult.stdout?.toString() || '未知挂载错误';
    console.error(`挂载失败 ${tag} -> ${guestPath}:`, message.trim());
    appendLog(`挂载失败 ${tag} -> ${guestPath}: ${message.trim()}`);
    mountState.error = message.trim();
  } else {
    const mounted = isMounted(guestPath);
    if (!mounted) {
      const message = `${tag} 的挂载命令报告成功，但 ${guestPath} 未挂载`;
      appendLog(message);
      mountState.error = message;
    } else {
      appendLog(`成功挂载 ${tag} -> ${guestPath}`);
      mountState.mounted = true;
    }
  }
  return mountState;
}

/**
 * 尝试加载内核模块
 * @param {string[]} modules - 模块名称数组
 */
function tryModprobe(modules) {
  if (!Array.isArray(modules)) return;
  for (const name of modules) {
    if (!name) continue;
    const result = spawnSync('modprobe', [name], { stdio: 'ignore' });
    if (result.status === 0) {
      appendLog(`已加载内核模块: ${name}`);
    }
  }
}

/**
 * 确保所有挂载点已挂载
 * @param {Object} mounts - 挂载配置对象
 * @returns {Object[]} 挂载结果数组
 */
function ensureMounts(mounts) {
  const results = [];
  if (!mounts || typeof mounts !== 'object') return results;
  for (const mount of Object.values(mounts)) {
    if (!mount || typeof mount !== 'object') continue;
    const tag = mount.tag;
    const guestPath = mount.guestPath;
    if (typeof tag === 'string' && typeof guestPath === 'string') {
      results.push(ensureMount(tag, guestPath));
    }
  }
  return results;
}

/**
 * 验证工作区挂载
 * @param {Object} requestMounts - 请求挂载配置
 * @param {Object[]} mountResults - 挂载结果数组
 * @param {string} requestCwd - 请求的当前工作目录
 * @param {string} workspaceRoot - 工作区根目录
 */
function validateWorkspaceMount(requestMounts, mountResults, requestCwd, workspaceRoot) {
  if (ipcMode !== 'file') return;
  if (!requestMounts || typeof requestMounts !== 'object') return;

  const mounts = Object.values(requestMounts)
    .filter((mount) => mount && typeof mount === 'object')
    .map((mount) => ({
      tag: typeof mount.tag === 'string' ? mount.tag : '',
      guestPath: typeof mount.guestPath === 'string' ? mount.guestPath : '',
    }))
    .filter((mount) => mount.tag && mount.guestPath);

  if (mounts.length === 0) return;

  const workspaceMount = mounts.find((mount) =>
    mount.tag === 'work' || mount.guestPath === workspaceRoot || mount.guestPath === requestCwd
  );
  if (!workspaceMount) return;

  const matchedResult = Array.isArray(mountResults)
    ? mountResults.find((item) => item.tag === workspaceMount.tag && item.guestPath === workspaceMount.guestPath)
    : null;
  const mounted = matchedResult ? matchedResult.mounted : isMounted(workspaceMount.guestPath);
  if (!mounted) {
    throw new Error(
      `沙箱工作区挂载不可用（${workspaceMount.tag} -> ${workspaceMount.guestPath}）。`
      + '文件将写入虚拟机内部，不会持久化到所选文件夹。'
    );
  }

  if (!isPathWritable(requestCwd)) {
    throw new Error(
      `沙箱工作区路径不可写: ${requestCwd}。`
      + '文件将不会持久化到所选文件夹。'
    );
  }
}

// ---------------------------------------------------------------------------
// 心跳功能
// ---------------------------------------------------------------------------
/**
 * 更新心跳状态
 */
function updateHeartbeat() {
  const data = {
    timestamp: Date.now(),
    pid: process.pid,
    uptime: process.uptime(),
    ipcMounted: ipcMode === 'file' ? isMounted(IPC_ROOT) : true,
  };

  if (ipcMode === 'serial') {
    serialWrite({ type: 'heartbeat', ...data });
    appendLog(`心跳 (串口): ${JSON.stringify(data)}`);
  } else {
    try {
      fs.writeFileSync(HEARTBEAT_PATH, JSON.stringify(data));
      appendLog(`心跳已更新: ${JSON.stringify(data)}`);
    } catch (error) {
      appendLog(`更新心跳失败: ${error.message}`);
    }
  }
}

// ---------------------------------------------------------------------------
// 流写入器 – 文件模式与串口模式
// ---------------------------------------------------------------------------
/**
 * 创建流写入器
 * @param {string} requestId - 请求 ID
 * @returns {Object} 流写入器对象
 */
function createStreamWriter(requestId) {
  if (ipcMode === 'serial') {
    return {
      stream: null,
      streamPath: null,
      emit: (payload) => {
        serialWrite({ type: 'stream', requestId, line: JSON.stringify(payload) });
      },
      close: () => {},
    };
  }

  ensureDir(STREAMS_DIR);
  const streamPath = path.join(STREAMS_DIR, `${requestId}.log`);
  try {
    fs.closeSync(fs.openSync(streamPath, 'a'));
  } catch (error) {
    console.error('创建流文件失败:', streamPath, error);
  }
  const stream = fs.createWriteStream(streamPath, { flags: 'a' });
  return {
    stream,
    streamPath,
    emit: (payload) => {
      try {
        stream.write(`${JSON.stringify(payload)}\n`);
      } catch (error) {
        console.error('写入流数据失败:', error);
      }
    },
    close: () => stream.end(),
  };
}

/**
 * 构建环境变量对象
 * @param {Object} requestEnv - 请求环境变量
 * @returns {Object} 环境变量对象
 */
function buildEnv(requestEnv) {
  const env = { ...process.env };
  if (requestEnv && typeof requestEnv === 'object') {
    for (const [key, value] of Object.entries(requestEnv)) {
      if (value === undefined || value === null) continue;
      env[key] = String(value);
    }
  }
  if (!env.ANTHROPIC_API_KEY && env.ANTHROPIC_AUTH_TOKEN) {
    env.ANTHROPIC_API_KEY = env.ANTHROPIC_AUTH_TOKEN;
  }
  if (!env.ANTHROPIC_AUTH_TOKEN && env.ANTHROPIC_API_KEY) {
    env.ANTHROPIC_AUTH_TOKEN = env.ANTHROPIC_API_KEY;
  }
  env.HOME = env.HOME || '/root';
  env.XDG_CONFIG_HOME = env.XDG_CONFIG_HOME || '/root/.config';
  env.TMPDIR = '/tmp';
  env.TMP = '/tmp';
  env.TEMP = '/tmp';
  // Claude CLI 需要 bash
  env.SHELL = env.SHELL || '/bin/bash';
  env.PATH = env.PATH || '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin';
  // 确保 USER 已设置
  env.USER = env.USER || 'root';
  env.LOGNAME = env.LOGNAME || 'root';
  return env;
}

// ---------------------------------------------------------------------------
// 权限响应 – 文件模式与串口模式
// ---------------------------------------------------------------------------

// 待处理的串口权限响应: requestId → { resolve }
const pendingSerialPermissions = new Map();
const pendingSerialHostToolResponses = new Map();

/**
 * 等待权限响应
 * @param {string} requestId - 请求 ID
 * @param {AbortSignal} signal - 中止信号
 * @returns {Promise<Object>} 权限响应对象
 */
function waitForPermissionResponse(requestId, signal) {
  if (ipcMode === 'serial') {
    return waitForSerialPermissionResponse(requestId, signal);
  }
  return waitForFilePermissionResponse(requestId, signal);
}

/**
 * 等待文件权限响应
 * @param {string} requestId - 请求 ID
 * @param {AbortSignal} signal - 中止信号
 * @returns {Promise<Object>} 权限响应对象
 */
async function waitForFilePermissionResponse(requestId, signal) {
  ensureDir(RESPONSES_DIR);
  const responsePath = path.join(RESPONSES_DIR, `${requestId}.json`);
  const startAt = Date.now();
  while (true) {
    if (signal?.aborted) {
      return { behavior: 'deny', message: '会话已中止' };
    }
    if (Date.now() - startAt >= PERMISSION_RESPONSE_TIMEOUT_MS) {
      return { behavior: 'deny', message: '权限请求在 60 秒后超时' };
    }
    if (fs.existsSync(responsePath)) {
      const payload = safeReadJson(responsePath);
      if (payload) {
        try {
          fs.unlinkSync(responsePath);
        } catch (error) {
          console.error('删除权限响应文件失败:', error);
        }
        return payload;
      }
    }
    await sleep(200);
  }
}

/**
 * 等待串口权限响应
 * @param {string} requestId - 请求 ID
 * @param {AbortSignal} signal - 中止信号
 * @returns {Promise<Object>} 权限响应对象
 */
function waitForSerialPermissionResponse(requestId, signal) {
  return new Promise((resolve) => {
    let settled = false;
    let timeoutId = null;
    let onAbort = null;

    const cleanup = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      if (signal && onAbort) {
        signal.removeEventListener('abort', onAbort);
      }
      pendingSerialPermissions.delete(requestId);
    };

    const finalize = (result) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };

    onAbort = () => {
      finalize({ behavior: 'deny', message: '会话已中止' });
    };

    if (signal?.aborted) {
      finalize({ behavior: 'deny', message: '会话已中止' });
      return;
    }
    pendingSerialPermissions.set(requestId, { resolve: finalize });

    timeoutId = setTimeout(() => {
      finalize({ behavior: 'deny', message: '权限请求在 60 秒后超时' });
    }, PERMISSION_RESPONSE_TIMEOUT_MS);

    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

/**
 * 等待主机工具响应
 * @param {string} requestId - 请求 ID
 * @param {AbortSignal} signal - 中止信号
 * @returns {Promise<Object>} 主机工具响应对象
 */
function waitForHostToolResponse(requestId, signal) {
  if (ipcMode === 'serial') {
    return waitForSerialHostToolResponse(requestId, signal);
  }
  return waitForFileHostToolResponse(requestId, signal);
}

/**
 * 等待文件主机工具响应
 * @param {string} requestId - 请求 ID
 * @param {AbortSignal} signal - 中止信号
 * @returns {Promise<Object>} 主机工具响应对象
 */
async function waitForFileHostToolResponse(requestId, signal) {
  ensureDir(RESPONSES_DIR);
  const responsePath = path.join(RESPONSES_DIR, `${requestId}.host-tool.json`);
  const startAt = Date.now();
  while (true) {
    if (signal?.aborted) {
      return { success: false, error: '会话已中止' };
    }
    if (Date.now() - startAt >= PERMISSION_RESPONSE_TIMEOUT_MS) {
      return { success: false, error: '主机工具请求在 60 秒后超时' };
    }
    if (fs.existsSync(responsePath)) {
      const payload = safeReadJson(responsePath);
      if (payload) {
        try {
          fs.unlinkSync(responsePath);
        } catch (error) {
          console.error('删除主机工具响应文件失败:', error);
        }
        return payload;
      }
    }
    await sleep(200);
  }
}

/**
 * 等待串口主机工具响应
 * @param {string} requestId - 请求 ID
 * @param {AbortSignal} signal - 中止信号
 * @returns {Promise<Object>} 主机工具响应对象
 */
function waitForSerialHostToolResponse(requestId, signal) {
  return new Promise((resolve) => {
    let settled = false;
    let timeoutId = null;
    let onAbort = null;

    const cleanup = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      if (signal && onAbort) {
        signal.removeEventListener('abort', onAbort);
      }
      pendingSerialHostToolResponses.delete(requestId);
    };

    const finalize = (result) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };

    onAbort = () => {
      finalize({ success: false, error: '会话已中止' });
    };

    if (signal?.aborted) {
      finalize({ success: false, error: '会话已中止' });
      return;
    }

    pendingSerialHostToolResponses.set(requestId, { resolve: finalize });

    timeoutId = setTimeout(() => {
      finalize({ success: false, error: '主机工具请求在 60 秒后超时' });
    }, PERMISSION_RESPONSE_TIMEOUT_MS);

    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

// ---------------------------------------------------------------------------
// 请求处理器（两种模式共用）
// ---------------------------------------------------------------------------
/**
 * 处理请求
 * @param {string} requestId - 请求 ID
 * @param {Object} request - 请求对象
 * @param {string} requestPath - 请求文件路径
 */
async function handleRequest(requestId, request, requestPath) {
  const writer = createStreamWriter(requestId);
  const emit = writer.emit;
  const requestCwd = request.cwd || '/workspace';
  const confirmationMode = request.confirmationMode === 'text' ? 'text' : 'modal';
  const hostWorkspaceRoot = typeof request.hostWorkspaceRoot === 'string'
    ? request.hostWorkspaceRoot.trim()
    : '';
  const workspaceRoot = (() => {
    const rawRoot = typeof request.workspaceRoot === 'string' && request.workspaceRoot.trim()
      ? request.workspaceRoot
      : requestCwd;
    const resolvedRoot = path.resolve(rawRoot);
    try {
      return fs.realpathSync(resolvedRoot);
    } catch {
      return resolvedRoot;
    }
  })();

  const callHostTool = async (toolName, toolInput, signal) => {
    const hostRequestId = randomUUID();
    emit({
      type: 'host_tool_request',
      requestId: hostRequestId,
      toolName,
      toolInput,
    });
    return waitForHostToolResponse(hostRequestId, signal);
  };

  try {
    appendLog(`正在处理请求 ${requestId}`);
    const mountResults = ensureMounts(request.mounts);
    validateWorkspaceMount(request.mounts, mountResults, requestCwd, workspaceRoot);

    const sdk = await import('@anthropic-ai/claude-agent-sdk');
    const sdkVersion = getClaudeSdkVersion();
    const query = sdk.query;
    if (typeof query !== 'function') {
      throw new Error('Claude Agent SDK 查询函数不可用');
    }
    appendLog(`已加载 Claude SDK 版本: ${sdkVersion}`);

    const options = {
      cwd: requestCwd,
      env: buildEnv(request.env),
      pathToClaudeCodeExecutable: require.resolve('@anthropic-ai/claude-agent-sdk/cli.js'),
      includePartialMessages: true,
      permissionMode: 'default',
      stderr: (data) => {
        const line = typeof data === 'string' ? data.trim() : '';
        if (line) {
          appendLog(`claude 标准错误输出: ${line}`);
        }
      },
      canUseTool: async (toolName, toolInput, { signal }) => {
        if (signal?.aborted) {
          return { behavior: 'deny', message: '会话已中止' };
        }

        const resolvedName = String(toolName ?? 'unknown');
        const resolvedInput =
          toolInput && typeof toolInput === 'object'
            ? toolInput
            : { value: toolInput };
        const normalizedInput = normalizeToolInputPaths(
          resolvedName,
          resolvedInput,
          requestCwd,
          request.env,
          hostWorkspaceRoot
        );

        if (isBlockedBuiltinWebTool(resolvedName)) {
          appendLog(`策略阻止的工具: ${resolvedName}`);
          return {
            behavior: 'deny',
            message: '工具被应用策略阻止: WebSearch/WebFetch 在此环境中已禁用。',
          };
        }

        if (request.autoApprove) {
          return { behavior: 'allow', updatedInput: normalizedInput };
        }

        const policyResult = await enforceToolSafetyPolicy({
          emit,
          signal,
          toolName: resolvedName,
          toolInput: normalizedInput,
          cwd: requestCwd,
          workspaceRoot,
          requestEnv: request.env,
        });
        if (policyResult) {
          return policyResult;
        }

        if (resolvedName !== 'AskUserQuestion') {
          return { behavior: 'allow', updatedInput: normalizedInput };
        }

        const permissionRequestId = randomUUID();
        emit({
          type: 'permission_request',
          requestId: permissionRequestId,
          toolName: resolvedName,
          toolInput: normalizedInput,
        });

        const result = await waitForPermissionResponse(permissionRequestId, signal);
        if (signal?.aborted) {
          return { behavior: 'deny', message: '会话已中止' };
        }

        if (result.behavior === 'deny') {
          return result.message ? result : { behavior: 'deny', message: '权限被拒绝' };
        }

        const updatedInput = result.updatedInput ?? normalizedInput;
        const hasAnswers = updatedInput && typeof updatedInput === 'object' && 'answers' in updatedInput;
        if (!hasAnswers) {
          return { behavior: 'deny', message: '未提供答案' };
        }

        return { behavior: 'allow', updatedInput };
      },
    };

    const tool = typeof sdk.tool === 'function'
      ? sdk.tool
      : (name, description, inputSchema, handler) => ({ name, description, inputSchema, handler });
    let createSdkMcpServer = typeof sdk.createSdkMcpServer === 'function'
      ? sdk.createSdkMcpServer
      : null;
    if (!createSdkMcpServer) {
      createSdkMcpServer = buildFallbackMcpServerFactory();
      if (createSdkMcpServer) {
        appendLog(
          `Claude SDK 缺少 createSdkMcpServer 导出（版本=${sdkVersion}）。`
          + '使用来自 @modelcontextprotocol/sdk 的后备 MCP 服务器工厂。'
        );
      }
    }

    if (typeof sdk.tool !== 'function') {
      appendLog(
        `Claude SDK 缺少 tool 导出（版本=${sdkVersion}）。`
        + '使用后备工具定义包装器。'
      );
    }

    if (
      typeof createSdkMcpServer === 'function'
      && typeof tool === 'function'
    ) {
      const memoryServerName = `host-memory-${requestId.slice(0, 8)}`;
      const memoryTools = [
        tool(
          'conversation_search',
          '根据查询搜索历史对话并返回 Claude 风格的 <chat> 块。',
          {
            query: z.string().min(1),
            max_results: z.number().int().min(1).max(10).optional(),
            before: z.string().optional(),
            after: z.string().optional(),
          },
          async (args, { signal }) => {
            const response = await callHostTool('conversation_search', args, signal);
            const text = typeof response?.text === 'string'
              ? response.text
              : typeof response?.error === 'string'
                ? response.error
                : '';
            return {
              content: [{ type: 'text', text }],
              isError: response?.success === false,
            };
          }
        ),
        tool(
          'recent_chats',
          '列出最近的聊天并返回 Claude 风格的 <chat> 块。',
          {
            n: z.number().int().min(1).max(20).optional(),
            sort_order: z.enum(['asc', 'desc']).optional(),
            before: z.string().optional(),
            after: z.string().optional(),
          },
          async (args, { signal }) => {
            const response = await callHostTool('recent_chats', args, signal);
            const text = typeof response?.text === 'string'
              ? response.text
              : typeof response?.error === 'string'
                ? response.error
                : '';
            return {
              content: [{ type: 'text', text }],
              isError: response?.success === false,
            };
          }
        ),
      ];
      if (request.memoryEnabled !== false) {
        memoryTools.push(
          tool(
            'memory_user_edits',
            '管理用户记忆。操作类型: list|add|update|delete。',
            {
              action: z.enum(['list', 'add', 'update', 'delete']),
              id: z.string().optional(),
              text: z.string().optional(),
              confidence: z.number().min(0).max(1).optional(),
              status: z.enum(['created', 'stale', 'deleted']).optional(),
              is_explicit: z.boolean().optional(),
              limit: z.number().int().min(1).max(200).optional(),
              query: z.string().optional(),
            },
            async (args, { signal }) => {
              const response = await callHostTool('memory_user_edits', args, signal);
              const text = typeof response?.text === 'string'
                ? response.text
                : typeof response?.error === 'string'
                  ? response.error
                  : '';
              return {
                content: [{ type: 'text', text }],
                isError: response?.success === false,
              };
            }
          )
        );
      }
      options.mcpServers = {
        ...(options.mcpServers || {}),
        [memoryServerName]: createSdkMcpServer({
          name: memoryServerName,
          tools: memoryTools,
        }),
      };
    } else {
      appendLog(
        `主机记忆/历史工具已禁用，因为 MCP 辅助程序不可用 `
        + `(sdkVersion=${sdkVersion}, exports=${Object.keys(sdk || {}).sort().join(',')})。`
      );
    }

    if (request.sessionId) {
      options.resume = request.sessionId;
    }
    if (request.systemPrompt) {
      options.systemPrompt = request.systemPrompt;
    }

    const result = await query({ prompt: request.prompt || '', options });
    for await (const event of result) {
      emit({ type: 'sdk_event', event });
    }

    // SDK 查询完成后，强制将所有文件同步到主机（仅串口模式）
    forceFullSync();
  } catch (error) {
    appendLog(`请求 ${requestId} 失败: ${error instanceof Error ? error.message : String(error)}`);
    emit({
      type: 'sdk_event',
      event: {
        type: 'result',
        subtype: 'error',
        error: error instanceof Error ? error.message : String(error),
      },
    });
  } finally {
    writer.close();
    if (requestPath) {
      try {
        fs.unlinkSync(requestPath);
      } catch (error) {
        console.error('删除请求文件失败:', error);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 基于文件的 IPC（9p）— 原始轮询循环
// ---------------------------------------------------------------------------
/**
 * 轮询请求
 */
async function pollRequests() {
  ensureDir('/workspace');
  ensureMount('ipc', IPC_ROOT);
  ensureDir(REQUESTS_DIR);
  ensureDir(STREAMS_DIR);
  ensureDir(RESPONSES_DIR);

  // 写入初始心跳并启动心跳间隔
  appendLog('代理运行器已启动，正在轮询请求...');
  updateHeartbeat();
  setInterval(updateHeartbeat, HEARTBEAT_INTERVAL_MS);

  const inflight = new Set();

  while (true) {
    let files = [];
    try {
      files = fs.readdirSync(REQUESTS_DIR).filter((file) => file.endsWith('.json'));
    } catch (error) {
      console.error('读取请求目录失败:', error);
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    files.sort();

    for (const file of files) {
      if (inflight.has(file)) continue;
      inflight.add(file);
      const requestPath = path.join(REQUESTS_DIR, file);
      const requestId = path.basename(file, '.json');
      const request = safeReadJson(requestPath);
      if (request) {
        await handleRequest(requestId, request, requestPath);
      }
      inflight.delete(file);
    }

    await sleep(POLL_INTERVAL_MS);
  }
}

// ---------------------------------------------------------------------------
// 串口 IPC（virtio-serial）— 用于 Windows 主机
// ---------------------------------------------------------------------------
/**
 * 通过串口写入数据
 * @param {Object} data - 要写入的数据对象
 */
function serialWrite(data) {
  if (serialFd === null) return;
  try {
    const line = JSON.stringify(data) + '\n';
    fs.writeSync(serialFd, line);
  } catch (error) {
    appendLog(`串口写入错误: ${error.message}`);
  }
}

/**
 * 查找串口设备
 * @returns {string|null} 串口设备路径，未找到时返回 null
 */
function findSerialDevice() {
  for (const devPath of SERIAL_DEVICE_PATHS) {
    try {
      if (fs.existsSync(devPath)) {
        return devPath;
      }
    } catch { /* 忽略 */ }
  }
  return null;
}

// ---------------------------------------------------------------------------
// 文件同步 — 通过 virtio-serial 实现客户机到主机的文件传输
// ---------------------------------------------------------------------------

// 跟踪已知文件状态以进行变更检测: relativePath -> { mtimeMs, size }
const fileSyncKnown = new Map();

/**
 * 判断路径是否应被忽略
 * @param {string} filePath - 文件路径
 * @returns {boolean} 应忽略返回 true，否则返回 false
 */
function shouldIgnorePath(filePath) {
  const relative = path.relative(WORKSPACE_PROJECT, filePath);
  const parts = relative.split(path.sep);
  return parts.some((part) => FILE_SYNC_IGNORE.includes(part));
}

/**
 * 同步文件到主机
 * @param {string} absPath - 文件绝对路径
 */
function syncFile(absPath) {
  if (shouldIgnorePath(absPath)) return;

  const relativePath = path.relative(WORKSPACE_PROJECT, absPath);

  // 安全检查：拒绝逃逸工作区的路径
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    appendLog(`文件同步: 拒绝工作区外的路径: ${relativePath}`);
    return;
  }

  // 解析符号链接并验证真实路径在工作区内
  try {
    const realPath = fs.realpathSync(absPath);
    if (!realPath.startsWith(WORKSPACE_PROJECT)) {
      appendLog(`文件同步: 跳过工作区外的符号链接: ${absPath} -> ${realPath}`);
      return;
    }
  } catch { /* 如果 realpath 失败，继续使用原始路径 */ }

  let stat;
  try {
    stat = fs.statSync(absPath);
  } catch {
    return; // 文件可能在检测和读取之间被删除
  }

  if (stat.isDirectory()) return; // 目录是隐式创建的

  if (stat.size > FILE_SYNC_MAX_SIZE) {
    appendLog(`文件同步: 跳过超大文件（${stat.size} 字节）: ${relativePath}`);
    return;
  }

  // 使用正斜杠以实现跨平台路径一致性
  const syncPath = relativePath.split(path.sep).join('/');

  if (stat.size <= FILE_SYNC_CHUNK_SIZE) {
    // 单消息传输
    try {
      const data = fs.readFileSync(absPath);
      serialWrite({
        type: 'file_sync',
        path: syncPath,
        data: data.toString('base64'),
        size: stat.size,
      });
    } catch (error) {
      appendLog(`文件同步: 读取 ${relativePath} 失败: ${error.message}`);
    }
  } else {
    // 大文件分块传输
    const transferId = randomUUID();
    const totalChunks = Math.ceil(stat.size / FILE_SYNC_CHUNK_SIZE);
    let fd;
    try {
      fd = fs.openSync(absPath, 'r');
      for (let i = 0; i < totalChunks; i++) {
        const chunkSize = Math.min(FILE_SYNC_CHUNK_SIZE, stat.size - i * FILE_SYNC_CHUNK_SIZE);
        const buf = Buffer.alloc(chunkSize);
        fs.readSync(fd, buf, 0, chunkSize, i * FILE_SYNC_CHUNK_SIZE);
        serialWrite({
          type: 'file_sync_chunk',
          transferId,
          path: syncPath,
          chunkIndex: i,
          totalChunks,
          data: buf.toString('base64'),
        });
      }
    } catch (error) {
      appendLog(`文件同步: ${relativePath} 分块传输失败: ${error.message}`);
      return;
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }
    serialWrite({
      type: 'file_sync_complete',
      transferId,
      path: syncPath,
      totalChunks,
    });
  }

  appendLog(`文件同步: 已发送 ${relativePath}（${stat.size} 字节）`);
}

/**
 * 扫描并同步目录
 * @param {string} dir - 目录路径
 */
function scanAndSyncDir(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (shouldIgnorePath(fullPath)) continue;
    if (entry.isDirectory()) {
      scanAndSyncDir(fullPath);
    } else if (entry.isFile()) {
      try {
        const stat = fs.statSync(fullPath);
        const relativePath = path.relative(WORKSPACE_PROJECT, fullPath);
        const known = fileSyncKnown.get(relativePath);
        if (!known || known.mtimeMs < stat.mtimeMs || known.size !== stat.size) {
          fileSyncKnown.set(relativePath, { mtimeMs: stat.mtimeMs, size: stat.size });
          syncFile(fullPath);
        }
      } catch { /* 文件可能已消失 */ }
    }
  }
}

/**
 * 启动文件同步监视器
 */
function startFileSyncWatcher() {
  if (ipcMode !== 'serial') return;
  ensureDir(WORKSPACE_PROJECT);
  appendLog('文件同步: 启动定期监视器');
  setInterval(() => {
    if (fs.existsSync(WORKSPACE_PROJECT)) {
      scanAndSyncDir(WORKSPACE_PROJECT);
    }
  }, FILE_SYNC_INTERVAL_MS);
}

/**
 * 强制完整同步 /workspace/project/ 中的所有文件。
 * 在每次请求完成后调用，确保不会遗漏任何内容。
 */
function forceFullSync() {
  if (ipcMode !== 'serial') return;
  if (!fs.existsSync(WORKSPACE_PROJECT)) return;
  appendLog('文件同步: 运行强制完整扫描');
  // 清除已知文件以强制重新同步所有内容
  fileSyncKnown.clear();
  scanAndSyncDir(WORKSPACE_PROJECT);
}

// ---------------------------------------------------------------------------
// 主机 → 客户机文件推送（Windows 沙箱的技能文件传输）
// ---------------------------------------------------------------------------
const pendingPushTransfers = new Map();

/**
 * 处理推送文件
 * @param {string} basePath - 基础路径
 * @param {string} relativePath - 相对路径
 * @param {string} base64Data - Base64 编码的数据
 */
function handlePushFile(basePath, relativePath, base64Data) {
  const fullPath = path.join(basePath, relativePath);
  try {
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, Buffer.from(base64Data, 'base64'));
    // 如果文件看起来像脚本，则标记为可执行
    if (/\.(sh|bash)$/.test(relativePath)) {
      try { fs.chmodSync(fullPath, 0o755); } catch { /* 尽力而为 */ }
    }
    appendLog(`收到推送文件: ${relativePath} -> ${fullPath}`);
  } catch (error) {
    appendLog(`推送文件错误 ${relativePath}: ${error.message}`);
  }
}

/**
 * 处理推送文件分块
 * @param {Object} msg - 消息对象
 */
function handlePushFileChunk(msg) {
  const transferId = String(msg.transferId ?? '');
  const relativePath = String(msg.path ?? '');
  const chunkIndex = Number(msg.chunkIndex ?? 0);
  const totalChunks = Number(msg.totalChunks ?? 0);
  const data = String(msg.data ?? '');
  const basePath = String(msg.basePath ?? '');

  if (!transferId || !relativePath || !data || !basePath) return;

  if (!pendingPushTransfers.has(transferId)) {
    pendingPushTransfers.set(transferId, {
      chunks: new Map(),
      totalChunks,
      path: relativePath,
      basePath,
    });
  }

  const transfer = pendingPushTransfers.get(transferId);
  transfer.chunks.set(chunkIndex, Buffer.from(data, 'base64'));

  if (transfer.chunks.size === transfer.totalChunks) {
    assemblePushFile(transferId);
  }
}

/**
 * 处理推送文件完成
 * @param {Object} msg - 消息对象
 */
function handlePushFileComplete(msg) {
  const transferId = String(msg.transferId ?? '');
  if (!transferId) return;

  const transfer = pendingPushTransfers.get(transferId);
  if (transfer && transfer.chunks.size === transfer.totalChunks) {
    assemblePushFile(transferId);
  }

  // 超时后清理不完整的传输
  setTimeout(() => {
    if (pendingPushTransfers.has(transferId)) {
      appendLog(`推送文件: 清理不完整的传输 ${transferId}`);
      pendingPushTransfers.delete(transferId);
    }
  }, 30000);
}

/**
 * 组装推送文件
 * @param {string} transferId - 传输 ID
 */
function assemblePushFile(transferId) {
  const transfer = pendingPushTransfers.get(transferId);
  if (!transfer) return;

  const fullPath = path.join(transfer.basePath, transfer.path);
  try {
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });

    const buffers = [];
    for (let i = 0; i < transfer.totalChunks; i++) {
      const chunk = transfer.chunks.get(i);
      if (!chunk) {
        appendLog(`推送文件: 传输 ${transferId} 缺少分块 ${i}`);
        pendingPushTransfers.delete(transferId);
        return;
      }
      buffers.push(chunk);
    }

    fs.writeFileSync(fullPath, Buffer.concat(buffers));
    if (/\.(sh|bash)$/.test(transfer.path)) {
      try { fs.chmodSync(fullPath, 0o755); } catch { /* 尽力而为 */ }
    }
    appendLog(`收到推送文件（分块）: ${transfer.path} -> ${fullPath}`);
  } catch (error) {
    appendLog(`推送文件（分块）错误 ${transfer.path}: ${error.message}`);
  } finally {
    pendingPushTransfers.delete(transferId);
  }
}

/**
 * 串口 IPC 模式
 * @param {string} serialPath - 串口设备路径
 */
async function serialIpcMode(serialPath) {
  appendLog(`使用 virtio-serial IPC: ${serialPath}`);
  ipcMode = 'serial';
  serialFd = fs.openSync(serialPath, 'r+');

  // 启动心跳
  updateHeartbeat();
  setInterval(updateHeartbeat, HEARTBEAT_INTERVAL_MS);

  // 启动文件同步监视器，用于客户机到主机的文件传输
  startFileSyncWatcher();

  // 从主机读取传入消息（请求、权限响应）
  const readStream = fs.createReadStream(null, { fd: serialFd, autoClose: false });
  const rl = readline.createInterface({ input: readStream });

  rl.on('line', (line) => {
    if (!line.trim()) return;
    let msg;
    try {
      msg = JSON.parse(line.trim());
    } catch {
      return;
    }

    if (msg.type === 'request' && msg.requestId && msg.data) {
      appendLog(`收到串口请求: ${msg.requestId}`);
      handleRequest(msg.requestId, msg.data, null).catch((err) => {
        appendLog(`串口请求 ${msg.requestId} 失败: ${err.message}`);
      });
    }

    if (msg.type === 'permission_response' && msg.requestId) {
      const pending = pendingSerialPermissions.get(msg.requestId);
      if (pending) {
        pendingSerialPermissions.delete(msg.requestId);
        pending.resolve(msg.result || { behavior: 'deny', message: '空响应' });
      }
    }

    if (msg.type === 'host_tool_response' && msg.requestId) {
      const pending = pendingSerialHostToolResponses.get(msg.requestId);
      if (pending) {
        pendingSerialHostToolResponses.delete(msg.requestId);
        pending.resolve(msg);
      }
    }

    // 主机 → 客户机文件推送（用于在 Windows 上传输技能文件）
    if (msg.type === 'push_file' && msg.basePath && msg.path && msg.data) {
      handlePushFile(msg.basePath, msg.path, msg.data);
    }

    if (msg.type === 'push_file_chunk') {
      handlePushFileChunk(msg);
    }

    if (msg.type === 'push_file_complete') {
      handlePushFileComplete(msg);
    }
  });

  rl.on('close', () => {
    appendLog('串口读取行已关闭');
  });

  // 保持进程运行
  await new Promise(() => {});
}

// ---------------------------------------------------------------------------
// 主入口点
// ---------------------------------------------------------------------------
/**
 * 主函数
 */
async function main() {
  ensureDir('/workspace');

  // 首先尝试 9p 挂载
  ensureMount('ipc', IPC_ROOT);

  if (isMounted(IPC_ROOT)) {
    appendLog('IPC 已通过 9p 挂载，使用基于文件的 IPC');
    await pollRequests();
    return;
  }

  // 9p 不可用 — 检查 virtio-serial 设备
  appendLog('9p 挂载失败，正在检查 virtio-serial 设备...');
  tryModprobe(['virtio_console']);

  // 模块加载后短暂等待设备出现
  for (let i = 0; i < 10; i++) {
    const serialPath = findSerialDevice();
    if (serialPath) {
      await serialIpcMode(serialPath);
      return;
    }
    await sleep(500);
  }

  // 两种 IPC 机制都不可用 — 回退到文件轮询
  // （心跳将报告 ipcMounted=false）
  appendLog('未找到 virtio-serial 设备，回退到基于文件的 IPC');
  await pollRequests();
}

main().catch((error) => {
  console.error('代理运行器崩溃:', error);
  process.exit(1);
});
