#!/bin/bash
# 启动Web搜索桥接服务器
# 用途：启动并管理Web搜索桥接服务器进程
# 作者：purpose168@outlook.com
# 创建日期：2026-02-22

# ============================================================================
# 路径和配置变量设置
# ============================================================================

# 获取脚本所在目录的绝对路径
# ${BASH_SOURCE[0]}：当前脚本的路径
# dirname：获取目录名
# cd ... && pwd：切换到目录并获取绝对路径
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 获取项目根目录（脚本目录的上一级）
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# PID文件路径：用于存储服务器进程ID
PID_FILE="$PROJECT_DIR/.server.pid"

# 日志文件路径：用于存储服务器输出日志
LOG_FILE="$PROJECT_DIR/.server.log"

# 服务器入口文件：编译后的JavaScript文件
SERVER_ENTRY="dist/server/index.js"

# 强制修复标志：从环境变量读取，默认为0（不强制修复）
# ${VAR:-default}：如果VAR未设置或为空，则使用default值
FORCE_REPAIR="${WEB_SEARCH_FORCE_REPAIR:-0}"

# 服务器监听端口
SERVER_PORT="8923"

# 默认服务器URL
DEFAULT_SERVER_URL="http://127.0.0.1:8923"

# 实际使用的服务器URL：优先使用环境变量中的配置
SERVER_URL="${WEB_SEARCH_SERVER:-$DEFAULT_SERVER_URL}"

# 健康的服务器URL：用于存储检测到的健康服务器地址
HEALTHY_SERVER_URL=""

# ============================================================================
# Node.js运行时相关变量
# ============================================================================

# Node.js命令路径
NODE_CMD=""

# Node.js命令参数数组
NODE_ARGS=()

# Node.js环境变量前缀数组
NODE_ENV_PREFIX=()

# ============================================================================
# 函数定义：解析Node.js运行时
# ============================================================================
# 功能：检测系统中可用的Node.js运行时
# 优先级：1. 系统node命令  2. LobsterAI的Electron运行时
# 返回值：0表示成功找到运行时，1表示未找到
resolve_node_runtime() {
  # 方法1：检查系统是否安装了node命令
  # command -v：检查命令是否存在
  # > /dev/null 2>&1：将标准输出和错误输出都重定向到空设备（静默模式）
  if command -v node > /dev/null 2>&1; then
    NODE_CMD="node"
    NODE_ARGS=()
    NODE_ENV_PREFIX=()
    return 0
  fi

  # 方法2：检查LobsterAI的Electron路径是否可用
  # [ -n "string" ]：字符串不为空
  # [ -x "file" ]：文件存在且可执行
  if [ -n "${LOBSTERAI_ELECTRON_PATH:-}" ] && [ -x "${LOBSTERAI_ELECTRON_PATH}" ]; then
    NODE_CMD="$LOBSTERAI_ELECTRON_PATH"
    NODE_ARGS=()
    # 设置Electron以Node.js模式运行的环境变量
    NODE_ENV_PREFIX=("ELECTRON_RUN_AS_NODE=1")
    return 0
  fi

  # 未找到可用的Node.js运行时
  return 1
}

# ============================================================================
# 函数定义：HTTP GET请求
# ============================================================================
# 功能：使用可用的HTTP客户端发送GET请求
# 参数：$1 - 请求的URL
# 返回值：0表示成功，非0表示失败
# 支持的客户端：curl、wget、Node.js fetch
http_get() {
  local URL="$1"

  # 方法1：使用curl命令
  # -s：静默模式，不显示进度信息
  # -f：失败时返回非零退出码
  if command -v curl > /dev/null 2>&1; then
    if curl -s -f "$URL" 2>/dev/null; then
      return 0
    fi
  fi

  # 方法2：使用wget命令
  # -q：静默模式
  # -O-：将输出写入标准输出
  if command -v wget > /dev/null 2>&1; then
    if wget -q -O- "$URL" 2>/dev/null; then
      return 0
    fi
  fi

  # 方法3：使用Node.js的fetch API
  # 如果curl和wget都不可用，则使用Node.js
  if ! resolve_node_runtime; then
    return 127  # 返回127表示命令未找到
  fi

  # 使用heredoc传递Node.js代码
  # env：设置环境变量后执行命令
  # <<'NODE'：heredoc语法，NODE是结束标记，单引号表示不进行变量替换
  env "${NODE_ENV_PREFIX[@]}" "$NODE_CMD" "${NODE_ARGS[@]}" - "$URL" <<'NODE'
const [url] = process.argv.slice(2);

(async () => {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      process.exit(22);  // 退出码22表示HTTP错误
    }
    process.stdout.write(await response.text());
  } catch {
    process.exit(1);  // 退出码1表示一般错误
  }
})();
NODE
}

# ============================================================================
# 函数定义：确保npm可用
# ============================================================================
# 功能：检查npm命令是否可用
# 返回值：0表示可用，1表示不可用
ensure_npm_available() {
  if command -v npm > /dev/null 2>&1; then
    return 0
  fi

  echo "✗ npm不可用，无法修复web-search运行时"
  echo "  请从LobsterAI重新安装web-search技能运行时。"
  return 1
}

# ============================================================================
# 函数定义：安装依赖
# ============================================================================
# 功能：使用npm安装项目依赖
# 返回值：0表示成功，1表示失败
install_dependencies() {
  echo "正在安装依赖..."
  # npm install：安装package.json中定义的所有依赖
  # > /dev/null 2>&1：静默模式，不显示输出
  if ! npm install > /dev/null 2>&1; then
    echo "✗ 安装依赖失败"
    echo "  请检查网络连接和npm日志，然后重试。"
    return 1
  fi
  return 0
}

# ============================================================================
# 函数定义：修复iconv-lite依赖
# ============================================================================
# 功能：重新安装iconv-lite包以修复不完整的安装
# 返回值：0表示成功，1表示失败
repair_iconv_lite() {
  echo "正在修复不完整的iconv-lite安装..."
  # rm -rf：递归强制删除目录
  rm -rf "node_modules/iconv-lite"
  # --no-save：不修改package.json
  if ! npm install --no-save iconv-lite > /dev/null 2>&1; then
    echo "✗ 修复iconv-lite依赖失败"
    return 1
  fi
  return 0
}

# ============================================================================
# 函数定义：验证iconv运行时
# ============================================================================
# 功能：验证iconv-lite模块是否可以正常加载
# 返回值：0表示成功，非0表示失败
verify_iconv_runtime() {
  # -e：执行JavaScript代码后退出
  # require()：加载Node.js模块
  env "${NODE_ENV_PREFIX[@]}" "$NODE_CMD" "${NODE_ARGS[@]}" -e "require('./node_modules/iconv-lite/lib/index.js')" > /dev/null 2>&1
}

# ============================================================================
# 函数定义：终止占用服务器端口的进程
# ============================================================================
# 功能：强制终止所有监听服务器端口的进程
# 返回值：总是返回0
kill_listeners_on_server_port() {
  # 检查lsof命令是否可用
  # lsof：列出打开的文件和网络连接
  if ! command -v lsof > /dev/null 2>&1; then
    return 0
  fi

  local PIDS
  # -ti：只输出PID
  # tcp:$SERVER_PORT：指定TCP端口
  # -sTCP:LISTEN：只显示监听状态的连接
  # tr '\n' ' '：将换行符替换为空格
  PIDS=$(lsof -ti "tcp:$SERVER_PORT" -sTCP:LISTEN 2>/dev/null | tr '\n' ' ')
  
  # 如果没有找到进程，直接返回
  if [ -z "$PIDS" ]; then
    return 0
  fi

  echo "已启用强制修复，正在停止端口 $SERVER_PORT 上的监听进程: $PIDS"
  
  # 第一轮：尝试优雅终止进程（发送SIGTERM信号）
  for PID in $PIDS; do
    kill "$PID" > /dev/null 2>&1 || true
  done

  # 等待进程退出
  sleep 1

  # 第二轮：强制终止未退出的进程（发送SIGKILL信号）
  # ps -p：检查进程是否存在
  for PID in $PIDS; do
    if ps -p "$PID" > /dev/null 2>&1; then
      kill -9 "$PID" > /dev/null 2>&1 || true
    fi
  done
}

# ============================================================================
# 函数定义：检查桥接服务器健康状态
# ============================================================================
# 功能：检查指定URL的服务器是否健康
# 参数：$1 - 服务器基础URL
# 返回值：0表示健康，1表示不健康
is_bridge_server_healthy_at() {
  local BASE_URL="${1%/}"  # ${var%/}：删除末尾的斜杠
  local HEALTH_URL="$BASE_URL/api/health"
  local HEALTH_RESPONSE
  
  # 发送健康检查请求
  HEALTH_RESPONSE=$(http_get "$HEALTH_URL" || true)

  # 检查响应中是否包含成功标志
  # grep -q：静默模式，只返回退出码
  if echo "$HEALTH_RESPONSE" | grep -q '"success":true'; then
    return 0
  fi

  return 1
}

# ============================================================================
# 函数定义：检测健康的桥接服务器
# ============================================================================
# 功能：在候选URL列表中查找健康的服务器
# 返回值：0表示找到，1表示未找到
# 副作用：设置HEALTHY_SERVER_URL变量
detect_healthy_bridge_server() {
  # 创建候选URL数组，优先检查配置的URL
  local CANDIDATES=("$SERVER_URL")

  # 如果配置的URL不是默认URL，则添加默认URL作为备选
  if [ "$SERVER_URL" != "$DEFAULT_SERVER_URL" ]; then
    CANDIDATES+=("$DEFAULT_SERVER_URL")
  fi

  # 遍历所有候选URL
  for CANDIDATE in "${CANDIDATES[@]}"; do
    if is_bridge_server_healthy_at "$CANDIDATE"; then
      HEALTHY_SERVER_URL="$CANDIDATE"
      return 0
    fi
  done

  return 1
}

# ============================================================================
# 主流程开始
# ============================================================================

# 如果未请求强制修复，且目标端口上已有健康的桥接服务器在运行
# 则将其视为已运行状态，即使PID文件不存在
if [ "$FORCE_REPAIR" != "1" ] && detect_healthy_bridge_server; then
  echo "✓ 桥接服务器已在运行（通过健康检查端点检测到: ${HEALTHY_SERVER_URL%/}/api/health）"
  exit 0
fi

# 检查服务器是否已经运行（通过PID文件）
if [ -f "$PID_FILE" ]; then
  # 读取PID文件中的进程ID
  PID=$(cat "$PID_FILE")
  
  # 检查进程是否存在
  # ps -p：根据PID检查进程
  if ps -p "$PID" > /dev/null 2>&1; then
    # 如果启用了强制修复，则停止现有服务器
    if [ "$FORCE_REPAIR" = "1" ]; then
      echo "已启用强制修复，正在停止现有的桥接服务器（PID: $PID）..."
      kill "$PID" > /dev/null 2>&1 || true
      sleep 1
      # 如果进程还在运行，强制终止
      if ps -p "$PID" > /dev/null 2>&1; then
        kill -9 "$PID" > /dev/null 2>&1 || true
      fi
      # 删除PID文件
      rm -f "$PID_FILE"
    else
      echo "✓ 桥接服务器已在运行（PID: $PID）"
      exit 0
    fi
  else
    # PID文件存在但进程已不存在，说明是过期的PID文件
    # 删除过期的PID文件
    rm "$PID_FILE"
  fi
fi

# 如果启用了强制修复，终止占用端口的进程
if [ "$FORCE_REPAIR" = "1" ]; then
  kill_listeners_on_server_port
fi

# ============================================================================
# 启动服务器
# ============================================================================

echo "正在启动桥接服务器..."
# 切换到项目目录
cd "$PROJECT_DIR"

# 检查Node.js运行时是否可用
if ! resolve_node_runtime; then
  echo "✗ 启动桥接服务器失败"
  echo "  未找到Node.js运行时。"
  echo "  请安装Node.js，或从LobsterAI运行以便脚本可以使用Electron运行时。"
  exit 1
fi

# ============================================================================
# 依赖验证和修复
# ============================================================================

# 在决定是否重新安装之前，验证关键的传递依赖
# 历史上有些安装存在不完整的node_modules树（缺少iconv-lite编码）
ICONV_SENTINEL="node_modules/iconv-lite/encodings/index.js"

# 如果启用了强制修复，重新安装iconv-lite
if [ "$FORCE_REPAIR" = "1" ]; then
  if ! ensure_npm_available; then
    exit 1
  fi
  if ! repair_iconv_lite; then
    exit 1
  fi
fi

# 确保依赖已安装
# [ ! -d "dir" ]：目录不存在
# [ ! -f "file" ]：文件不存在
if [ ! -d "node_modules" ] || [ ! -f "$ICONV_SENTINEL" ]; then
  if ! ensure_npm_available; then
    exit 1
  fi
  if ! install_dependencies; then
    exit 1
  fi
fi

# npm install可能成功但保留了损坏的缓存包
# 再次检查关键文件是否存在
if [ ! -f "$ICONV_SENTINEL" ]; then
  if ! ensure_npm_available; then
    exit 1
  fi
  if ! repair_iconv_lite; then
    exit 1
  fi
fi

# 最终检查：如果关键文件仍然不存在，报错退出
if [ ! -f "$ICONV_SENTINEL" ]; then
  echo "✗ 依赖检查失败：缺少 $ICONV_SENTINEL"
  echo "  请尝试删除node_modules并在有网络连接的情况下重新安装。"
  exit 1
fi

# 验证iconv运行时是否正常工作
if ! verify_iconv_runtime; then
  if ! ensure_npm_available; then
    exit 1
  fi
  if ! repair_iconv_lite; then
    exit 1
  fi
fi

# 再次验证运行时
if ! verify_iconv_runtime; then
  echo "✗ iconv-lite运行时验证失败（修复后）"
  echo "  请尝试删除node_modules并在有网络连接的情况下重新安装。"
  exit 1
fi

# ============================================================================
# 编译检查
# ============================================================================

# 确保代码已编译
if [ ! -f "$SERVER_ENTRY" ]; then
  if ! ensure_npm_available; then
    exit 1
  fi
  echo "正在编译TypeScript..."
  # npm run build：执行package.json中的build脚本
  if ! npm run build > /dev/null 2>&1; then
    echo "✗ 编译TypeScript服务器失败"
    exit 1
  fi
fi

# ============================================================================
# 启动服务器进程
# ============================================================================

# 在后台启动服务器
# nohup：忽略HUP信号，使进程在终端关闭后继续运行
# &：在后台运行
# > "$LOG_FILE" 2>&1：将标准输出和错误输出都重定向到日志文件
nohup env "${NODE_ENV_PREFIX[@]}" "$NODE_CMD" "${NODE_ARGS[@]}" "$SERVER_ENTRY" > "$LOG_FILE" 2>&1 &
SERVER_PID=$!

# 保存PID到文件
echo "$SERVER_PID" > "$PID_FILE"

# 等待片刻以检查服务器是否成功启动
sleep 2

# ============================================================================
# 启动结果检查
# ============================================================================

# 检查服务器进程是否还在运行
if ps -p "$SERVER_PID" > /dev/null 2>&1; then
  echo "✓ 桥接服务器启动成功（PID: $SERVER_PID）"
  echo "  健康检查: ${DEFAULT_SERVER_URL}/api/health"
  # 如果请求的URL不是默认URL，显示请求的端点
  if [ "$SERVER_URL" != "$DEFAULT_SERVER_URL" ]; then
    echo "  请求的端点: ${SERVER_URL%/}/api/health"
  fi
  echo "  日志文件: $LOG_FILE"
else
  # 进程已退出，检查是否有其他健康的服务器在运行
  if detect_healthy_bridge_server; then
    echo "✓ 桥接服务器已在运行（通过健康检查端点检测到: ${HEALTHY_SERVER_URL%/}/api/health）"
    rm -f "$PID_FILE"
    exit 0
  fi

  # 启动失败
  echo "✗ 启动桥接服务器失败"
  echo "  请检查日志: $LOG_FILE"
  rm "$PID_FILE"
  exit 1
fi
