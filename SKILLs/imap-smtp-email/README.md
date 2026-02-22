# IMAP/SMTP 邮件技能

通过 IMAP/SMTP 协议读取和发送邮件。支持任何 IMAP/SMTP 服务器，包括 Gmail、Outlook、163.com、vip.163.com、126.com、vip.126.com、188.com 和 vip.188.com。

## 快速设置

1. **创建 `.env` 文件**并配置您的凭据：

```bash
# IMAP 配置（接收邮件）
IMAP_HOST=imap.gmail.com
IMAP_PORT=993
IMAP_USER=your@gmail.com
IMAP_PASS=your_app_password
IMAP_TLS=true
IMAP_MAILBOX=INBOX

# SMTP 配置（发送邮件）
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your@gmail.com
SMTP_PASS=your_app_password
SMTP_FROM=your@gmail.com
```

2. **安装依赖：**
```bash
npm install
```

3. **测试连接：**
```bash
node scripts/imap.js check
node scripts/smtp.js test
```

## IMAP 命令（接收邮件）

### 检查新邮件
```bash
node scripts/imap.js check --limit 10
node scripts/imap.js check --recent 2h        # 最近 2 小时
node scripts/imap.js check --recent 30m       # 最近 30 分钟
```

### 获取特定邮件
```bash
node scripts/imap.js fetch <uid>
```

### 搜索邮件
```bash
node scripts/imap.js search --unseen
node scripts/imap.js search --from "sender@example.com"
node scripts/imap.js search --subject "important"
node scripts/imap.js search --recent 24h
```

### 标记为已读/未读
```bash
node scripts/imap.js mark-read <uid>
node scripts/imap.js mark-unread <uid>
```

### 列出邮箱
```bash
node scripts/imap.js list-mailboxes
```

## SMTP 命令（发送邮件）

### 测试 SMTP 连接
```bash
node scripts/smtp.js test
```

### 发送邮件
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
| QQ Mail | imap.qq.com | 993 | smtp.qq.com | 587 |

**163.com 重要提示：**
- 使用**授权码**，而非账户密码
- 需先在网页设置中启用 IMAP/SMTP

## 配置选项

**IMAP：**
- `IMAP_HOST` - 服务器主机名
- `IMAP_PORT` - 服务器端口
- `IMAP_USER` - 您的邮箱地址
- `IMAP_PASS` - 您的密码或应用专用密码
- `IMAP_TLS` - 使用 TLS（true 表示 SSL，false 表示 STARTTLS）
- `IMAP_REJECT_UNAUTHORIZED` - 接受自签名证书
- `IMAP_MAILBOX` - 默认邮箱（INBOX）

**SMTP：**
- `SMTP_HOST` - 服务器主机名
- `SMTP_PORT` - 服务器端口（587 用于 STARTTLS，465 用于 SSL）
- `SMTP_SECURE` - true 表示 SSL（465），false 表示 STARTTLS（587）
- `SMTP_USER` - 您的邮箱地址
- `SMTP_PASS` - 您的密码或应用专用密码
- `SMTP_FROM` - 默认发件人邮箱（可选）
- `SMTP_REJECT_UNAUTHORIZED` - 接受自签名证书

## 故障排除

**连接错误：**
- 验证 IMAP/SMTP 服务器是否正在运行且可访问
- 检查 `.env` 中的主机/端口设置

**身份验证失败：**
- Gmail：使用应用专用密码（如果启用了双因素认证，请勿使用账户密码）
- 163.com：使用授权码，而非账户密码

**TLS/SSL 错误：**
- 对于自签名证书：设置 `IMAP_REJECT_UNAUTHORIZED=false` 或 `SMTP_REJECT_UNAUTHORIZED=false`

## 文件说明

- `SKILL.md` - 技能文档
- `scripts/imap.js` - IMAP 命令行工具
- `scripts/smtp.js` - SMTP 命令行工具
- `package.json` - Node.js 依赖
- `.env` - 您的凭据（需手动创建）
