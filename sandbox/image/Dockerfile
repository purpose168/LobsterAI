# =============================================================================
# Dockerfile - 沙箱镜像构建环境
# =============================================================================
# 用途：创建一个包含构建 Alpine Linux 沙箱镜像所需工具的 Docker 容器环境
# 基础镜像：Ubuntu 22.04 LTS
# 构建命令：docker build -t sandbox-builder .
# 运行命令：docker run --rm -v $(pwd):/workspace sandbox-builder ./build.sh
# =============================================================================

# -----------------------------------------------------------------------------
# 构建参数定义
# -----------------------------------------------------------------------------
# ARG 指令定义构建时的变量，可在 docker build 时通过 --build-arg 覆盖
# BASE_IMAGE：指定基础镜像，默认使用 Ubuntu 22.04 LTS
# 示例：docker build --build-arg BASE_IMAGE=ubuntu:24.04 -t sandbox-builder .
ARG BASE_IMAGE=ubuntu:22.04

# -----------------------------------------------------------------------------
# 基础镜像
# -----------------------------------------------------------------------------
# FROM 指令指定基础镜像，后续所有指令都基于此镜像执行
# 使用 ${BASE_IMAGE} 引用上面定义的 ARG 变量
FROM ${BASE_IMAGE}

# -----------------------------------------------------------------------------
# 环境变量设置
# -----------------------------------------------------------------------------
# ENV 指令设置环境变量，在容器运行时和构建时都有效
# DEBIAN_FRONTEND=noninteractive：
#   - 禁用 Debian/Ubuntu 的交互式前端
#   - 避免安装软件包时出现交互式提示（如时区选择、键盘布局等）
#   - 这是 Docker 环境中的最佳实践，确保自动化构建不会卡住
ENV DEBIAN_FRONTEND=noninteractive

# -----------------------------------------------------------------------------
# 安装构建依赖
# -----------------------------------------------------------------------------
# RUN 指令在镜像构建时执行命令
# 这里安装构建沙箱镜像所需的所有工具：
#
# bash          - Bourne Again Shell，脚本执行环境
# ca-certificates - SSL/TLS 根证书，用于 HTTPS 连接验证
# curl          - 命令行 HTTP 客户端，用于下载文件（如 Alpine rootfs）
# dosfstools    - FAT/FAT32 文件系统工具，用于创建 EFI 分区
# e2fsprogs     - ext2/ext3/ext4 文件系统工具，用于创建和格式化根分区
# kpartx        - 分区映射工具，用于将镜像文件的分区映射为块设备
# parted        - 分区管理工具，用于创建分区表（MBR/GPT）
# qemu-utils    - QEMU 工具集，包含 qemu-img 用于创建和转换 QCOW2 镜像
# rsync         - 文件同步工具，用于高效复制文件到挂载的镜像
# tar           - 归档工具，用于解压 Alpine rootfs 压缩包
# udev          - 设备管理守护进程，用于自动创建设备节点
# util-linux    - Linux 系统工具集，包含 fdisk、mount、mkfs 等核心工具
# xz-utils      - XZ 压缩工具，用于解压 .tar.xz 格式的 Alpine rootfs
#
# --no-install-recommends：
#   - 只安装必需的依赖，不安装推荐包
#   - 显著减小镜像体积
#
# rm -rf /var/lib/apt/lists/*：
#   - 清理 apt 缓存，减小镜像体积
#   - 这是 Dockerfile 的最佳实践
RUN apt-get update && apt-get install -y --no-install-recommends \
    bash \
    ca-certificates \
    curl \
    dosfstools \
    e2fsprogs \
    kpartx \
    parted \
    qemu-utils \
    rsync \
    tar \
    udev \
    util-linux \
    xz-utils \
  && rm -rf /var/lib/apt/lists/*

# -----------------------------------------------------------------------------
# 工作目录设置
# -----------------------------------------------------------------------------
# WORKDIR 指令设置工作目录
# 后续的 RUN、CMD、ENTRYPOINT、COPY、ADD 指令都会在此目录下执行
# /workspace 是构建脚本的默认工作目录
# 运行容器时通常会将宿主机目录挂载到此位置
WORKDIR /workspace

# -----------------------------------------------------------------------------
# 容器入口点
# -----------------------------------------------------------------------------
# ENTRYPOINT 指定容器启动时执行的命令
# 设置为 /bin/bash 允许用户在容器内执行交互式命令或脚本
#
# 使用方式：
# 1. 交互模式：docker run -it sandbox-builder
# 2. 执行脚本：docker run --rm -v $(pwd):/workspace sandbox-builder ./build.sh
# 3. 覆盖命令：docker run sandbox-builder ls -la
ENTRYPOINT ["/bin/bash"]
