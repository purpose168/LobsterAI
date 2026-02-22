---
name: imap-smtp-email
description: 通过 IMAP/SMTP 读取和发送邮件。检查新邮件/未读邮件、获取内容、搜索邮箱、标记为已读/未读，以及发送带附件的邮件。支持任何 IMAP/SMTP 服务器，包括 Gmail、Outlook、163.com、vip.163.com、126.com、vip.126.com、188.com 和 vip.188.com。
---

# IMAP/SMTP 邮件工具

通过 IMAP 协议读取、搜索和管理邮件。通过 SMTP 发送邮件。支持 Gmail、Outlook、163.com、vip.163.com、126.com、vip.126.com、188.com、vip.188.com 以及任何标准的 IMAP/SMTP 服务器。

## 配置

在技能文件夹中创建 `.env` 文件或设置环境变量：

```bash
# IMAP 配置（接收邮件）
IMAP_HOST=imap.gmail.com          # 服务器主机名
IMAP_PORT=993                     # 服务器端口
IMAP_USER=your@email.com
IMAP_PASS=your_password
IMAP_TLS=true                     # 使用 TLS/SSL 连接
IMAP_REJECT_UNAUTHORIZED=true     # 对于自签名证书设置为 false
IMAP_MAILBOX=INBOX                # 默认邮箱

# SMTP 配置（发送邮件）
SMTP_HOST=smtp.gmail.com          # SMTP 服务器主机名
SMTP_PORT=587                     # SMTP 端口（587 用于 STARTTLS，465 用于 SSL）
SMTP_SECURE=false                 # true 用于 SSL (465)，false 用于 STARTTLS (587)
SMTP_USER=your@gmail.com          # 您的邮箱地址
SMTP_PASS=your_password           # 您的密码或应用专用密码
SMTP_FROM=your@gmail.com          # 默认发件人邮箱（可选）
SMTP_REJECT_UNAUTHORIZED=true     # 对于自签名证书设置为 false
```

## 常用邮件服务器

| 服务商 | IMAP 主机 | IMAP 端口 | SMTP 主机 | SMTP 端口 |
|----------|-----------|-----------|-----------|-----------|
| 163.com | imap.163.com | 993 | smtp.163.com | 465 |
| vip.163.com | imap.vip.163.com | 993 | smtp.vip.163.com | 465 |
| 126.com | imap.126.com | 993 | smtp.126.com | 465 |
| vip.126.com | imap.vip.126.com | 993 | smtp.vip.126.com | 465 |
| 188.com | imap.188.com | 993 | smtp.188.com | 465 |
| vip.188.com | imap.vip.188.com | 993 | smtp.vip.188.com | 465 |
| yeah.net | imap.yeah.net | 993 | smtp.yeah.net | 465 |
| Gmail | imap.gmail.com | 993 | smtp.gmail.com | 587 |
| Outlook | outlook.office365.com | 993 | smtp.office365.com | 587 |
| QQ 邮箱 | imap.qq.com | 993 | smtp.qq.com | 587 |

**163.com 重要说明：**
- 使用**授权码**，而非账户密码
- 需先在网页设置中启用 IMAP/SMTP

## IMAP 命令（接收邮件）

### check
检查新邮件/未读邮件。

```bash
node scripts/imap.js check [--limit 10] [--mailbox INBOX] [--recent 2h]
```

选项：
- `--limit <n>`：最大结果数（默认：10）
- `--mailbox <name>`：要检查的邮箱（默认：INBOX）
- `--recent <time>`：仅显示最近 X 时间内的邮件（例如：30m、2h、7d）

### fetch
根据 UID 获取完整邮件内容。

```bash
node scripts/imap.js fetch <uid> [--mailbox INBOX]
```

### download
下载邮件中的所有附件，或下载特定附件。

```bash
node scripts/imap.js download <uid> [--mailbox INBOX] [--dir <path>] [--file <filename>]
```

选项：
- `--mailbox <name>`：邮箱（默认：INBOX）
- `--dir <path>`：输出目录（默认：当前目录）
- `--file <filename>`：仅下载指定的附件（默认：下载全部）

### search
使用筛选条件搜索邮件。

```bash
node scripts/imap.js search [options]

选项：
  --unseen           仅未读邮件
  --seen             仅已读邮件
  --from <email>     发件人地址包含
  --subject <text>   主题包含
  --recent <time>    最近 X 时间内（例如：30m、2h、7d）
  --since <date>     日期之后（YYYY-MM-DD）
  --before <date>    日期之前（YYYY-MM-DD）
  --limit <n>        最大结果数（默认：20）
  --mailbox <name>   要搜索的邮箱（默认：INBOX）
```

### mark-read / mark-unread
将邮件标记为已读或未读。

```bash
node scripts/imap.js mark-read <uid> [uid2 uid3...]
node scripts/imap.js mark-unread <uid> [uid2 uid3...]
```

### list-mailboxes
列出所有可用的邮箱/文件夹。

```bash
node scripts/imap.js list-mailboxes
```

## SMTP 命令（发送邮件）

### send
通过 SMTP 发送邮件。

```bash
node scripts/smtp.js send --to <email> --subject <text> [options]
```

**必需参数：**
- `--to <email>`：收件人（多个收件人用逗号分隔）
- `--subject <text>`：邮件主题，或使用 `--subject-file <file>`

**可选参数：**
- `--body <text>`：纯文本正文
- `--html`：以 HTML 格式发送正文
- `--body-file <file>`：从文件读取正文
- `--html-file <file>`：从文件读取 HTML
- `--cc <email>`：抄送收件人
- `--bcc <email>`：密送收件人
- `--attach <file>`：附件（多个附件用逗号分隔）
- `--from <email>`：覆盖默认发件人

**示例：**
```bash
# 简单文本邮件
node scripts/smtp.js send --to recipient@example.com --subject "Hello" --body "World"

# HTML 邮件
node scripts/smtp.js send --to recipient@example.com --subject "Newsletter" --html --body "<h1>Welcome</h1>"

# 带附件的邮件
node scripts/smtp.js send --to recipient@example.com --subject "Report" --body "Please find attached" --attach report.pdf

# 多个收件人
node scripts/smtp.js send --to "a@example.com,b@example.com" --cc "c@example.com" --subject "Update" --body "Team update"
```

### test
通过向自己发送测试邮件来测试 SMTP 连接。

```bash
node scripts/smtp.js test
```

## 依赖安装

```bash
npm install
```

## 安全说明

- 将凭据存储在 `.env` 文件中（添加到 `.gitignore`）
- Gmail：如果启用了两步验证，请使用应用专用密码
- 163.com：使用授权码，而非账户密码

## 故障排除

**连接超时：**
- 验证服务器正在运行且可访问
- 检查主机/端口配置

**身份验证失败：**
- 验证用户名（通常是完整的邮箱地址）
- 检查密码是否正确
- 163.com：使用授权码，而非账户密码
- Gmail：如果启用了两步验证，请使用应用专用密码

**TLS/SSL 错误：**
- 将 `IMAP_TLS`/`SMTP_SECURE` 设置与服务器要求匹配
- 对于自签名证书：设置 `IMAP_REJECT_UNAUTHORIZED=false` 或 `SMTP_REJECT_UNAUTHORIZED=false`
