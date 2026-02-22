#!/usr/bin/env node

/**
 * SMTP 邮件命令行工具
 * 通过 SMTP 协议发送邮件。支持 Gmail、Outlook、163.com 以及任何标准 SMTP 服务器。
 * 支持附件、HTML 内容和多收件人。
 */

const nodemailer = require('nodemailer');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

// 解析命令行参数
function parseArgs() {
  const args = process.argv.slice(2);
  const command = args[0];
  const options = {};
  const positional = [];

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const value = args[i + 1];
      options[key] = value || true;
      if (value && !value.startsWith('--')) i++;
    } else {
      positional.push(arg);
    }
  }

  return { command, options, positional };
}

// 创建 SMTP 传输器
function createTransporter() {
  const config = {
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true', // 端口 465 时为 true，其他端口为 false
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
    tls: {
      rejectUnauthorized: process.env.SMTP_REJECT_UNAUTHORIZED !== 'false',
    },
  };

  if (!config.host || !config.auth.user || !config.auth.pass) {
    throw new Error('缺少 SMTP 配置。请在 .env 文件中设置 SMTP_HOST、SMTP_USER 和 SMTP_PASS');
  }

  return nodemailer.createTransport(config);
}

// 发送邮件
async function sendEmail(options) {
  const transporter = createTransporter();

  // 验证连接
  try {
    await transporter.verify();
    console.error('SMTP 服务器已准备好发送邮件');
  } catch (err) {
    throw new Error(`SMTP 连接失败: ${err.message}`);
  }

  const mailOptions = {
    from: options.from || process.env.SMTP_FROM || process.env.SMTP_USER,
    to: options.to,
    cc: options.cc || undefined,
    bcc: options.bcc || undefined,
    subject: options.subject || '(无主题)',
    text: options.text || undefined,
    html: options.html || undefined,
    attachments: options.attachments || [],
  };

  // 如果未提供文本或 HTML 内容，则使用默认文本
  if (!mailOptions.text && !mailOptions.html) {
    mailOptions.text = options.body || '';
  }

  const info = await transporter.sendMail(mailOptions);

  return {
    success: true,
    messageId: info.messageId,
    response: info.response,
    to: mailOptions.to,
  };
}

// 读取附件文件内容
function readAttachment(filePath) {
  const fs = require('fs');
  if (!fs.existsSync(filePath)) {
    throw new Error(`附件文件未找到: ${filePath}`);
  }
  return {
    filename: path.basename(filePath),
    path: path.resolve(filePath),
  };
}

// 发送包含文件内容的邮件
async function sendEmailWithContent(options) {
  // 处理附件
  if (options.attach) {
    const attachFiles = options.attach.split(',').map(f => f.trim());
    options.attachments = attachFiles.map(f => readAttachment(f));
  }

  return await sendEmail(options);
}

// 测试 SMTP 连接
async function testConnection() {
  const transporter = createTransporter();

  try {
    await transporter.verify();
    const info = await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: process.env.SMTP_USER, // 发送给自己
      subject: 'SMTP 连接测试',
      text: '这是一封来自 IMAP/SMTP 邮件技能的测试邮件。',
      html: '<p>这是一封来自 IMAP/SMTP 邮件技能的<strong>测试邮件</strong>。</p>',
    });

    return {
      success: true,
      message: 'SMTP 连接成功',
      messageId: info.messageId,
    };
  } catch (err) {
    throw new Error(`SMTP 测试失败: ${err.message}`);
  }
}

// 验证 SMTP 连接（不发送邮件）
async function verifyConnection() {
  const transporter = createTransporter();

  try {
    await transporter.verify();
    return {
      success: true,
      message: 'SMTP 验证成功',
    };
  } catch (err) {
    throw new Error(`SMTP 验证失败: ${err.message}`);
  }
}

// 主命令行处理函数
async function main() {
  const { command, options, positional } = parseArgs();

  try {
    let result;

    switch (command) {
      case 'send':
        if (!options.to) {
          throw new Error('缺少必需选项: --to <邮箱地址>');
        }
        if (!options.subject && !options['subject-file']) {
          throw new Error('缺少必需选项: --subject <文本> 或 --subject-file <文件>');
        }

        // 如果指定了主题文件，则从文件读取主题
        if (options['subject-file']) {
          const fs = require('fs');
          options.subject = fs.readFileSync(options['subject-file'], 'utf8').trim();
        }

        // 如果指定了正文文件，则从文件读取正文
        if (options['body-file']) {
          const fs = require('fs');
          const content = fs.readFileSync(options['body-file'], 'utf8');
          if (options['body-file'].endsWith('.html') || options.html) {
            options.html = content;
          } else {
            options.text = content;
          }
        } else if (options['html-file']) {
          const fs = require('fs');
          options.html = fs.readFileSync(options['html-file'], 'utf8');
        } else if (options.body) {
          options.text = options.body;
        }

        result = await sendEmailWithContent(options);
        break;

      case 'test':
        result = await testConnection();
        break;

      case 'verify':
        result = await verifyConnection();
        break;

      default:
        console.error('未知命令:', command);
        console.error('可用命令: send, test, verify');
        console.error('\n用法:');
        console.error('  send   --to <邮箱> --subject <主题> [--body <正文>] [--html] [--cc <邮箱>] [--bcc <邮箱>] [--attach <文件>]');
        console.error('  send   --to <邮箱> --subject <主题> --body-file <文件> [--html-file <文件>] [--attach <文件>]');
        console.error('  test   测试 SMTP 连接');
        console.error('  verify 验证 SMTP 连接（不发送邮件）');
        process.exit(1);
    }

    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error('错误:', err.message);
    process.exit(1);
  }
}

main();
