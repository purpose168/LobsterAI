/**
 * 从源 PNG 图片生成多尺寸的 .ico 图标文件
 *
 * ICO 文件格式说明（内嵌 PNG 数据）：
 *   ICONDIR  (6 字节)  – 保留字段(2) + 类型(2)=1 + 图像数量(2)
 *   ICONDIRENTRY * N (每个 16 字节) - 图像目录条目
 *   PNG 数据块 - 实际的图像数据
 *
 * 实现原理：
 * 通过 PowerShell 调用 System.Drawing 库将源图像调整为多种尺寸，
 * 保存为临时 PNG 文件，然后使用 Node.js Buffer 将它们打包成 .ico 格式。
 */

// 导入必要的 Node.js 核心模块
const fs = require('fs');                    // 文件系统操作模块
const path = require('path');                // 路径处理模块
const { execSync } = require('child_process'); // 同步执行命令模块

// 定义源文件和输出路径
const SOURCE = path.join(__dirname, '..', 'public', 'logo.png');  // 源 PNG 文件路径
const OUT_DIR = path.join(__dirname, '..', 'build', 'icons', 'win'); // 输出目录
const OUT_ICO = path.join(OUT_DIR, 'icon.ico');  // 输出的 .ico 文件路径
const SIZES = [256, 128, 64, 48, 32, 16];        // 需要生成的图标尺寸列表

// 确保输出目录存在，如果不存在则递归创建
fs.mkdirSync(OUT_DIR, { recursive: true });

// 步骤 1: 使用 PowerShell + System.Drawing 库调整源 PNG 图片尺寸
const tmpDir = path.join(__dirname, '..', 'build', 'icons', '_tmp'); // 临时目录
fs.mkdirSync(tmpDir, { recursive: true }); // 创建临时目录

// PowerShell 脚本：使用 System.Drawing 库调整图像尺寸
// 注意：PowerShell 脚本内容保持英文，因为这是 Windows 系统命令
const psScript = `
Add-Type -AssemblyName System.Drawing

$src = [System.Drawing.Image]::FromFile("${SOURCE.replace(/\\/g, '\\\\')}")  # 加载源图像
$sizes = @(${SIZES.join(',')})  # 定义目标尺寸数组

# 遍历每个尺寸，生成对应的 PNG 文件
foreach ($s in $sizes) {
    $bmp = New-Object System.Drawing.Bitmap($s, $s)  # 创建指定尺寸的位图
    $g = [System.Drawing.Graphics]::FromImage($bmp)  # 创建绘图对象
    
    # 设置高质量图像处理参数
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic  # 高质量双三次插值
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality  # 高质量平滑模式
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality  # 高质量像素偏移
    $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality  # 高质量合成
    
    # 将源图像绘制到目标尺寸的位图上
    $g.DrawImage($src, 0, 0, $s, $s)
    $g.Dispose()  # 释放绘图资源
    
    # 保存为 PNG 文件
    $outPath = "${tmpDir.replace(/\\/g, '\\\\')}\\\\icon_$s.png"
    $bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()  # 释放位图资源
}

$src.Dispose()  # 释放源图像资源
`;

// 将 PowerShell 脚本写入临时文件
const psFile = path.join(tmpDir, 'resize.ps1');
fs.writeFileSync(psFile, psScript, 'utf8');

// 执行 PowerShell 脚本，绕过执行策略
execSync(`powershell -ExecutionPolicy Bypass -File "${psFile}"`, { stdio: 'inherit' });

// 步骤 2: 读取调整尺寸后的 PNG 文件并打包成 ICO 格式
const pngBuffers = SIZES.map(s => {
  const p = path.join(tmpDir, `icon_${s}.png`);  // PNG 文件路径
  return { size: s, data: fs.readFileSync(p) };  // 返回尺寸和文件数据
});

// 计算 ICO 文件结构参数
const count = pngBuffers.length;        // 图像数量
const headerSize = 6;                   // ICONDIR 头部大小（6 字节）
const entrySize = 16;                   // 每个 ICONDIRENTRY 的大小（16 字节）
const dataOffset0 = headerSize + entrySize * count;  // 图像数据的起始偏移量

// 计算每个图像在 ICO 文件中的偏移量
let currentOffset = dataOffset0;
const entries = pngBuffers.map(({ size, data }) => {
  const entry = {
    width: size >= 256 ? 0 : size,   // ICO 格式中，256 像素用 0 表示
    height: size >= 256 ? 0 : size,  // ICO 格式中，256 像素用 0 表示
    dataSize: data.length,           // 图像数据大小
    offset: currentOffset,           // 图像数据偏移量
    data,                            // 图像数据
  };
  currentOffset += data.length;      // 更新下一个图像的偏移量
  return entry;
});

// 构建 ICO 文件缓冲区
const totalSize = currentOffset;      // ICO 文件总大小
const ico = Buffer.alloc(totalSize);  // 分配缓冲区

// 写入 ICONDIR 头部（6 字节）
ico.writeUInt16LE(0, 0);        // 保留字段，必须为 0
ico.writeUInt16LE(1, 2);        // 类型字段，1 表示 ICO 格式
ico.writeUInt16LE(count, 4);    // 图像数量

// 写入每个图像的 ICONDIRENTRY（每个 16 字节）
entries.forEach((e, i) => {
  const off = headerSize + i * entrySize;  // 计算当前条目的偏移量
  ico.writeUInt8(e.width, off + 0);       // 图像宽度（像素）
  ico.writeUInt8(e.height, off + 1);      // 图像高度（像素）
  ico.writeUInt8(0, off + 2);             // 颜色调色板大小（0 表示无调色板）
  ico.writeUInt8(0, off + 3);             // 保留字段，必须为 0
  ico.writeUInt16LE(1, off + 4);          // 颜色平面数（应为 0 或 1）
  ico.writeUInt16LE(32, off + 6);         // 每像素位数（32 位表示 RGBA）
  ico.writeUInt32LE(e.dataSize, off + 8); // 图像数据大小（字节）
  ico.writeUInt32LE(e.offset, off + 12);  // 图像数据偏移量（字节）
});

// 写入图像数据
entries.forEach(e => {
  e.data.copy(ico, e.offset);  // 将 PNG 数据复制到 ICO 缓冲区
});

// 将 ICO 文件写入磁盘
fs.writeFileSync(OUT_ICO, ico);
console.log(`已生成 ${OUT_ICO} (${SIZES.join(', ')}px) — ${ico.length} 字节`);

// 清理临时文件和目录
fs.rmSync(tmpDir, { recursive: true, force: true });
