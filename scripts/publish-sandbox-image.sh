#!/bin/bash
# -*- coding: utf-8 -*-
#
# 沙箱镜像发布脚本
# 用途：将构建好的沙箱镜像文件复制到发布目录，并生成SHA256校验和文件
# 作者：purpose168@outlook.com
# 创建日期：2026-02-21
#
# 使用方法：
#   ./publish-sandbox-image.sh <版本号>
#   或设置环境变量 COWORK_SANDBOX_IMAGE_VERSION
#
# 功能说明：
#   1. 从输入目录读取构建好的镜像文件（qcow2格式）
#   2. 复制镜像文件、内核文件和initramfs文件到发布目录
#   3. 为每个文件生成SHA256校验和
#   4. 生成汇总的SHA256SUMS文件
#

# 设置严格的错误处理模式
# -e: 命令出错时立即退出
# -u: 使用未定义变量时报错
# -o pipefail: 管道中的命令出错时，整个管道返回失败状态
set -euo pipefail

# ============================================================================
# 目录和变量配置
# ============================================================================

# 获取脚本所在目录的父目录作为项目根目录
# BASH_SOURCE[0]：当前脚本的路径
# dirname：获取目录部分
# cd ... && pwd：切换到该目录并获取绝对路径
ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

# 输入目录：存放构建好的镜像文件
# 使用默认值语法：${变量名:-默认值}，如果变量未设置则使用默认值
INPUT_DIR=${INPUT_DIR:-"${ROOT_DIR}/sandbox/image/out"}

# 版本号：优先使用命令行参数，其次使用环境变量
# $1：脚本的第一个参数
# ${变量名:-默认值}：如果变量未设置或为空，则使用默认值（这里默认值为空）
VERSION=${1:-${COWORK_SANDBOX_IMAGE_VERSION:-}}

# 输出基础目录：发布文件的存放位置
OUTPUT_BASE=${OUTPUT_BASE:-"${ROOT_DIR}/sandbox/image/publish"}

# ============================================================================
# 参数验证
# ============================================================================

# 检查版本号是否已设置
if [ -z "${VERSION}" ]; then
  echo "使用方法: $0 <版本号>" >&2
  echo "或设置环境变量 COWORK_SANDBOX_IMAGE_VERSION" >&2
  exit 1
fi

# 检查输入目录是否存在
# -d：判断是否为目录
if [ ! -d "${INPUT_DIR}" ]; then
  echo "错误：输入目录不存在: ${INPUT_DIR}" >&2
  exit 1
fi

# ============================================================================
# 准备输出目录
# ============================================================================

# 创建版本特定的输出目录
# mkdir -p：递归创建目录，如果目录已存在则不报错
OUT_DIR="${OUTPUT_BASE}/${VERSION}"
mkdir -p "${OUT_DIR}"

# ============================================================================
# 检测SHA256校验和工具
# ============================================================================

# 检测系统中可用的SHA256校验和工具
# command -v：检查命令是否存在
# >/dev/null 2>&1：将标准输出和标准错误都重定向到空设备（不显示任何输出）
if command -v sha256sum >/dev/null 2>&1; then
  # Linux系统通常使用sha256sum
  HASH_CMD=(sha256sum)
elif command -v shasum >/dev/null 2>&1; then
  # macOS系统通常使用shasum，需要指定-a 256参数
  HASH_CMD=(shasum -a 256)
else
  echo "错误：缺少 sha256sum 或 shasum 工具" >&2
  exit 1
fi

# ============================================================================
# 复制镜像文件并生成校验和
# ============================================================================

# 标记是否找到至少一个镜像文件
found=0

# 遍历支持的CPU架构：amd64（x86_64）和arm64（aarch64）
for arch in amd64 arm64; do
  # ------------------------------------------------------------------------
  # 复制qcow2镜像文件
  # ------------------------------------------------------------------------
  # 源文件路径：输入目录下的linux-{架构}.qcow2
  src="${INPUT_DIR}/linux-${arch}.qcow2"
  # 目标文件路径：输出目录下的image-linux-{架构}.qcow2
  dest="${OUT_DIR}/image-linux-${arch}.qcow2"
  
  # 检查源文件是否存在
  if [ -f "${src}" ]; then
    # -f：强制覆盖已存在的目标文件
    cp -f "${src}" "${dest}"
    found=1
  else
    echo "警告：缺少文件 ${src}" >&2
  fi
  
  # 如果目标文件存在，生成SHA256校验和文件
  # 校验和文件格式：文件名.sha256
  if [ -f "${dest}" ]; then
    "${HASH_CMD[@]}" "${dest}" > "${dest}.sha256"
  fi

  # ------------------------------------------------------------------------
  # 复制内核文件（vmlinuz-virt）
  # ------------------------------------------------------------------------
  # vmlinuz-virt：Alpine Linux的虚拟化优化内核
  kernel_src="${INPUT_DIR}/vmlinuz-virt-${arch}"
  kernel_dest="${OUT_DIR}/vmlinuz-virt-${arch}"
  
  if [ -f "${kernel_src}" ]; then
    cp -f "${kernel_src}" "${kernel_dest}"
    # 生成内核文件的SHA256校验和
    "${HASH_CMD[@]}" "${kernel_dest}" > "${kernel_dest}.sha256"
  fi

  # ------------------------------------------------------------------------
  # 复制initramfs文件（initramfs-virt）
  # ------------------------------------------------------------------------
  # initramfs-virt：Alpine Linux的虚拟化优化初始内存文件系统
  # initramfs包含系统启动所需的驱动和工具
  initrd_src="${INPUT_DIR}/initramfs-virt-${arch}"
  initrd_dest="${OUT_DIR}/initramfs-virt-${arch}"
  
  if [ -f "${initrd_src}" ]; then
    cp -f "${initrd_src}" "${initrd_dest}"
    # 生成initramfs文件的SHA256校验和
    "${HASH_CMD[@]}" "${initrd_dest}" > "${initrd_dest}.sha256"
  fi
done

# ============================================================================
# 验证和汇总
# ============================================================================

# 检查是否至少找到一个qcow2镜像文件
if [ "${found}" -eq 0 ]; then
  echo "错误：在 ${INPUT_DIR} 中未找到任何qcow2镜像文件" >&2
  exit 1
fi

# 生成汇总的SHA256SUMS文件
# 该文件包含所有镜像文件、内核文件和initramfs文件的校验和
# 使用子shell ( ... ) 在目标目录中执行命令，避免影响当前工作目录
(
  cd "${OUT_DIR}"
  # ls命令检查文件是否存在，>/dev/null 2>&1 隐藏输出
  if ls image-linux-*.qcow2 vmlinuz-virt-* initramfs-virt-* >/dev/null 2>&1; then
    # 生成汇总校验和文件
    # 通配符匹配所有相关文件
    "${HASH_CMD[@]}" image-linux-*.qcow2 vmlinuz-virt-* initramfs-virt-* > SHA256SUMS
  fi
)

# ============================================================================
# 输出发布信息
# ============================================================================

# 使用here document输出多行信息
# <<EOF ... EOF：here document语法，用于输出多行文本
cat <<EOF
发布目录: ${OUT_DIR}

预期的CDN布局:
  ${OUT_DIR}/image-linux-amd64.qcow2
  ${OUT_DIR}/image-linux-arm64.qcow2

环境变量配置:
  COWORK_SANDBOX_BASE_URL=<https://your.cdn/cowork/sandbox>
  COWORK_SANDBOX_IMAGE_VERSION=${VERSION}
EOF

# ============================================================================
# 脚本执行完成
# ============================================================================
# 
# 输出文件说明：
#   - image-linux-{arch}.qcow2：虚拟机镜像文件（qcow2格式）
#   - image-linux-{arch}.qcow2.sha256：镜像文件的SHA256校验和
#   - vmlinuz-virt-{arch}：Linux内核文件
#   - vmlinuz-virt-{arch}.sha256：内核文件的SHA256校验和
#   - initramfs-virt-{arch}：初始内存文件系统
#   - initramfs-virt-{arch}.sha256：initramfs的SHA256校验和
#   - SHA256SUMS：所有文件的汇总校验和文件
#
# 使用场景：
#   此脚本用于将构建好的沙箱镜像发布到CDN或镜像仓库，
#   供CoWork沙箱环境使用。每个文件都附带SHA256校验和，
#   确保文件传输的完整性和安全性。
#
# 注意事项：
#   1. 确保输入目录中包含所有必要的文件
#   2. 版本号应该唯一且有意义（如：v1.0.0、20260221等）
#   3. 发布后请验证SHA256校验和是否正确
#   4. 建议将发布目录同步到CDN或对象存储服务
