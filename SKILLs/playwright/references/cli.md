# Playwright CLI 参考

除非 CLI 已经全局安装，否则请使用包装脚本：

```bash
export SKILLS_ROOT="${LOBSTERAI_SKILLS_ROOT:-${SKILLS_ROOT:-$HOME/Library/Application Support/LobsterAI/SKILLs}}"
export PWCLI="$SKILLS_ROOT/playwright/scripts/playwright_cli.sh"
"$PWCLI" --help
```

已安装的技能从 `$LOBSTERAI_SKILLS_ROOT` / `$SKILLS_ROOT` 解析（生产环境默认值：应用 `userData/SKILLs`，macOS 通常为 `~/Library/Application Support/LobsterAI/SKILLs`）。

可选的便捷别名：

```bash
alias pwcli="$PWCLI"
```

## 核心操作

```bash
pwcli open https://example.com      # 打开网页
pwcli close                         # 关闭页面
pwcli snapshot                      # 获取页面快照
pwcli click e3                      # 点击元素 e3
pwcli dblclick e7                   # 双击元素 e7
pwcli type "search terms"           # 输入搜索关键词
pwcli press Enter                   # 按下 Enter 键
pwcli fill e5 "user@example.com"    # 在元素 e5 中填入邮箱
pwcli drag e2 e8                    # 将元素 e2 拖拽到 e8
pwcli hover e4                      # 悬停在元素 e4 上
pwcli select e9 "option-value"      # 在元素 e9 中选择选项
pwcli upload ./document.pdf         # 上传文档
pwcli check e12                     # 勾选复选框 e12
pwcli uncheck e12                   # 取消勾选复选框 e12
pwcli eval "document.title"         # 执行 JavaScript 获取文档标题
pwcli eval "el => el.textContent" e5  # 执行 JavaScript 获取元素 e5 的文本内容
pwcli dialog-accept                 # 接受对话框
pwcli dialog-accept "confirmation text"  # 接受对话框并输入确认文本
pwcli dialog-dismiss                # 关闭对话框
pwcli resize 1920 1080              # 调整视口大小为 1920x1080
```

## 导航操作

```bash
pwcli go-back                       # 后退
pwcli go-forward                    # 前进
pwcli reload                        # 刷新页面
```

## 键盘操作

```bash
pwcli press Enter                   # 按下 Enter 键
pwcli press ArrowDown               # 按下向下箭头键
pwcli keydown Shift                 # 按下 Shift 键（保持按下状态）
pwcli keyup Shift                   # 释放 Shift 键
```

## 鼠标操作

```bash
pwcli mousemove 150 300             # 移动鼠标到坐标 (150, 300)
pwcli mousedown                     # 按下鼠标左键
pwcli mousedown right               # 按下鼠标右键
pwcli mouseup                       # 释放鼠标左键
pwcli mouseup right                 # 释放鼠标右键
pwcli mousewheel 0 100              # 滚动鼠标滚轮
```

## 保存操作

```bash
pwcli screenshot                    # 截取整个页面的屏幕截图
pwcli screenshot e5                 # 截取元素 e5 的屏幕截图
pwcli pdf                           # 将页面保存为 PDF
```

## 标签页管理

```bash
pwcli tab-list                      # 列出所有标签页
pwcli tab-new                       # 新建标签页
pwcli tab-new https://example.com/page  # 在新标签页中打开指定网址
pwcli tab-close                     # 关闭当前标签页
pwcli tab-close 2                   # 关闭第 2 个标签页
pwcli tab-select 0                  # 切换到第 0 个标签页
```

## 开发者工具

```bash
pwcli console                       # 显示控制台日志
pwcli console warning               # 显示控制台警告
pwcli network                       # 显示网络请求
pwcli run-code "await page.waitForTimeout(1000)"  # 执行代码：等待 1 秒
pwcli tracing-start                 # 开始追踪
pwcli tracing-stop                  # 停止追踪
```

## 会话管理

使用命名会话来隔离工作：

```bash
pwcli --session todo open https://demo.playwright.dev/todomvc
pwcli --session todo snapshot
```

或者设置一次环境变量：

```bash
export PLAYWRIGHT_CLI_SESSION=todo
pwcli open https://demo.playwright.dev/todomvc
```
