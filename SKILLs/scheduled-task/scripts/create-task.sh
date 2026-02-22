#!/bin/bash
# 通过 LobsterAI 内部 API 创建计划任务
# 用法：bash "$SKILLS_ROOT/scheduled-task/scripts/create-task.sh" '<json_payload>'
#
# JSON 负载数据应遵循 ScheduledTaskInput 架构规范
# 返回 JSON 响应：{ "success": true, "task": { ... } } 或 { "success": false, "error": "..." }
#
# 环境变量（由 LobsterAI 协作会话自动设置）：
#   LOBSTERAI_API_BASE_URL - 内部代理 URL（始终指向本地代理）

# ============================================================================
# 全局变量定义
# ============================================================================

# HTTP 客户端节点命令路径
HTTP_NODE_CMD=""
# HTTP 客户端节点参数数组
HTTP_NODE_ARGS=()
# HTTP 客户端环境变量前缀数组
HTTP_NODE_ENV_PREFIX=()

# ============================================================================
# 函数定义
# ============================================================================

# ----------------------------------------------------------------------------
# 函数：is_windows_bash
# 用途：检测当前是否运行在 Windows 的 Bash 环境中
# 参数：无
# 返回值：
#   0 - 是 Windows Bash 环境（MINGW/MSYS/CYGWIN）
#   1 - 不是 Windows Bash 环境
# 说明：
#   uname -s 命令返回操作系统名称
#   MINGW、MSYS、CYGWIN 是 Windows 上常见的 Unix 模拟环境
# ----------------------------------------------------------------------------
is_windows_bash() {
  case "$(uname -s 2>/dev/null)" in
    MINGW*|MSYS*|CYGWIN*) return 0 ;;
    *) return 1 ;;
  esac
}

# ----------------------------------------------------------------------------
# 函数：resolve_http_node_runtime
# 用途：解析并设置用于 HTTP 请求的 Node.js 运行时环境
# 参数：无
# 返回值：
#   0 - 成功找到可用的 Node.js 运行时
#   1 - 未找到可用的 Node.js 运行时
# 说明：
#   优先级：1. 系统 node 命令  2. LobsterAI 内置的 Electron 环境
#   2>/dev/null 表示将标准错误输出重定向到空设备（静默错误信息）
# ----------------------------------------------------------------------------
resolve_http_node_runtime() {
  # 如果已经解析过，直接返回
  if [ -n "$HTTP_NODE_CMD" ]; then
    return 0
  fi

  # 首先检查系统是否安装了 Node.js
  # command -v 用于检查命令是否存在，> /dev/null 2>&1 表示静默所有输出
  if command -v node > /dev/null 2>&1; then
    HTTP_NODE_CMD="node"
    HTTP_NODE_ARGS=()
    HTTP_NODE_ENV_PREFIX=()
    return 0
  fi

  # 如果系统没有 Node.js，检查 LobsterAI 是否提供了 Electron 环境
  # ${VAR:-} 语法：如果 VAR 未设置，则使用默认值（空字符串）
  # -x 用于检查文件是否可执行
  if [ -n "${LOBSTERAI_ELECTRON_PATH:-}" ] && [ -x "${LOBSTERAI_ELECTRON_PATH}" ]; then
    HTTP_NODE_CMD="$LOBSTERAI_ELECTRON_PATH"
    HTTP_NODE_ARGS=()
    # 设置环境变量使 Electron 以 Node.js 模式运行
    HTTP_NODE_ENV_PREFIX=("ELECTRON_RUN_AS_NODE=1")
    return 0
  fi

  return 1
}

# ----------------------------------------------------------------------------
# 函数：http_post_json
# 用途：发送 HTTP POST 请求，提交 JSON 数据
# 参数：
#   $1 - URL：请求的目标 URL
#   $2 - BODY：要发送的 JSON 数据
# 返回值：
#   0 - 请求成功
#   127 - 未找到可用的 HTTP 客户端
#   其他 - HTTP 请求失败
# 说明：
#   在非 Windows 环境下，优先使用 curl 或 wget
#   在 Windows Git Bash 环境下，使用 Node.js fetch API 以避免编码问题
# ----------------------------------------------------------------------------
http_post_json() {
  local URL="$1"
  local BODY="$2"

  # 在 Windows Git Bash 环境中，优先使用 Node.js fetch API
  # 以避免通过 curl/wget 管道传输时可能出现的区域设置/代码页问题
  # 这些问题可能导致非 ASCII JSON 负载数据损坏
  if ! is_windows_bash; then
    # 尝试使用 curl 发送请求
    # -s：静默模式，不显示进度信息
    # -f：失败时返回非零退出码
    # -X POST：指定请求方法为 POST
    # -H：添加请求头
    # -d：指定请求体数据
    if command -v curl > /dev/null 2>&1; then
      if curl -s -f -X POST "$URL" \
        -H "Content-Type: application/json" \
        -d "$BODY"; then
        return 0
      fi
    fi

    # 如果 curl 不可用，尝试使用 wget
    if command -v wget > /dev/null 2>&1; then
      # BusyBox wget（常见于沙箱环境）不支持 GNU 专有标志
      # 如 --method/--body-data，因此使用 --post-data
      # -q：静默模式
      # -O-：将输出写入标准输出
      # --header：添加请求头
      # --post-data：发送 POST 数据
      if wget -q -O- \
        --header "Content-Type: application/json" \
        --post-data "$BODY" \
        "$URL"; then
        return 0
      fi
    fi
  fi

  # 如果 curl 和 wget 都不可用，尝试使用 Node.js 运行时
  if ! resolve_http_node_runtime; then
    return 127
  fi

  # 使用 Node.js 的 fetch API 发送请求
  # env 命令用于设置环境变量
  # "${HTTP_NODE_ENV_PREFIX[@]}" 展开环境变量数组
  # - 表示从标准输入读取脚本
  # <<'NODE' 是 here-document 语法，NODE 是分隔符
  # 单引号包围分隔符表示不进行变量替换
  env "${HTTP_NODE_ENV_PREFIX[@]}" "$HTTP_NODE_CMD" "${HTTP_NODE_ARGS[@]}" - "$URL" "$BODY" <<'NODE'
const [url, body] = process.argv.slice(2);

(async () => {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    const responseBody = await response.text();
    if (!response.ok) {
      if (responseBody) {
        process.stdout.write(responseBody);
      } else {
        process.stdout.write(
          JSON.stringify({
            success: false,
            error: `Request failed with status ${response.status}`,
          })
        );
      }
      process.exit(22);
    }
    process.stdout.write(responseBody);
  } catch (error) {
    const message =
      error && typeof error === 'object' && 'message' in error
        ? String(error.message)
        : 'HTTP request failed';
    process.stdout.write(JSON.stringify({ success: false, error: message }));
    process.exit(1);
  }
})();
NODE
}

# ============================================================================
# 主程序逻辑
# ============================================================================

# 检查必要的环境变量是否已设置
# -z 用于检查字符串是否为空
if [ -z "$LOBSTERAI_API_BASE_URL" ]; then
  echo '{"success":false,"error":"LOBSTERAI_API_BASE_URL 未设置。此脚本必须在 LobsterAI 协作会话中运行。"}'
  exit 1
fi

# 检查是否提供了 JSON 负载数据
if [ -z "$1" ]; then
  echo '{"success":false,"error":"未提供 JSON 负载数据。用法：create-task.sh '\''<json>'\''  "}'
  exit 1
fi

PAYLOAD="$1"

# 支持 @file 语法以避免在命令行中传递非 ASCII 文本时的编码问题
# 示例：
#   bash create-task.sh @/tmp/task.json
# ${VAR#pattern} 语法：从变量值开头删除最短匹配 pattern 的部分
# 如果 PAYLOAD 以 @ 开头，则 ${PAYLOAD#@} 会去掉 @ 符号
if [ "${PAYLOAD#@}" != "$PAYLOAD" ]; then
  PAYLOAD_FILE="${PAYLOAD#@}"
  # 检查文件是否存在
  if [ ! -f "$PAYLOAD_FILE" ]; then
    echo "{\"success\":false,\"error\":\"负载数据文件未找到：${PAYLOAD_FILE}\"}"
    exit 1
  fi
  # 读取文件内容作为负载数据
  # $(command) 是命令替换语法，将命令的输出赋值给变量
  PAYLOAD="$(cat "$PAYLOAD_FILE")"
fi

# LOBSTERAI_API_BASE_URL 始终指向本地代理：http://127.0.0.1:PORT
# ${VAR%pattern} 语法：从变量值末尾删除最短匹配 pattern 的部分
# 这里用于移除 URL 末尾可能存在的斜杠
BASE_URL="${LOBSTERAI_API_BASE_URL%/}"

# 发送 HTTP POST 请求创建计划任务
RESPONSE="$(http_post_json "${BASE_URL}/api/scheduled-tasks" "$PAYLOAD")"
CODE=$?

# 检查请求是否成功
# $? 保存上一个命令的退出状态码
if [ "$CODE" -ne 0 ]; then
  # 如果有响应内容，输出响应
  if [ -n "$RESPONSE" ]; then
    echo "$RESPONSE"
    exit "$CODE"
  fi

  # 根据错误码输出相应的错误信息
  if [ "$CODE" -eq 127 ]; then
    echo '{"success":false,"error":"无可用的 HTTP 客户端。请安装 curl/wget 或确保 Node/Electron 运行时可用。"}'
  else
    echo "{\"success\":false,\"error\":\"请求失败，退出码：${CODE}\"}"
  fi
  exit "$CODE"
fi

# 输出响应结果
echo "$RESPONSE"
