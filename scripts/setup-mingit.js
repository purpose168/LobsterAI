#!/usr/bin/env node
/**
 * 为 Windows 打包/运行时准备 PortableGit（包含 bash.exe），放置于 resources/mingit 目录下。
 *
 * 功能特性：
 * - 跨平台执行（macOS/Linux 可以为 Windows 打包准备资源）
 * - 可选严格模式：--required（如果未准备好则构建失败）
 * - 通过 LOBSTERAI_PORTABLE_GIT_ARCHIVE 环境变量支持离线归档
 * - 通过 LOBSTERAI_PORTABLE_GIT_URL 环境变量支持镜像 URL 覆盖
 * - 通过 7zip-bin (path7za) 进行统一解压
 */

'use strict';

// 引入 Node.js 核心模块
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

// Git 版本号配置
const GIT_VERSION = '2.47.1';
// PortableGit 文件名（64位版本）
const PORTABLE_GIT_FILE = `PortableGit-${GIT_VERSION}-64-bit.7z.exe`;
// 默认的 PortableGit 下载 URL
const DEFAULT_PORTABLE_GIT_URL =
  `https://github.com/git-for-windows/git/releases/download/v${GIT_VERSION}.windows.1/${PORTABLE_GIT_FILE}`;

// 项目根目录（当前脚本所在目录的上一级）
const PROJECT_ROOT = path.resolve(__dirname, '..');
// 输出目录：PortableGit 解压后的目标位置
const OUTPUT_DIR = path.join(PROJECT_ROOT, 'resources', 'mingit');
// 默认归档文件路径：下载后保存的位置
const DEFAULT_ARCHIVE_PATH = path.join(PROJECT_ROOT, 'resources', PORTABLE_GIT_FILE);

// 需要清理的目录和文件列表（用于减小最终体积）
// 这些目录包含文档、手册页等非必要文件，可以安全删除
const DIRS_TO_PRUNE = [
  'doc',                                              // 文档目录
  'ReleaseNotes.html',                                // 发布说明文件
  'README.portable',                                  // 便携版说明文件
  path.join('mingw64', 'doc'),                        // MinGW64 文档目录
  path.join('mingw64', 'share', 'doc'),               // MinGW64 共享文档目录
  path.join('mingw64', 'share', 'gtk-doc'),           // GTK 文档目录
  path.join('mingw64', 'share', 'man'),               // 手册页目录
  path.join('mingw64', 'share', 'gitweb'),            // GitWeb 界面文件
  path.join('mingw64', 'share', 'git-gui'),           // Git GUI 图形界面文件
  path.join('mingw64', 'libexec', 'git-core', 'git-gui'),           // Git GUI 可执行文件
  path.join('mingw64', 'libexec', 'git-core', 'git-gui--askpass'),  // Git GUI 密码提示程序
  path.join('usr', 'share', 'doc'),                   // usr 共享文档目录
  path.join('usr', 'share', 'man'),                   // usr 手册页目录
  path.join('usr', 'share', 'vim'),                   // Vim 编辑器文件
  path.join('usr', 'share', 'perl5'),                 // Perl5 共享文件
  path.join('usr', 'lib', 'perl5'),                   // Perl5 库文件
];

/**
 * 解析命令行参数
 * @param {string[]} argv - 命令行参数数组
 * @returns {Object} 解析后的参数对象
 */
function parseArgs(argv) {
  return {
    required: argv.includes('--required'),  // 是否启用严格模式
  };
}

/**
 * 解析输入路径，将相对路径转换为绝对路径
 * @param {string} input - 输入路径字符串
 * @returns {string|null} 绝对路径，如果输入无效则返回 null
 */
function resolveInputPath(input) {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  // 如果已经是绝对路径则直接返回，否则基于当前工作目录转换为绝对路径
  return path.isAbsolute(trimmed) ? trimmed : path.resolve(process.cwd(), trimmed);
}

/**
 * 检查文件是否存在且非空
 * @param {string} filePath - 文件路径
 * @returns {boolean} 如果文件存在且大小大于 0 则返回 true
 */
function isNonEmptyFile(filePath) {
  try {
    return fs.statSync(filePath).isFile() && fs.statSync(filePath).size > 0;
  } catch {
    return false;
  }
}

/**
 * 递归计算目录的总大小
 * @param {string} dir - 目录路径
 * @returns {number} 目录总大小（字节）
 */
function getDirSize(dir) {
  let size = 0;
  // 遍历目录中的所有条目
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // 如果是目录，递归计算
      size += getDirSize(full);
    } else {
      // 如果是文件，累加文件大小
      size += fs.statSync(full).size;
    }
  }
  return size;
}

/**
 * 解析并获取 7zip 可执行文件路径
 * @returns {string} 7za 可执行文件的绝对路径
 * @throws {Error} 如果 7zip-bin 未安装或可执行文件不存在
 */
function resolve7zaPath() {
  let path7za;
  try {
    // 尝试加载 7zip-bin 模块
    ({ path7za } = require('7zip-bin'));
  } catch (error) {
    throw new Error(
      '缺少依赖项 "7zip-bin"。请运行 npm install 后重试。'
      + `原始错误：${error instanceof Error ? error.message : String(error)}`
    );
  }

  // 验证可执行文件是否存在
  if (!path7za || !fs.existsSync(path7za)) {
    throw new Error(`7zip-bin 可执行文件未找到：${path7za || '(路径为空)'}`);
  }

  return path7za;
}

/**
 * 在指定目录中查找 PortableGit 的 bash.exe 文件
 * @param {string} baseDir - 基础搜索目录，默认为 OUTPUT_DIR
 * @returns {string|null} bash.exe 的完整路径，如果未找到则返回 null
 */
function findPortableGitBash(baseDir = OUTPUT_DIR) {
  // 可能的 bash.exe 位置候选
  const candidates = [
    path.join(baseDir, 'bin', 'bash.exe'),        // 主 bin 目录
    path.join(baseDir, 'usr', 'bin', 'bash.exe'), // usr/bin 目录
  ];

  // 遍历候选路径，返回第一个存在的路径
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

/**
 * 从指定 URL 下载归档文件到目标路径
 * @param {string} url - 下载 URL
 * @param {string} destination - 目标文件路径
 * @throws {Error} 如果下载失败或文件为空
 */
async function downloadArchive(url, destination) {
  // 发起 HTTP 请求，自动跟随重定向
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok || !response.body) {
    throw new Error(`下载失败 (${response.status} ${response.statusText})，URL：${url}`);
  }

  // 确保目标目录存在
  fs.mkdirSync(path.dirname(destination), { recursive: true });

  // 使用临时文件名进行下载，下载完成后再重命名
  const tmpFile = `${destination}.download`;
  try {
    const stream = fs.createWriteStream(tmpFile);
    // 使用流式传输下载文件
    await pipeline(Readable.fromWeb(response.body), stream);

    // 验证下载的文件是否非空
    if (!isNonEmptyFile(tmpFile)) {
      throw new Error('下载的归档文件为空。');
    }

    // 下载成功，重命名临时文件为最终文件名
    fs.renameSync(tmpFile, destination);
  } catch (error) {
    // 清理临时文件（忽略清理错误）
    try {
      fs.rmSync(tmpFile, { force: true });
    } catch {
      // 忽略清理错误
    }
    throw error;
  }
}

/**
 * 清理不需要的文件和目录以减小最终体积
 * 删除文档、手册页等非运行时必需的文件
 */
function pruneUnneededFiles() {
  let prunedCount = 0;
  for (const relPath of DIRS_TO_PRUNE) {
    const fullPath = path.join(OUTPUT_DIR, relPath);
    if (!fs.existsSync(fullPath)) continue;
    try {
      // 递归删除目录或文件
      fs.rmSync(fullPath, { recursive: true, force: true });
      prunedCount++;
    } catch (error) {
      console.warn(`[setup-mingit] 警告：无法删除 ${relPath}：${error instanceof Error ? error.message : String(error)}`);
    }
  }
  console.log(`[setup-mingit] 已清理 ${prunedCount} 个条目。`);
}

/**
 * 使用 7zip 解压归档文件到输出目录
 * @param {string} archivePath - 归档文件的完整路径
 * @throws {Error} 如果解压失败
 */
function extractArchive(archivePath) {
  // 获取 7zip 可执行文件路径
  const sevenZip = resolve7zaPath();
  // 如果输出目录已存在，先删除
  if (fs.existsSync(OUTPUT_DIR)) {
    fs.rmSync(OUTPUT_DIR, { recursive: true, force: true });
  }
  // 创建新的输出目录
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  console.log(`[setup-mingit] 正在使用 7zip-bin 解压归档：${archivePath}`);
  // 使用 7zip 解压文件
  // 参数说明：x = 解压，-o = 输出目录，-y = 自动确认覆盖
  const result = spawnSync(sevenZip, ['x', archivePath, `-o${OUTPUT_DIR}`, '-y'], {
    stdio: 'inherit',  // 继承标准输入输出，显示解压进度
  });

  // 检查解压是否成功
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`7zip 解压失败，退出码：${result.status}`);
  }
}

/**
 * 解析并获取 PortableGit 归档文件
 * 按优先级尝试：环境变量指定 > 本地缓存 > 下载
 * @param {boolean} required - 是否严格要求成功
 * @returns {Object|null} 归档信息对象，包含路径和来源；如果跳过则返回 null
 */
async function resolveArchive(required) {
  // 优先级 1：检查环境变量 LOBSTERAI_PORTABLE_GIT_ARCHIVE
  const envArchive = resolveInputPath(process.env.LOBSTERAI_PORTABLE_GIT_ARCHIVE);
  if (envArchive) {
    if (!isNonEmptyFile(envArchive)) {
      throw new Error(
        `LOBSTERAI_PORTABLE_GIT_ARCHIVE 指向无效文件：${envArchive}`
      );
    }
    console.log(`[setup-mingit] 使用环境变量 LOBSTERAI_PORTABLE_GIT_ARCHIVE 指定的本地归档：${envArchive}`);
    return { archivePath: envArchive, source: 'env-archive' };
  }

  // 优先级 2：检查本地缓存文件
  if (isNonEmptyFile(DEFAULT_ARCHIVE_PATH)) {
    console.log(`[setup-mingit] 使用缓存的归档文件：${DEFAULT_ARCHIVE_PATH}`);
    return { archivePath: DEFAULT_ARCHIVE_PATH, source: 'cache' };
  }

  // 优先级 3：从网络下载
  const urlFromEnv = typeof process.env.LOBSTERAI_PORTABLE_GIT_URL === 'string'
    ? process.env.LOBSTERAI_PORTABLE_GIT_URL.trim()
    : '';
  // 使用环境变量中的 URL 或默认 URL
  const downloadUrl = urlFromEnv || DEFAULT_PORTABLE_GIT_URL;

  try {
    console.log(`[setup-mingit] 正在从以下地址下载 PortableGit：${downloadUrl}`);
    await downloadArchive(downloadUrl, DEFAULT_ARCHIVE_PATH);
    const fileSizeMB = (fs.statSync(DEFAULT_ARCHIVE_PATH).size / 1024 / 1024).toFixed(1);
    console.log(`[setup-mingit] 下载完成 (${fileSizeMB} MB)：${DEFAULT_ARCHIVE_PATH}`);
    return { archivePath: DEFAULT_ARCHIVE_PATH, source: 'download' };
  } catch (error) {
    // 如果是严格模式，下载失败则抛出错误
    if (required) {
      throw new Error(
        '无法获取 PortableGit 归档文件。'
        + '请设置 LOBSTERAI_PORTABLE_GIT_ARCHIVE 环境变量指向本地离线包，或 '
        + '设置 LOBSTERAI_PORTABLE_GIT_URL 环境变量指向可访问的镜像地址。'
        + `原始错误：${error instanceof Error ? error.message : String(error)}`
      );
    }

    // 非严格模式下，仅输出警告并跳过
    console.warn(
      '[setup-mingit] PortableGit 归档文件不可用；因未设置 --required 参数而跳过。'
      + `原因：${error instanceof Error ? error.message : String(error)}`
    );
    return null;
  }
}

/**
 * 确保 PortableGit 已准备好
 * 主入口函数，协调整个准备流程
 * @param {Object} options - 配置选项
 * @param {boolean} options.required - 是否严格要求成功（非 Windows 平台也会执行）
 * @returns {Object} 结果对象，包含状态和 bash 路径信息
 */
async function ensurePortableGit(options = {}) {
  const required = Boolean(options.required);
  // 判断是否需要执行：
  // 1. Windows 平台自动执行
  // 2. 设置了 --required 参数强制执行
  // 3. 设置了 LOBSTERAI_SETUP_MINGIT_FORCE=1 环境变量强制执行
  const shouldRun = process.platform === 'win32' || required || process.env.LOBSTERAI_SETUP_MINGIT_FORCE === '1';

  if (!shouldRun) {
    console.log('[setup-mingit] 在非 Windows 主机上跳过（使用 --required 参数可强制跨平台准备）。');
    return { ok: true, skipped: true, bashPath: null };
  }

  // 检查是否已经准备好
  const existingBash = findPortableGitBash();
  if (existingBash) {
    console.log(`[setup-mingit] PortableGit 已准备就绪：${existingBash}`);
    return { ok: true, skipped: false, bashPath: existingBash };
  }

  // 获取归档文件
  const archive = await resolveArchive(required);
  if (!archive) {
    return { ok: true, skipped: true, bashPath: null };
  }

  // 解压归档文件
  extractArchive(archive.archivePath);
  // 验证 bash.exe 是否存在
  const resolvedBash = findPortableGitBash();
  if (!resolvedBash) {
    throw new Error(
      'PortableGit 解压完成但未找到 bash.exe。'
      + `已检查路径：${path.join(OUTPUT_DIR, 'bin', 'bash.exe')} 和 ${path.join(OUTPUT_DIR, 'usr', 'bin', 'bash.exe')}`
    );
  }

  // 清理不需要的文件
  pruneUnneededFiles();

  // 计算并显示最终大小
  const finalSize = getDirSize(OUTPUT_DIR);
  console.log(`[setup-mingit] PortableGit 准备完成：${resolvedBash}`);
  console.log(`[setup-mingit] 总大小：约 ${(finalSize / 1024 / 1024).toFixed(1)} MB`);

  return { ok: true, skipped: false, bashPath: resolvedBash };
}

/**
 * 主函数：解析命令行参数并执行准备流程
 */
async function main() {
  const args = parseArgs(process.argv.slice(2));
  await ensurePortableGit({ required: args.required });
}

// 如果作为独立脚本运行，则执行主函数
if (require.main === module) {
  main().catch((error) => {
    console.error('[setup-mingit] 错误：', error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

// 导出模块接口，供其他模块调用
module.exports = {
  ensurePortableGit,   // 确保 PortableGit 准备就绪的主函数
  findPortableGitBash, // 查找 bash.exe 路径的工具函数
};
