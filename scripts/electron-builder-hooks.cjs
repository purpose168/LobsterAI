'use strict';

/**
 * Electron Builder 钩子模块
 * 
 * 该模块提供了 electron-builder 打包过程中的自定义钩子函数，
 * 用于在打包前后执行特定的配置和验证操作。
 * 
 * 主要功能：
 * - Windows 平台：确保 PortableGit 正确打包
 * - macOS 平台：修复 Apple Silicon 兼容性图标问题
 */

// 导入 Node.js 核心模块
const path = require('path');           // 路径处理模块
const { existsSync } = require('fs');   // 文件系统同步检查模块
const { spawnSync } = require('child_process');  // 子进程同步执行模块

// 导入本地模块
const { ensurePortableGit } = require('./setup-mingit.js');  // PortableGit 配置模块

/**
 * 检查当前构建目标是否为 Windows 平台
 * 
 * @param {Object} context - electron-builder 提供的构建上下文对象
 * @param {string} context.electronPlatformName - 目标平台名称（'win32', 'darwin', 'linux' 等）
 * @returns {boolean} 如果目标平台是 Windows 返回 true，否则返回 false
 */
function isWindowsTarget(context) {
  return context?.electronPlatformName === 'win32';
}

/**
 * 检查当前构建目标是否为 macOS 平台
 * 
 * @param {Object} context - electron-builder 提供的构建上下文对象
 * @param {string} context.electronPlatformName - 目标平台名称（'win32', 'darwin', 'linux' 等）
 * @returns {boolean} 如果目标平台是 macOS 返回 true，否则返回 false
 */
function isMacTarget(context) {
  return context?.electronPlatformName === 'darwin';
}

/**
 * 在打包后的应用目录中查找 PortableGit 提供的 bash.exe 路径
 * 
 * 该函数会在应用的 resources/mingit 目录下搜索 bash.exe，
 * 支持两种可能的安装路径结构。
 * 
 * @param {string} appOutDir - 打包后应用的输出目录路径
 * @returns {string|null} 找到的 bash.exe 完整路径，如果未找到则返回 null
 */
function findPackagedBash(appOutDir) {
  // 定义可能的 bash.exe 路径候选
  const candidates = [
    path.join(appOutDir, 'resources', 'mingit', 'bin', 'bash.exe'),      // 直接在 bin 目录下
    path.join(appOutDir, 'resources', 'mingit', 'usr', 'bin', 'bash.exe'), // 在 usr/bin 目录下
  ];

  // 遍历候选路径，返回第一个存在的路径
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  // 所有候选路径都不存在，返回 null
  return null;
}

/**
 * 应用 macOS 图标修复，解决 Apple Silicon 兼容性问题
 * 
 * 该函数执行以下操作：
 * 1. 检查并添加 CFBundleIconName 到 Info.plist（Apple Silicon 需要）
 * 2. 清除扩展属性（xattr）
 * 3. 更新应用和资源目录的修改时间
 * 
 * 这些修复确保应用在 Apple Silicon Mac 上正确显示图标。
 * 
 * @param {string} appPath - macOS 应用包（.app）的完整路径
 */
function applyMacIconFix(appPath) {
  console.log('[electron-builder-hooks] 正在应用 macOS 图标修复以兼容 Apple Silicon...');

  // 定义关键文件路径
  const infoPlistPath = path.join(appPath, 'Contents', 'Info.plist');  // Info.plist 文件路径
  const resourcesPath = path.join(appPath, 'Contents', 'Resources');   // 资源目录路径
  const iconPath = path.join(resourcesPath, 'icon.icns');              // 图标文件路径

  // 检查 Info.plist 文件是否存在
  if (!existsSync(infoPlistPath)) {
    console.warn(`[electron-builder-hooks] 未找到 Info.plist 文件：${infoPlistPath}`);
    return;
  }

  // 检查图标文件是否存在
  if (!existsSync(iconPath)) {
    console.warn(`[electron-builder-hooks] 未找到 icon.icns 图标文件：${iconPath}`);
    return;
  }

  // 检查 CFBundleIconName 是否已存在
  const checkResult = spawnSync('plutil', [
    '-extract', 'CFBundleIconName', 'raw', infoPlistPath
  ], { encoding: 'utf-8' });

  if (checkResult.status !== 0) {
    // CFBundleIconName 不存在，需要添加
    console.log('[electron-builder-hooks] 正在向 Info.plist 添加 CFBundleIconName...');
    const addResult = spawnSync('plutil', [
      '-insert', 'CFBundleIconName', '-string', 'icon', infoPlistPath
    ], { encoding: 'utf-8' });

    if (addResult.status === 0) {
      console.log('[electron-builder-hooks] ✓ CFBundleIconName 添加成功');
    } else {
      console.warn('[electron-builder-hooks] 添加 CFBundleIconName 失败：', addResult.stderr);
    }
  } else {
    console.log('[electron-builder-hooks] ✓ CFBundleIconName 已存在');
  }

  // 清除扩展属性（解决某些 macOS 安全限制问题）
  spawnSync('xattr', ['-cr', appPath], { encoding: 'utf-8' });

  // 更新应用和资源目录的修改时间（触发系统重新识别）
  spawnSync('touch', [appPath], { encoding: 'utf-8' });
  spawnSync('touch', [resourcesPath], { encoding: 'utf-8' });

  console.log('[electron-builder-hooks] ✓ macOS 图标修复已应用');
}

/**
 * 打包前钩子函数
 * 
 * 在 electron-builder 开始打包前执行。对于 Windows 目标平台，
 * 确保 PortableGit 已正确准备和配置。
 * 
 * @param {Object} context - electron-builder 提供的构建上下文对象
 * @param {string} context.electronPlatformName - 目标平台名称
 * @param {string} context.appOutDir - 应用输出目录
 * @returns {Promise<void>}
 */
async function beforePack(context) {
  // 仅对 Windows 目标平台执行操作
  if (!isWindowsTarget(context)) {
    return;
  }

  console.log('[electron-builder-hooks] 检测到 Windows 目标平台，正在准备 PortableGit...');
  await ensurePortableGit({ required: true });
}

/**
 * 打包后钩子函数
 * 
 * 在 electron-builder 完成打包后执行。执行以下验证和修复：
 * - Windows：验证 PortableGit bash.exe 是否正确打包
 * - macOS：应用图标修复以支持 Apple Silicon
 * 
 * @param {Object} context - electron-builder 提供的构建上下文对象
 * @param {string} context.electronPlatformName - 目标平台名称
 * @param {string} context.appOutDir - 应用输出目录
 * @param {Object} context.packager - 打包器对象
 * @returns {Promise<void>}
 * @throws {Error} 如果 Windows 打包缺少必需的 bash.exe 文件
 */
async function afterPack(context) {
  // 处理 Windows 平台的验证
  if (isWindowsTarget(context)) {
    const bashPath = findPackagedBash(context.appOutDir);
    if (!bashPath) {
      // bash.exe 未找到，抛出错误
      throw new Error(
        'Windows 打包缺少内置的 PortableGit bash.exe。'
        + '预期位置为：'
        + `${path.join(context.appOutDir, 'resources', 'mingit', 'bin', 'bash.exe')} 或 `
        + `${path.join(context.appOutDir, 'resources', 'mingit', 'usr', 'bin', 'bash.exe')}`
      );
    }

    console.log(`[electron-builder-hooks] 已验证内置 PortableGit：${bashPath}`);
  }

  // 处理 macOS 平台的图标修复
  if (isMacTarget(context)) {
    const appName = context.packager.appInfo.productFilename;  // 获取应用名称
    const appPath = path.join(context.appOutDir, `${appName}.app`);  // 构建 .app 路径

    if (existsSync(appPath)) {
      applyMacIconFix(appPath);
    } else {
      console.warn(`[electron-builder-hooks] 未在 ${appPath} 找到应用，跳过图标修复`);
    }
  }
}

// 导出钩子函数，供 electron-builder 配置文件使用
module.exports = {
  beforePack,   // 打包前钩子
  afterPack,    // 打包后钩子
};
