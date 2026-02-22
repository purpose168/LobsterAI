#!/usr/bin/env node

/**
 * IMAP 邮件命令行工具
 * 适用于任何标准 IMAP 服务器（Gmail、ProtonMail Bridge、Fastmail 等）
 * 支持 IMAP ID 扩展（RFC 2971）以兼容 163.com 等服务器
 */

const Imap = require('imap');
const { simpleParser } = require('mailparser');
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

// IMAP ID 信息，用于 163.com 兼容性
const IMAP_ID = {
  name: 'moltbot',
  version: '0.0.1',
  vendor: 'netease',
  'support-email': 'kefu@188.com'
};

const DEFAULT_MAILBOX = process.env.IMAP_MAILBOX || 'INBOX';

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

// 创建 IMAP 连接配置
function createImapConfig() {
  return {
    user: process.env.IMAP_USER,
    password: process.env.IMAP_PASS,
    host: process.env.IMAP_HOST || '127.0.0.1',
    port: parseInt(process.env.IMAP_PORT) || 1143,
    tls: process.env.IMAP_TLS === 'true',
    tlsOptions: {
      rejectUnauthorized: process.env.IMAP_REJECT_UNAUTHORIZED !== 'false',
    },
    connTimeout: 10000,
    authTimeout: 10000,
  };
}

// 连接到 IMAP 服务器，支持 ID 扩展
async function connect() {
  const config = createImapConfig();

  if (!config.user || !config.password) {
    throw new Error('缺少 IMAP_USER 或 IMAP_PASS 环境变量');
  }

  return new Promise((resolve, reject) => {
    const imap = new Imap(config);

    imap.once('ready', () => {
      // 发送 IMAP ID 命令以兼容 163.com
      if (typeof imap.id === 'function') {
        imap.id(IMAP_ID, (err) => {
          if (err) {
            console.warn('警告：IMAP ID 命令失败：', err.message);
          }
          resolve(imap);
        });
      } else {
        // 不支持 ID，继续执行
        resolve(imap);
      }
    });

    imap.once('error', (err) => {
      reject(new Error(`IMAP 连接失败：${err.message}`));
    });

    imap.connect();
  });
}

// 打开邮箱并返回 Promise
function openBox(imap, mailbox, readOnly = false) {
  return new Promise((resolve, reject) => {
    imap.openBox(mailbox, readOnly, (err, box) => {
      if (err) reject(err);
      else resolve(box);
    });
  });
}

// 搜索邮件
function searchMessages(imap, criteria, fetchOptions) {
  return new Promise((resolve, reject) => {
    imap.search(criteria, (err, results) => {
      if (err) {
        reject(err);
        return;
      }

      if (!results || results.length === 0) {
        resolve([]);
        return;
      }

      const fetch = imap.fetch(results, fetchOptions);
      const messages = [];

      fetch.on('message', (msg) => {
        const parts = [];

        msg.on('body', (stream, info) => {
          let buffer = '';

          stream.on('data', (chunk) => {
            buffer += chunk.toString('utf8');
          });

          stream.once('end', () => {
            parts.push({ which: info.which, body: buffer });
          });
        });

        msg.once('attributes', (attrs) => {
          parts.forEach((part) => {
            part.attributes = attrs;
          });
        });

        msg.once('end', () => {
          if (parts.length > 0) {
            messages.push(parts[0]);
          }
        });
      });

      fetch.once('error', (err) => {
        reject(err);
      });

      fetch.once('end', () => {
        resolve(messages);
      });
    });
  });
}

// 从原始缓冲区解析邮件
async function parseEmail(bodyStr, includeAttachments = false) {
  const parsed = await simpleParser(bodyStr);

  return {
    from: parsed.from?.text || '未知',
    to: parsed.to?.text,
    subject: parsed.subject || '(无主题)',
    date: parsed.date,
    text: parsed.text,
    html: parsed.html,
    snippet: parsed.text
      ? parsed.text.slice(0, 200)
      : (parsed.html ? parsed.html.slice(0, 200).replace(/<[^>]*>/g, '') : ''),
    attachments: parsed.attachments?.map((a) => ({
      filename: a.filename,
      contentType: a.contentType,
      size: a.size,
      content: includeAttachments ? a.content : undefined,
      cid: a.cid,
    })),
  };
}

// 检查新邮件/未读邮件
async function checkEmails(mailbox = DEFAULT_MAILBOX, limit = 10, recentTime = null, unreadOnly = false) {
  const imap = await connect();

  try {
    await openBox(imap, mailbox);

    // 构建搜索条件
    const searchCriteria = unreadOnly ? ['UNSEEN'] : ['ALL'];

    if (recentTime) {
      const sinceDate = parseRelativeTime(recentTime);
      searchCriteria.push(['SINCE', sinceDate]);
    }

    // 获取邮件并按日期排序（最新的在前）
    const fetchOptions = {
      bodies: [''],
      markSeen: false,
    };

    const messages = await searchMessages(imap, searchCriteria, fetchOptions);

    // 按日期排序（最新的在前）- 从邮件属性解析
    const sortedMessages = messages.sort((a, b) => {
      const dateA = a.attributes.date ? new Date(a.attributes.date) : new Date(0);
      const dateB = b.attributes.date ? new Date(b.attributes.date) : new Date(0);
      return dateB - dateA;
    }).slice(0, limit);

    const results = [];

    for (const item of sortedMessages) {
      const bodyStr = item.body;
      const parsed = await parseEmail(bodyStr);

      results.push({
        uid: item.attributes.uid,
        ...parsed,
        flags: item.attributes.flags,
      });
    }

    return results;
  } finally {
    imap.end();
  }
}

// 根据 UID 获取完整邮件
async function fetchEmail(uid, mailbox = DEFAULT_MAILBOX) {
  const imap = await connect();

  try {
    await openBox(imap, mailbox);

    const searchCriteria = [['UID', uid]];
    const fetchOptions = {
      bodies: [''],
      markSeen: false,
    };

    const messages = await searchMessages(imap, searchCriteria, fetchOptions);

    if (messages.length === 0) {
      throw new Error(`未找到邮件 UID ${uid}`);
    }

    const item = messages[0];
    const parsed = await parseEmail(item.body);

    return {
      uid: item.attributes.uid,
      ...parsed,
      flags: item.attributes.flags,
    };
  } finally {
    imap.end();
  }
}

// 从邮件下载附件
async function downloadAttachments(uid, mailbox = DEFAULT_MAILBOX, outputDir = '.', specificFilename = null) {
  const imap = await connect();

  try {
    await openBox(imap, mailbox);

    const searchCriteria = [['UID', uid]];
    const fetchOptions = {
      bodies: [''],
      markSeen: false,
    };

    const messages = await searchMessages(imap, searchCriteria, fetchOptions);

    if (messages.length === 0) {
      throw new Error(`未找到邮件 UID ${uid}`);
    }

    const item = messages[0];
    const parsed = await parseEmail(item.body, true);

    if (!parsed.attachments || parsed.attachments.length === 0) {
      return {
        uid,
        downloaded: [],
        message: '未找到附件',
      };
    }

    // 如果输出目录不存在则创建
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const downloaded = [];

    for (const attachment of parsed.attachments) {
      // 如果指定了文件名，只下载匹配的附件
      if (specificFilename && attachment.filename !== specificFilename) {
        continue;
      }
      if (attachment.content) {
        const filePath = path.join(outputDir, attachment.filename);
        fs.writeFileSync(filePath, attachment.content);
        downloaded.push({
          filename: attachment.filename,
          path: filePath,
          size: attachment.size,
        });
      }
    }

    // 如果请求了特定文件但未找到
    if (specificFilename && downloaded.length === 0) {
      const availableFiles = parsed.attachments.map(a => a.filename).join(', ');
      return {
        uid,
        downloaded: [],
        message: `未找到文件"${specificFilename}"。可用附件：${availableFiles}`,
      };
    }

    return {
      uid,
      downloaded,
      message: `已下载 ${downloaded.length} 个附件`,
    };
  } finally {
    imap.end();
  }
}

// 解析相对时间（例如："2h"、"30m"、"7d"）为日期对象
function parseRelativeTime(timeStr) {
  const match = timeStr.match(/^(\d+)(m|h|d)$/);
  if (!match) {
    throw new Error('无效的时间格式。请使用：30m、2h、7d');
  }

  const value = parseInt(match[1]);
  const unit = match[2];
  const now = new Date();

  switch (unit) {
    case 'm': // 分钟
      return new Date(now.getTime() - value * 60 * 1000);
    case 'h': // 小时
      return new Date(now.getTime() - value * 60 * 60 * 1000);
    case 'd': // 天
      return new Date(now.getTime() - value * 24 * 60 * 60 * 1000);
    default:
      throw new Error('未知的时间单位');
  }
}

// 根据条件搜索邮件
async function searchEmails(options) {
  const imap = await connect();

  try {
    const mailbox = options.mailbox || DEFAULT_MAILBOX;
    await openBox(imap, mailbox);

    const criteria = [];

    if (options.unseen) criteria.push('UNSEEN');
    if (options.seen) criteria.push('SEEN');
    if (options.from) criteria.push(['FROM', options.from]);
    if (options.subject) criteria.push(['SUBJECT', options.subject]);

    // 处理相对时间（--recent 2h）
    if (options.recent) {
      const sinceDate = parseRelativeTime(options.recent);
      criteria.push(['SINCE', sinceDate]);
    } else {
      // 处理绝对日期
      if (options.since) criteria.push(['SINCE', options.since]);
      if (options.before) criteria.push(['BEFORE', options.before]);
    }

    // 如果没有条件，默认搜索所有邮件
    if (criteria.length === 0) criteria.push('ALL');

    const fetchOptions = {
      bodies: [''],
      markSeen: false,
    };

    const messages = await searchMessages(imap, criteria, fetchOptions);
    const limit = parseInt(options.limit) || 20;
    const results = [];

    // 按日期排序（最新的在前）
    const sortedMessages = messages.sort((a, b) => {
      const dateA = a.attributes.date ? new Date(a.attributes.date) : new Date(0);
      const dateB = b.attributes.date ? new Date(b.attributes.date) : new Date(0);
      return dateB - dateA;
    }).slice(0, limit);

    for (const item of sortedMessages) {
      const parsed = await parseEmail(item.body);
      results.push({
        uid: item.attributes.uid,
        ...parsed,
        flags: item.attributes.flags,
      });
    }

    return results;
  } finally {
    imap.end();
  }
}

// 将邮件标记为已读
async function markAsRead(uids, mailbox = DEFAULT_MAILBOX) {
  const imap = await connect();

  try {
    await openBox(imap, mailbox);

    return new Promise((resolve, reject) => {
      imap.addFlags(uids, '\\Seen', (err) => {
        if (err) reject(err);
        else resolve({ success: true, uids, action: '标记为已读' });
      });
    });
  } finally {
    imap.end();
  }
}

// 将邮件标记为未读
async function markAsUnread(uids, mailbox = DEFAULT_MAILBOX) {
  const imap = await connect();

  try {
    await openBox(imap, mailbox);

    return new Promise((resolve, reject) => {
      imap.delFlags(uids, '\\Seen', (err) => {
        if (err) reject(err);
        else resolve({ success: true, uids, action: '标记为未读' });
      });
    });
  } finally {
    imap.end();
  }
}

// 列出所有邮箱
async function listMailboxes() {
  const imap = await connect();

  try {
    return new Promise((resolve, reject) => {
      imap.getBoxes((err, boxes) => {
        if (err) reject(err);
        else resolve(formatMailboxTree(boxes));
      });
    });
  } finally {
    imap.end();
  }
}

// 递归格式化邮箱树
function formatMailboxTree(boxes, prefix = '') {
  const result = [];
  for (const [name, info] of Object.entries(boxes)) {
    const fullName = prefix ? `${prefix}${info.delimiter}${name}` : name;
    result.push({
      name: fullName,
      delimiter: info.delimiter,
      attributes: info.attribs,
    });

    if (info.children) {
      result.push(...formatMailboxTree(info.children, fullName));
    }
  }
  return result;
}

// 主命令行处理程序
async function main() {
  const { command, options, positional } = parseArgs();

  try {
    let result;

    switch (command) {
      case 'check':
        result = await checkEmails(
          options.mailbox || DEFAULT_MAILBOX,
          parseInt(options.limit) || 10,
          options.recent || null,
          options.unseen === 'true' // 如果设置了 --unseen，只获取未读邮件
        );
        break;

      case 'fetch':
        if (!positional[0]) {
          throw new Error('需要 UID：node imap.js fetch <uid>');
        }
        result = await fetchEmail(positional[0], options.mailbox);
        break;

      case 'download':
        if (!positional[0]) {
          throw new Error('需要 UID：node imap.js download <uid>');
        }
        result = await downloadAttachments(positional[0], options.mailbox, options.dir || '.', options.file || null);
        break;

      case 'search':
        result = await searchEmails(options);
        break;

      case 'mark-read':
        if (positional.length === 0) {
          throw new Error('需要 UID：node imap.js mark-read <uid> [uid2...]');
        }
        result = await markAsRead(positional, options.mailbox);
        break;

      case 'mark-unread':
        if (positional.length === 0) {
          throw new Error('需要 UID：node imap.js mark-unread <uid> [uid2...]');
        }
        result = await markAsUnread(positional, options.mailbox);
        break;

      case 'list-mailboxes':
        result = await listMailboxes();
        break;

      default:
        console.error('未知命令：', command);
        console.error('可用命令：check, fetch, download, search, mark-read, mark-unread, list-mailboxes');
        process.exit(1);
    }

    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error('错误：', err.message);
    process.exit(1);
  }
}

main();
