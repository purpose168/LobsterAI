---
name: local-tools
description: 访问本地系统资源，包括 macOS 和 Windows 上的日历。当您需要直接在用户设备上管理日程安排时使用此技能。
---

# 本地工具技能

## 何时使用此技能

在以下情况下使用 local-tools 技能：

- **日历管理** - 查看、创建、更新或删除日历事件

**使用示例：**
- 用户："显示我明天的日程安排"
- 用户："创建一个下午 3 点的会议"
- 用户："搜索包含'项目'的日历事件"
- 用户："删除明天的会议"

## 工作原理

```
┌──────────┐    Bash/PowerShell    ┌─────────────────────────────────────────────────────────────┐
│  Claude  │──────────────────────▶│  calendar.sh / calendar.ps1                                 │
│          │                       │  ├─ macOS: osascript -l JavaScript (JXA) ──▶ Calendar.app   │
│          │                       │  └─ Windows: PowerShell ──▶ Outlook COM API                 │
└──────────┘                       └─────────────────────────────────────────────────────────────┘
```

**架构：**
1. **CLI 脚本** - 平台特定的脚本，无需 HTTP 服务器
   - `calendar.sh` - macOS 的 Bash 脚本
   - `calendar.ps1` - Windows 的 PowerShell 脚本

2. **本地日历访问** - 直接访问系统日历
   - macOS: 使用 JXA (JavaScript for Automation) 控制 Calendar.app
   - Windows: 使用 PowerShell COM API 控制 Microsoft Outlook

3. **JSON 输出** - 结构化数据格式，便于解析

## 平台支持

| 平台 | 实现方式 | 日历应用 | 状态 |
|----------|---------------|--------------|--------|
| **macOS 10.10+** | JXA + Calendar.app | Calendar.app | ✅ 完全支持 |
| **Windows 7+** | PowerShell + COM | Microsoft Outlook | ✅ 完全支持 |
| **Linux** | - | - | ❌ 不支持 |

## 权限

### macOS
- 需要"日历"访问权限
- 首次使用时会提示用户授权
- 可在以下位置管理：系统设置 > 隐私与安全性 > 日历

### Windows
- 需要安装 Microsoft Outlook
- 可能需要管理员权限进行 COM 访问

## 日历操作

**重要：如何定位脚本**

当您使用 Read 工具读取此 SKILL.md 文件时，会收到其绝对路径（例如 `/Users/username/.../SKILLs/local-tools/SKILL.md`）。

**构建脚本路径：**
1. 获取此 SKILL.md 文件的目录
2. 追加 `/scripts/calendar.sh`（macOS）或 `/scripts/calendar.ps1`（Windows）

**示例：**
```bash
# 如果 SKILL.md 位于：/Users/username/path/to/SKILLs/local-tools/SKILL.md
# 那么脚本位于：/Users/username/path/to/SKILLs/local-tools/scripts/calendar.sh

bash "/Users/username/path/to/SKILLs/local-tools/scripts/calendar.sh" <operation> [options]
```

在以下所有示例中，`<skill-dir>/scripts/calendar.sh` 是占位符。请将其替换为实际的绝对路径。

### AI 助手的最佳实践

**应该做：**
- ✅ 直接执行命令，不要展示试错过程
- ✅ 如果命令失败，告知用户权限问题，不要展示技术错误
- ✅ 使用 `search` 命令搜索生日/纪念日
- ✅ 如果未指定日历名称，脚本将自动使用第一个可用的日历

**不应该做：**
- ❌ 不要反复尝试不同的命令组合
- ❌ 不要向用户展示错误堆栈或技术细节
- ❌ 不要读取脚本源代码来分析问题
- ❌ 不要询问用户日历名称，使用默认行为

**示例 - 搜索生日：**
```bash
# 正确方法：直接搜索，不要试错
bash "<skill-dir>/scripts/calendar.sh" search --query "birthday"

# 如果返回权限错误，直接告诉用户：
# "需要日历访问权限。请打开系统设置 > 隐私与安全性 > 日历，并授权终端或 LobsterAI"
```

### 列出事件

```bash
# 列出未来 7 天的事件（默认）
bash "<skill-dir>/scripts/calendar.sh" list

# 列出特定日期范围的事件
bash "<skill-dir>/scripts/calendar.sh" list \
  --start "2026-02-12T00:00:00" \
  --end "2026-02-19T23:59:59"

# 列出特定日历的事件（macOS）
bash "<skill-dir>/scripts/calendar.sh" list \
  --calendar "Work"
```

### 创建事件

```bash
# 创建一个简单事件
bash "<skill-dir>/scripts/calendar.sh" create \
  --title "Team Meeting" \
  --start "2026-02-13T14:00:00" \
  --end "2026-02-13T15:00:00"

# 创建带有地点和备注的事件
bash "<skill-dir>/scripts/calendar.sh" create \
  --title "Client Call" \
  --start "2026-02-14T10:00:00" \
  --end "2026-02-14T11:00:00" \
  --calendar "Work" \
  --location "Conference Room A" \
  --notes "Discuss Q1 roadmap"
```

### 更新事件

```bash
# 更新事件标题
bash "<skill-dir>/scripts/calendar.sh" update \
  --id "EVENT-ID" \
  --title "Updated Meeting Title"

# 更新事件时间
bash "<skill-dir>/scripts/calendar.sh" update \
  --id "EVENT-ID" \
  --start "2026-02-13T15:00:00" \
  --end "2026-02-13T16:00:00"
```

### 删除事件

```bash
bash "<skill-dir>/scripts/calendar.sh" delete \
  --id "EVENT-ID"
```

### 搜索事件

```bash
# 搜索包含关键词的事件（搜索所有日历）
bash "<skill-dir>/scripts/calendar.sh" search \
  --query "meeting"

# 仅在特定日历中搜索
bash "<skill-dir>/scripts/calendar.sh" search \
  --query "project" \
  --calendar "Work"
```

**注意：** 当未指定 `--calendar` 时，搜索操作将在 macOS 和 Windows 上查找**所有可用的日历**。

## 输出格式

所有命令返回具有以下结构的 JSON：

### 成功响应

```json
{
  "success": true,
  "data": {
    "events": [
      {
        "eventId": "E621F8C4-...",
        "title": "Team Meeting",
        "startTime": "2026-02-13T14:00:00.000Z",
        "endTime": "2026-02-13T15:00:00.000Z",
        "location": "Conference Room",
        "notes": "Weekly sync",
        "calendar": "Work",
        "allDay": false
      }
    ],
    "count": 1
  }
}
```

### 错误响应

```json
{
  "success": false,
  "error": {
    "code": "CALENDAR_ACCESS_ERROR",
    "message": "Calendar access permission is required...",
    "recoverable": true,
    "permissionRequired": true
  }
}
```

### 错误代码

| 代码 | 含义 | 可恢复 |
|------|---------|-------------|
| `CALENDAR_ACCESS_ERROR` | 权限被拒绝或日历不可访问 | 是 |
| `INVALID_INPUT` | 缺少必需参数 | 否 |
| `EVENT_NOT_FOUND` | 未找到事件 ID | 否 |
| `OUTLOOK_NOT_AVAILABLE` | 未安装 Microsoft Outlook（Windows） | 是 |

## 日期格式指南

### 重要：日期格式指南

使用 `list` 命令配合时间范围时：

1. **始终使用 ISO 8601 格式**：`YYYY-MM-DDTHH:mm:ss`
2. **使用本地时区**：不要使用 UTC 或时区后缀（如 +08:00 或 Z）
3. **自行计算日期**：不要使用 shell 命令替换，如 `$(date ...)`
4. **Claude 应计算日期**：基于当前日期，直接计算目标日期
5. **示例**：
   - 今天午夜：`2026-02-13T00:00:00`
   - 今天结束：`2026-02-13T23:59:59`
   - 明天上午：`2026-02-14T09:00:00`
   - 下周一：`2026-02-16T00:00:00`

**原因**：脚本期望与您系统时区匹配的本地时间字符串。Shell 替换可能在所有环境中无法正确执行。

## 常见模式

### 模式 1：日程管理

```bash
# 用户问："我今天有什么会议？"
# Claude 的方法：计算今天的日期，并查询从 00:00 到 23:59 的全天
# 重要：Claude 应将 2026-02-13 替换为实际的当前日期
bash "<skill-dir>/scripts/calendar.sh" list \
  --start "2026-02-13T00:00:00" \
  --end "2026-02-13T23:59:59"

# 用户问："我明天的日程安排是什么？"
# Claude 应计算明天的日期（例如，如果今天是 2026-02-13，明天就是 2026-02-14）
bash "<skill-dir>/scripts/calendar.sh" list \
  --start "2026-02-14T00:00:00" \
  --end "2026-02-14T23:59:59"
```

### 模式 2：会议安排

```bash
# 用户问："安排一个明天下午 3 点的会议"
# Claude 的方法：
bash "<skill-dir>/scripts/calendar.sh" create \
  --title "Meeting" \
  --start "2026-02-13T15:00:00" \
  --end "2026-02-13T16:00:00" \
  --calendar "Work"
```

### 模式 3：事件搜索

```bash
# 用户问："查找所有关于项目的会议"
# Claude 的方法：
bash "<skill-dir>/scripts/calendar.sh" search \
  --query "project" \
  --calendar "Work"
```

### 模式 4：可用性检查

```bash
# 用户问："我明天下午有空吗？"
# Claude 的方法：
# 1. 列出明天的事件
# 2. 分析时间段
# 3. 报告可用性
bash "<skill-dir>/scripts/calendar.sh" list \
  --start "2026-02-14T00:00:00" \
  --end "2026-02-14T23:59:59"
```

## 已知行为

### 时间范围匹配

`list` 命令使用**区间重叠检测**：
- 返回与查询时间范围有**任何重叠**的事件
- 不要求事件完全包含在范围内

**示例：**
- 查询：2026-02-13 00:00:00 到 23:59:59
- 返回：
  - ✅ 完全在 2 月 13 日的事件（例如，10:00-11:00）
  - ✅ 跨越 2 月 13 日的多日事件（例如，2 月 12 日 10:00 - 2 月 14 日 10:00）
  - ✅ 跨越午夜的事件（例如，2 月 13 日 23:30 - 2 月 14 日 00:30）
  - ❌ 完全在 2 月 13 日之前的事件（例如，2 月 12 日 10:00-11:00）
  - ❌ 完全在 2 月 13 日之后的事件（例如，2 月 14 日 10:00-11:00）

### 全天事件

- 视为在其日期内从 00:00:00 到 23:59:59
- 多日全天事件（例如，2 月 12-14 日）在查询该范围内任何日期时都会出现

### 时间精度

- 比较使用秒级精度
- 日期比较中忽略毫秒

### 重复事件

- 每次出现都被视为单独的事件实例
- 脚本返回查询时间范围内的单独出现

## 最佳实践

### 1. 创建前始终检查

创建事件之前，列出现有事件以避免冲突：

```bash
# 首先检查现有事件
bash "<skill-dir>/scripts/calendar.sh" list

# 如果没有冲突则创建
bash "<skill-dir>/scripts/calendar.sh" create ...
```

### 2. 使用特定日历（macOS）

指定日历以保持事件有序：

```bash
bash "<skill-dir>/scripts/calendar.sh" create \
  --title "Team Meeting" \
  --calendar "Work" \
  ...
```

### 3. 更新/删除前先搜索

始终先搜索以获取正确的事件 ID：

```bash
# 搜索以查找事件 ID
bash "<skill-dir>/scripts/calendar.sh" search --query "meeting"

# 然后更新或删除
bash "<skill-dir>/scripts/calendar.sh" update --id "FOUND-ID" ...
```

### 4. 优雅地处理错误

解析响应并处理错误：

```bash
result=$(bash "<skill-dir>/scripts/calendar.sh" list)
if echo "$result" | grep -q '"success":true'; then
  # 处理事件
  events=$(echo "$result" | jq '.data.events')
else
  # 处理错误
  error=$(echo "$result" | jq '.error.message')
  echo "失败：$error"
fi
```

## 限制

### macOS
- 需要 macOS 10.10 Yosemite 或更高版本（用于 JXA 支持）
- 需要日历访问权限
- 不支持高级重复事件查询
- 无法修改重复事件规则

### Windows
- 需要安装 Microsoft Outlook
- 不支持其他日历应用程序（Windows 日历、Google 日历等）
- 在企业环境中可能需要 COM 访问权限
- 文件夹枚举可能会跳过受限日历

### 通用
- 所有日期必须采用 ISO 8601 格式（`YYYY-MM-DDTHH:mm:ss`）
- 所有操作使用本地时区
- 返回值转换为 UTC（ISO 8601 带 Z 后缀）
- 不支持与会者或会议邀请

## 故障排除

### macOS

**权限被拒绝：**
```
Error: Calendar access permission is required
```
**解决方案：** 打开系统设置 > 隐私与安全性 > 日历，授权终端或 LobsterAI

**脚本未找到：**
```
bash: calendar.sh: No such file or directory
```
**解决方案：** 确保您使用的是 SKILL.md 目录的绝对路径 + `/scripts/calendar.sh`

### Windows

**Outlook 未找到：**
```
Error: Microsoft Outlook is not installed or not accessible
```
**解决方案：** 安装 Microsoft Outlook 并确保其已正确配置

**PowerShell 执行策略：**
```
Error: Execution of scripts is disabled on this system
```
**解决方案：** 以管理员身份运行 PowerShell 并执行：
```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

## 技术细节

### macOS 实现

**JXA (JavaScript for Automation)：**
- 使用 `osascript -l JavaScript` 执行 JXA 代码
- 通过 Apple Events 控制 Calendar.app
- 适用于 Intel 和 Apple Silicon Mac
- 需要用户授予日历访问权限

**日期处理：**
- 使用 BSD date 命令（macOS 原生）
- 格式：`date +%Y-%m-%dT%H:%M:%S`（本地时区）
- 相对日期：`date -v+7d`（从现在起 7 天）

### Windows 实现

**PowerShell + COM：**
- 通过 PowerShell 使用 Outlook COM API
- 需要安装并配置 Outlook
- 适用于所有 Outlook 兼容的日历

**日期处理：**
- 使用 PowerShell `[DateTime]::Parse()` 进行日期解析
- 自动处理本地时区

### 跨平台一致性

两种实现：
- 使用相同的 JSON 输出格式
- 支持相同的操作（list、create、update、delete、search）
- 在本地时区处理日期
- 以 ISO 8601 格式返回 UTC 时间戳

## 相关技能

- **imap-smtp-email** - 用于基于电子邮件的会议邀请
- **scheduled-task** - 用于定期日历同步
