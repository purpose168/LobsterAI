#!/usr/bin/env node

/**
 * 托盘图标生成脚本
 * 
 * 此脚本用于从源Logo图像生成各平台所需的托盘图标文件：
 * - Linux: PNG格式图标
 * - Windows: ICO格式图标（包含多种尺寸）
 * - macOS: 模板图标（黑白）和彩色图标（标准分辨率和高清分辨率）
 * 
 * 依赖：需要安装ImageMagick（magick或convert命令）
 * 
 * 使用方法：
 *   node generate-tray-icons.js [输入图片路径]
 *   如果不指定输入图片路径，默认使用 public/logo.png
 */

// 导入Node.js核心模块
const fs = require('fs');         // 文件系统操作模块
const os = require('os');         // 操作系统工具模块
const path = require('path');     // 路径处理模块
const { spawnSync } = require('child_process');  // 子进程同步执行模块

// 解析项目根目录路径
const projectRoot = path.resolve(__dirname, '..');

// 解析输入图片路径（从命令行参数获取，或使用默认值）
const inputPath = path.resolve(projectRoot, process.argv[2] || 'public/logo.png');

// 设置输出目录路径
const outputDir = path.resolve(projectRoot, 'resources/tray');

/**
 * 执行外部命令
 * @param {string} cmd - 要执行的命令
 * @param {string[]} args - 命令参数数组
 * @throws {Error} 如果命令执行失败则抛出错误
 */
function run(cmd, args) {
  // 同步执行命令，捕获标准输出和标准错误
  const result = spawnSync(cmd, args, { stdio: 'pipe', encoding: 'utf8' });
  
  // 检查命令执行状态
  if (result.status !== 0) {
    const stderr = result.stderr?.trim();
    const stdout = result.stdout?.trim();
    const detail = stderr || stdout || `退出码 ${result.status}`;
    throw new Error(`${cmd} ${args.join(' ')} 执行失败: ${detail}`);
  }
}

/**
 * 检查系统中是否存在指定命令
 * @param {string} cmd - 要检查的命令
 * @param {string[]} args - 用于测试命令的参数
 * @returns {boolean} 如果命令可用则返回true，否则返回false
 */
function hasCommand(cmd, args) {
  // 尝试执行命令，忽略输出
  const result = spawnSync(cmd, args, { stdio: 'ignore' });
  return result.status === 0;
}

/**
 * 确保ImageMagick已安装并返回可用的命令名称
 * @returns {string} ImageMagick命令名称（'magick' 或 'convert'）
 * @throws {Error} 如果未找到ImageMagick则抛出错误
 */
function ensureImageMagick() {
  // 优先使用新版ImageMagick的magick命令
  if (hasCommand('magick', ['-version'])) return 'magick';
  // 兼容旧版ImageMagick的convert命令
  if (hasCommand('convert', ['-version'])) return 'convert';
  throw new Error('需要安装ImageMagick。请安装 `magick` 或 `convert` 命令。');
}

/**
 * 确保输入图片文件存在
 * @throws {Error} 如果输入文件不存在则抛出错误
 */
function ensureInputExists() {
  if (!fs.existsSync(inputPath)) {
    throw new Error(`未找到输入Logo文件: ${inputPath}`);
  }
}

/**
 * 确保输出目录存在，如果不存在则创建
 */
function ensureOutputDir() {
  // 递归创建输出目录（包括所有父目录）
  fs.mkdirSync(outputDir, { recursive: true });
}

/**
 * 主函数：生成各平台的托盘图标
 */
function main() {
  // 验证输入文件和输出目录
  ensureInputExists();
  ensureOutputDir();
  
  // 获取ImageMagick命令
  const magick = ensureImageMagick();
  
  // 创建临时目录用于存放中间文件
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tray-icons-'));

  // 定义Windows图标所需的各尺寸PNG文件路径
  const win16 = path.join(tmpDir, 'tray-16.png');
  const win32 = path.join(tmpDir, 'tray-32.png');
  const win48 = path.join(tmpDir, 'tray-48.png');

  // 定义最终输出的图标文件路径
  const linuxPng = path.join(outputDir, 'tray-icon.png');              // Linux平台PNG图标
  const winIco = path.join(outputDir, 'tray-icon.ico');                // Windows平台ICO图标
  const macTemplate = path.join(outputDir, 'trayIconTemplate.png');    // macOS模板图标（标准分辨率）
  const macTemplate2x = path.join(outputDir, 'trayIconTemplate@2x.png'); // macOS模板图标（高清分辨率）
  const macColor = path.join(outputDir, 'tray-icon-mac.png');          // macOS彩色图标（标准分辨率）
  const macColor2x = path.join(outputDir, 'tray-icon-mac@2x.png');     // macOS彩色图标（高清分辨率）
  const macColorRaw = path.join(tmpDir, 'tray-icon-mac-raw.png');      // macOS彩色图标临时文件（标准分辨率）
  const macColor2xRaw = path.join(tmpDir, 'tray-icon-mac@2x-raw.png'); // macOS彩色图标临时文件（高清分辨率）

  // 生成Linux平台托盘图标（48x48 PNG格式）
  run(magick, [inputPath, '-resize', '48x48', linuxPng]);

  // 生成Windows平台所需的各尺寸PNG文件
  run(magick, [inputPath, '-resize', '16x16', win16]);
  run(magick, [inputPath, '-resize', '32x32', win32]);
  run(magick, [inputPath, '-resize', '48x48', win48]);
  
  // 将多个PNG文件打包成Windows ICO图标文件
  run(magick, [win16, win32, win48, winIco]);

  // macOS模板图标生成说明：
  // 将白色龙虾图案转换为不透明像素，同时将红色背景强制设为完全透明，
  // 然后将图案居中并添加小边距，以避免菜单栏裁剪。
  // macOS会自动根据系统主题（浅色/深色）调整模板图标的颜色。
  
  // 生成macOS模板图标（标准分辨率 18x18）
  run(magick, [
    inputPath, '-resize', '18x18',
    '-colorspace', 'Gray', '-threshold', '70%',      // 转换为灰度并应用阈值
    '-alpha', 'copy',                                 // 复制灰度通道到Alpha通道
    '-channel', 'RGB', '-fill', 'black', '-colorize', '100',  // 用黑色填充RGB通道
    '-trim', '+repage',                               // 裁剪空白边缘
    '-background', 'none', '-gravity', 'center', '-extent', '18x18',  // 居中并扩展到18x18
    macTemplate,
  ]);

  // 生成macOS模板图标（高清分辨率 36x36）
  run(magick, [
    inputPath, '-resize', '36x36',
    '-colorspace', 'Gray', '-threshold', '70%',
    '-alpha', 'copy',
    '-channel', 'RGB', '-fill', 'black', '-colorize', '100',
    '-trim', '+repage',
    '-background', 'none', '-gravity', 'center', '-extent', '36x36',
    macTemplate2x,
  ]);

  // macOS彩色托盘图标生成说明：
  // 保留原始品牌颜色，用于需要彩色图标的场景。
  
  // 生成macOS彩色图标（标准分辨率）
  // 处理步骤：裁剪空白 -> 调整大小 -> 调整亮度和对比度 -> 居中放置
  run(magick, [
    inputPath,
    '-trim', '+repage',                               // 裁剪空白边缘
    '-resize', '16x16',                               // 调整到16x16
    '-modulate', '108,118,100',                       // 调整亮度(108%)、饱和度(118%)、色相(100%)
    '-sigmoidal-contrast', '4,50%',                   // 应用S形对比度调整，增强视觉效果
    '-background', 'none', '-gravity', 'center', '-extent', '18x18',  // 居中并扩展到18x18
    macColorRaw,
  ]);

  // 生成macOS彩色图标（高清分辨率）
  run(magick, [
    inputPath,
    '-trim', '+repage',
    '-resize', '32x32',                               // 调整到32x32
    '-modulate', '108,118,100',
    '-sigmoidal-contrast', '4,50%',
    '-background', 'none', '-gravity', 'center', '-extent', '36x36',  // 居中并扩展到36x36
    macColor2xRaw,
  ]);

  // 将临时PNG文件转换为标准PNG格式（确保正确的颜色空间和Alpha通道）
  run(magick, [
    macColorRaw,
    '-alpha', 'on',                                   // 启用Alpha通道
    '-colorspace', 'sRGB',                            // 设置为sRGB颜色空间
    '-type', 'TrueColorAlpha',                        // 设置为真彩色带Alpha
    '-strip',                                         // 移除所有元数据
    '-define', 'png:color-type=6',                    // 设置PNG颜色类型为RGBA
    macColor,
  ]);

  run(magick, [
    macColor2xRaw,
    '-alpha', 'on',
    '-colorspace', 'sRGB',
    '-type', 'TrueColorAlpha',
    '-strip',
    '-define', 'png:color-type=6',
    macColor2x,
  ]);

  // 清理临时目录及其所有内容
  fs.rmSync(tmpDir, { recursive: true, force: true });
  
  // 输出成功信息
  console.log(`已成功生成托盘图标: ${inputPath} -> ${outputDir}`);
}

// 执行主函数，捕获并处理可能的错误
try {
  main();
} catch (error) {
  // 输出错误信息并退出
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
