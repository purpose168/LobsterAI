#!/bin/bash
# -*- coding: utf-8 -*-
# ============================================================================
# 脚本名称：build-sandbox-image-win-on-mac.sh
# 用途：在macOS系统上构建Windows沙箱镜像
# 作者：LobsterAI Team
# 联系方式：purpose168@outlook.com
# 创建日期：2024
# 说明：此脚本专门为macOS系统设计，支持Apple Silicon和Intel架构
# ============================================================================

# 设置严格的错误处理模式
# -e: 命令出错时立即退出
# -u: 使用未定义变量时报错
# -o pipefail: 管道中的命令失败时，整个管道返回失败状态
set -euo pipefail

# ============================================================================
# 变量定义部分
# ============================================================================

# 获取脚本所在目录的父目录（项目根目录）
# BASH_SOURCE[0]：当前脚本的路径
# dirname：获取目录路径
# cd ... && pwd：切换到该目录并获取绝对路径
ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

# Docker构建脚本的路径
DOCKER_SCRIPT="${ROOT_DIR}/scripts/build-sandbox-image-docker.sh"

# ============================================================================
# 帮助信息函数
# ============================================================================

# 显示脚本使用说明
# 使用heredoc语法（<<'EOF'）输出多行文本
# 单引号包围EOF可以防止变量替换，保持文本原样输出
usage() {
  cat <<'EOF'
使用方法：
  ./scripts/build-sandbox-image-win-on-mac.sh [--tool docker|podman]

选项说明：
  -t, --tool   指定容器工具（docker 或 podman）。如果省略，则自动检测。
  -h, --help   显示此帮助信息。

功能说明：
  此脚本用于在macOS系统上构建Windows沙箱镜像。
  支持Apple Silicon（M1/M2/M3）和Intel架构的Mac设备。
  自动检测并使用已安装的容器工具（Docker或Podman）。

示例：
  # 自动检测容器工具
  ./scripts/build-sandbox-image-win-on-mac.sh

  # 指定使用docker
  ./scripts/build-sandbox-image-win-on-mac.sh --tool docker

  # 指定使用podman
  ./scripts/build-sandbox-image-win-on-mac.sh -t podman
EOF
}

# ============================================================================
# 系统环境检查
# ============================================================================

# 检查是否在macOS系统上运行
# uname命令返回操作系统名称，Darwin是macOS的内核名称
if [ "$(uname)" != "Darwin" ]; then
  echo "错误：此脚本仅适用于macOS系统。" >&2
  exit 1
fi

# 检查Docker构建脚本是否存在且可执行
# -x：检查文件是否存在且具有可执行权限
if [ ! -x "${DOCKER_SCRIPT}" ]; then
  echo "错误：缺少可执行脚本：${DOCKER_SCRIPT}" >&2
  exit 1
fi

# ============================================================================
# 命令行参数解析
# ============================================================================

# 初始化容器工具变量
CONTAINER_TOOL=""

# 使用while循环解析命令行参数
# $#：参数个数
# $# -gt 0：参数个数大于0
while [ $# -gt 0 ]; do
  case "$1" in
    # 处理 -t 或 --tool 选项（参数值在下一个位置）
    -t|--tool)
      # 检查是否提供了参数值
      if [ $# -lt 2 ]; then
        echo "错误：选项 $1 缺少参数值" >&2
        usage
        exit 1
      fi
      CONTAINER_TOOL="$2"
      shift 2  # 移动两个位置（跳过选项名和参数值）
      ;;
    # 处理 --tool=value 格式的选项
    --tool=*)
      # ${1#*=}：删除变量值中第一个=及其前面的所有字符，提取=后面的值
      CONTAINER_TOOL="${1#*=}"
      shift  # 移动一个位置
      ;;
    # 处理帮助选项
    -h|--help)
      usage
      exit 0
      ;;
    # 处理未知选项
    *)
      echo "错误：未知参数 '$1'" >&2
      usage
      exit 1
      ;;
  esac
done

# ============================================================================
# 容器工具自动检测
# ============================================================================

# 如果未指定容器工具，则自动检测
if [ -z "${CONTAINER_TOOL}" ]; then
  # command -v：检查命令是否存在
  # >/dev/null 2>&1：将标准输出和错误输出重定向到空设备（不显示输出）
  if command -v docker >/dev/null 2>&1; then
    CONTAINER_TOOL=docker
  elif command -v podman >/dev/null 2>&1; then
    CONTAINER_TOOL=podman
  else
    echo "错误：未找到 docker 或 podman。请安装其中之一后继续。" >&2
    exit 1
  fi
fi

# ============================================================================
# 容器工具验证
# ============================================================================

# 验证容器工具是否为支持的类型
if [ "${CONTAINER_TOOL}" != "docker" ] && [ "${CONTAINER_TOOL}" != "podman" ]; then
  echo "错误：不支持的容器工具 '${CONTAINER_TOOL}'。请使用 docker 或 podman。" >&2
  exit 1
fi

# 检查容器工具命令是否可用
if ! command -v "${CONTAINER_TOOL}" >/dev/null 2>&1; then
  echo "错误：未找到 ${CONTAINER_TOOL} 命令。" >&2
  # 如果是docker，提供下载链接
  if [ "${CONTAINER_TOOL}" = "docker" ]; then
    echo "下载地址：https://www.docker.com/products/docker-desktop/" >&2
  fi
  exit 1
fi

# ============================================================================
# 容器服务状态检查
# ============================================================================

# 检查容器服务是否正在运行
# docker info 或 podman info 命令需要守护进程运行才能成功
if ! "${CONTAINER_TOOL}" info >/dev/null 2>&1; then
  if [ "${CONTAINER_TOOL}" = "docker" ]; then
    echo "错误：Docker Desktop 未运行。请启动 Docker Desktop 后重试。" >&2
  else
    echo "错误：podman 虚拟机未运行。请启动后重试。" >&2
    echo "提示：运行命令 'podman machine start'" >&2
  fi
  exit 1
fi

# ============================================================================
# 架构检测与镜像构建
# ============================================================================

# 获取主机架构信息
# uname -m：显示机器硬件名称
# 常见值：arm64（Apple Silicon）、aarch64（ARM 64位）、x86_64（Intel 64位）
HOST_ARCH=$(uname -m)

# 根据架构类型选择构建方式
if [ "${HOST_ARCH}" = "arm64" ] || [ "${HOST_ARCH}" = "aarch64" ]; then
  # Apple Silicon（M1/M2/M3芯片）架构处理
  # Windows沙箱使用linux-amd64镜像
  # 在Apple Silicon上需要通过QEMU模拟运行amd64容器
  echo "检测到 Apple Silicon 处理器。正在通过 ${CONTAINER_TOOL} 使用模拟的 linux/amd64 容器构建 linux-amd64 镜像..."

  # 设置环境变量并调用Docker构建脚本
  # CONTAINER_TOOL：指定容器工具
  # CONTAINER_PLATFORM：指定容器平台（linux/amd64）
  # ARCHS：指定目标架构（amd64）
  CONTAINER_TOOL="${CONTAINER_TOOL}" CONTAINER_PLATFORM=linux/amd64 ARCHS=amd64 "${DOCKER_SCRIPT}"

elif [ "${HOST_ARCH}" = "x86_64" ]; then
  # Intel Mac 架构处理
  # Intel Mac原生支持amd64架构，无需模拟
  echo "检测到 Intel Mac。正在使用 ${CONTAINER_TOOL} 构建 linux-amd64 镜像..."

  # 设置环境变量并调用Docker构建脚本
  # Intel Mac不需要指定CONTAINER_PLATFORM，因为架构原生支持
  CONTAINER_TOOL="${CONTAINER_TOOL}" ARCHS=amd64 "${DOCKER_SCRIPT}"

else
  # 不支持的架构
  echo "错误：不支持的 macOS 架构 '${HOST_ARCH}'。" >&2
  exit 1
fi

# ============================================================================
# 构建完成提示
# ============================================================================

echo "构建完成。Windows 沙箱镜像已生成在："
echo "  ${ROOT_DIR}/sandbox/image/out/linux-amd64.qcow2"
