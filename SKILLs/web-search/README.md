# 网页搜索技能

使用 Playwright 控制的浏览器自动化为 LobsterAI 提供实时网页搜索能力。

## 概述

网页搜索技能使 LobsterAI 能够使用 Google 和 Bing 执行实时网页搜索，当一个提供商不可用时会自动回退。该技能使用 Playwright 控制本地 Chrome 浏览器实例，使所有操作透明且可观察。

## 功能特性

- ✅ **实时搜索** - 通过 Google 访问当前网页信息，支持 Bing 回退
- ✅ **透明操作** - 可见的浏览器窗口显示所有操作
- ✅ **Playwright 驱动** - 使用 playwright-core 实现稳健的浏览器自动化
- ✅ **简单 CLI** - 为 Claude 提供易用的命令行界面
- ✅ **HTTP API** - 用于高级集成的 RESTful 桥接服务器
- ✅ **自动管理** - Electron 自动启动/停止服务
- ✅ **连接缓存** - 重用浏览器连接以提升性能
- ✅ **仅限本地** - 设计安全，无外部暴露

## 架构

```
Claude → Bash 工具 → CLI 脚本 → 桥接服务器 (localhost:8923) → Playwright → CDP → Chrome
```

**组件：**

1. **桥接服务器** - 用于浏览器控制的 Express HTTP API
2. **Playwright 管理器** - 连接和会话管理
3. **浏览器启动器** - Chrome 生命周期管理
4. **搜索引擎** - Google 为主，Bing 为备用
5. **CLI 脚本** - 简化的命令行界面
6. **Electron 集成** - 自动服务管理

## 快速开始

### 1. 安装依赖

```bash
cd SKILLs/web-search
npm install
```

### 2. 构建

```bash
npm run build
```

### 3. 启动服务器

```bash
bash scripts/start-server.sh
```

### 4. 执行搜索

```bash
bash scripts/search.sh "TypeScript tutorial" 5
```

### 5. 停止服务器

```bash
bash scripts/stop-server.sh
```

## 使用方法

### 简单搜索

```bash
bash SKILLs/web-search/scripts/search.sh "搜索查询" [最大结果数]
```

**示例：**

```bash
# 搜索 React 19 特性（默认 10 条结果）
bash scripts/search.sh "React 19 new features"

# 搜索 TypeScript 教程（限制为 5 条结果）
bash scripts/search.sh "TypeScript tutorial" 5

# 搜索当前新闻
bash scripts/search.sh "AI news 2026" 10
```

### API 使用

完整 API 文档请参阅 [examples/basic-search.md](examples/basic-search.md)。

**健康检查：**
```bash
curl http://127.0.0.1:8923/api/health
```

**搜索：**
```bash
curl -X POST http://127.0.0.1:8923/api/search \
  -H "Content-Type: application/json" \
  -d '{"connectionId": "...", "query": "...", "maxResults": 5}'
```

## 配置

`server/config.ts` 中的默认配置：

```typescript
{
  browser: {
    cdpPort: 9222,
    headless: false,  // 始终可见
    chromeFlags: [/* ... */]
  },
  server: {
    port: 8923,
    host: '127.0.0.1'  // 仅限本地
  },
  search: {
    defaultEngine: 'auto',
    fallbackOrder: ['google', 'bing'],
    defaultMaxResults: 10,
    searchTimeout: 30000,
    navigationTimeout: 15000
  }
}
```

## Claude 如何使用此技能

当 Claude 需要实时信息时，它会：

1. **识别需求** - 关于当前事件、最新文档等问题
2. **检查服务器** - 验证桥接服务器是否运行
3. **执行搜索** - 运行 `bash scripts/search.sh "查询" N`
4. **解析结果** - 从 Markdown 输出中提取相关信息
5. **回答用户** - 基于搜索结果提供响应

**交互示例：**

```
用户：Next.js 14 有哪些新功能？

Claude：[调用：bash SKILLs/web-search/scripts/search.sh "Next.js 14 features" 5]

        根据最新的搜索结果，Next.js 14 引入了：
        1. Turbopack - 比 Webpack 快 5000 倍
        2. Server Actions（稳定版）- 简化数据变更
        3. 部分预渲染 - 更快的页面加载
        ...
```

## API 端点

### 浏览器管理
- `POST /api/browser/launch` - 启动 Chrome
- `POST /api/browser/connect` - 连接到浏览器
- `POST /api/browser/disconnect` - 断开连接
- `GET /api/browser/status` - 获取状态

### 搜索操作
- `POST /api/search` - 执行搜索
- `POST /api/search/content` - 获取 URL 内容

### 页面操作
- `POST /api/page/navigate` - 导航到 URL
- `POST /api/page/screenshot` - 截取屏幕截图
- `POST /api/page/content` - 获取 HTML 内容
- `POST /api/page/text` - 获取文本内容

### 实用工具
- `GET /api/health` - 健康检查
- `GET /api/connections` - 列出连接

## 项目结构

```
SKILLs/web-search/
├── README.md                    # 本文件
├── SKILL.md                     # 技能文档（供 Claude 使用）
├── LICENSE.txt                  # MIT 许可证
├── package.json                 # 依赖项
├── tsconfig.json                # TypeScript 配置
├── server/                      # 桥接服务器源码
│   ├── index.ts                 # Express 服务器
│   ├── config.ts                # 配置
│   ├── playwright/
│   │   ├── manager.ts           # Playwright 连接管理器
│   │   ├── browser.ts           # 浏览器生命周期
│   │   └── operations.ts        # 页面操作
│   └── search/
│       ├── types.ts             # 类型定义
│       ├── google.ts            # Google 搜索引擎
│       └── bing.ts              # Bing 备用引擎
├── scripts/                     # CLI 工具
│   ├── start-server.sh          # 启动桥接服务器
│   ├── stop-server.sh           # 停止桥接服务器
│   ├── search.sh                # 搜索 CLI
│   ├── test-basic.js            # 基础功能测试
│   └── test-search.js           # 集成测试
├── examples/                    # 使用示例
│   └── basic-search.md          # 完整使用指南
└── dist/                        # 编译输出（自动生成）
```

## 测试

### 基础功能测试

```bash
node scripts/test-basic.js
```

测试内容：
- 浏览器启动和连接
- Playwright 连接管理
- 页面导航
- 标题和内容提取
- 屏幕截图捕获
- 资源清理

### 搜索集成测试

```bash
node scripts/test-search.js
```

测试内容：
- 桥接服务器启动
- 通过 API 启动浏览器
- Playwright 连接
- Bing 搜索执行
- 结果解析
- 屏幕截图和文本提取
- 完整清理

## 故障排除

### 服务器无法启动

```bash
# 检查日志
cat .server.log

# 检查端口是否被占用
lsof -i :8923

# 重新构建
npm run build
```

### 找不到 Chrome

安装 Chrome：
- macOS: https://www.google.com/chrome/
- Linux: `sudo apt install chromium-browser`
- Windows: https://www.google.com/chrome/

### 连接问题

```bash
# 清理
bash scripts/stop-server.sh
rm .connection .server.pid

# 重启
bash scripts/start-server.sh
```

## 安全性

- **仅限本地** - 服务器绑定到 127.0.0.1
- **无外部访问** - 不暴露到网络
- **隔离配置** - 独立的 Chrome 用户数据目录
- **可见操作** - 所有操作在浏览器窗口中显示
- **无凭据** - 不执行敏感操作

## 性能

- **服务器启动**: < 2 秒
- **浏览器启动**: < 3 秒
- **搜索延迟**: < 1 秒（取决于网络）
- **连接重用**: 缓存用于多次搜索
- **内存使用**: ~80MB（桥接服务器）+ Chrome

## 系统要求

- Node.js 18+
- Google Chrome 或 Chromium
- macOS、Windows 或 Linux
- 用于搜索的网络连接

## 依赖项

- `express` - HTTP 服务器
- `playwright-core` - 浏览器自动化
- `uuid` - 连接 ID 生成

## 许可证

MIT 许可证 - 详见 LICENSE.txt

## 未来增强

### 第二阶段（可选）
- 高级搜索选项（日期范围、语言、地区）
- 结果缓存
- 深度内容提取

### 第三阶段（可选）
- 原生 Cowork 工具集成
- 表单填写和多步骤自动化
- CAPTCHA 处理
- 使用 Playwright 进行网络拦截

## 贡献

此技能是 LobsterAI 项目的一部分。如有问题或建议：

1. 检查现有问题
2. 创建详细的错误报告
3. 包含 `.server.log` 中的日志
4. 使用最新版本测试

## 致谢

构建使用：
- [Playwright](https://playwright.dev/) - 浏览器自动化
- [Express](https://expressjs.com/) - HTTP 服务器
- [Chrome DevTools Protocol](https://chromedevtools.github.io/devtools-protocol/) - 浏览器控制

## 支持

获取帮助：
1. 阅读 [examples/basic-search.md](examples/basic-search.md)
2. 查看故障排除部分
3. 检查 `.server.log` 中的错误
4. 使用 `node scripts/test-basic.js` 测试
