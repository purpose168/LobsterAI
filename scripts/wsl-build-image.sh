#!/bin/bash
# ============================================================================
# 脚本名称：wsl-build-image.sh
# 用途：在WSL环境中构建沙箱虚拟机镜像
# 作者：purpose168@outlook.com
# 创建日期：2026-02-21
# ============================================================================

# 设置严格的错误处理模式
# -e: 当命令返回非零状态码时立即退出脚本
# -u: 使用未定义的变量时视为错误
# -o pipefail: 管道中任何一个命令失败时，整个管道返回失败状态
set -euo pipefail

echo "============================================"
echo " 沙箱虚拟机镜像构建器 (WSL环境)"
echo "============================================"

# ============================================================================
# 变量定义部分
# ============================================================================

# 项目根目录路径（WSL挂载的Windows D盘路径）
PROJECT=/mnt/d/project/lobsterai

# 构建根目录（临时工作目录，用于存放构建过程中的文件）
BROOT=/root/sandbox-build

# 输出目录（最终生成的镜像文件存放位置）
OUTDIR=$PROJECT/sandbox/image/out

# ============================================================================
# [步骤1/6] 准备构建目录
# ============================================================================
echo "[1/6] 正在准备构建目录..."

# 删除旧的构建目录（如果存在）
# rm -rf: 递归强制删除，不提示确认
rm -rf "$BROOT"

# 创建构建所需的目录结构
# mkdir -p: 递归创建目录，如果父目录不存在则一并创建
mkdir -p "$BROOT/sandbox/image"
mkdir -p "$BROOT/sandbox/agent-runner"

# 复制镜像构建脚本到构建目录
cp "$PROJECT/sandbox/image/build.sh" "$BROOT/sandbox/image/build.sh"

# 复制overlay目录（包含系统配置文件和自定义文件）
# -r: 递归复制整个目录
cp -r "$PROJECT/sandbox/image/overlay" "$BROOT/sandbox/image/overlay"

# 复制agent-runner相关文件到构建目录
cp "$PROJECT/sandbox/agent-runner/index.js" "$BROOT/sandbox/agent-runner/"
cp "$PROJECT/sandbox/agent-runner/package.json" "$BROOT/sandbox/agent-runner/"

# 如果存在系统提示词文件，也一并复制
# -f: 检查文件是否存在
if [ -f "$PROJECT/sandbox/agent-runner/AGENT_SYSTEM_PROMPT.md" ]; then
    cp "$PROJECT/sandbox/agent-runner/AGENT_SYSTEM_PROMPT.md" "$BROOT/sandbox/agent-runner/"
fi

# ============================================================================
# [步骤2/6] 修复行尾符格式
# ============================================================================
echo "[2/6] 正在修复行尾符格式（使用dos2unix）..."

# 将Windows格式的行尾符（CRLF）转换为Unix格式（LF）
# find命令: 查找指定目录下的文件
# -type f: 只查找文件（不包括目录）
# -name "*.sh" -o -name "*.js": 查找.sh或.js文件
# -exec dos2unix -q {} +: 对找到的文件执行dos2unix命令
#   -q: 安静模式，不显示转换信息
#   {}: find命令找到的文件名占位符
#   +: 将多个文件名传递给一个dos2unix命令（提高效率）
find "$BROOT" -type f \( -name "*.sh" -o -name "*.js" -o -name "*.json" -o -name "*.md" \) -exec dos2unix -q {} +

# 修复overlay/etc目录下所有配置文件的行尾符
find "$BROOT/sandbox/image/overlay/etc" -type f -exec dos2unix -q {} +

# 为构建脚本添加可执行权限
# chmod +x: 添加执行权限
chmod +x "$BROOT/sandbox/image/build.sh"

# ============================================================================
# [步骤3/6] 显示构建文件列表
# ============================================================================
echo "[3/6] 构建文件列表："

# 列出构建目录中的所有文件（最多显示前20个）
# head -20: 只显示前20行输出
find "$BROOT" -type f | head -20
echo ""

# ============================================================================
# [步骤4/6] 启动镜像构建
# ============================================================================
echo "[4/6] 正在启动镜像构建（架构：amd64）..."

# 创建输出目录（如果不存在）
mkdir -p "$OUTDIR"

# 切换到构建脚本所在目录
cd "$BROOT/sandbox/image"

# 执行构建脚本，设置环境变量：
# ARCHS=amd64: 指定目标架构为amd64（64位x86架构）
# AGENT_RUNNER_BUILD=auto: 自动构建agent-runner
# OUT_DIR="$OUTDIR": 指定输出目录
ARCHS=amd64 AGENT_RUNNER_BUILD=auto OUT_DIR="$OUTDIR" ./build.sh

# ============================================================================
# [步骤5/6] 检查构建输出
# ============================================================================
echo ""
echo "[5/6] 正在检查构建输出..."

# 检查生成的镜像文件是否存在
if [ -f "$OUTDIR/linux-amd64.qcow2" ]; then
    # 获取文件大小（字节）
    # stat -c%s: 获取文件大小（以字节为单位）
    SIZE=$(stat -c%s "$OUTDIR/linux-amd64.qcow2")
    echo "  成功：linux-amd64.qcow2（大小：$SIZE 字节）"
else
    # 文件不存在，构建失败
    echo "  错误：未找到输出文件！"
    # 列出输出目录中的文件（如果目录存在）
    # 2>/dev/null: 将错误输出重定向到空设备（忽略错误）
    # || true: 即使ls命令失败，也继续执行（避免脚本因错误退出）
    ls -la "$OUTDIR/" 2>/dev/null || true
    exit 1
fi

# ============================================================================
# [步骤6/6] 清理临时文件
# ============================================================================
echo "[6/6] 正在清理临时文件..."

# 删除构建目录，释放磁盘空间
rm -rf "$BROOT"

echo "构建完成！"
