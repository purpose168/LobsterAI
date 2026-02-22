#!/usr/bin/env bash
# -*- coding: utf-8 -*-
#
# Playwright CLI 启动脚本
# 用途：提供便捷的方式来运行 Playwright CLI 工具
# 作者：purpose168@outlook.com
# 创建日期：2026-02-22
#
# 使用方法：
#   ./playwright_cli.sh [选项] [参数]
#
# 环境变量：
#   PLAYWRIGHT_CLI_SESSION - 可选的会话标识符，用于保持浏览器会话状态
#
# 示例：
#   ./playwright_cli.sh --help
#   PLAYWRIGHT_CLI_SESSION=my-session ./playwright_cli.sh navigate https://example.com
#

# 设置严格的错误处理模式
# -e：当命令返回非零退出码时立即退出脚本
# -u：使用未定义的变量时报错
# -o pipefail：管道中任一命令失败时，整个管道返回失败状态
set -euo pipefail

# 检查 npx 是否可用
# command -v：检查命令是否存在并返回其路径
# >/dev/null 2>&1：将标准输出和标准错误都重定向到空设备（静默模式）
if ! command -v npx >/dev/null 2>&1; then
  echo "错误：需要 npx 但在 PATH 中未找到。" >&2
  exit 1
fi

# 初始化会话标志为 false
# 用于跟踪用户是否在命令行参数中指定了 --session 选项
has_session_flag="false"

# 遍历所有命令行参数，检查是否包含 --session 选项
# "$@"：表示所有位置参数的数组
for arg in "$@"; do
  case "$arg" in
    --session|--session=*)
      # 匹配 --session 或 --session=xxx 格式的参数
      has_session_flag="true"
      break  # 找到后立即退出循环，提高效率
      ;;
  esac
done

# 构建命令数组
# 使用数组可以安全地处理包含空格或特殊字符的参数
# npx --yes：自动安装并运行包，无需确认
# --package @playwright/mcp：指定要运行的包名称
cmd=(npx --yes --package @playwright/mcp playwright-cli)

# 如果用户未指定 --session 参数，但设置了环境变量，则自动添加会话参数
# ${PLAYWRIGHT_CLI_SESSION:-}：如果变量未定义则使用空字符串（避免 set -u 报错）
if [[ "${has_session_flag}" != "true" && -n "${PLAYWRIGHT_CLI_SESSION:-}" ]]; then
  cmd+=(--session "${PLAYWRIGHT_CLI_SESSION}")
fi

# 将所有用户提供的参数追加到命令数组末尾
cmd+=("$@")

# 执行构建的命令
# exec：用新命令替换当前 shell 进程，使 Playwright CLI 成为脚本的主进程
# "${cmd[@]}"：展开数组，每个元素作为独立的参数传递
exec "${cmd[@]}"
