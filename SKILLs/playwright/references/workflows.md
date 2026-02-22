# Playwright CLI 工作流程

经常使用包装脚本和快照功能。
假设已设置 `PWCLI` 环境变量，且 `pwcli` 是 `"$PWCLI"` 的别名。
在本仓库中，请从 `output/playwright/<label>/` 目录运行命令，以将生成的文件集中存放。

## 标准交互循环

```bash
pwcli open https://example.com
pwcli snapshot
pwcli click e3
pwcli snapshot
```

## 表单提交

```bash
pwcli open https://example.com/form --headed
pwcli snapshot
pwcli fill e1 "user@example.com"
pwcli fill e2 "password123"
pwcli click e3
pwcli snapshot
pwcli screenshot
```

## 数据提取

```bash
pwcli open https://example.com
pwcli snapshot
pwcli eval "document.title"
pwcli eval "el => el.textContent" e12
```

## 调试与检查

在重现问题后捕获控制台消息和网络活动：

```bash
pwcli console warning
pwcli network
```

在可疑流程周围记录追踪信息：

```bash
pwcli tracing-start
# 重现问题
pwcli tracing-stop
pwcli screenshot
```

## 会话管理

使用会话在不同项目间隔离工作：

```bash
pwcli --session marketing open https://example.com
pwcli --session marketing snapshot
pwcli --session checkout open https://example.com/checkout
```

或者一次性设置会话：

```bash
export PLAYWRIGHT_CLI_SESSION=checkout
pwcli open https://example.com/checkout
```

## 配置文件

默认情况下，CLI 会从当前目录读取 `playwright-cli.json` 配置文件。使用 `--config` 参数可指定特定文件。

最小配置示例：

```json
{
  "browser": {
    "launchOptions": {
      "headless": false
    },
    "contextOptions": {
      "viewport": { "width": 1280, "height": 720 }
    }
  }
}
```

## 故障排除

- 如果元素引用失败，请重新运行 `pwcli snapshot` 并重试。
- 如果页面显示异常，请使用 `--headed` 参数重新打开并调整窗口大小。
- 如果某个流程依赖于之前的状态，请使用命名的 `--session`。
