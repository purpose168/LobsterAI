#!/bin/bash
# 网络搜索命令行工具 - 为Claude提供的简化搜索接口
# 用途：提供便捷的网络搜索功能，支持多种搜索引擎
# 作者：LobsterAI团队
# 联系方式：purpose168@outlook.com

# ============================================================================
# 路径和配置初始化
# ============================================================================

# 获取脚本所在目录的绝对路径
# BASH_SOURCE[0]：当前脚本的路径
# dirname：获取目录部分
# cd ... && pwd：切换到目录并获取绝对路径
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 项目根目录（脚本目录的上一级）
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# 默认服务器地址
DEFAULT_SERVER_URL="http://127.0.0.1:8923"

# 服务器URL，优先使用环境变量WEB_SEARCH_SERVER，否则使用默认值
# 语法：${变量名:-默认值} 表示如果变量未设置则使用默认值
SERVER_URL="${WEB_SEARCH_SERVER:-$DEFAULT_SERVER_URL}"

# 当前活动的服务器URL
ACTIVE_SERVER_URL="$SERVER_URL"

# 连接缓存文件路径，用于存储浏览器连接ID
CONNECTION_CACHE="$PROJECT_DIR/.connection"

# ============================================================================
# 颜色定义（用于终端输出美化）
# ============================================================================

# ANSI颜色转义码
# 格式：\033[样式;前景色m
# 0：重置/正常，1：粗体，31-37：前景色
RED='\033[0;31m'      # 红色 - 用于错误信息
GREEN='\033[0;32m'    # 绿色 - 用于成功信息
YELLOW='\033[1;33m'   # 黄色（粗体） - 用于警告信息
BLUE='\033[0;34m'     # 蓝色 - 用于信息提示
NC='\033[0m'          # 无颜色（No Color） - 重置颜色

# ============================================================================
# HTTP客户端运行时配置
# ============================================================================

# Node.js/Electron运行时命令
HTTP_NODE_CMD=""

# Node.js/Electron运行时参数数组
HTTP_NODE_ARGS=()

# Node.js/Electron环境变量前缀数组
HTTP_NODE_ENV_PREFIX=()

# ============================================================================
# 系统检测函数
# ============================================================================

# 检测是否在Windows的Git Bash/MSYS/Cygwin环境中运行
# 返回值：0表示是Windows环境，1表示非Windows环境
# 说明：Windows环境下的curl/wget可能存在编码问题，需要特殊处理
is_windows_bash() {
  case "$(uname -s 2>/dev/null)" in
    MINGW*|MSYS*|CYGWIN*) return 0 ;;  # Windows环境
    *) return 1 ;;                      # 非Windows环境
  esac
}

# ============================================================================
# 使用说明
# ============================================================================

# 显示脚本使用帮助信息
# 参数：无
# 返回值：总是退出脚本（exit 1）
usage() {
  cat << EOF
用法: $(basename "$0") <搜索词|@文件路径> [最大结果数]

参数说明:
  搜索词        搜索查询内容（必需），或使用@UTF-8文件路径方式传入非ASCII字符
  最大结果数    返回的最大结果数量（默认: 10）

使用示例:
  $(basename "$0") "TypeScript教程" 5
  $(basename "$0") "React hooks" 10
  $(basename "$0") @query.txt 5    # 从文件读取搜索词

环境变量:
  WEB_SEARCH_SERVER   桥接服务器URL（默认: http://127.0.0.1:8923）
  WEB_SEARCH_ENGINE   首选搜索引擎: auto|google|bing（默认: auto）

EOF
  exit 1
}

# ============================================================================
# HTTP客户端运行时解析
# ============================================================================

# 解析并设置HTTP客户端运行时（Node.js或Electron）
# 优先级：1. Node.js命令  2. Electron（通过LOBSTERAI_ELECTRON_PATH环境变量）
# 返回值：0表示成功找到运行时，1表示未找到
resolve_http_node_runtime() {
  # 如果已经解析过，直接返回
  if [ -n "$HTTP_NODE_CMD" ]; then
    return 0
  fi

  # 检查是否有node命令可用
  # command -v：检查命令是否存在
  # >/dev/null 2>&1：将标准输出和错误输出都重定向到空设备
  if command -v node > /dev/null 2>&1; then
    HTTP_NODE_CMD="node"
    HTTP_NODE_ARGS=()
    HTTP_NODE_ENV_PREFIX=()
    return 0
  fi

  # 检查是否有Electron运行时可用
  # ${变量:-}：如果变量未设置则使用空字符串
  # -x：检查文件是否可执行
  if [ -n "${LOBSTERAI_ELECTRON_PATH:-}" ] && [ -x "${LOBSTERAI_ELECTRON_PATH}" ]; then
    HTTP_NODE_CMD="$LOBSTERAI_ELECTRON_PATH"
    HTTP_NODE_ARGS=()
    # Electron需要设置ELECTRON_RUN_AS_NODE环境变量才能作为Node.js运行
    HTTP_NODE_ENV_PREFIX=("ELECTRON_RUN_AS_NODE=1")
    return 0
  fi

  return 1
}

# ============================================================================
# HTTP请求函数
# ============================================================================

# 执行HTTP请求
# 参数：
#   $1 - METHOD：HTTP方法（GET、POST等）
#   $2 - URL：请求URL
#   $3 - BODY：请求体（可选，用于POST请求）
# 返回值：0表示成功，非0表示失败
# 说明：
#   1. 在非Windows环境下优先使用curl或wget
#   2. 在Windows环境下使用Node.js fetch API避免编码问题
#   3. 如果curl/wget不可用，回退到Node.js
http_request() {
  local METHOD="$1"
  local URL="$2"
  local BODY="${3:-}"

  # 在Windows Git Bash/MSYS/Cygwin环境下，优先使用Node fetch
  # 原因：避免curl/wget命令行参数中的非ASCII字符编码问题
  if ! is_windows_bash; then
    # 尝试使用curl
    if command -v curl > /dev/null 2>&1; then
      if [ "$METHOD" = "GET" ]; then
        # curl参数说明：
        # -s：静默模式，不显示进度
        # -f：失败时返回非零退出码
        if curl -s -f "$URL" 2>/dev/null; then
          return 0
        fi
      else
        # POST请求
        # -X：指定HTTP方法
        # -H：添加请求头
        # -d：指定请求体数据
        if curl -s -f -X "$METHOD" "$URL" \
          -H "Content-Type: application/json" \
          -d "$BODY" 2>/dev/null; then
          return 0
        fi
      fi
    fi

    # 尝试使用wget
    if command -v wget > /dev/null 2>&1; then
      if [ "$METHOD" = "GET" ]; then
        # wget参数说明：
        # -q：静默模式
        # -O-：输出到标准输出
        if wget -q -O- "$URL" 2>/dev/null; then
          return 0
        fi
      else
        # POST请求
        # --method：指定HTTP方法
        # --header：添加请求头
        # --body-data：指定请求体数据
        if wget -q -O- --method="$METHOD" \
          --header="Content-Type: application/json" \
          --body-data="$BODY" \
          "$URL" 2>/dev/null; then
          return 0
        fi
      fi
    fi
  fi

  # 使用Node.js/Electron运行时发送请求
  if ! resolve_http_node_runtime; then
    return 127  # 命令未找到
  fi

  # 执行Node.js脚本发送HTTP请求
  # env：设置环境变量后执行命令
  # "${HTTP_NODE_ENV_PREFIX[@]}"：展开环境变量数组
  # -：从标准输入读取脚本
  env "${HTTP_NODE_ENV_PREFIX[@]}" "$HTTP_NODE_CMD" "${HTTP_NODE_ARGS[@]}" - "$METHOD" "$URL" "$BODY" <<'NODE'
const [method, url, body] = process.argv.slice(2);

(async () => {
  try {
    const init = { method };
    if (method !== 'GET') {
      init.headers = { 'Content-Type': 'application/json' };
      init.body = body ?? '';
    }
    const response = await fetch(url, init);
    if (!response.ok) {
      process.exit(22);  // EINVAL - 无效参数
    }
    process.stdout.write(await response.text());
  } catch {
    process.exit(1);
  }
})();
NODE
}

# 执行HTTP GET请求
# 参数：
#   $1 - URL：请求URL
# 返回值：继承http_request的返回值
http_get() {
  http_request "GET" "$1"
}

# 执行HTTP POST请求（JSON格式）
# 参数：
#   $1 - URL：请求URL
#   $2 - BODY：JSON请求体（可选，默认为空对象{}）
# 返回值：继承http_request的返回值
http_post_json() {
  local BODY="${2:-}"
  if [ -z "$BODY" ]; then
    BODY='{}'
  fi

  http_request "POST" "$1" "$BODY"
}

# ============================================================================
# 搜索载荷构建
# ============================================================================

# 构建搜索请求的JSON载荷
# 参数：
#   $1 - CONNECTION_ID：浏览器连接ID
#   $2 - QUERY：搜索查询词
#   $3 - MAX_RESULTS：最大结果数
#   $4 - ENGINE：搜索引擎（auto/google/bing）
# 返回值：输出JSON字符串到标准输出
# 说明：优先使用Node.js构建JSON以确保正确的编码处理
build_search_payload() {
  local CONNECTION_ID="$1"
  local QUERY="$2"
  local MAX_RESULTS="$3"
  local ENGINE="$4"

  # 使用Node.js构建JSON载荷
  if resolve_http_node_runtime; then
    env "${HTTP_NODE_ENV_PREFIX[@]}" "$HTTP_NODE_CMD" "${HTTP_NODE_ARGS[@]}" - "$CONNECTION_ID" "$QUERY" "$MAX_RESULTS" "$ENGINE" <<'NODE'
const [connectionId, query, maxResultsRaw, engineRaw] = process.argv.slice(2);
const maxResults = Number.parseInt(maxResultsRaw, 10);
const engine = engineRaw || 'auto';

process.stdout.write(JSON.stringify({
  connectionId,
  query,
  maxResults: Number.isFinite(maxResults) ? maxResults : 10,
  engine,
}));
NODE
    return $?
  fi

  # 回退方案：当Node运行时不可用时使用shell构建JSON
  # 注意：这种方式可能存在编码问题
  # sed：转义特殊字符（反斜杠和双引号）
  local ESCAPED_QUERY
  ESCAPED_QUERY=$(printf '%s' "$QUERY" | sed 's/\\/\\\\/g; s/"/\\"/g')
  printf '{"connectionId":"%s","query":"%s","maxResults":%s,"engine":"%s"}' \
    "$CONNECTION_ID" "$ESCAPED_QUERY" "${MAX_RESULTS:-10}" "${ENGINE:-auto}"
}

# ============================================================================
# HTTP客户端可用性检查
# ============================================================================

# 确保HTTP客户端可用
# 返回值：0表示可用，1表示不可用
# 说明：检查curl、wget或Node.js运行时是否可用
ensure_http_client_available() {
  # Windows环境必须使用Node.js
  if is_windows_bash; then
    if resolve_http_node_runtime; then
      return 0
    fi
    echo -e "${RED}✗ Windows环境下没有可用的HTTP客户端${NC}" >&2
    echo -e "${YELLOW}  Windows Shell模式下需要Node/Electron运行时。${NC}" >&2
    return 1
  fi

  # 检查curl
  if command -v curl > /dev/null 2>&1; then
    return 0
  fi

  # 检查wget
  if command -v wget > /dev/null 2>&1; then
    return 0
  fi

  # 检查Node.js运行时
  if resolve_http_node_runtime; then
    return 0
  fi

  echo -e "${RED}✗ 没有可用的HTTP客户端${NC}" >&2
  echo -e "${YELLOW}  请安装curl或wget，或确保Node/Electron运行时可用。${NC}" >&2
  return 1
}

# ============================================================================
# 服务器健康检查
# ============================================================================

# 检查服务器是否健康运行
# 参数：
#   $1 - BASE_URL：服务器基础URL
# 返回值：0表示健康，1表示不健康
is_server_healthy() {
  local BASE_URL="${1%/}"  # 移除末尾的斜杠
  local HEALTH_RESPONSE
  HEALTH_RESPONSE=$(http_get "$BASE_URL/api/health" || true)
  # 检查响应中是否包含"success":true
  echo "$HEALTH_RESPONSE" | grep -q '"success":true'
}

# 尝试切换到本地服务器
# 返回值：0表示切换成功，1表示切换失败
# 说明：当配置的服务器不可用时，尝试切换到默认本地服务器
try_switch_to_local_server() {
  # 如果当前已经是默认服务器，无需切换
  if [ "$ACTIVE_SERVER_URL" = "$DEFAULT_SERVER_URL" ]; then
    return 1
  fi

  # 检查本地服务器是否健康
  if is_server_healthy "$DEFAULT_SERVER_URL"; then
    echo -e "${YELLOW}$ACTIVE_SERVER_URL 的桥接服务器不可用，回退到 ${DEFAULT_SERVER_URL}${NC}" >&2
    ACTIVE_SERVER_URL="$DEFAULT_SERVER_URL"
    return 0
  fi

  return 1
}

# ============================================================================
# 服务器检查和启动
# ============================================================================

# 检查服务器是否运行，如未运行则尝试启动
# 返回值：0表示服务器可用，exit 1表示服务器不可用
check_server() {
  # 检查当前服务器是否健康
  if is_server_healthy "$ACTIVE_SERVER_URL"; then
    return 0
  fi

  # 尝试切换到本地服务器
  if try_switch_to_local_server; then
    return 0
  fi

  # 尝试启动服务器
  echo -e "${YELLOW}桥接服务器未运行，正在尝试启动...${NC}" >&2
  if ! WEB_SEARCH_SERVER="$ACTIVE_SERVER_URL" bash "$SCRIPT_DIR/start-server.sh" > /dev/null 2>&1; then
    # 启动脚本返回错误，但服务器可能已经可用
    if is_server_healthy "$ACTIVE_SERVER_URL" || try_switch_to_local_server; then
      echo -e "${YELLOW}桥接服务器启动返回错误，但已有健康的服务器可用。继续执行...${NC}" >&2
      return 0
    fi
    echo -e "${RED}✗ 自动启动桥接服务器失败${NC}" >&2
    echo -e "${YELLOW}  请尝试手动启动: bash $SCRIPT_DIR/start-server.sh${NC}" >&2
    # 显示最近的日志
    if [ -f "$PROJECT_DIR/.server.log" ]; then
      echo -e "${YELLOW}  最近日志:${NC}" >&2
      tail -20 "$PROJECT_DIR/.server.log" >&2
    fi
    exit 1
  fi

  # 等待服务器启动
  sleep 2
  if is_server_healthy "$ACTIVE_SERVER_URL"; then
    return 0
  fi

  # 再次尝试切换到本地服务器
  if try_switch_to_local_server; then
    return 0
  fi

  # 服务器仍然不可用
  if ! is_server_healthy "$ACTIVE_SERVER_URL"; then
    echo -e "${RED}✗ 桥接服务器启动后仍然不可用${NC}" >&2
    echo -e "${YELLOW}  检查的端点: $ACTIVE_SERVER_URL/api/health${NC}" >&2
    if [ -f "$PROJECT_DIR/.server.log" ]; then
      echo -e "${YELLOW}  最近日志:${NC}" >&2
      tail -20 "$PROJECT_DIR/.server.log" >&2
    fi
    exit 1
  fi
}

# ============================================================================
# 运行时错误检测
# ============================================================================

# 检测是否为iconv运行时错误
# 参数：
#   $1 - RESPONSE：服务器响应
# 返回值：0表示是iconv错误，1表示不是
is_iconv_runtime_error() {
  local RESPONSE="$1"
  # 检查是否包含"Cannot find module"和"encodings"
  if echo "$RESPONSE" | grep -q "Cannot find module" && echo "$RESPONSE" | grep -q "encodings"; then
    return 0
  fi
  return 1
}

# 检测是否为连接运行时错误
# 参数：
#   $1 - RESPONSE：服务器响应
# 返回值：0表示是连接错误，1表示不是
is_connection_runtime_error() {
  local RESPONSE="$1"
  # 检查各种连接相关的错误消息
  if echo "$RESPONSE" | grep -q "Connection not found"; then
    return 0
  fi
  if echo "$RESPONSE" | grep -q "Connection not active"; then
    return 0
  fi
  if echo "$RESPONSE" | grep -q "Connection became invalid"; then
    return 0
  fi
  if echo "$RESPONSE" | grep -q "browserContext.newPage"; then
    return 0
  fi
  if echo "$RESPONSE" | grep -q "Target page, context or browser has been closed"; then
    return 0
  fi
  if echo "$RESPONSE" | grep -q "Failed to connect to CDP"; then
    return 0
  fi
  return 1
}

# ============================================================================
# 服务器运行时修复
# ============================================================================

# 修复服务器运行时问题
# 返回值：0表示修复成功，1表示修复失败
repair_server_runtime() {
  echo -e "${YELLOW}检测到web-search运行时损坏，正在尝试自动修复...${NC}" >&2
  # 删除连接缓存
  rm -f "$CONNECTION_CACHE"
  # 停止服务器
  bash "$SCRIPT_DIR/stop-server.sh" > /dev/null 2>&1 || true

  # 强制修复模式启动服务器
  if ! WEB_SEARCH_FORCE_REPAIR=1 bash "$SCRIPT_DIR/start-server.sh" > /dev/null 2>&1; then
    echo -e "${RED}✗ 修复web-search运行时失败${NC}" >&2
    if [ -f "$PROJECT_DIR/.server.log" ]; then
      echo -e "${YELLOW}  最近日志:${NC}" >&2
      tail -20 "$PROJECT_DIR/.server.log" >&2
    fi
    return 1
  fi

  # 等待服务器启动
  sleep 2
  return 0
}

# ============================================================================
# 连接缓存验证
# ============================================================================

# 检查缓存的连接是否有效
# 参数：
#   $1 - CONNECTION_ID：连接ID
# 返回值：0表示有效，1表示无效
is_cached_connection_valid() {
  local CONNECTION_ID="$1"
  local VALIDATE_RESPONSE
  # 尝试获取页面文本以验证连接
  VALIDATE_RESPONSE=$(http_post_json "$ACTIVE_SERVER_URL/api/page/text" "{\"connectionId\":\"$CONNECTION_ID\"}" || true)

  # 检查响应是否成功
  if echo "$VALIDATE_RESPONSE" | grep -q '"success":true'; then
    return 0
  fi

  # 检查是否为连接运行时错误
  if is_connection_runtime_error "$VALIDATE_RESPONSE"; then
    return 1
  fi

  # 未知的验证失败，不应阻止新连接的创建
  return 1
}

# ============================================================================
# 浏览器连接管理
# ============================================================================

# 获取或创建浏览器连接
# 参数：
#   $1 - ATTEMPT：尝试次数（可选，默认1）
# 返回值：输出连接ID到标准输出，返回0表示成功，1表示失败
get_connection() {
  local ATTEMPT="${1:-1}"
  local CONNECTION_ID=""

  # 尝试使用缓存的连接
  if [ -f "$CONNECTION_CACHE" ]; then
    CONNECTION_ID=$(cat "$CONNECTION_CACHE")

    # 验证缓存的连接是否实际可用
    if [ -n "$CONNECTION_ID" ] && is_cached_connection_valid "$CONNECTION_ID"; then
      echo "$CONNECTION_ID"
      return 0
    fi

    # 缓存的连接已过期，删除缓存
    rm -f "$CONNECTION_CACHE"
  fi

  # 启动浏览器（如果未运行）
  local LAUNCH_RESPONSE
  LAUNCH_RESPONSE=$(http_post_json "$ACTIVE_SERVER_URL/api/browser/launch" "{}" || true)

  # 检查启动是否成功
  if ! echo "$LAUNCH_RESPONSE" | grep -q '"success":true'; then
    # 如果是iconv运行时错误，尝试修复
    if [ "$ATTEMPT" -eq 1 ] && is_iconv_runtime_error "$LAUNCH_RESPONSE"; then
      if repair_server_runtime; then
        get_connection 2
        return $?
      fi
    fi
    # 如果是连接运行时错误，尝试修复
    if [ "$ATTEMPT" -eq 1 ] && is_connection_runtime_error "$LAUNCH_RESPONSE"; then
      rm -f "$CONNECTION_CACHE"
      bash "$SCRIPT_DIR/stop-server.sh" > /dev/null 2>&1 || true
      if WEB_SEARCH_FORCE_REPAIR=1 bash "$SCRIPT_DIR/start-server.sh" > /dev/null 2>&1; then
        get_connection 2
        return $?
      fi
    fi
    echo -e "${RED}✗ 启动浏览器失败${NC}" >&2
    echo "$LAUNCH_RESPONSE" >&2
    return 1
  fi

  # 连接到浏览器
  local CONNECT_RESPONSE
  CONNECT_RESPONSE=$(http_post_json "$ACTIVE_SERVER_URL/api/browser/connect" "{}" || true)

  # 检查连接是否成功
  if ! echo "$CONNECT_RESPONSE" | grep -q '"success":true'; then
    # 如果是iconv运行时错误，尝试修复
    if [ "$ATTEMPT" -eq 1 ] && is_iconv_runtime_error "$CONNECT_RESPONSE"; then
      if repair_server_runtime; then
        get_connection 2
        return $?
      fi
    fi
    # 如果是连接运行时错误，尝试修复
    if [ "$ATTEMPT" -eq 1 ] && is_connection_runtime_error "$CONNECT_RESPONSE"; then
      rm -f "$CONNECTION_CACHE"
      bash "$SCRIPT_DIR/stop-server.sh" > /dev/null 2>&1 || true
      if WEB_SEARCH_FORCE_REPAIR=1 bash "$SCRIPT_DIR/start-server.sh" > /dev/null 2>&1; then
        get_connection 2
        return $?
      fi
    fi
    echo -e "${RED}✗ 连接浏览器失败${NC}" >&2
    echo "$CONNECT_RESPONSE" >&2
    return 1
  fi

  # 提取连接ID
  # grep -o：只输出匹配的部分
  # cut -d'"' -f4：以双引号为分隔符，取第4个字段
  CONNECTION_ID=$(echo "$CONNECT_RESPONSE" | grep -o '"connectionId":"[^"]*"' | cut -d'"' -f4)

  if [ -z "$CONNECTION_ID" ]; then
    echo -e "${RED}✗ 获取连接ID失败${NC}" >&2
    return 1
  fi

  # 缓存连接ID
  echo "$CONNECTION_ID" > "$CONNECTION_CACHE"
  echo "$CONNECTION_ID"
}

# ============================================================================
# 搜索执行
# ============================================================================

# 执行搜索
# 参数：
#   $1 - QUERY：搜索查询词
#   $2 - MAX_RESULTS：最大结果数（可选，默认10）
#   $3 - CONNECTION_ID：浏览器连接ID
#   $4 - ATTEMPT：尝试次数（可选，默认1）
# 返回值：0表示成功，1表示失败
search() {
  local QUERY="$1"
  local MAX_RESULTS="${2:-10}"
  local CONNECTION_ID="$3"
  local ATTEMPT="${4:-1}"
  local ENGINE="${WEB_SEARCH_ENGINE:-auto}"

  # 显示搜索提示
  echo -e "${BLUE}🔍 正在搜索: \"$QUERY\"${NC}" >&2
  echo "" >&2

  # 通过API执行搜索
  local SEARCH_RESPONSE
  local SEARCH_PAYLOAD
  # 构建搜索载荷
  if ! SEARCH_PAYLOAD="$(build_search_payload "$CONNECTION_ID" "$QUERY" "$MAX_RESULTS" "$ENGINE")"; then
    echo -e "${RED}✗ 构建搜索载荷失败${NC}" >&2
    return 1
  fi

  # 发送搜索请求
  SEARCH_RESPONSE=$(http_post_json "$ACTIVE_SERVER_URL/api/search" "$SEARCH_PAYLOAD" || true)

  # 检查搜索是否成功
  if ! echo "$SEARCH_RESPONSE" | grep -q '"success":true'; then
    # 如果是iconv运行时错误，尝试修复后重试
    if [ "$ATTEMPT" -eq 1 ] && is_iconv_runtime_error "$SEARCH_RESPONSE"; then
      if repair_server_runtime; then
        if CONNECTION_ID="$(get_connection 2)"; then
          search "$QUERY" "$MAX_RESULTS" "$CONNECTION_ID" 2
          return $?
        fi
        return 1
      fi
    fi
    # 如果是连接运行时错误，重新获取连接后重试
    if [ "$ATTEMPT" -eq 1 ] && is_connection_runtime_error "$SEARCH_RESPONSE"; then
      rm -f "$CONNECTION_CACHE"
      if CONNECTION_ID="$(get_connection 2)"; then
        search "$QUERY" "$MAX_RESULTS" "$CONNECTION_ID" 2
        return $?
      fi
    fi
    echo -e "${RED}✗ 搜索失败${NC}" >&2
    echo "$SEARCH_RESPONSE" >&2
    return 1
  fi

  # 解析并显示结果
  # 提取搜索耗时
  local DURATION=$(echo "$SEARCH_RESPONSE" | grep -o '"duration":[0-9]*' | cut -d':' -f2)
  # 提取总结果数
  local TOTAL=$(echo "$SEARCH_RESPONSE" | grep -o '"totalResults":[0-9]*' | cut -d':' -f2)
  # 提取使用的搜索引擎
  local ENGINE_USED=$(echo "$SEARCH_RESPONSE" | grep -o '"engine":"[^"]*"' | cut -d'"' -f4)

  if [ -z "$ENGINE_USED" ]; then
    ENGINE_USED="未知"
  fi

  # 显示搜索统计信息
  echo -e "${GREEN}✓ 找到 $TOTAL 个结果，耗时 ${DURATION}ms（引擎: ${ENGINE_USED}）${NC}" >&2
  echo "" >&2

  # 以Markdown格式输出结果
  echo "# 搜索结果: $QUERY"
  echo ""
  echo "**搜索词:** $QUERY  "
  echo "**搜索引擎:** $ENGINE_USED  "
  echo "**结果数:** $TOTAL  "
  echo "**耗时:** ${DURATION}ms  "
  echo ""
  echo "---"
  echo ""

  # 提取并格式化每个结果
  # 注意：这是一个简化的解析器。生产环境建议使用jq或node.js
  # while IFS= read -r：逐行读取，保留前导空格
  echo "$SEARCH_RESPONSE" | grep -o '"title":"[^"]*","url":"[^"]*","snippet":"[^"]*"' | while IFS= read -r result; do
    # 提取标题
    local TITLE=$(echo "$result" | sed -n 's/.*"title":"\([^"]*\)".*/\1/p')
    # 提取URL
    local URL=$(echo "$result" | sed -n 's/.*"url":"\([^"]*\)".*/\1/p')
    # 提取摘要
    local SNIPPET=$(echo "$result" | sed -n 's/.*"snippet":"\([^"]*\)".*/\1/p')

    # 输出格式化的结果
    echo "## $TITLE"
    echo ""
    echo "**链接:** [$URL]($URL)"
    echo ""
    echo "$SNIPPET"
    echo ""
    echo "---"
    echo ""
  done
}

# ============================================================================
# 主程序入口
# ============================================================================

# 主函数
# 参数：命令行参数
# 返回值：0表示成功，非0表示失败
main() {
  # 解析参数
  if [ $# -lt 1 ]; then
    usage
  fi

  local QUERY_ARG="$1"
  local QUERY="$QUERY_ARG"
  local MAX_RESULTS="${2:-10}"

  # 支持@文件语法，避免非ASCII查询词的命令行编码问题
  # ${变量#模式}：删除从开头匹配的最短部分
  if [ "${QUERY_ARG#@}" != "$QUERY_ARG" ]; then
    local QUERY_FILE="${QUERY_ARG#@}"
    if [ ! -f "$QUERY_FILE" ]; then
      echo -e "${RED}✗ 查询文件不存在: $QUERY_FILE${NC}" >&2
      exit 1
    fi
    QUERY="$(cat "$QUERY_FILE")"
  fi

  # 确保HTTP客户端可用
  if ! ensure_http_client_available; then
    exit 1
  fi

  # 检查服务器
  check_server

  # 获取连接
  local CONNECTION_ID=""
  if ! CONNECTION_ID="$(get_connection)"; then
    exit 1
  fi

  # 执行搜索
  if ! search "$QUERY" "$MAX_RESULTS" "$CONNECTION_ID" 1; then
    exit 1
  fi
}

# ============================================================================
# 脚本执行入口
# ============================================================================

# 运行主函数，传递所有命令行参数
# "$@"：展开所有位置参数，保持参数中的空格和引号
main "$@"
