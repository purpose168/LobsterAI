#!/bin/bash
# ============================================================================
# Alpine Linux 沙箱镜像构建脚本
# ============================================================================
# 用途：为 LobsterAI 项目构建可用于虚拟化环境的 Alpine Linux 镜像
# 作者：LobsterAI Team
# 联系方式：purpose168@outlook.com
# ============================================================================
# 功能说明：
#   1. 下载 Alpine Linux 最小根文件系统
#   2. 配置系统环境和安装必要软件包
#   3. 集成 agent-runner 服务
#   4. 创建可启动的 QCOW2 虚拟机镜像
# ============================================================================
# 使用方法：
#   ./build.sh                    # 为当前主机架构构建镜像
#   ARCHS=amd64 ./build.sh        # 指定架构构建
#   ARCHS="amd64 arm64" ./build.sh # 为多个架构构建
# ============================================================================
# 环境变量说明：
#   OUT_DIR              - 输出目录（默认：./out）
#   WORK_DIR             - 工作目录（默认：./.work）
#   ALPINE_MIRROR        - Alpine 镜像源地址
#   ALPINE_BRANCH        - Alpine 分支版本（默认：v3.20）
#   ALPINE_VERSION       - Alpine 具体版本号（默认：3.20.3）
#   IMAGE_SIZE           - 镜像大小（默认：4G）
#   ARCHS                - 目标架构列表（默认：当前主机架构）
#   AGENT_RUNNER_BUILD   - agent-runner 构建模式（auto/1/0）
#   ALLOW_CROSS          - 是否允许跨架构构建（默认：不允许）
#   NO_SUDO              - 禁用 sudo（容器环境使用）
# ============================================================================

# 设置严格的错误处理模式
# -e: 命令出错时立即退出
# -u: 使用未定义变量时报错
# -o pipefail: 管道中任一命令失败则整个管道失败
set -euo pipefail

# ============================================================================
# 目录配置
# ============================================================================

# 获取脚本所在目录的绝对路径
# BASH_SOURCE[0] 表示当前脚本的路径
# dirname 获取目录部分，cd 进入该目录，pwd 获取绝对路径
ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

# 输出目录：存放最终生成的镜像文件
# ${VAR:-default} 语法：如果 VAR 未设置或为空，则使用 default 值
OUT_DIR="${OUT_DIR:-${ROOT_DIR}/out}"

# 工作目录：存放临时文件和中间产物
WORK_DIR="${WORK_DIR:-${ROOT_DIR}/.work}"

# 下载目录：存放下载的 Alpine 根文件系统压缩包
DOWNLOADS_DIR="${WORK_DIR}/downloads"

# 覆盖目录：存放需要覆盖到根文件系统的自定义文件
OVERLAY_DIR="${ROOT_DIR}/overlay"

# agent-runner 源代码目录
AGENT_DIR="${ROOT_DIR}/../agent-runner"

# ============================================================================
# Alpine Linux 配置
# ============================================================================

# Alpine Linux 镜像源地址
# 国内用户可设置为：https://mirrors.tuna.tsinghua.edu.cn/alpine
ALPINE_MIRROR=${ALPINE_MIRROR:-https://dl-cdn.alpinelinux.org/alpine}

# Alpine 分支版本（如 v3.20, v3.19 等）
ALPINE_BRANCH=${ALPINE_BRANCH:-v3.20}

# Alpine 具体版本号
ALPINE_VERSION=${ALPINE_VERSION:-3.20.3}

# 虚拟机镜像大小
IMAGE_SIZE=${IMAGE_SIZE:-4G}

# 目标架构列表（为空时自动检测）
ARCHS=${ARCHS:-}

# agent-runner 构建模式
# auto: 自动检测是否需要构建
# 1/true: 强制执行构建
# 0/false: 跳过构建
AGENT_RUNNER_BUILD=${AGENT_RUNNER_BUILD:-auto}

# ============================================================================
# 架构检测
# ============================================================================

# 获取主机架构
# uname -m 返回机器硬件名称（如 x86_64, aarch64）
HOST_ARCH=$(uname -m)

# 将主机架构名称标准化为统一格式
# x86_64 -> amd64
# aarch64/arm64 -> arm64
case "${HOST_ARCH}" in
  x86_64) HOST_ARCH=amd64 ;;
  aarch64|arm64) HOST_ARCH=arm64 ;;
  *)
    # 不支持的架构，输出错误信息到标准错误流（>&2）
    echo "不支持的主机架构: ${HOST_ARCH}" >&2
    exit 1
    ;;
esac

# 如果未指定目标架构，则使用主机架构
if [ -z "${ARCHS}" ]; then
  ARCHS="${HOST_ARCH}"
fi

# ============================================================================
# 权限管理
# ============================================================================

# 检测是否需要使用 sudo
# id -u 返回当前用户的 UID，0 表示 root 用户
SUDO=
if [ "$(id -u)" -ne 0 ]; then
  # 如果设置了 NO_SUDO=1，则不使用 sudo（适用于已授权的容器环境）
  if [ "${NO_SUDO:-}" = "1" ]; then
    SUDO=
  # 检查 sudo 命令是否可用
  elif command -v sudo >/dev/null 2>&1; then
    SUDO=sudo
  else
    echo "此脚本需要 root 权限（未找到 sudo 命令）。如果是已授权的容器环境，请设置 NO_SUDO=1" >&2
    exit 1
  fi
fi

# ============================================================================
# 依赖检查函数
# ============================================================================

# 检查必需的命令是否存在
# 参数：$1 - 命令名称
# 如果命令不存在，输出错误信息并退出
need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "缺少必需的命令: $1" >&2
    exit 1
  fi
}

# 检查所有必需的命令
# curl: 用于下载文件
# tar: 用于解压缩
# qemu-img: 用于创建和转换虚拟机镜像
# mkfs.ext4: 用于创建 ext4 文件系统
# parted: 用于磁盘分区
# partprobe: 用于通知内核重新读取分区表
# rsync: 用于文件同步
# losetup: 用于设置循环设备
# mount/umount: 用于挂载和卸载文件系统
need_cmd curl
need_cmd tar
need_cmd qemu-img
need_cmd mkfs.ext4
need_cmd parted
need_cmd partprobe
need_cmd rsync
need_cmd losetup
need_cmd mount
need_cmd umount

# 创建必要的目录
# -p 参数表示如果目录已存在则不报错，且创建父目录
mkdir -p "${OUT_DIR}" "${WORK_DIR}" "${DOWNLOADS_DIR}"

# ============================================================================
# 循环设备设置函数
# ============================================================================
# 功能：确保循环设备可用（在容器环境中特别重要）
# 循环设备允许将普通文件作为块设备使用，是创建镜像的关键
# ============================================================================

setup_loop_devices() {
  # 尝试加载 loop 内核模块
  # modprobe 用于加载内核模块，2>/dev/null 忽略错误输出
  ${SUDO} modprobe loop 2>/dev/null || true

  # 检查 loop-control 设备是否存在
  # loop-control 是用于管理循环设备的控制设备
  if [ ! -e /dev/loop-control ]; then
    echo "警告: 未找到 /dev/loop-control，尝试创建它..."
    # mknod 用于创建设备文件
    # c 表示字符设备，10 237 是主设备号和次设备号
    ${SUDO} mknod /dev/loop-control c 10 237 2>/dev/null || true
  fi

  # 创建循环设备节点（如果不存在）
  # 通常需要 loop0 到 loop7 共 8 个设备
  for i in $(seq 0 7); do
    if [ ! -e "/dev/loop${i}" ]; then
      # b 表示块设备，7 是 loop 设备的主设备号
      ${SUDO} mknod "/dev/loop${i}" b 7 "${i}" 2>/dev/null || true
    fi
  done
}

# 执行循环设备设置
setup_loop_devices

# ============================================================================
# 挂载点清理函数
# ============================================================================
# 功能：安全地卸载所有挂载点
# 参数：$1 - 挂载点路径
# 说明：按照正确的顺序卸载，避免设备忙错误
# ============================================================================

cleanup_mounts() {
  local mnt="$1"
  
  # 检查挂载点是否存在并卸载
  # mountpoint -q 静默检查是否为挂载点
  # 卸载顺序很重要：先卸载子挂载点，最后卸载根挂载点
  
  # 卸载 EFI 分区（仅 ARM64 架构）
  if mountpoint -q "${mnt}/boot/efi"; then
    ${SUDO} umount "${mnt}/boot/efi"
  fi
  
  # 卸载 proc 文件系统（进程信息）
  if mountpoint -q "${mnt}/proc"; then
    ${SUDO} umount "${mnt}/proc"
  fi
  
  # 卸载 sysfs 文件系统（系统信息）
  if mountpoint -q "${mnt}/sys"; then
    ${SUDO} umount "${mnt}/sys"
  fi
  
  # 卸载 dev 文件系统（设备文件）
  if mountpoint -q "${mnt}/dev"; then
    ${SUDO} umount "${mnt}/dev"
  fi
  
  # 最后卸载根挂载点
  if mountpoint -q "${mnt}"; then
    ${SUDO} umount "${mnt}"
  fi
}

# ============================================================================
# 创建根文件系统函数
# ============================================================================
# 功能：创建 Alpine Linux 根文件系统并安装必要软件
# 参数：$1 - 目标架构（amd64 或 arm64）
# 返回：根文件系统路径（通过文件描述符 3）
# ============================================================================

create_rootfs() {
  # 保存标准输出到文件描述符 3，将标准输出重定向到标准错误
  # 这样函数内的 echo 输出会显示在终端，但返回值通过 fd 3 传递
  exec 3>&1
  exec 1>&2

  local arch="$1"
  local alpine_arch
  
  # 将标准化架构名称转换为 Alpine 的架构名称
  case "${arch}" in
    amd64) alpine_arch=x86_64 ;;
    arm64) alpine_arch=aarch64 ;;
    *)
      echo "不支持的目标架构: ${arch}" >&2
      exit 1
      ;;
  esac

  # 检查是否允许跨架构构建
  # 跨架构构建需要 binfmt_misc 和 qemu-user-static 支持
  if [ "${arch}" != "${HOST_ARCH}" ] && [ "${ALLOW_CROSS:-}" != "1" ]; then
    echo "默认不支持跨架构构建。" >&2
    echo "请在 ${arch} 主机上构建 ${arch} 镜像，或设置 ALLOW_CROSS=1 并配置 binfmt/qemu-user-static。" >&2
    exit 1
  fi

  # 构建下载文件名和 URL
  local tarball="alpine-minirootfs-${ALPINE_VERSION}-${alpine_arch}.tar.gz"
  local url="${ALPINE_MIRROR}/${ALPINE_BRANCH}/releases/${alpine_arch}/${tarball}"
  local dest="${DOWNLOADS_DIR}/${tarball}"

  # 下载 Alpine 最小根文件系统（如果尚未下载）
  if [ ! -f "${dest}" ]; then
    echo "正在下载 ${url}"
    # curl 参数说明：
    # -f: HTTP 错误时失败
    # -L: 跟随重定向
    # -o: 输出到文件
    curl -fL "${url}" -o "${dest}"
  fi

  # 创建根文件系统目录
  local rootfs="${WORK_DIR}/rootfs-${arch}"
  ${SUDO} rm -rf "${rootfs}"
  ${SUDO} mkdir -p "${rootfs}"
  
  # 解压根文件系统
  # tar 参数说明：
  # -x: 解压
  # -z: 处理 gzip 压缩
  # -f: 指定文件
  # -C: 指定目标目录
  ${SUDO} tar -xzf "${dest}" -C "${rootfs}"

  # 应用覆盖文件（如果存在）
  # 覆盖目录中的文件会覆盖根文件系统中的对应文件
  if [ -d "${OVERLAY_DIR}" ]; then
    # rsync 参数说明：
    # -a: 归档模式，保留权限、时间戳等属性
    # 注意：源目录后的 / 表示复制目录内容而非目录本身
    ${SUDO} rsync -a "${OVERLAY_DIR}/" "${rootfs}/"
  fi

  # 检查 agent-runner 源代码是否存在
  if [ ! -d "${AGENT_DIR}" ] || [ -z "$(ls -A "${AGENT_DIR}")" ]; then
    echo "在 ${AGENT_DIR} 中未找到 agent-runner 源代码" >&2
    exit 1
  fi

  # 复制 agent-runner 到根文件系统
  ${SUDO} mkdir -p "${rootfs}/opt/agent-runner"
  ${SUDO} rsync -a "${AGENT_DIR}/" "${rootfs}/opt/agent-runner/"

  # 配置 APK 软件包管理器的软件源
  # 这里使用 heredoc 语法创建多行配置文件
  cat <<EOF_REPO | ${SUDO} tee "${rootfs}/etc/apk/repositories" >/dev/null
${ALPINE_MIRROR}/${ALPINE_BRANCH}/main
${ALPINE_MIRROR}/${ALPINE_BRANCH}/community
EOF_REPO

  # 复制主机的 DNS 配置到根文件系统
  # 这样 chroot 环境中可以正常解析域名
  if [ -f /etc/resolv.conf ]; then
    ${SUDO} cp /etc/resolv.conf "${rootfs}/etc/resolv.conf"
  fi

  # 挂载必要的虚拟文件系统到 chroot 环境
  # 这些挂载对于 chroot 中的系统操作是必需的
  
  # --bind: 绑定挂载，使设备文件在 chroot 中可用
  ${SUDO} mount --bind /dev "${rootfs}/dev"
  
  # -t proc: 挂载 proc 文件系统，提供进程信息
  ${SUDO} mount -t proc proc "${rootfs}/proc"
  
  # -t sysfs: 挂载 sysfs，提供系统信息
  ${SUDO} mount -t sysfs sys "${rootfs}/sys"
  
  # 设置退出时自动清理的 trap
  # 如果脚本异常退出，会自动调用 cleanup_mounts 清理挂载
  trap "cleanup_mounts \"${rootfs}\"" EXIT

  # 更新 APK 软件包索引
  ${SUDO} chroot "${rootfs}" /bin/sh -c "apk update"
  
  # ===========================================================================
  # 安装 Alpine 软件包
  # ===========================================================================
  # 基础系统包：
  #   - ca-certificates: CA 证书，用于 HTTPS 连接
  #   - openrc: 初始化系统和服务管理器
  #   - linux-virt: 虚拟化优化的 Linux 内核
  #   - util-linux: 系统工具集
  #   - e2fsprogs: ext 文件系统工具
  #   - kmod: 内核模块工具
  #
  # Node.js 运行时：
  #   - nodejs: Node.js 运行时环境
  #   - npm: Node.js 包管理器
  #
  # Shell 环境：
  #   - bash: Bourne Again Shell（Claude CLI 需要）
  #
  # Claude CLI 工具依赖：
  #   - ripgrep: 高性能搜索工具（Grep/Glob 工具需要）
  #   - git: 版本控制系统
  #   - python3: Python 3 解释器
  #   - py3-pip: Python 包管理器
  #   - coreutils: GNU 核心工具集（cat, head, tail 等）
  #   - findutils: 文件查找工具（find, xargs 等）
  #   - grep: GNU grep 文本搜索
  #   - sed: 流编辑器
  #   - gawk: GNU awk 文本处理
  #   - curl: 网络请求工具
  #   - jq: JSON 处理工具
  #   - file: 文件类型识别
  #   - less: 分页查看器
  #   - tree: 目录树显示
  #   - tar: 归档工具
  #   - gzip: gzip 压缩工具
  #   - unzip: ZIP 解压工具
  #   - openssh-client: SSH 客户端
  #
  # 如需添加更多依赖，请在下方 apk add 命令中追加包名
  # 可用包列表: https://pkgs.alpinelinux.org/packages
  # ===========================================================================
  ${SUDO} chroot "${rootfs}" /bin/sh -c "apk add --no-cache \
    ca-certificates \
    openrc \
    linux-virt \
    util-linux \
    e2fsprogs \
    kmod \
    nodejs \
    npm \
    bash \
    ripgrep \
    git \
    python3 \
    py3-pip \
    coreutils \
    findutils \
    grep \
    sed \
    gawk \
    curl \
    jq \
    file \
    less \
    tree \
    tar \
    gzip \
    unzip \
    openssh-client \
  "

  # ===========================================================================
  # 安装 agent-runner 依赖
  # ===========================================================================
  # AGENT_RUNNER_BUILD 变量控制依赖安装和构建行为：
  #   - "1" 或 "true": 总是运行 npm install 和 build
  #   - "auto": 总是运行 npm install，仅在 node_modules 不存在时运行 build
  #   - "0" 或 "false": 完全跳过
  # ===========================================================================
  
  if [ -f "${rootfs}/opt/agent-runner/package.json" ]; then
    # 根据是否存在 package-lock.json 选择安装命令
    # npm ci: 根据 lock 文件安装，更快且严格
    # npm install: 根据依赖范围安装，可能更新版本
    local npm_install_cmd="npm install --omit=dev"
    if [ -f "${rootfs}/opt/agent-runner/package-lock.json" ]; then
      npm_install_cmd="npm ci --omit=dev"
    fi
    
    # 根据 AGENT_RUNNER_BUILD 设置执行相应操作
    if [ "${AGENT_RUNNER_BUILD}" = "0" ] || [ "${AGENT_RUNNER_BUILD}" = "false" ]; then
      echo "跳过 agent-runner 依赖安装 (AGENT_RUNNER_BUILD=${AGENT_RUNNER_BUILD})"
    elif [ "${AGENT_RUNNER_BUILD}" = "1" ] || [ "${AGENT_RUNNER_BUILD}" = "true" ]; then
      # 强制执行安装和构建
      # --if-present: 仅在 package.json 中定义了 build 脚本时才执行
      ${SUDO} chroot "${rootfs}" /bin/sh -c "cd /opt/agent-runner && ${npm_install_cmd} && npm run build --if-present"
    else
      # 默认行为（auto）：总是安装依赖
      ${SUDO} chroot "${rootfs}" /bin/sh -c "cd /opt/agent-runner && ${npm_install_cmd}"
    fi
  fi

  # 检查 agentd 入口点配置
  # agentd 是 agent-runner 的系统服务
  if [ -f "${rootfs}/etc/conf.d/agentd" ]; then
    local entry
    # 从配置文件中提取 AGENTD_ENTRY 的值
    # grep: 搜索匹配行
    # head -n 1: 取第一行
    # cut -d= -f2-: 以 = 为分隔符，取第二个字段及之后的内容
    # tr -d '\"': 删除双引号
    entry=$(grep -E '^AGENTD_ENTRY=' "${rootfs}/etc/conf.d/agentd" | head -n 1 | cut -d= -f2- | tr -d '\"')
    
    # 验证入口点文件是否存在
    if [ -n "${entry}" ] && [ ! -f "${rootfs}${entry}" ]; then
      echo "警告: 在根文件系统中未找到 AGENTD_ENTRY: ${entry}" >&2
    fi
  fi

  # 确保 agentd 服务开机自启
  # OpenRC 是 Alpine Linux 的初始化系统
  if [ -f "${rootfs}/etc/init.d/agentd" ]; then
    # rc-update: OpenRC 服务管理工具
    # add agentd default: 将 agentd 添加到 default 运行级别
    ${SUDO} chroot "${rootfs}" /bin/sh -c "rc-update add agentd default" || true
  fi
  
  # 即使 rc-update 不可用，也确保 agentd 链接到运行级别
  # 这是备用方案，直接创建符号链接
  if [ -f "${rootfs}/etc/init.d/agentd" ]; then
    ${SUDO} mkdir -p "${rootfs}/etc/runlevels/default" "${rootfs}/etc/runlevels/boot"
    # -s: 创建符号链接
    # -f: 强制覆盖已存在的链接
    ${SUDO} ln -sf /etc/init.d/agentd "${rootfs}/etc/runlevels/default/agentd"
    ${SUDO} ln -sf /etc/init.d/agentd "${rootfs}/etc/runlevels/boot/agentd"
  fi

  # 清理挂载点
  cleanup_mounts "${rootfs}"
  
  # 移除 EXIT trap
  trap - EXIT

  # 通过文件描述符 3 返回根文件系统路径
  # >&3: 输出到文件描述符 3
  printf '%s\n' "${rootfs}" >&3
  
  # 恢复标准输出并关闭文件描述符 3
  exec 1>&3 3>&-
}

# ============================================================================
# 安装 GRUB 配置函数
# ============================================================================
# 功能：生成并安装 GRUB 引导加载程序的配置文件
# 参数：
#   $1 - 挂载点路径
#   $2 - 目标架构
# 说明：配置内核启动参数，包括根设备和控制台
# ============================================================================

install_grub_cfg() {
  local mnt="$1"
  local arch="$2"
  local root_device
  local console

  # 根据架构设置不同的启动参数
  # amd64: 使用第一个分区，串口控制台为 ttyS0
  # arm64: 使用第二个分区（第一个是 ESP），串口控制台为 ttyAMA0
  if [ "${arch}" = "amd64" ]; then
    root_device=/dev/vda1
    console=ttyS0
  else
    root_device=/dev/vda2
    console=ttyAMA0
  fi

  # 创建 GRUB 配置目录
  ${SUDO} mkdir -p "${mnt}/boot/grub"
  
  # 使用 heredoc 生成 grub.cfg 配置文件
  # tee 命令用于同时输出到文件和标准输出
  # >/dev/null 丢弃标准输出
  ${SUDO} tee "${mnt}/boot/grub/grub.cfg" >/dev/null <<EOF_CFG
# GRUB 配置文件
# 设置默认启动项（0 表示第一个菜单项）
set default=0

# 设置启动菜单超时时间（0 表示立即启动，不显示菜单）
set timeout=0

# 定义启动菜单项
menuentry 'Alpine Sandbox' {
  # linux: 指定内核镜像和启动参数
  # root=: 根文件系统设备
  # modules=ext4: 需要加载的内核模块
  # quiet: 静默启动，减少输出
  # console=: 控制台设备，用于虚拟机串口输出
  linux /boot/vmlinuz-virt root=${root_device} modules=ext4 quiet console=${console}
  
  # initrd: 指定初始 RAM 文件系统
  initrd /boot/initramfs-virt
}
EOF_CFG
}

# ============================================================================
# 安装 GRUB 软件包函数
# ============================================================================
# 功能：在目标系统中安装 GRUB 引导加载程序软件包
# 参数：
#   $1 - 挂载点路径
#   $2 - 目标架构
# 说明：
#   - amd64: 安装 grub-bios（传统 BIOS 引导）
#   - arm64: 安装 grub-efi（UEFI 引导）及相关工具
# ============================================================================

install_grub_packages() {
  local mnt="$1"
  local arch="$2"
  
  if [ "${arch}" = "amd64" ]; then
    # AMD64 架构使用 BIOS 引导
    # 先尝试安装 grub-bios，如果失败则尝试 grub（旧版本包名）
    if ! ${SUDO} chroot "${mnt}" /bin/sh -c "apk add --no-cache grub-bios"; then
      ${SUDO} chroot "${mnt}" /bin/sh -c "apk add --no-cache grub"
    fi
  else
    # ARM64 架构使用 UEFI 引导
    # grub-efi: UEFI 版本的 GRUB
    # efibootmgr: UEFI 启动项管理工具
    # dosfstools: FAT 文件系统工具（用于 ESP 分区）
    ${SUDO} chroot "${mnt}" /bin/sh -c "apk add --no-cache grub-efi efibootmgr dosfstools"
  fi
}

# ============================================================================
# 构建镜像函数
# ============================================================================
# 功能：创建完整的虚拟机镜像文件
# 参数：
#   $1 - 目标架构
#   $2 - 根文件系统路径
# 流程：
#   1. 创建空白镜像文件
#   2. 分区并格式化
#   3. 复制根文件系统
#   4. 安装引导加载程序
#   5. 转换为 QCOW2 格式
# ============================================================================

build_image() {
  local arch="$1"
  local rootfs="$2"
  
  # 定义文件路径
  local image_raw="${WORK_DIR}/linux-${arch}.raw"      # 原始镜像
  local image_out="${OUT_DIR}/linux-${arch}.qcow2"     # 最终输出镜像
  local mnt="${WORK_DIR}/mnt-${arch}"                  # 挂载点
  local loop_device                                     # 循环设备
  local root_part                                       # 根分区设备
  local esp_part                                        # ESP 分区设备（仅 ARM64）

  # 清理旧文件
  ${SUDO} rm -f "${image_raw}" "${image_out}"
  
  # 创建指定大小的空白文件
  # truncate 创建稀疏文件，不占用实际磁盘空间直到写入数据
  truncate -s "${IMAGE_SIZE}" "${image_raw}"

  # 根据架构创建不同的分区表
  if [ "${arch}" = "amd64" ]; then
    # AMD64: 使用 MBR 分区表（msdos）
    # parted 参数说明：
    #   -s: 脚本模式，不提示确认
    #   mklabel: 创建分区表
    #   mkpart: 创建分区
    #   set: 设置分区标志
    ${SUDO} parted -s "${image_raw}" mklabel msdos
    ${SUDO} parted -s "${image_raw}" mkpart primary ext4 1MiB 100%
    ${SUDO} parted -s "${image_raw}" set 1 boot on
  else
    # ARM64: 使用 GPT 分区表，需要 ESP 分区
    # 检查 mkfs.vfat 命令是否可用
    need_cmd mkfs.vfat
    
    ${SUDO} parted -s "${image_raw}" mklabel gpt
    # 创建 ESP 分区（EFI 系统分区），200MB
    ${SUDO} parted -s "${image_raw}" mkpart ESP fat32 1MiB 201MiB
    ${SUDO} parted -s "${image_raw}" set 1 esp on
    # 创建根分区
    ${SUDO} parted -s "${image_raw}" mkpart primary ext4 201MiB 100%
  fi

  # 通知内核重新读取分区表
  # 2>/dev/null 忽略错误（在某些环境中可能失败）
  ${SUDO} partprobe "${image_raw}" 2>/dev/null || true

  # 设置循环设备
  # --find: 查找空闲的循环设备
  # --partscan: 扫描分区
  # --show: 显示使用的设备名称
  loop_device=$(${SUDO} losetup --find --partscan --show "${image_raw}")
  
  # 设置清理 trap，确保退出时释放资源
  trap "cleanup_mounts \"${mnt}\"; ${SUDO} losetup -d \"${loop_device}\"" EXIT

  # 通知内核分区变化
  # partx -a: 添加分区到系统
  ${SUDO} partx -a "${loop_device}" >/dev/null 2>&1 || true
  sleep 0.5

  # ===========================================================================
  # 处理分区设备节点（容器环境兼容性）
  # ===========================================================================
  # 在某些容器环境（如 macOS 上的 Podman）中，分区设备节点可能不会自动创建
  # 这里尝试手动创建这些设备节点
  # ===========================================================================
  
  local base_loop
  base_loop=$(basename "${loop_device}")
  
  # 检查 /sys/block 目录是否存在
  if [ -d "/sys/block/${base_loop}" ]; then
    # 遍历所有分区
    for part in /sys/block/${base_loop}/${base_loop}p*; do
      [ -e "${part}" ] || continue
      
      local name
      name=$(basename "${part}")
      local dev="/dev/${name}"
      
      # 如果设备节点不存在，尝试创建
      if [ ! -e "${dev}" ]; then
        local majmin
        # 从 sysfs 读取主设备号和次设备号
        majmin=$(cat "${part}/dev")
        local major=${majmin%%:*}  # 提取主设备号（冒号前的部分）
        local minor=${majmin##*:}  # 提取次设备号（冒号后的部分）
        
        # 尝试创建设备节点
        ${SUDO} mknod "${dev}" b "${major}" "${minor}" 2>/dev/null || {
          echo "警告: 无法通过 mknod 创建 ${dev}，尝试其他方法..."
        }
      fi
    done
  fi

  # 如果分区设备仍然不存在，尝试重新扫描
  if ! ls "${loop_device}p"* >/dev/null 2>&1; then
    echo "未找到分区设备，尝试重新扫描 losetup..."
    ${SUDO} losetup -d "${loop_device}" 2>/dev/null || true
    sleep 0.2
    loop_device=$(${SUDO} losetup --find --partscan --show "${image_raw}")
    trap "cleanup_mounts \"${mnt}\"; ${SUDO} losetup -d \"${loop_device}\"" EXIT
    sleep 0.5
  fi

  # 如果仍然没有分区，尝试使用 kpartx（最后的手段）
  # kpartx: 用于创建设备映射器的分区映射
  local use_kpartx=0
  if ! ls "${loop_device}p"* >/dev/null 2>&1; then
    if command -v kpartx >/dev/null 2>&1; then
      echo "使用 kpartx 创建分区映射..."
      # -a: 添加映射
      # -v: 详细输出
      ${SUDO} kpartx -av "${loop_device}" || true
      sleep 0.5
      use_kpartx=1
    fi
  fi

  # ===========================================================================
  # 查找分区设备
  # ===========================================================================
  # 使用多种方法尝试找到分区设备，确保在不同环境下都能工作
  # ===========================================================================
  
  local parts=()
  
  # 方法 1: 使用 lsblk 命令查找分区
  # -l: 列表格式
  # -n: 不显示标题
  # -o NAME,TYPE: 只显示设备名和类型
  # awk 过滤出类型为 part 的分区
  while IFS= read -r line; do
    parts+=("/dev/${line}")
  done < <(lsblk -ln -o NAME,TYPE "${loop_device}" 2>/dev/null | awk '$2=="part"{print $1}')

  # 方法 2: 如果 lsblk 未找到，尝试直接检查设备路径
  if [ "${#parts[@]}" -eq 0 ]; then
    for i in 1 2 3; do
      if [ -e "${loop_device}p${i}" ]; then
        parts+=("${loop_device}p${i}")
      fi
    done
  fi

  # 方法 3: 如果使用了 kpartx，尝试设备映射器路径
  if [ "${#parts[@]}" -eq 0 ] && [ "${use_kpartx}" = "1" ]; then
    local loop_name
    loop_name=$(basename "${loop_device}")
    for i in 1 2 3; do
      local dm_path="/dev/mapper/${loop_name}p${i}"
      if [ -e "${dm_path}" ]; then
        parts+=("${dm_path}")
      fi
    done
  fi

  # 验证找到的分区数量
  if [ "${arch}" = "amd64" ]; then
    if [ "${#parts[@]}" -lt 1 ]; then
      echo "未找到 ${loop_device} 的循环分区" >&2
      exit 1
    fi
    root_part="${parts[0]}"
  else
    if [ "${#parts[@]}" -lt 2 ]; then
      echo "${loop_device} 应有 2 个分区（ESP+根分区）" >&2
      exit 1
    fi
    esp_part="${parts[0]}"
    root_part="${parts[1]}"
  fi

  # 创建挂载点目录
  ${SUDO} mkdir -p "${mnt}"

  # 格式化分区并挂载
  if [ "${arch}" = "amd64" ]; then
    # AMD64: 只需要格式化根分区
    # -F: 强制格式化，即使文件系统已存在
    ${SUDO} mkfs.ext4 -F "${root_part}"
    ${SUDO} mount "${root_part}" "${mnt}"
  else
    # ARM64: 需要格式化 ESP 和根分区
    # -F 32: 创建 FAT32 文件系统
    ${SUDO} mkfs.vfat -F 32 "${esp_part}"
    ${SUDO} mkfs.ext4 -F "${root_part}"
    ${SUDO} mount "${root_part}" "${mnt}"
    
    # 创建 EFI 目录并挂载 ESP 分区
    ${SUDO} mkdir -p "${mnt}/boot/efi"
    ${SUDO} mount "${esp_part}" "${mnt}/boot/efi"
  fi

  # 复制根文件系统到镜像
  # tar 参数说明：
  #   --numeric-owner: 保留数字 UID/GID（避免名称解析问题）
  #   -C: 切换到指定目录
  #   -cpf -: 创建归档，保留权限，输出到标准输出
  #   -xpf -: 解压归档，保留权限，从标准输入读取
  ${SUDO} tar --numeric-owner -C "${rootfs}" -cpf - . | ${SUDO} tar -C "${mnt}" -xpf -

  # 挂载虚拟文件系统（用于 chroot 操作）
  ${SUDO} mount --bind /dev "${mnt}/dev"
  ${SUDO} mount -t proc proc "${mnt}/proc"
  ${SUDO} mount -t sysfs sys "${mnt}/sys"

  # 安装 GRUB
  install_grub_packages "${mnt}" "${arch}"
  install_grub_cfg "${mnt}" "${arch}"

  # ===========================================================================
  # 安装 GRUB 引导加载程序
  # ===========================================================================
  
  if [ "${arch}" = "amd64" ]; then
    # AMD64: 安装 BIOS 版本的 GRUB
    # --target=i386-pc: 指定目标平台为传统 BIOS
    # --boot-directory: 指定 GRUB 文件安装目录
    ${SUDO} chroot "${mnt}" /bin/sh -c "grub-install --target=i386-pc --boot-directory=/boot ${loop_device}"
  else
    # ARM64: 安装 UEFI 版本的 GRUB
    # --target=arm64-efi: 指定目标平台为 ARM64 UEFI
    # --efi-directory: 指定 EFI 系统分区挂载点
    # --removable: 为可移动介质安装（创建标准路径的 EFI 文件）
    # --no-nvram: 不修改 NVRAM 启动项（适用于虚拟机）
    ${SUDO} chroot "${mnt}" /bin/sh -c "grub-install --target=arm64-efi --efi-directory=/boot/efi --boot-directory=/boot --removable --no-nvram"
    
    # 确保存在可移动介质的 EFI 引导文件
    # 某些固件不会加载 NVRAM 条目，需要标准的 EFI 引导路径
    local boot_efi="${mnt}/boot/efi/EFI/BOOT/BOOTAA64.EFI"
    if [ ! -f "${boot_efi}" ]; then
      local grub_efi=""
      # 查找现有的 GRUB EFI 文件
      grub_efi=$(find "${mnt}/usr/lib/grub" -name 'grubaa64.efi' -o -name 'BOOTAA64.EFI' 2>/dev/null | head -n 1 || true)
      
      if [ -n "${grub_efi}" ]; then
        # 复制找到的 EFI 文件
        ${SUDO} mkdir -p "$(dirname "${boot_efi}")"
        ${SUDO} cp "${grub_efi}" "${boot_efi}"
      else
        # 如果没有找到，尝试使用 grub-mkimage 创建
        ${SUDO} chroot "${mnt}" /bin/sh -c "\
          mkdir -p /boot/efi/EFI/BOOT; \
          if command -v grub-mkimage >/dev/null 2>&1; then \
            grub-mkimage -O arm64-efi -o /boot/efi/EFI/BOOT/BOOTAA64.EFI -p /boot/grub \
              part_gpt part_msdos fat ext2 normal linux configfile search search_fs_uuid; \
          fi"
      fi
    fi

    # 创建 UEFI Shell 启动脚本
    # 如果没有 NVRAM 条目，UEFI Shell 会自动执行此脚本
    ${SUDO} tee "${mnt}/boot/efi/startup.nsh" >/dev/null <<'EOF_NSH'
\EFI\BOOT\BOOTAA64.EFI
EOF_NSH
  fi

  # 对于 ARM64，复制内核和 initramfs 到输出目录
  # 这对于某些虚拟化平台（如 QEMU 直接启动）很有用
  if [ "${arch}" = "arm64" ]; then
    if [ -f "${mnt}/boot/vmlinuz-virt" ]; then
      ${SUDO} cp "${mnt}/boot/vmlinuz-virt" "${OUT_DIR}/vmlinuz-virt-${arch}"
    fi
    if [ -f "${mnt}/boot/initramfs-virt" ]; then
      ${SUDO} cp "${mnt}/boot/initramfs-virt" "${OUT_DIR}/initramfs-virt-${arch}"
    fi
  fi

  # 清理挂载点
  cleanup_mounts "${mnt}"
  
  # 如果使用了 kpartx，清理设备映射
  if [ "${use_kpartx}" = "1" ] && command -v kpartx >/dev/null 2>&1; then
    # -d: 删除映射
    ${SUDO} kpartx -dv "${loop_device}" 2>/dev/null || true
  fi
  
  # 释放循环设备
  ${SUDO} losetup -d "${loop_device}"
  
  # 移除 trap
  trap - EXIT
  
  # 删除挂载点目录
  rmdir "${mnt}"

  # 将原始镜像转换为 QCOW2 格式
  # QCOW2 是 QEMU 的标准镜像格式，支持快照、压缩等特性
  # 参数说明：
  #   -f raw: 输入格式为原始格式
  #   -O qcow2: 输出格式为 QCOW2
  qemu-img convert -f raw -O qcow2 "${image_raw}" "${image_out}"
  
  # 删除原始镜像文件
  rm -f "${image_raw}"

  echo "已构建完成: ${image_out}"
}

# ============================================================================
# 主执行流程
# ============================================================================

# 遍历所有目标架构，为每个架构构建镜像
for arch in ${ARCHS}; do
  echo "正在为 ${arch} 架构构建沙箱镜像"
  
  # 创建根文件系统
  # $() 命令替换：执行命令并捕获输出
  rootfs=$(create_rootfs "${arch}")
  
  # 构建镜像
  build_image "${arch}" "${rootfs}"
  
  # 清理根文件系统目录
  ${SUDO} rm -rf "${rootfs}"
  
  echo "完成: ${OUT_DIR}/linux-${arch}.qcow2"
  echo
done
