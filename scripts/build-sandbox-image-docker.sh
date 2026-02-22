#!/bin/bash
# ============================================================================
# 脚本名称：build-sandbox-image-docker.sh
# 脚本用途：使用Docker/Podman容器构建LobsterAI沙箱镜像
# 创建日期：2026-02-21
# 联系方式：purpose168@outlook.com
# ============================================================================
# 功能说明：
#   本脚本用于在容器环境中构建沙箱磁盘镜像，支持Docker和Podman两种容器工具。
#   主要功能包括：
#   - 自动检测可用的容器工具（优先Docker，其次Podman）
#   - 构建沙箱镜像构建器容器镜像
#   - 在特权模式下运行容器以创建磁盘镜像
#   - 支持跨平台构建和自定义基础镜像
# ============================================================================

# 设置严格的错误处理模式
# -e: 命令出错时立即退出
# -u: 使用未定义变量时报错
# -o pipefail: 管道中任一命令失败则整个管道返回失败
set -euo pipefail

# ============================================================================
# 基础配置变量
# ============================================================================

# 获取脚本所在目录的父目录（项目根目录）
# BASH_SOURCE[0]：当前脚本的路径
# dirname：获取目录部分
# cd ... && pwd：切换到该目录并获取绝对路径
ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

# 容器镜像名称（可通过环境变量IMAGE_NAME覆盖）
# 语法：${变量名:-默认值} 表示如果变量未设置则使用默认值
IMAGE_NAME=${IMAGE_NAME:-lobsterai-sandbox-image-builder}

# Dockerfile路径（可通过环境变量DOCKERFILE覆盖）
DOCKERFILE=${DOCKERFILE:-"${ROOT_DIR}/sandbox/image/Dockerfile"}

# 构建上下文目录（可通过环境变量BUILD_CONTEXT覆盖）
# 构建上下文是Docker构建时可以访问的文件目录
BUILD_CONTEXT=${BUILD_CONTEXT:-"${ROOT_DIR}/sandbox/image"}

# 容器平台（如linux/amd64、linux/arm64，可选）
CONTAINER_PLATFORM=${CONTAINER_PLATFORM:-}

# 基础镜像（可通过环境变量BASE_IMAGE覆盖）
# 默认使用Ubuntu 22.04作为构建环境
BASE_IMAGE=${BASE_IMAGE:-ubuntu:22.04}

# ============================================================================
# 容器工具自动检测
# ============================================================================

# 自动检测容器工具：优先使用docker，其次使用podman
# ${CONTAINER_TOOL:-} 表示如果CONTAINER_TOOL未设置则为空字符串
if [ -z "${CONTAINER_TOOL:-}" ]; then
  # command -v：检查命令是否存在
  # >/dev/null 2>&1：将标准输出和错误输出都重定向到空设备（静默模式）
  if command -v docker >/dev/null 2>&1; then
    CONTAINER_TOOL=docker
  elif command -v podman >/dev/null 2>&1; then
    CONTAINER_TOOL=podman
  else
    # 错误消息输出到标准错误流（>&2）
    echo "错误：未找到docker或podman。请安装其中之一以继续。" >&2
    exit 1
  fi
fi

echo "正在使用容器工具：${CONTAINER_TOOL}"

# 再次验证容器工具是否可用（处理用户手动设置CONTAINER_TOOL的情况）
if ! command -v "${CONTAINER_TOOL}" >/dev/null 2>&1; then
  echo "错误：运行此脚本需要容器工具 '${CONTAINER_TOOL}'。" >&2
  exit 1
fi

# ============================================================================
# 用户和工作目录配置
# ============================================================================

# 获取当前用户的UID（用户ID）
# id -u：返回当前用户的数字用户ID
HOST_UID=$(id -u)

# 获取当前用户的GID（组ID）
# id -g：返回当前用户的主组ID
HOST_GID=$(id -g)

# 默认工作目录（用于临时文件存储）
WORK_DIR_DEFAULT=/tmp/lobsterai-sandbox-work

# 实际使用的工作目录（可通过环境变量WORK_DIR覆盖）
WORK_DIR_ENV=${WORK_DIR:-${WORK_DIR_DEFAULT}}

# ============================================================================
# 容器特定选项配置
# ============================================================================

# 容器运行选项（如用户命名空间、安全选项等）
CONTAINER_OPTS=""

# 卷挂载选项（如SELinux标签）
VOLUME_OPTS=""

# 设备选项（当前未使用，预留扩展）
DEVICE_OPTS=""

# 根据容器工具类型设置特定选项
if [ "${CONTAINER_TOOL}" = "podman" ]; then
  # 在macOS上，podman machine需要rootful模式才能执行特权操作
  # uname命令返回操作系统名称，Darwin表示macOS
  if [ "$(uname)" = "Darwin" ]; then
    echo "注意：在macOS上，请确保 'podman machine' 以rootful模式运行以执行特权操作。"
    echo "执行命令：podman machine stop && podman machine set --rootful && podman machine start"
    # 对于macOS上的podman，需要在容器内以root用户运行
    # --userns=keep-id选项在特权操作时可能无法正常工作
  else
    # 在Linux上，使用keep-id选项保持用户ID映射
    # 这样容器内的用户ID与宿主机一致，避免文件权限问题
    CONTAINER_OPTS="--userns=keep-id"
    # 添加SELinux标签用于卷挂载（在Fedora/RHEL等系统上很有用）
    # :Z标签表示为容器重新标记SELinux上下文
    VOLUME_OPTS=":Z"
  fi
  # 添加安全选项以允许设备访问
  # label=disable：禁用SELinux标签限制
  CONTAINER_OPTS="${CONTAINER_OPTS} --security-opt label=disable"
fi

# ============================================================================
# 设备挂载配置
# ============================================================================

# 挂载/dev目录以支持loop设备访问（磁盘镜像创建所需）
# loop设备用于将普通文件作为块设备使用
# -v /dev:/dev：将宿主机的/dev目录挂载到容器内
DEV_MOUNT="-v /dev:/dev"

# ============================================================================
# 构建平台参数配置
# ============================================================================

# 构建平台参数数组（用于docker/podman build命令）
BUILD_PLATFORM_ARGS=()

# 运行平台参数数组（用于docker/podman run命令）
RUN_PLATFORM_ARGS=()

# 基础镜像构建参数
# --build-arg：向Dockerfile传递构建参数
BUILD_ARG_BASE_IMAGE=(--build-arg "BASE_IMAGE=${BASE_IMAGE}")

# 如果指定了容器平台，则添加平台参数
# 这对于跨架构构建很有用（如在x86_64主机上构建arm64镜像）
if [ -n "${CONTAINER_PLATFORM}" ]; then
  BUILD_PLATFORM_ARGS=(--platform "${CONTAINER_PLATFORM}")
  RUN_PLATFORM_ARGS=(--platform "${CONTAINER_PLATFORM}")
  echo "正在使用容器平台：${CONTAINER_PLATFORM}"
fi

# ============================================================================
# 构建容器镜像
# ============================================================================

echo "正在使用基础镜像：${BASE_IMAGE}"

# 执行容器镜像构建命令
# 参数说明：
#   "${BUILD_PLATFORM_ARGS[@]}"：平台参数（如--platform linux/amd64）
#   "${BUILD_ARG_BASE_IMAGE[@]}"：构建参数（传递BASE_IMAGE变量）
#   -f "${DOCKERFILE}"：指定Dockerfile路径
#   -t "${IMAGE_NAME}"：为镜像指定标签名称
#   "${BUILD_CONTEXT}"：构建上下文目录
"${CONTAINER_TOOL}" build "${BUILD_PLATFORM_ARGS[@]}" "${BUILD_ARG_BASE_IMAGE[@]}" -f "${DOCKERFILE}" -t "${IMAGE_NAME}" "${BUILD_CONTEXT}"

# ============================================================================
# 运行容器构建沙箱镜像
# ============================================================================

# 执行容器运行命令
# 参数说明：
#   run：运行容器命令
#   --rm：容器退出后自动删除
#   --privileged：特权模式，允许容器访问宿主机设备（磁盘镜像创建所需）
#   "${RUN_PLATFORM_ARGS[@]}"：平台参数
#   ${CONTAINER_OPTS}：容器特定选项（如用户命名空间）
#   ${DEV_MOUNT}：设备目录挂载
#   -e：设置环境变量
#   -v：挂载卷
#   -w：设置工作目录
"${CONTAINER_TOOL}" run --rm --privileged "${RUN_PLATFORM_ARGS[@]}" ${CONTAINER_OPTS} ${DEV_MOUNT} \
  -e ARCHS="${ARCHS:-}" \
  -e ALPINE_MIRROR="${ALPINE_MIRROR:-}" \
  -e ALPINE_BRANCH="${ALPINE_BRANCH:-}" \
  -e ALPINE_VERSION="${ALPINE_VERSION:-}" \
  -e IMAGE_SIZE="${IMAGE_SIZE:-}" \
  -e AGENT_RUNNER_BUILD="${AGENT_RUNNER_BUILD:-}" \
  -e ALLOW_CROSS="${ALLOW_CROSS:-}" \
  -e WORK_DIR="${WORK_DIR_ENV}" \
  -e NO_SUDO="1" \
  -e HOST_UID="${HOST_UID}" \
  -e HOST_GID="${HOST_GID}" \
  -v "${ROOT_DIR}:/workspace${VOLUME_OPTS}" \
  -w /workspace \
  "${IMAGE_NAME}" \
  -lc "sandbox/image/build.sh && { chown -R ${HOST_UID}:${HOST_GID} sandbox/image/out || true; if [[ \"${WORK_DIR_ENV}\" == /workspace/* ]]; then chown -R ${HOST_UID}:${HOST_GID} \"${WORK_DIR_ENV}\" || true; fi; }"

# ============================================================================
# 环境变量说明
# ============================================================================
# ARCHS：目标架构列表（如"x86_64 arm64"）
# ALPINE_MIRROR：Alpine Linux镜像源地址（用于加速下载）
# ALPINE_BRANCH：Alpine Linux分支（如v3.18）
# ALPINE_VERSION：Alpine Linux版本号
# IMAGE_SIZE：磁盘镜像大小
# AGENT_RUNNER_BUILD：Agent Runner构建配置
# ALLOW_CROSS：是否允许跨架构构建
# WORK_DIR：工作目录路径
# NO_SUDO：禁用sudo（容器内已具有必要权限）
# HOST_UID：宿主机用户ID（用于文件权限修正）
# HOST_GID：宿主机组ID（用于文件权限修正）
#
# 执行流程说明：
# 1. 运行 sandbox/image/build.sh 脚本构建磁盘镜像
# 2. 构建完成后，将输出目录的所有权改回宿主机用户
# 3. 如果工作目录在/workspace下，同样修正其权限
# ============================================================================
