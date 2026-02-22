# Web Search Skill - 基本使用示例

本文档提供了使用 Web Search skill 的实际示例。

## 快速开始

### 1. 启动 Bridge Server

```bash
bash SKILLs/web-search/scripts/start-server.sh
```

预期输出:
```
✓ Bridge Server started successfully (PID: 12345)
  Health check: http://127.0.0.1:8923/api/health
  Logs: SKILLs/web-search/.server.log
```

### 2. 执行简单搜索

```bash
bash SKILLs/web-search/scripts/search.sh "TypeScript tutorial" 5
```

预期输出:
```
🔍 Searching for: "TypeScript tutorial"

✓ Found 5 results in 834ms

# Search Results: TypeScript tutorial

**Query:** TypeScript tutorial
**Results:** 5
**Time:** 834ms

---

## TypeScript Tutorial - W3Schools
...
```

### 3. 停止服务器

```bash
bash SKILLs/web-search/scripts/stop-server.sh
```

## 常见用例

### 示例 1：研究最新信息

**场景：** 查找 React 19 的最新功能

```bash
bash SKILLs/web-search/scripts/search.sh "React 19 new features" 10
```

**用例：** 当您需要 Claude 知识截止日期之后的最新信息时使用。

### 示例 2：技术文档

**场景：** 搜索 Next.js App Router 文档

```bash
bash SKILLs/web-search/scripts/search.sh "Next.js App Router documentation" 5
```

**用例：** 查找特定框架或库的官方文档。

### 示例 3：新闻和时事

**场景：** 查找最新的 AI 新闻

```bash
bash SKILLs/web-search/scripts/search.sh "AI news 2026" 10
```

**用例：** 获取有关时事的实时信息。

### 示例 4：故障排查错误

**场景：** 搜索错误解决方案

```bash
bash SKILLs/web-search/scripts/search.sh "TypeError: Cannot read property of undefined" 5
```

**用例：** 查找特定错误消息的解决方案。

### 示例 5：对比研究

**场景：** 比较技术方案

```bash
bash SKILLs/web-search/scripts/search.sh "Vue vs React 2026 comparison" 8
```

**用例：** 收集信息进行对比分析。

## 高级 API 使用

### 直接 API 调用（面向高级用户）

#### 健康检查

```bash
curl http://127.0.0.1:8923/api/health
```

响应:
```json
{
  "success": true,
  "data": {
    "status": "healthy",
    "uptime": 123.45,
    "connections": 1
  }
}
```

#### 启动浏览器

```bash
curl -X POST http://127.0.0.1:8923/api/browser/launch \
  -H "Content-Type: application/json"
```

响应:
```json
{
  "success": true,
  "data": {
    "pid": 12345,
    "cdpPort": 9222,
    "startTime": 1707363600000
  }
}
```

#### 连接到浏览器

```bash
curl -X POST http://127.0.0.1:8923/api/browser/connect \
  -H "Content-Type: application/json" \
  -d '{}'
```

响应:
```json
{
  "success": true,
  "data": {
    "connectionId": "e2421754-0091-450d-a54c-7bc58498bfec",
    "cdpPort": 9222
  }
}
```

#### 执行搜索

```bash
curl -X POST http://127.0.0.1:8923/api/search \
  -H "Content-Type: application/json" \
  -d '{
    "connectionId": "e2421754-0091-450d-a54c-7bc58498bfec",
    "query": "TypeScript tutorial",
    "maxResults": 5
  }'
```

响应:
```json
{
  "success": true,
  "data": {
    "query": "TypeScript tutorial",
    "results": [
      {
        "title": "TypeScript Tutorial - W3Schools",
        "url": "https://www.w3schools.com/typescript/",
        "snippet": "Learn TypeScript with examples...",
        "source": "bing",
        "position": 1
      }
    ],
    "totalResults": 5,
    "timestamp": 1707363600000,
    "duration": 834
  }
}
```

#### 截取屏幕截图

```bash
curl -X POST http://127.0.0.1:8923/api/page/screenshot \
  -H "Content-Type: application/json" \
  -d '{
    "connectionId": "e2421754-0091-450d-a54c-7bc58498bfec",
    "format": "png",
    "fullPage": false
  }'
```

响应:
```json
{
  "success": true,
  "data": {
    "screenshot": "iVBORw0KGgoAAAANSUhEUgAA...",
    "format": "png",
    "size": 387122
  }
}
```

#### 导航到 URL

```bash
curl -X POST http://127.0.0.1:8923/api/page/navigate \
  -H "Content-Type: application/json" \
  -d '{
    "connectionId": "e2421754-0091-450d-a54c-7bc58498bfec",
    "url": "https://example.com",
    "waitUntil": "domcontentloaded",
    "timeout": 15000
  }'
```

#### 获取页面文本

```bash
curl -X POST http://127.0.0.1:8923/api/page/text \
  -H "Content-Type: application/json" \
  -d '{
    "connectionId": "e2421754-0091-450d-a54c-7bc58498bfec"
  }'
```

#### 断开连接

```bash
curl -X POST http://127.0.0.1:8923/api/browser/disconnect \
  -H "Content-Type: application/json" \
  -d '{
    "connectionId": "e2421754-0091-450d-a54c-7bc58498bfec"
  }'
```

## 工作流示例：完整的研究会话

```bash
# 1. 启动服务器
bash SKILLs/web-search/scripts/start-server.sh

# 2. 搜索主题
bash SKILLs/web-search/scripts/search.sh "React Server Components" 5

# 3. 搜索相关主题
bash SKILLs/web-search/scripts/search.sh "Next.js 14 features" 5

# 4. 搜索对比内容
bash SKILLs/web-search/scripts/search.sh "RSC vs traditional React" 3

# 5. 完成后停止服务器
bash SKILLs/web-search/scripts/stop-server.sh
```

## 与 Cowork 会话的集成

在 Cowork 会话中使用此 skill 时，Claude 将自动：

1. 检查 Bridge Server 是否正在运行
2. 如有需要启动服务器（通过 Electron 服务管理器）
3. 使用简化的 CLI 执行搜索
4. 解析和分析结果
5. 基于实时信息提供答案

Cowork 交互示例：

```
用户：React 19 有哪些新功能？

Claude：让我搜索有关 React 19 的最新信息。
        [调用：bash SKILLs/web-search/scripts/search.sh "React 19 new features" 5]

        根据搜索结果，React 19 引入了几个关键功能：
        1. React Compiler - 自动优化
        2. Actions - 简化表单处理
        3. Document metadata - 内置 SEO 支持
        ...
```

## 故障排查

### 服务器无法启动

**问题：** Bridge Server 启动失败

**解决方案：**
```bash
# 检查端口 8923 是否已被占用
lsof -i :8923

# 检查日志
cat SKILLs/web-search/.server.log

# 重新安装依赖
cd SKILLs/web-search
npm install
npm run build
```

### 找不到 Chrome

**问题：** 浏览器无法启动

**解决方案：**
- 安装 Google Chrome 或 Chromium
- macOS：从 https://www.google.com/chrome/ 下载
- Linux：`sudo apt install chromium-browser`
- Windows：从 https://www.google.com/chrome/ 下载

### 连接失败

**问题：** 无法连接到浏览器

**解决方案：**
```bash
# 停止服务器
bash SKILLs/web-search/scripts/stop-server.sh

# 清除缓存
rm SKILLs/web-search/.connection
rm SKILLs/web-search/.server.pid

# 重新启动
bash SKILLs/web-search/scripts/start-server.sh
```

### 搜索超时

**问题：** 搜索耗时过长或超时

**解决方案：**
- 检查您的网络连接
- 尝试不同的搜索查询
- 减少最大结果数（例如，使用 3 而不是 10）
- 重启浏览器

## 最佳实践

1. **启动服务器一次** - 在研究会话期间保持服务器运行
2. **使用具体的查询** - 使用聚焦的搜索词获得更好的结果
3. **限制结果数量** - 只请求您需要的结果（5-10 个结果）
4. **清理资源** - 完成后停止服务器以释放资源
5. **检查日志** - 如果出现问题，查看 `.server.log`

## 性能提示

- **连接缓存** - 重用浏览器连接以加快搜索速度
- **后台服务器** - 服务器独立运行，无启动延迟
- **并发搜索** - 可以同时运行多个搜索
- **资源清理** - 关闭时自动清理

## 安全说明

- 服务器仅在 `127.0.0.1`（本地主机）上监听
- 无外部网络暴露
- 隔离的浏览器配置文件（与您的主 Chrome 分开）
- 所有操作在浏览器窗口中可见
- 无凭据存储或敏感操作
