#!/bin/bash

# IMAP/SMTP 邮件技能配置助手
# 用途：帮助用户创建包含邮件凭据的 .env 配置文件
# 作者：purpose168@outlook.com

echo "================================"
echo "  IMAP/SMTP 邮件技能配置向导"
echo "================================"
echo ""
echo "本脚本将帮助您创建包含邮件凭据的 .env 配置文件。"
echo ""

# 提示用户选择邮件服务提供商
# 根据不同的邮件服务商，预设相应的服务器地址和端口配置
echo "请选择您的邮件服务提供商："
echo "  1) Gmail（谷歌邮箱）"
echo "  2) Outlook（微软邮箱）"
echo "  3) 163.com（网易163邮箱）"
echo "  4) vip.163.com（网易VIP163邮箱）"
echo "  5) 126.com（网易126邮箱）"
echo "  6) vip.126.com（网易VIP126邮箱）"
echo "  7) 188.com（网易188邮箱）"
echo "  8) vip.188.com（网易VIP188邮箱）"
echo "  9) yeah.net（网易Yeah邮箱）"
echo " 10) QQ Mail（腾讯QQ邮箱）"
echo " 11) Custom（自定义配置）"
echo ""
# read -p：读取用户输入，-p参数用于显示提示信息
read -p "请输入选项 (1-11): " PROVIDER_CHOICE

# case语句：根据用户选择配置不同的邮件服务器参数
# IMAP：用于接收邮件的协议
# SMTP：用于发送邮件的协议
case $PROVIDER_CHOICE in
  # Gmail 配置
  # Gmail 使用 STARTTLS（端口587）进行SMTP连接
  1)
    IMAP_HOST="imap.gmail.com"
    IMAP_PORT="993"
    SMTP_HOST="smtp.gmail.com"
    SMTP_PORT="587"
    SMTP_SECURE="false"
    IMAP_TLS="true"
    ;;
  # Outlook 配置
  # Outlook 使用 STARTTLS（端口587）进行SMTP连接
  2)
    IMAP_HOST="outlook.office365.com"
    IMAP_PORT="993"
    SMTP_HOST="smtp.office365.com"
    SMTP_PORT="587"
    SMTP_SECURE="false"
    IMAP_TLS="true"
    ;;
  # 163邮箱配置
  # 163邮箱使用SSL（端口465）进行SMTP连接
  3)
    IMAP_HOST="imap.163.com"
    IMAP_PORT="993"
    SMTP_HOST="smtp.163.com"
    SMTP_PORT="465"
    SMTP_SECURE="true"
    IMAP_TLS="true"
    ;;
  # VIP163邮箱配置
  4)
    IMAP_HOST="imap.vip.163.com"
    IMAP_PORT="993"
    SMTP_HOST="smtp.vip.163.com"
    SMTP_PORT="465"
    SMTP_SECURE="true"
    IMAP_TLS="true"
    ;;
  # 126邮箱配置
  5)
    IMAP_HOST="imap.126.com"
    IMAP_PORT="993"
    SMTP_HOST="smtp.126.com"
    SMTP_PORT="465"
    SMTP_SECURE="true"
    IMAP_TLS="true"
    ;;
  # VIP126邮箱配置
  6)
    IMAP_HOST="imap.vip.126.com"
    IMAP_PORT="993"
    SMTP_HOST="smtp.vip.126.com"
    SMTP_PORT="465"
    SMTP_SECURE="true"
    IMAP_TLS="true"
    ;;
  # 188邮箱配置
  7)
    IMAP_HOST="imap.188.com"
    IMAP_PORT="993"
    SMTP_HOST="smtp.188.com"
    SMTP_PORT="465"
    SMTP_SECURE="true"
    IMAP_TLS="true"
    ;;
  # VIP188邮箱配置
  8)
    IMAP_HOST="imap.vip.188.com"
    IMAP_PORT="993"
    SMTP_HOST="smtp.vip.188.com"
    SMTP_PORT="465"
    SMTP_SECURE="true"
    IMAP_TLS="true"
    ;;
  # Yeah邮箱配置
  9)
    IMAP_HOST="imap.yeah.net"
    IMAP_PORT="993"
    SMTP_HOST="smtp.yeah.net"
    SMTP_PORT="465"
    SMTP_SECURE="true"
    IMAP_TLS="true"
    ;;
  # QQ邮箱配置
  # QQ邮箱使用STARTTLS（端口587）进行SMTP连接
  10)
    IMAP_HOST="imap.qq.com"
    IMAP_PORT="993"
    SMTP_HOST="smtp.qq.com"
    SMTP_PORT="587"
    SMTP_SECURE="false"
    IMAP_TLS="true"
    ;;
  # 自定义配置
  # 用户手动输入所有服务器参数
  11)
    read -p "IMAP服务器地址: " IMAP_HOST
    read -p "IMAP端口: " IMAP_PORT
    read -p "SMTP服务器地址: " SMTP_HOST
    read -p "SMTP端口: " SMTP_PORT
    read -p "IMAP是否使用TLS? (true/false): " IMAP_TLS
    read -p "SMTP是否使用SSL? (true/false): " SMTP_SECURE
    ;;
  # 无效选择处理
  *)
    echo "无效的选项"
    exit 1
    ;;
esac

echo ""
# 提示用户输入邮箱地址
read -p "邮箱地址: " EMAIL
# read -s：静默读取，输入内容不会显示在屏幕上（用于密码输入）
# 提示用户输入密码/应用专用密码/授权码
# 注意：部分邮箱服务商需要使用应用专用密码或授权码，而非登录密码
read -s -p "密码 / 应用专用密码 / 授权码: " PASSWORD
echo ""

# 询问是否接受自签名证书
# 自签名证书可能导致安全风险，生产环境建议使用正规证书
if [ -z "$REJECT_UNAUTHORIZED" ]; then
  read -p "是否接受自签名证书? (y/n): " ACCEPT_CERT
  if [ "$ACCEPT_CERT" = "y" ]; then
    REJECT_UNAUTHORIZED="false"
  else
    REJECT_UNAUTHORIZED="true"
  fi
fi

# 创建 .env 配置文件
# 使用 cat 和 heredoc (<<EOF) 创建多行配置文件
# .env 文件用于存储环境变量，通常包含敏感信息，应添加到 .gitignore
cat > .env << EOF
# IMAP 配置（接收邮件）
IMAP_HOST=$IMAP_HOST
IMAP_PORT=$IMAP_PORT
IMAP_USER=$EMAIL
IMAP_PASS=$PASSWORD
IMAP_TLS=$IMAP_TLS
IMAP_REJECT_UNAUTHORIZED=$REJECT_UNAUTHORIZED
IMAP_MAILBOX=INBOX

# SMTP 配置（发送邮件）
SMTP_HOST=$SMTP_HOST
SMTP_PORT=$SMTP_PORT
SMTP_SECURE=$SMTP_SECURE
SMTP_USER=$EMAIL
SMTP_PASS=$PASSWORD
SMTP_FROM=$EMAIL
SMTP_REJECT_UNAUTHORIZED=$REJECT_UNAUTHORIZED
EOF

echo ""
echo "✅ 已创建 .env 配置文件"
echo ""
echo "正在测试连接..."
echo ""

# 测试 IMAP 连接
# 使用 node 执行 imap.js 脚本进行连接测试
# >/dev/null 2>&1：将标准输出和错误输出都重定向到空设备（不显示）
echo "正在测试 IMAP 连接..."
if node scripts/imap.js list-mailboxes >/dev/null 2>&1; then
    echo "✅ IMAP 连接成功！"
else
    echo "❌ IMAP 连接测试失败"
    echo "   请检查您的凭据和设置"
fi

# 测试 SMTP 连接
# 使用 node 执行 smtp.js 脚本进行连接测试
echo ""
echo "正在测试 SMTP 连接..."
if node scripts/smtp.js test >/dev/null 2>&1; then
    echo "✅ SMTP 连接成功！"
else
    echo "❌ SMTP 连接测试失败"
    echo "   请检查您的凭据和设置"
fi

echo ""
echo "配置完成！您可以尝试以下命令："
echo "  node scripts/imap.js check                                    # 检查邮箱"
echo "  node scripts/smtp.js send --to recipient@example.com \\"
echo "    --subject Test --body 'Hello World'                         # 发送测试邮件"
