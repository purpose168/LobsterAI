#!/usr/bin/env bash
# ============================================================================
# 脚本名称：build-runtime-macos.sh
# 用途：为 macOS 构建运行时环境
# 作者：LobsterAI 团队
# 创建日期：2026-02-21
# 联系方式：purpose168@outlook.com
# ============================================================================
#
# 功能说明：
#   本脚本用于在 macOS 系统上构建 QEMU 运行时环境，支持 arm64 和 x64 两种架构。
#   它会自动检测系统架构，安装必要的依赖，并将 QEMU 二进制文件及其依赖库打包
#   成可分发的运行时包。
#
# 使用方法：
#   ./build-runtime-macos.sh [环境变量选项]
#
# 环境变量：
#   OUT_DIR      - 输出目录路径（默认：$ROOT_DIR/sandbox/runtime/out）
#   ARCH         - 目标架构（arm64 或 x64，默认：当前系统架构）
#   BREW_PREFIX  - Homebrew 安装路径（默认：自动检测）
#
# 依赖工具：
#   - Homebrew（macOS 包管理器）
#   - qemu（虚拟化软件）
#   - dylibbundler（动态库打包工具）
#
# 输出文件：
#   - runtime-darwin-$ARCH/        - 运行时目录
#   - runtime-darwin-$ARCH.tar.gz  - 压缩包
#   - runtime-darwin-$ARCH.tar.gz.sha256 - SHA256 校验文件
# ============================================================================

# 设置严格的错误处理模式
# -e: 命令失败时立即退出
# -u: 使用未定义变量时报错
# -o pipefail: 管道中任一命令失败则整个管道失败
set -euo pipefail

# ============================================================================
# 路径和目录配置
# ============================================================================

# 获取脚本所在目录的父目录的父目录，即项目根目录
# ${BASH_SOURCE[0]} - 当前脚本的完整路径
# dirname - 获取目录路径
# cd ... && pwd - 切换到该目录并获取绝对路径
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# 设置输出目录，优先使用环境变量 OUT_DIR，否则使用默认路径
# ${OUT_DIR:-默认值} - 如果 OUT_DIR 已设置且非空则使用其值，否则使用默认值
OUT_DIR="${OUT_DIR:-$ROOT_DIR/sandbox/runtime/out}"

# ============================================================================
# 架构检测与配置
# ============================================================================

# 获取目标架构，优先使用环境变量 ARCH，否则使用当前系统架构
# uname -m 显示当前机器硬件名称
ARCH_INPUT="${ARCH:-$(uname -m)}"

# 根据输入架构设置对应的配置
case "$ARCH_INPUT" in
  arm64|aarch64)
    # ARM64 架构配置
    ARCH="arm64"
    QEMU_BIN="qemu-system-aarch64"
    ;;
  x86_64|amd64|x64)
    # x64 架构配置（支持多种命名方式）
    ARCH="x64"
    QEMU_BIN="qemu-system-x86_64"
    ;;
  *)
    # 不支持的架构，输出错误信息到标准错误流（>&2）
    echo "错误：不支持的架构类型: $ARCH_INPUT" >&2
    echo "支持的架构：arm64, aarch64, x86_64, amd64, x64" >&2
    exit 1
    ;;
esac

# ============================================================================
# 依赖检查
# ============================================================================

# 检查 Homebrew 是否已安装
# command -v 用于检查命令是否存在
# >/dev/null 2>&1 将标准输出和标准错误都重定向到 /dev/null（静默模式）
if ! command -v brew >/dev/null 2>&1; then
  echo "错误：未找到 Homebrew。请先安装 Homebrew 和 qemu。" >&2
  echo "安装方法：请访问 https://brew.sh 获取安装说明" >&2
  exit 1
fi

# 获取 QEMU 的 Homebrew 安装路径
# 优先使用环境变量 BREW_PREFIX，否则尝试自动检测
# 2>/dev/null || true 表示即使命令失败也不报错（返回空字符串）
BREW_PREFIX="${BREW_PREFIX:-$(brew --prefix qemu 2>/dev/null || true)}"

# 验证 QEMU 安装路径是否存在
if [[ -z "$BREW_PREFIX" || ! -d "$BREW_PREFIX" ]]; then
  echo "错误：qemu 未安装。请运行以下命令安装：" >&2
  echo "  brew install qemu" >&2
  exit 1
fi

# 检查 QEMU 二进制文件是否存在且可执行
# -x 测试文件是否存在且具有可执行权限
if [[ ! -x "$BREW_PREFIX/bin/$QEMU_BIN" ]]; then
  echo "错误：未找到预期的 QEMU 二进制文件: $BREW_PREFIX/bin/$QEMU_BIN" >&2
  echo "提示：如果在 arm64 系统上构建 x64 版本，请在 /usr/local 下安装 x86 版本的 Homebrew，" >&2
  echo "      并设置 BREW_PREFIX 环境变量指向该路径。" >&2
  exit 1
fi

# 检查 dylibbundler 工具是否已安装
# dylibbundler 用于打包动态库依赖
if ! command -v dylibbundler >/dev/null 2>&1; then
  echo "错误：未找到 dylibbundler。请运行以下命令安装：" >&2
  echo "  brew install dylibbundler" >&2
  exit 1
fi

# ============================================================================
# 构建过程
# ============================================================================

# 创建临时暂存目录
# mktemp -d 创建临时目录，${TMPDIR:-/tmp} 优先使用环境变量 TMPDIR
# XXXXXX 会被替换为随机字符，确保目录名唯一
STAGING="$(mktemp -d "${TMPDIR:-/tmp}/lobsterai-runtime-${ARCH}.XXXXXX")"

# 设置退出时自动清理临时目录
# trap 命令用于捕获信号，EXIT 是脚本退出时触发的信号
# rm -rf 递归强制删除目录
trap 'rm -rf "$STAGING"' EXIT

echo "=========================================="
echo "开始构建 macOS $ARCH 运行时环境"
echo "=========================================="
echo "项目根目录: $ROOT_DIR"
echo "输出目录: $OUT_DIR"
echo "目标架构: $ARCH"
echo "QEMU 二进制: $QEMU_BIN"
echo "Homebrew 路径: $BREW_PREFIX"
echo "暂存目录: $STAGING"
echo "=========================================="

# 创建运行时目录结构
# mkdir -p 递归创建目录，如果目录已存在则不报错
mkdir -p "$STAGING/bin" "$STAGING/lib" "$STAGING/share"

# 复制 QEMU 二进制文件到暂存目录
cp "$BREW_PREFIX/bin/$QEMU_BIN" "$STAGING/bin/"

# 复制 QEMU 共享资源文件（如 BIOS、固件等）
# -R 表示递归复制整个目录
cp -R "$BREW_PREFIX/share/qemu" "$STAGING/share/"

# 设置二进制文件的完整路径变量
BIN="$STAGING/bin/$QEMU_BIN"

echo "正在处理动态库依赖..."

# 使用 dylibbundler 打包动态库依赖
# 参数说明：
#   -b              - 批处理模式，不提示确认
#   -x "$BIN"       - 指定要处理的可执行文件
#   -d "$STAGING/lib" - 指定输出库文件的目标目录
#   -p "@rpath"     - 将库的安装名称前缀设置为 @rpath（macOS 动态库查找路径）
#   -s 路径         - 添加库搜索路径（可多次使用）
dylibbundler -b -x "$BIN" -d "$STAGING/lib" -p "@rpath" \
  -s "$BREW_PREFIX/lib" -s "$BREW_PREFIX/opt" \
  -s "/usr/local/lib" -s "/opt/homebrew/lib"

# 修改可执行文件的 rpath，使其能找到相对路径的库文件
# install_name_tool 是 macOS 专用的二进制文件修改工具
# -add_rpath 添加运行时库搜索路径
# @loader_path 表示可执行文件所在目录
# ../lib 表示相对于可执行文件的 lib 目录
install_name_tool -add_rpath "@loader_path/../lib" "$BIN"

echo "动态库依赖处理完成"

# ============================================================================
# 打包输出
# ============================================================================

# 设置最终输出目录路径
DEST_DIR="$OUT_DIR/runtime-darwin-$ARCH"

# 清理旧的输出目录（如果存在）
rm -rf "$DEST_DIR"

# 创建输出目录的父目录
mkdir -p "$OUT_DIR"

# 将暂存目录的所有内容复制到最终输出目录
# 注意：使用 "$STAGING/." 可以复制目录内容而非目录本身
cp -R "$STAGING/." "$DEST_DIR/"

echo "运行时目录已创建: $DEST_DIR"

# 创建压缩包
# tar -czf 创建 gzip 压缩的 tar 归档文件
# -C "$DEST_DIR" 切换到目标目录后再打包（不包含目录名）
TARBALL="$OUT_DIR/runtime-darwin-$ARCH.tar.gz"
tar -czf "$TARBALL" -C "$DEST_DIR" .

echo "压缩包已创建: $TARBALL"

# 生成 SHA256 校验文件（如果 shasum 命令可用）
# shasum -a 256 计算 SHA256 哈希值
if command -v shasum >/dev/null 2>&1; then
  shasum -a 256 "$TARBALL" > "$TARBALL.sha256"
  echo "SHA256 校验值: $(cat "$TARBALL.sha256")"
fi

# ============================================================================
# 构建完成
# ============================================================================

echo "=========================================="
echo "构建成功完成！"
echo "=========================================="
echo "输出文件: $TARBALL"
echo "校验文件: $TARBALL.sha256"
echo "运行时目录: $DEST_DIR"
echo "=========================================="
