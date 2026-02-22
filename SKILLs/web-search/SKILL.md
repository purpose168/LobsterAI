---
name: web-search
description: 使用 Playwright 控制的浏览器进行实时网络搜索。当您需要当前信息、最新文档、最新新闻或任何超出知识截止日期（2025年1月）的数据时，请使用此技能。
---

# 网络搜索技能

## 何时使用此技能

在以下情况下使用 web-search 技能：

- **当前信息** - 2025年1月之后的事件、新闻或数据
- **最新文档** - 最新的框架/库文档（React 19、Next.js 15 等）
- **实时数据** - 股票价格、天气、体育比分等
- **事实核查** - 检查项目、公司或技术的当前状态
- **近期讨论** - 社区观点、GitHub issues、Stack Overflow 问答
- **产品比较** - 最新评论和对比
- **故障排查** - 搜索特定错误消息或解决方案

**使用示例：**
- 用户："React 19 有哪些新功能？"
- 用户："搜索最新的 Next.js App Router 文档"
- 用户："Rust async 项目的当前状态如何？"
- 用户："查找关于 Vue 3 性能的近期讨论"

## 工作原理

```
┌──────────┐    Bash    ┌─────────┐    HTTP    ┌──────────────┐    CDP    ┌────────┐
│  Claude  │───────────▶│ CLI.sh  │───────────▶│ Bridge Server│──────────▶│ Chrome │
│          │            │         │            │ (localhost)  │ Playwright│        │
└──────────┘            └─────────┘            └──────────────┘            └────────┘
                                                      │
                                                  ▼
                                             Google/Bing Search
                                                Extract Results
```

**架构：**
1. **CLI 脚本** - 为 Claude 提供简单的 bash 接口
2. **Bridge Server（桥接服务器）** - Express HTTP API（由 Electron 自动启动）
3. **Playwright Manager（Playwright 管理器）** - 浏览器连接和会话管理
4. **Search Engine Layer（搜索引擎层）** - Google 优先，Bing 备用
5. **Chrome 浏览器** - 可见浏览器窗口（所有操作透明可见）

## 基本用法

### 简单搜索（推荐）

**重要提示：** 始终使用 `$SKILLS_ROOT` 环境变量来定位技能脚本。这确保技能在开发和生产环境中都能正常工作。

```bash
bash "$SKILLS_ROOT/web-search/scripts/search.sh" "搜索查询" [最大结果数]
```

对于非 ASCII 查询（中文/日文等），建议使用 UTF-8 文件输入以避免 Windows 上的 shell 编码问题：

```bash
cat > /tmp/web-query.txt <<'TXT'
苹果 Siri AI 2026 发布计划
TXT

bash "$SKILLS_ROOT/web-search/scripts/search.sh" @/tmp/web-query.txt 10
```

**示例：**

```bash
# 搜索，默认返回 10 条结果
bash "$SKILLS_ROOT/web-search/scripts/search.sh" "TypeScript 5.0 new features"

# 限制返回 5 条结果
bash "$SKILLS_ROOT/web-search/scripts/search.sh" "React Server Components guide" 5

# 搜索近期新闻
bash "$SKILLS_ROOT/web-search/scripts/search.sh" "AI news January 2026" 10
```

**输出格式：**

脚本返回 Markdown 格式的结果：

```markdown
# Search Results: TypeScript 5.0 new features

**Query:** TypeScript 5.0 new features
**Results:** 5
**Time:** 834ms

---

## TypeScript 5.0 Release Notes

**URL:** [https://www.typescriptlang.org/docs/...]

TypeScript 5.0 introduces decorators, const type parameters...

---

## (More results...)
```

### 工作流示例

```bash
# 1. 搜索主题
bash "$SKILLS_ROOT/web-search/scripts/search.sh" "Next.js 14 features" 5

# 2. 分析结果并回答用户

# 3. 如需跟进搜索
bash "$SKILLS_ROOT/web-search/scripts/search.sh" "Next.js Server Actions tutorial" 3
```

## 高级用法

### 服务器管理

Bridge Server 由 Electron **自动管理**。通常您不需要手动启动/停止它。

但是，如需手动控制：

```bash
# 启动服务器（如果尚未运行）
bash "$SKILLS_ROOT/web-search/scripts/start-server.sh"

# 停止服务器
bash "$SKILLS_ROOT/web-search/scripts/stop-server.sh"

# 检查健康状态（启动脚本会打印端点状态）
bash "$SKILLS_ROOT/web-search/scripts/start-server.sh"
```

### 直接 API 调用

对于高级用例，您可以直接调用 HTTP API：

```bash
# 获取或创建连接
CONNECTION_ID=$(curl -s -X POST http://127.0.0.1:8923/api/browser/connect \
  -H "Content-Type: application/json" \
  -d '{}' | grep -o '"connectionId":"[^"]*"' | cut -d'"' -f4)

# 执行搜索
curl -X POST http://127.0.0.1:8923/api/search \
  -H "Content-Type: application/json" \
  -d "{
    \"connectionId\": \"$CONNECTION_ID\",
    \"query\": \"Playwright tutorial\",
    \"maxResults\": 5
  }"

# 导航到特定 URL
curl -X POST http://127.0.0.1:8923/api/page/navigate \
  -H "Content-Type: application/json" \
  -d "{
    \"connectionId\": \"$CONNECTION_ID\",
    \"url\": \"https://example.com\"
  }"

# 截图
curl -X POST http://127.0.0.1:8923/api/page/screenshot \
  -H "Content-Type: application/json" \
  -d "{
    \"connectionId\": \"$CONNECTION_ID\",
    \"format\": \"png\"
  }"
```

## 最佳实践

### 1. 使用具体的查询

❌ 不好的做法：`bash scripts/search.sh "react"`
✅ 好的做法：`bash scripts/search.sh "React 19 new features and breaking changes"`

### 2. 适当限制结果数量

- 快速查询：3-5 条结果
- 全面研究：10 条结果
- 不要请求超过需要的数量（更快 + 噪音更少）

### 3. 首先检查服务器状态

如果搜索失败，验证服务器是否正在运行：

```bash
bash "$SKILLS_ROOT/web-search/scripts/start-server.sh" || echo "Server not running"
```

### 4. 重用连接

CLI 脚本会自动缓存连接。同一会话中的多次搜索将重用相同的浏览器连接以获得更好的性能。

### 5. 清理输出

解析 Markdown 输出以为用户提取关键信息。不要只是倾倒所有结果——要综合和总结。

## 常见模式

### 模式 1：最新文档

```bash
# 用户询问最新的框架功能
bash SKILLs/web-search/scripts/search.sh "Next.js 15 documentation" 5

# 解析结果，找到官方文档，总结功能
```

### 模式 2：故障排查

```bash
# 用户报告错误
bash SKILLs/web-search/scripts/search.sh "TypeError: Cannot read property of undefined React" 5

# 查找 Stack Overflow 答案和 GitHub issues，提供解决方案
```

### 模式 3：当前事件

```bash
# 用户询问近期新闻
bash SKILLs/web-search/scripts/search.sh "AI developments January 2026" 10

# 从结果中总结关键新闻条目
```

### 模式 4：比较研究

```bash
# 用户想要比较技术
bash SKILLs/web-search/scripts/search.sh "Vue 3 vs React 18 performance 2026" 5

# 从多个来源综合比较
```

### 模式 5：API/库用法

```bash
# 用户需要特定的 API 文档
bash SKILLs/web-search/scripts/search.sh "Playwright page.evaluate examples" 5

# 提取代码示例和用法模式
```

## 错误处理

### 服务器未运行

**错误：** `✗ Bridge Server is not running`

**解决方案：**
- 服务器应该随 Electron 自动启动
- 如需手动启动：`bash SKILLs/web-search/scripts/start-server.sh`
- 检查日志：`cat SKILLs/web-search/.server.log`

### 浏览器启动失败

**错误：** `Failed to launch browser`

**原因：** Chrome 未安装或未找到

**解决方案：**
- macOS：从 https://www.google.com/chrome/ 安装
- Linux：`sudo apt install chromium-browser`
- Windows：从 https://www.google.com/chrome/ 安装

### 连接超时

**错误：** `CDP port not ready` 或 `Connection timeout`

**解决方案：**
```bash
# 停止服务器
bash SKILLs/web-search/scripts/stop-server.sh

# 清除缓存
rm SKILLs/web-search/.connection

# 重启
bash SKILLs/web-search/scripts/start-server.sh
```

### 无搜索结果

**错误：** `Found 0 results`

**可能的原因：**
- 查询过于具体或不常见
- Bing 更改了页面结构（罕见）
- 网络问题

**解决方案：**
- 尝试更广泛的查询
- 检查网络连接
- 在 bing.com 手动验证页面是否加载

### 搜索超时

**错误：** `Search failed: timeout`

**解决方案：**
- 检查网络连接
- 减少最大结果数
- 重试（可能是临时网络问题）

## 理解结果

### 结果结构

每个搜索结果包含：

```markdown
## [结果标题]

**URL:** [https://example.com/page]

[搜索结果中的摘要/描述]
```

**字段：**
- **Title（标题）** - 页面/文章标题
- **URL** - 直接链接（可能包含 Bing 跟踪）
- **Snippet（摘要）** - 页面预览文本

### 解析结果

搜索输出是 Markdown 格式。提取：
1. 总结果数
2. 搜索耗时
3. 各结果标题和 URL
4. 摘要作为上下文

### 结果质量

- **官方文档** - 通常出现在前 3 条结果中
- **Stack Overflow** - 技术问题会出现
- **近期文章** - Bing 优先显示近期内容
- **中文内容** - Bing 在中国工作良好，包含中文来源

## 性能考虑

### 典型延迟

- 服务器启动：约 2 秒（一次性，自动启动）
- 浏览器启动：约 3 秒（每次会话一次性）
- 首次搜索：约 2-3 秒（包含浏览器连接）
- 后续搜索：约 1 秒（连接已缓存）

### 优化技巧

1. **重用连接** - CLI 脚本自动缓存连接
2. **限制结果** - 只请求需要的数量（5-10 条通常足够）
3. **批量搜索** - 如需多次搜索，连续执行以重用连接
4. **具体查询** - 越具体 = 越快且结果越好

## 安全与隐私

### 安全措施

- **仅本地主机** - Bridge Server 绑定到 127.0.0.1（无外部访问）
- **无网络暴露** - 无法从其他机器访问
- **隔离浏览器** - 使用独立的 Chrome 配置文件，不会影响用户的主浏览器
- **可见操作** - 所有浏览器操作在可见窗口中显示（透明）
- **无凭据** - 技能从不处理密码或敏感数据

### 隐私考虑

- 搜索查询通过 Google 和/或 Bing，取决于可用性
- Google/Bing 可能会跟踪搜索（适用其标准隐私政策）
- 技能不会在本地存储搜索历史
- 用户可以实时观察所有浏览器活动

## 限制

### 当前限制

1. **无 CAPTCHA 处理** - 如果 Google 或 Bing 显示 CAPTCHA，用户必须手动解决
2. **搜索引擎可用性因网络/地区而异** - 自动模式在 Google 和 Bing 之间回退
3. **侧重英文/中文** - 针对英文和中文结果优化
4. **基础提取** - 提取标题和摘要，而非完整页面内容
5. **无身份验证** - 无法搜索需要登录的页面

### 不适用于

- 需要身份验证的搜索
- 填写表单或提交数据
- 需要 CAPTCHA 解决的操作（除非用户手动解决）
- 大规模抓取或自动化批量搜索
- 访问付费墙后的页面

## 故障排查指南

### 快速诊断

```bash
# 1. 检查服务器健康状态
curl http://127.0.0.1:8923/api/health

# 2. 检查服务器日志
cat SKILLs/web-search/.server.log | tail -50

# 3. 测试基本搜索
bash SKILLs/web-search/scripts/search.sh "test" 1

# 4. 检查 Chrome 安装
which google-chrome || which chromium || which chromium-browser
```

### 常见问题

| 问题 | 症状 | 解决方案 |
|-------|---------|----------|
| 服务器宕机 | `Connection refused` | 启动服务器或重启 Electron |
| 浏览器缺失 | `Chrome not found` | 安装 Chrome/Chromium |
| 端口冲突 | `Address already in use` | 停止占用端口 8923 的进程 |
| 连接过期 | `Connection not found` | 删除 `.connection` 缓存文件 |
| 网络问题 | `Search timeout` | 检查网络连接 |

### 完全重置

如果所有方法都失败，执行完全重置：

```bash
cd SKILLs/web-search

# 停止服务器
bash scripts/stop-server.sh

# 清理缓存和状态
rm -f .connection .server.pid .server.log

# 重新构建
npm run build

# 重启
bash scripts/start-server.sh

# 测试
bash scripts/search.sh "test" 1
```

## Claude 使用示例

### 示例 1：用户询问最新框架

**用户：** "Next.js 15 有哪些新功能？"

**Claude 的方法：**
```bash
# 搜索 Next.js 15 功能
bash "$SKILLS_ROOT/web-search/scripts/search.sh" "Next.js 15 new features" 5
```

**然后：** 解析结果，识别官方 Next.js 博客/文档，为用户总结关键功能。

### 示例 2：排查错误

**用户：** "我在 TypeScript 中遇到 'Cannot find module' 错误"

**Claude 的方法：**
```bash
# 搜索特定错误
bash "$SKILLS_ROOT/web-search/scripts/search.sh" "TypeScript Cannot find module error solution" 5
```

**然后：** 从 Stack Overflow 结果中提取解决方案，提供分步修复方法。

### 示例 3：当前事件

**用户：** "这个月 AI 领域发生了什么？"

**Claude 的方法：**
```bash
# 搜索近期 AI 新闻
bash "$SKILLS_ROOT/web-search/scripts/search.sh" "AI news January 2026" 10
```

**然后：** 综合多个来源的新闻，提供关键事件摘要。

### 示例 4：文档查询

**用户：** "如何使用 React Server Components？"

**Claude 的方法：**
```bash
# 搜索 RSC 文档和教程
bash "$SKILLS_ROOT/web-search/scripts/search.sh" "React Server Components guide tutorial" 5
```

**然后：** 找到官方 React 文档和优质教程，用示例解释。

### 示例 5：比较研究

**用户：** "2026 年我应该使用 Vite 还是 webpack？"

**Claude 的方法：**
```bash
# 搜索近期比较
bash "$SKILLS_ROOT/web-search/scripts/search.sh" "Vite vs webpack 2026 comparison" 5
```

**然后：** 分析多种观点，提供平衡的建议。

## 有效使用技巧

1. **查询要具体** - 包含版本号、日期或具体方面
2. **仔细解析结果** - 不要只是复制粘贴，要综合信息
3. **用多个来源验证** - 交叉核对重要信息
4. **引用来源** - 告诉用户您使用的是哪些来源
5. **说明限制** - 如果搜索没有找到好的结果，告诉用户
6. **使用跟进搜索** - 一次搜索可能不够，如需要可多次搜索
7. **检查结果日期** - 对于当前信息，优先选择近期文章
8. **寻找官方来源** - 优先选择官方文档和权威来源

## 技术细节

### 使用的技术

- **Playwright Core** - 浏览器自动化框架
- **Chrome DevTools Protocol** - 底层浏览器控制
- **Express.js** - HTTP API 服务器
- **Google + Bing Search** - 多引擎回退搜索策略
- **Bash Scripts** - 简单的 CLI 接口

### 系统要求

- Node.js 18+
- 已安装 Google Chrome 或 Chromium
- 用于搜索的网络连接
- Bridge Server 约 100MB RAM
- Chrome 实例约 200MB RAM

### 文件位置

- 服务器：`SKILLs/web-search/dist/server/index.js`
- 日志：`SKILLs/web-search/.server.log`
- PID：`SKILLs/web-search/.server.pid`
- 连接缓存：`SKILLs/web-search/.connection`

## 其他资源

- **完整文档：** `SKILLs/web-search/README.md`
- **使用示例：** `SKILLs/web-search/examples/basic-search.md`
- **API 参考：** 参见 README.md 获取完整 API 文档
- **故障排查：** 参见 examples/basic-search.md

## 支持

如遇问题：
1. 检查 `.server.log` 中的错误
2. 运行基本测试：`node SKILLs/web-search/scripts/test-basic.js`
3. 验证 Chrome 安装
4. 检查网络连接
5. 查看上方的故障排查部分

---

**记住：** 此技能提供对当前信息的实时访问。当用户需要超出您知识截止日期的信息或当前数据的准确性很重要时，请使用它。
