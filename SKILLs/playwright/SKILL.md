---
name: "playwright"
description: "当任务需要通过终端自动化真实浏览器时使用此技能（导航、表单填写、快照、截图、数据提取、UI流程调试），通过 `playwright-cli` 或捆绑的包装脚本实现。"
---


# Playwright CLI 技能

使用 `playwright-cli` 从终端驱动真实浏览器。优先使用捆绑的包装脚本，这样即使 CLI 未全局安装也能正常工作。
将此技能视为 CLI 优先的自动化工具。除非用户明确要求测试文件，否则不要转向 `@playwright/test`。

## 前置条件检查（必需）

在提出命令之前，检查 `npx` 是否可用（包装脚本依赖它）：

```bash
command -v npx >/dev/null 2>&1
```

如果不可用，暂停并请用户安装 Node.js/npm（它提供 `npx`）。按原样提供以下步骤：

```bash
# 验证 Node/npm 是否已安装
node --version
npm --version

# 如果缺失，安装 Node.js/npm，然后：
npm install -g @playwright/mcp@latest
playwright-cli --help
```

一旦 `npx` 存在，继续使用包装脚本。全局安装 `playwright-cli` 是可选的。

## 技能路径（设置一次）

```bash
export SKILLS_ROOT="${LOBSTERAI_SKILLS_ROOT:-${SKILLS_ROOT:-$HOME/Library/Application Support/LobsterAI/SKILLs}}"
export PWCLI="$SKILLS_ROOT/playwright/scripts/playwright_cli.sh"
```

已安装的技能从 `$LOBSTERAI_SKILLS_ROOT` / `$SKILLS_ROOT` 解析（生产环境默认值：应用 `userData/SKILLs`，macOS 通常为 `~/Library/Application Support/LobsterAI/SKILLs`）。

## 快速开始

使用包装脚本：

```bash
"$PWCLI" open https://playwright.dev --headed
"$PWCLI" snapshot
"$PWCLI" click e15
"$PWCLI" type "Playwright"
"$PWCLI" press Enter
"$PWCLI" screenshot
```

如果用户偏好全局安装，这也是有效的：

```bash
npm install -g @playwright/mcp@latest
playwright-cli --help
```

## 核心工作流程

1. 打开页面。
2. 快照以获取稳定的元素引用。
3. 使用最新快照中的引用进行交互。
4. 在导航或重大 DOM 更改后重新快照。
5. 在有用时捕获产物（截图、pdf、跟踪）。

最小循环：

```bash
"$PWCLI" open https://example.com
"$PWCLI" snapshot
"$PWCLI" click e3
"$PWCLI" snapshot
```

## 何时重新快照

在以下情况后重新快照：

- 导航
- 点击显著改变 UI 的元素
- 打开/关闭模态框或菜单
- 标签页切换

引用可能会过时。当命令因缺失引用而失败时，重新快照。

## 推荐模式

### 表单填写和提交

```bash
"$PWCLI" open https://example.com/form
"$PWCLI" snapshot
"$PWCLI" fill e1 "user@example.com"
"$PWCLI" fill e2 "password123"
"$PWCLI" click e3
"$PWCLI" snapshot
```

### 使用跟踪调试 UI 流程

```bash
"$PWCLI" open https://example.com --headed
"$PWCLI" tracing-start
# ...交互操作...
"$PWCLI" tracing-stop
```

### 多标签页操作

```bash
"$PWCLI" tab-new https://example.com
"$PWCLI" tab-list
"$PWCLI" tab-select 0
"$PWCLI" snapshot
```

## 包装脚本

包装脚本使用 `npx --package @playwright/mcp playwright-cli`，这样 CLI 可以在无需全局安装的情况下运行：

```bash
"$PWCLI" --help
```

除非仓库已标准化使用全局安装，否则优先使用包装脚本。

## 参考资料

仅打开所需内容：

- CLI 命令参考：`references/cli.md`
- 实用工作流程和故障排除：`references/workflows.md`

## 限制与规范

- 在引用元素 id（如 `e12`）之前始终先快照。
- 当引用似乎过时时重新快照。
- 优先使用显式命令而不是 `eval` 和 `run-code`，除非必要。
- 当没有新快照时，使用占位符引用如 `eX` 并说明原因；不要用 `run-code` 绕过引用。
- 当视觉检查有帮助时使用 `--headed`。
- 在此仓库中捕获产物时，使用 `output/playwright/` 并避免引入新的顶级产物文件夹。
- 默认使用 CLI 命令和工作流程，而不是 Playwright 测试规范。
