# CLAUDE.md

本文件为 Claude Code (claude.ai/code) 在此代码库中工作时提供指导。

## 构建和开发命令

```bash
# 开发模式 - 启动 Vite 开发服务器 (端口 5175) + Electron 应用，支持热重载
npm run electron:dev

# 构建生产环境包 (TypeScript + Vite)
npm run build

# 使用 ESLint 进行代码检查
npm run lint

# 运行内存提取器测试 (Node.js 内置测试运行器)
npm run test:memory

# 仅编译 Electron 主进程
npm run compile:electron

# 打包分发 (平台特定)
npm run dist:mac        # macOS (.dmg)
npm run dist:win        # Windows (.exe)
npm run dist:linux      # Linux (.AppImage)
```

**系统要求**: Node.js >=24 <25。Windows 构建需要 PortableGit (设置说明见 README.md)。

## 架构概览

LobsterAI 是一个 Electron + React 桌面应用程序，具有两种主要模式：
1. **协作模式 (Cowork Mode)** - 使用 Claude Agent SDK 进行 AI 辅助编程会话，支持工具执行
2. **制品系统 (Artifacts System)** - 代码输出的富预览 (HTML、SVG、React、Mermaid)

采用严格的进程隔离和 IPC 通信。

### 进程模型

**主进程** (`src/main/main.ts`):
- 窗口生命周期管理
- 通过 `sql.js` 实现 SQLite 存储 (`src/main/sqliteStore.ts`)
- 协作会话运行器 (`src/main/libs/coworkRunner.ts`) - 执行 Claude Agent SDK
- IPC 处理程序，用于存储、协作和 API 操作
- 安全性：启用上下文隔离、禁用 node 集成、启用沙箱

**预加载脚本** (`src/main/preload.ts`):
- 通过 `contextBridge` 暴露 `window.electron` API
- 包含 `cowork` 命名空间，用于会话管理和流式事件

**渲染进程** (React 在 `src/renderer/`):
- 所有 UI 和业务逻辑
- 仅通过 IPC 与主进程通信

### 关键目录

```
src/main/
├── main.ts              # 入口点，IPC 处理程序
├── sqliteStore.ts       # SQLite 数据库 (kv + cowork 表)
├── coworkStore.ts       # 协作会话/消息 CRUD 操作
└── libs/
    ├── coworkRunner.ts          # Claude Agent SDK 执行引擎
    ├── coworkVmRunner.ts        # 沙箱 VM 执行模式
    ├── claudeSdk.ts             # SDK 加载工具
    ├── coworkMemoryExtractor.ts # 从对话中提取记忆变更
    └── coworkMemoryJudge.ts     # 使用评分/LLM 验证记忆候选项

src/renderer/
├── types/cowork.ts      # 协作类型定义
├── store/slices/
│   ├── coworkSlice.ts   # 协作会话和流式状态
│   └── artifactSlice.ts # 制品状态
├── services/
│   ├── cowork.ts        # 协作服务 (IPC 封装器，Redux 集成)
│   ├── api.ts           # LLM API，支持 SSE 流式传输
│   └── artifactParser.ts # 制品检测和解析
├── components/
│   ├── cowork/          # 协作 UI 组件
│   │   ├── CoworkView.tsx          # 主协作界面
│   │   ├── CoworkSessionList.tsx   # 会话侧边栏
│   │   ├── CoworkSessionDetail.tsx # 消息显示
│   │   └── CoworkPermissionModal.tsx # 工具权限 UI
│   └── artifacts/       # 制品渲染器

SKILLs/                  # 协作会话的自定义技能定义
├── skills.config.json   # 技能启用/顺序配置
├── docx/                # Word 文档生成技能
├── xlsx/                # Excel 技能
├── pptx/                # PowerPoint 技能
└── ...
```

### 数据流

1. **初始化**: `src/renderer/App.tsx` → `coworkService.init()` → 通过 IPC 加载配置/会话 → 设置流监听器
2. **协作会话**: 用户发送提示 → `coworkService.startSession()` → IPC 到主进程 → `CoworkRunner.startSession()` → Claude Agent SDK 执行 → 通过 IPC 将流式事件返回渲染进程 → Redux 更新
3. **工具权限**: Claude 请求使用工具 → `CoworkRunner` 发出 `permissionRequest` → UI 显示 `CoworkPermissionModal` → 用户批准/拒绝 → 结果返回给 SDK
4. **持久化**: 协作会话存储在 SQLite 中 (`cowork_sessions`、`cowork_messages` 表)

### 协作系统

协作功能提供 AI 辅助编程会话：

**执行模式** (`CoworkExecutionMode`):
- `auto` - 根据上下文自动选择
- `local` - 在本地机器上直接运行工具
- `sandbox` - 在隔离的 VM 环境中运行工具

**记忆系统**: 自动从对话中提取和管理用户记忆：
- `coworkMemoryExtractor.ts` - 检测显式的记住/忘记命令 (中/英文)，并使用信号模式 (profile、preferences、ownership) 隐式提取个人事实。使用守护级别 (`strict`/`standard`/`relaxed`) 配置信度阈值。
- `coworkMemoryJudge.ts` - 使用基于规则的评分和可选的 LLM 二次判断来验证记忆候选项，适用于边界情况。包含基于 TTL 的 LLM 结果缓存。

**流事件** (从主进程到渲染进程的 IPC):
- `message` - 新消息添加到会话
- `messageUpdate` - 现有消息的流式内容更新
- `permissionRequest` - 工具需要用户批准
- `complete` - 会话执行完成
- `error` - 会话遇到错误

**关键 IPC 通道**:
- `cowork:startSession`、`cowork:continueSession`、`cowork:stopSession`
- `cowork:getSession`、`cowork:listSessions`、`cowork:deleteSession`
- `cowork:respondToPermission`、`cowork:getConfig`、`cowork:setConfig`

### 关键模式

- **流式响应**: `apiService.chat()` 使用 SSE 和 `onProgress` 回调进行实时消息更新
- **协作流式传输**: 使用 IPC 事件监听器 (`onStreamMessage`、`onStreamMessageUpdate` 等) 进行双向通信
- **Markdown 渲染**: `react-markdown` 配合 `remark-gfm`、`remark-math`、`rehype-katex` 用于 GitHub markdown 和 LaTeX
- **主题系统**: 基于类的 Tailwind 暗色模式，将 `dark` 类应用到 `<html>` 元素
- **国际化 (i18n)**: `services/i18n.ts` 中的简单键值对翻译，支持中文 (默认) 和英文。首次运行时从系统区域设置自动检测语言。
- **路径别名**: `@` 在 Vite 配置中映射到 `src/renderer/` 用于导入。
- **技能**: `SKILLs/` 目录中的自定义技能定义，通过 `skills.config.json` 配置

### 制品系统

制品功能提供类似 Claude 制品的代码输出富预览：

**支持的类型**:
- `html` - 在沙箱 iframe 中渲染的完整 HTML 页面
- `svg` - SVG 图形，经过 DOMPurify 清理并支持缩放控制
- `mermaid` - 通过 Mermaid.js 渲染流程图、序列图、类图
- `react` - 在隔离 iframe 中使用 Babel 编译的 React/JSX 组件
- `code` - 带行号的语法高亮代码

**检测方法**:
1. 显式标记: ` ```artifact:html title="My Page" `
2. 启发式检测: 分析代码块语言和内容模式

**UI 组件**:
- 右侧面板 (300-800px 可调整宽度)
- 带类型图标、标题、复制/下载/关闭按钮的头部
- 消息中的制品徽章用于切换制品

**安全性**:
- HTML: `sandbox="allow-scripts"` 且无 `allow-same-origin`
- SVG: DOMPurify 移除所有脚本内容
- React: 完全隔离的 iframe，无网络访问
- Mermaid: `securityLevel: 'strict'` 配置

### 配置

- 应用配置存储在 SQLite `kv` 表中
- 协作配置存储在 `cowork_config` 表中 (workingDirectory、systemPrompt、executionMode)
- 协作会话和消息存储在 `cowork_sessions` 和 `cowork_messages` 表中
- 数据库文件: 用户数据目录中的 `lobsterai.sqlite`

### TypeScript 配置

- `tsconfig.json`: React/渲染进程代码 (ES2020, ESNext 模块)
- `electron-tsconfig.json`: Electron 主进程 (CommonJS 输出到 `dist-electron/`)

### 关键依赖

- `@anthropic-ai/claude-agent-sdk` - 用于协作会话的 Claude Agent SDK
- `sql.js` - 用于持久化的 SQLite 数据库
- `react-markdown`、`remark-gfm`、`rehype-katex` - 支持数学公式的 Markdown 渲染
- `mermaid` - 图表渲染
- `dompurify` - SVG/HTML 清理

## 编码风格与命名规范

- 使用 TypeScript、函数式 React 组件和 Hooks；将非 UI 特定的逻辑放在 `src/renderer/services/` 中。
- 匹配现有格式：2 空格缩进、单引号和分号。
- 命名：组件使用 `PascalCase` (如 `Chat.tsx`)，函数/变量使用 `camelCase`，Redux slices 使用 `*Slice.ts`。
- Tailwind CSS 是主要的样式方案；优先使用工具类而非自定义 CSS。

## 测试指南

- 测试使用 Node.js 内置的 `node:test` 模块 (不使用 Jest/Mocha/Vitest)。
- 运行测试: `npm run test:memory` (先编译 Electron 主进程，然后运行 `tests/coworkMemoryExtractor.test.mjs`)。
- 测试文件位于 `tests/` 目录，导入 `dist-electron/` 中的编译输出。
- 通过运行 `npm run electron:dev` 并执行关键流程来手动验证 UI 变更：
  - 协作: 启动会话、发送提示、批准/拒绝工具权限、停止会话
  - 制品: 预览 HTML、SVG、Mermaid 图表、React 组件
  - 设置: 主题切换、语言切换
- 保持控制台警告/错误清洁；提交前通过 `npm run lint` 进行代码检查。

## 提交与拉取请求指南

- 最近的提交历史使用约定式前缀，如 `feat:`、`refactor:` 和 `chore:`；较早的提交包含 `feature:` 和 `Initial commit`。
- 优先使用 `type: 简短祈使句摘要` 格式 (如 `feat: add artifact toolbar actions`)。
- PR 应包含简洁的描述、相关联的 issue (如适用)，以及 UI 变更的截图。
- 在 PR 描述中注明任何 Electron 特定的行为变更 (IPC、存储、窗口管理)。
