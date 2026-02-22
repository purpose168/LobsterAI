# 端到端测试指南

## 测试完整集成

本指南将引导您完成 Web Search Skill 与 LobsterAI 完整集成的测试过程。

## 前置条件

1. LobsterAI 已构建并准备运行
2. 已安装 Google Chrome
3. 网络连接可用

## 测试 1：服务自动启动

**目标：** 验证 Bridge Server 随 LobsterAI 自动启动。

**步骤：**

1. 以开发模式启动 LobsterAI：
   ```bash
   npm run electron:dev
   ```

2. 检查控制台输出是否包含：
   ```
   [SkillServices] Starting skill services...
   [SkillServices] Starting Web Search Bridge Server...
   [SkillServices] Web Search Bridge Server started (PID: XXXXX)
   ```

3. 验证服务器正在运行：
   ```bash
   curl http://127.0.0.1:8923/api/health
   ```

   预期响应：
   ```json
   {
     "success": true,
     "data": {
       "status": "healthy",
       "uptime": 123.45,
       "connections": 0
     }
   }
   ```

**预期结果：** ✅ Bridge Server 在 LobsterAI 启动后 3 秒内自动启动。

## 测试 2：从终端执行 CLI 搜索

**目标：** 直接从命令行测试搜索功能。

**步骤：**

1. 在 LobsterAI 运行时打开一个终端

2. 执行搜索：
   ```bash
   bash SKILLs/web-search/scripts/search.sh "React 19 features" 5
   ```

3. 验证输出包含：
   - 搜索查询
   - 结果数量
   - 持续时间（毫秒）
   - Markdown 格式的结果，包含标题、URL 和摘要

**预期结果：** ✅ 搜索在 3 秒内完成，返回 5 个结果。

## 测试 3：Cowork 会话集成

**目标：** 测试 Claude 在 Cowork 会话中使用该技能的能力。

**步骤：**

1. 启动 LobsterAI
2. 创建一个新的 Cowork 会话
3. 发送以下消息：

   ```
   Search for the latest information about Next.js 14 new features.
   ```

4. 观察：
   - Claude 应识别需要实时信息
   - Claude 应执行：`bash SKILLs/web-search/scripts/search.sh "Next.js 14 new features" 5`
   - 搜索结果应出现在工具执行输出中
   - Claude 应综合结果中的信息
   - Claude 应提供带有来源引用的摘要

**预期结果：** ✅ Claude 自动使用 web-search 技能，提供带有来源的当前信息。

## 测试 4：多次连续搜索

**目标：** 验证连接缓存和性能优化。

**步骤：**

1. 在 Cowork 会话中，询问：
   ```
   1. Search for "TypeScript 5.0 features"
   2. Search for "React Server Components guide"
   3. Search for "Vite 5.0 changes"
   ```

2. 观察：
   - 第一次搜索：约 2-3 秒（包含浏览器启动）
   - 第二次搜索：约 1 秒（复用连接）
   - 第三次搜索：约 1 秒（复用连接）

**预期结果：** ✅ 由于连接缓存，后续搜索速度更快。

## 测试 5：退出时服务清理

**目标：** 验证 LobsterAI 退出时服务的优雅关闭。

**步骤：**

1. 在 LobsterAI 运行并完成搜索后，退出应用程序
2. 检查控制台输出是否包含：
   ```
   [SkillServices] Stopping skill services...
   [SkillServices] Stopping Web Search Bridge Server...
   [SkillServices] Web Search Bridge Server stopped
   ```

3. 验证服务器已停止：
   ```bash
   curl http://127.0.0.1:8923/api/health
   ```

   预期：连接被拒绝

4. 检查是否有孤立进程：
   ```bash
   ps aux | grep "web-search"
   ```

**预期结果：** ✅ 所有服务干净地停止，无孤立进程。

## 测试 6：错误处理 - 服务器未运行

**目标：** 测试 Bridge Server 被手动停止时的行为。

**步骤：**

1. 启动 LobsterAI
2. 手动停止 Bridge Server：
   ```bash
   bash SKILLs/web-search/scripts/stop-server.sh
   ```

3. 在 Cowork 会话中，要求 Claude 进行搜索
4. 观察错误消息：
   ```
   ✗ Bridge Server is not running
     Please start the server first:
     bash SKILLs/web-search/scripts/start-server.sh
   ```

5. 手动重启：
   ```bash
   bash SKILLs/web-search/scripts/start-server.sh
   ```

6. 重试搜索

**预期结果：** ✅ 清晰的错误消息，易于恢复。

## 测试 7：浏览器可见性

**目标：** 验证所有浏览器操作可见且透明。

**步骤：**

1. 启动 LobsterAI（确保配置中 headless 为 false）
2. 通过 CLI 或 Cowork 执行搜索
3. 观察：
   - Chrome 窗口出现
   - 导航到 Bing 搜索页面
   - 搜索查询在地址栏中可见
   - 结果页面可见地加载

**预期结果：** ✅ 所有浏览器操作对用户可见，行为透明。

## 测试 8：跨平台兼容性

**目标：** 验证技能在不同平台上正常工作。

**平台特定步骤：**

### macOS
```bash
# 验证 Chrome 路径检测
bash SKILLs/web-search/scripts/search.sh "test" 1

# 应在以下位置找到 Chrome：/Applications/Google Chrome.app/Contents/MacOS/Google Chrome
```

### Linux
```bash
# 验证 Chrome/Chromium 检测
bash SKILLs/web-search/scripts/search.sh "test" 1

# 应在以下位置找到：/usr/bin/google-chrome 或 /usr/bin/chromium
```

### Windows
```bash
# 验证 Chrome 检测
bash SKILLs/web-search/scripts/search.sh "test" 1

# 应在以下位置找到：C:\Program Files\Google\Chrome\Application\chrome.exe
```

**预期结果：** ✅ Chrome 检测在所有平台上正常工作。

## 测试 9：并发搜索

**目标：** 测试多个搜索并行执行。

**步骤：**

1. 打开两个终端窗口
2. 同时执行搜索：
   - 终端 1：`bash scripts/search.sh "React" 3`
   - 终端 2：`bash scripts/search.sh "Vue" 3`

3. 两者都应成功完成

**预期结果：** ✅ 多个搜索可以并发运行。

## 测试 10：结果质量

**目标：** 验证搜索结果相关且格式良好。

**步骤：**

1. 搜索特定主题：
   ```bash
   bash SKILLs/web-search/scripts/search.sh "Playwright documentation" 5
   ```

2. 验证结果包含：
   - 官方 Playwright 文档（playwright.dev）
   - 最近的教程和指南
   - 相关的 Stack Overflow 或 GitHub 讨论

3. 检查 Markdown 格式：
   - 每个结果的标题
   - 可点击的 URL
   - 整洁的摘要

**预期结果：** ✅ 高质量、相关的结果，格式正确。

## 性能基准

| 操作 | 目标 | 可接受 |
|-----------|--------|------------|
| 服务器启动 | < 2s | < 3s |
| 浏览器启动 | < 3s | < 5s |
| 首次搜索 | < 3s | < 5s |
| 后续搜索 | < 1s | < 2s |
| 服务器关闭 | < 2s | < 3s |

## 常见问题及解决方案

### 问题 1：服务器无法启动

**症状：** 未创建 PID 文件，健康检查失败

**调试：**
```bash
cat SKILLs/web-search/.server.log
npm run build --prefix SKILLs/web-search
```

### 问题 2：找不到 Chrome

**症状：** "Chrome not found" 错误

**解决方案：**
- macOS：从 https://www.google.com/chrome/ 安装
- Linux：`sudo apt install chromium-browser`
- Windows：安装 Chrome

### 问题 3：端口已被占用

**症状：** "Address already in use" 错误

**解决方案：**
```bash
lsof -i :8923
kill -9 <PID>
bash SKILLs/web-search/scripts/start-server.sh
```

### 问题 4：连接过期

**症状：** "Connection not found" 错误

**解决方案：**
```bash
rm SKILLs/web-search/.connection
```

## 成功标准

所有测试通过的条件：

- ✅ 服务器随 LobsterAI 自动启动
- ✅ 搜索在 3 秒内完成
- ✅ Claude 在适当时自动使用技能
- ✅ 连接缓存提升性能
- ✅ 退出时服务优雅清理
- ✅ 错误消息清晰且可操作
- ✅ 浏览器操作可见
- ✅ 在 macOS、Linux、Windows 上正常工作
- ✅ 支持并发搜索
- ✅ 结果相关且格式良好

## 最终检查清单

在认为集成完成之前：

- [ ] 所有 10 个测试通过
- [ ] 满足性能基准
- [ ] 无控制台错误或警告
- [ ] 文档完整
- [ ] 代码编译无错误
- [ ] Skills 配置包含 web-search
- [ ] SKILL.md 内容全面
- [ ] README.md 准确
- [ ] 示例按文档说明工作
- [ ] 服务管理器干净集成

## 后续步骤

所有测试通过后：

1. 创建包含所有更改的提交
2. 在生产构建中测试
3. 记录任何平台特定的特性
4. 收集用户反馈
5. 考虑第二阶段增强功能（Google 搜索、缓存等）
