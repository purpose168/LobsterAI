/**
 * Telegram 网关
 * 使用 grammy 库以轮询模式管理 Telegram 机器人
 * 支持文本消息和媒体文件（图片、视频、音频、语音、文档、贴纸）
 */

import { EventEmitter } from 'events';
import { Bot, InputFile, type BotError, type Context } from 'grammy';
import { run, type RunnerHandle } from '@grammyjs/runner';
import * as fs from 'fs';
import * as path from 'path';
import {
  TelegramConfig,
  TelegramGatewayStatus,
  IMMessage,
  IMMediaAttachment,
  DEFAULT_TELEGRAM_STATUS,
} from './types';
import { extractMediaFromMessage, cleanupOldMediaFiles } from './telegramMedia';
import { parseMediaMarkers } from './dingtalkMediaParser';

// 导入 node-fetch 用于 HTTP 请求（grammy 的默认配置）
const nodeFetch = require('node-fetch');

/**
 * 自定义 fetch 包装器，使用 Node.js 原生 AbortController
 * 而非 abort-controller 填充库（polyfill）。
 *
 * 这样做的原因是：
 * 1. grammy 使用 abort-controller 填充库来创建 AbortSignal
 * 2. node-fetch 通过 `proto.constructor.name === 'AbortSignal'` 检查信号
 * 3. 经过 esbuild 打包后，填充库的类名可能会被混淆
 * 4. 这会导致 "Expected signal to be an instanceof AbortSignal" 错误
 *
 * 解决方案：创建一个新的原生 AbortController 并将其链接到 grammy 的信号
 */
async function grammyFetch(url: string, options: RequestInit = {}): Promise<Response> {
  // 如果存在来自 grammy 的信号，创建一个原生 AbortController
  // 并链接中止事件
  if (options.signal) {
    const grammySignal = options.signal;
    const nativeController = new AbortController();

    // 如果已经中止，立即中止
    if (grammySignal.aborted) {
      nativeController.abort();
    } else {
      // 将 grammy 的信号链接到原生控制器
      grammySignal.addEventListener('abort', () => {
        nativeController.abort();
      });
    }

    // 用原生信号替换原有信号
    options = { ...options, signal: nativeController.signal };
  }

  return nodeFetch(url, options);
}

// 媒体组缓冲接口
interface MediaGroupBuffer {
  messages: IMMessage[];
  ctx: Context;  // 保存第一条消息的 ctx 用于回复
  timeout: NodeJS.Timeout;
}

export class TelegramGateway extends EventEmitter {
  private bot: Bot | null = null;
  private runner: RunnerHandle | null = null;
  private config: TelegramConfig | null = null;
  private status: TelegramGatewayStatus = { ...DEFAULT_TELEGRAM_STATUS };
  private onMessageCallback?: (message: IMMessage, replyFn: (text: string) => Promise<void>) => Promise<void>;
  private lastChatId: number | null = null;

  // 媒体组缓冲 Map (mediaGroupId -> buffer)
  private mediaGroupBuffers: Map<string, MediaGroupBuffer> = new Map();
  private readonly MEDIA_GROUP_TIMEOUT = 500;  // 500ms 缓冲窗口

  // 定期清理任务
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    super();
  }

  /**
   * 获取当前网关状态
   */
  getStatus(): TelegramGatewayStatus {
    return { ...this.status };
  }

  /**
   * 检查网关是否已连接
   */
  isConnected(): boolean {
    return this.status.connected;
  }

  /**
   * 外部重连触发的公共方法（例如网络事件）
   */
  reconnectIfNeeded(): void {
    if (!this.bot && this.config) {
      console.log('[Telegram 网关] 外部重连触发');
      this.start(this.config).catch((error) => {
        console.error('[Telegram 网关] 重连失败:', error.message);
      });
    }
  }

  /**
   * 设置消息回调函数
   */
  setMessageCallback(
    callback: (message: IMMessage, replyFn: (text: string) => Promise<void>) => Promise<void>
  ): void {
    this.onMessageCallback = callback;
  }

  /**
   * 以轮询模式启动 Telegram 网关
   */
  async start(config: TelegramConfig): Promise<void> {
    if (this.bot) {
      console.log('[Telegram 网关] 已在运行中，先停止...');
      await this.stop();
    }

    if (!config.enabled) {
      console.log('[Telegram 网关] Telegram 在配置中已禁用');
      return;
    }

    if (!config.botToken) {
      throw new Error('需要 Telegram 机器人令牌');
    }

    this.config = config;
    const log = config.debug ? console.log : () => {};

    log('[Telegram 网关] 正在启动...');

    try {
      // 使用自定义 fetch 包装器创建机器人实例
      // 该包装器将 grammy 的填充库 AbortSignal 转换为原生 AbortSignal
      // 以避免 "Expected signal to be an instanceof AbortSignal" 错误
      this.bot = new Bot(config.botToken, {
        client: {
          // 使用我们的自定义 fetch 包装器
          fetch: grammyFetch as any,
          // 将 API 超时时间增加到 60 秒以支持文件上传（默认为 500 秒，太长）
          timeoutSeconds: 60,
        },
      });

      // 注册错误处理器
      this.bot.catch((err: BotError) => {
        console.error(`[Telegram 网关] 机器人错误: ${err.message}`);
        this.status.lastError = err.message;
        this.emit('error', err);
      });

      // 为所有消息类型注册消息处理器（文本 + 媒体）
      this.bot.on('message', async (ctx: Context) => {
        await this.handleMessage(ctx);
      });

      // 获取机器人信息以验证令牌并获取用户名
      const botInfo = await this.bot.api.getMe();
      console.log(`[Telegram 网关] 机器人信息: @${botInfo.username}`);

      // 使用 grammyjs/runner 启动轮询以支持并发更新处理
      this.runner = run(this.bot, {
        runner: {
          fetch: {
            timeout: 30,
          },
          silent: true,
          retryInterval: 'exponential',
        },
      });

      this.status = {
        connected: true,
        startedAt: Date.now(),
        lastError: null,
        botUsername: botInfo.username || null,
        lastInboundAt: null,
        lastOutboundAt: null,
      };

      // 启动时清理旧媒体文件
      cleanupOldMediaFiles(7);

      // 设置定期清理任务（每 24 小时）
      this.cleanupInterval = setInterval(() => {
        cleanupOldMediaFiles(7);
      }, 24 * 60 * 60 * 1000);

      console.log(`[Telegram 网关] 已成功连接为 @${botInfo.username}`);
      this.emit('connected');

    } catch (error: any) {
      console.error(`[Telegram 网关] 启动失败: ${error.message}`);
      this.status = {
        connected: false,
        startedAt: null,
        lastError: error.message,
        botUsername: null,
        lastInboundAt: null,
        lastOutboundAt: null,
      };
      this.bot = null;
      this.runner = null;
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * 停止 Telegram 网关
   */
  async stop(): Promise<void> {
    if (!this.bot && !this.runner) {
      console.log('[Telegram 网关] 未在运行');
      return;
    }

    const log = this.config?.debug ? console.log : () => {};
    log('[Telegram 网关] 正在停止...');

    try {
      // 清理定期任务
      if (this.cleanupInterval) {
        clearInterval(this.cleanupInterval);
        this.cleanupInterval = null;
      }

      // 清理媒体组缓冲
      for (const [, buffer] of this.mediaGroupBuffers) {
        clearTimeout(buffer.timeout);
      }
      this.mediaGroupBuffers.clear();

      // 先停止运行器
      if (this.runner) {
        const runner = this.runner;
        this.runner = null;
        try {
          await runner.stop();
        } catch (e) {
          // 忽略停止错误
        }
      }

      // 清除机器人引用
      this.bot = null;

      this.status = {
        connected: false,
        startedAt: null,
        lastError: null,
        botUsername: null,
        lastInboundAt: null,
        lastOutboundAt: null,
      };

      log('[Telegram 网关] 已停止');
      this.emit('disconnected');
    } catch (error: any) {
      console.error(`[Telegram 网关] 停止时出错: ${error.message}`);
      this.status.lastError = error.message;
    }
  }

  /**
   * 处理传入的 Telegram 消息（支持媒体）
   */
  private async handleMessage(ctx: Context): Promise<void> {
    try {
      const message = ctx.message;
      if (!message) return;

      // 忽略来自机器人本身的消息
      if (message.from?.is_bot) return;

      const chatId = message.chat.id;
      const chatType = message.chat.type;
      const isGroup = chatType === 'group' || chatType === 'supergroup';

      // 构建发送者信息
      const senderName = message.from
        ? [message.from.first_name, message.from.last_name].filter(Boolean).join(' ').trim() || message.from.username
        : '未知';
      const senderId = message.from?.id?.toString() || 'unknown';

      // 提取文本内容（可能是文本或标题）
      const textContent = message.text || message.caption || '';

      // 提取媒体附件
      const attachments = await extractMediaFromMessage(ctx);

      // 如果没有内容且没有附件，则跳过
      if (!textContent && attachments.length === 0) {
        return;
      }

      // 为媒体构建内容描述
      let content = textContent;
      if (!content && attachments.length > 0) {
        // 为纯媒体消息生成描述性内容
        content = this.generateMediaDescription(attachments);
      }

      // 打印完整的输入消息日志
      console.log(`[Telegram] 收到消息:`, JSON.stringify({
        sender: senderName,
        senderId,
        chatId,
        chatType: isGroup ? 'group' : 'direct',
        content,
        attachments: attachments.length > 0 ? attachments : undefined,
        mediaGroupId: message.media_group_id,
      }, null, 2));

      // 创建 IMMessage
      const imMessage: IMMessage = {
        platform: 'telegram',
        messageId: message.message_id.toString(),
        conversationId: chatId.toString(),
        senderId: senderId,
        senderName: senderName,
        content: content,
        chatType: isGroup ? 'group' : 'direct',
        timestamp: message.date * 1000,
        attachments: attachments.length > 0 ? attachments : undefined,
        mediaGroupId: message.media_group_id,
      };

      // 处理媒体组（一起发送的多张照片/视频）
      if (message.media_group_id) {
        await this.handleMediaGroup(imMessage, ctx);
        return;
      }

      // 处理单条消息
      await this.processMessage(imMessage, ctx);

    } catch (error: any) {
      console.error(`[Telegram 网关] 处理消息时出错: ${error.message}`);
      this.status.lastError = error.message;
      this.emit('error', error);
    }
  }

  /**
   * 处理媒体组消息（缓冲并合并）
   */
  private async handleMediaGroup(message: IMMessage, ctx: Context): Promise<void> {
    const log = this.config?.debug ? console.log : () => {};
    const groupId = message.mediaGroupId!;

    log(`[Telegram 网关] 媒体组消息添加到缓冲: groupId=${groupId}`);

    let buffer = this.mediaGroupBuffers.get(groupId);

    if (buffer) {
      // 添加到现有缓冲
      buffer.messages.push(message);
      // 重置超时
      clearTimeout(buffer.timeout);
      buffer.timeout = setTimeout(() => this.flushMediaGroup(groupId), this.MEDIA_GROUP_TIMEOUT);
    } else {
      // 创建新缓冲
      buffer = {
        messages: [message],
        ctx: ctx,
        timeout: setTimeout(() => this.flushMediaGroup(groupId), this.MEDIA_GROUP_TIMEOUT),
      };
      this.mediaGroupBuffers.set(groupId, buffer);
    }
  }

  /**
   * 刷新媒体组缓冲并处理合并后的消息
   */
  private async flushMediaGroup(groupId: string): Promise<void> {
    const log = this.config?.debug ? console.log : () => {};
    const buffer = this.mediaGroupBuffers.get(groupId);
    if (!buffer || buffer.messages.length === 0) return;

    this.mediaGroupBuffers.delete(groupId);

    // 按 message_id 排序消息以保持顺序
    buffer.messages.sort((a, b) => parseInt(a.messageId) - parseInt(b.messageId));

    // 将所有消息合并为一条
    const firstMessage = buffer.messages[0];
    const allAttachments: IMMediaAttachment[] = [];
    let content = '';

    for (const msg of buffer.messages) {
      if (msg.attachments) {
        allAttachments.push(...msg.attachments);
      }
      // 使用第一个非空内容（标题）
      if (msg.content && !content) {
        // 跳过自动生成的描述
        if (!msg.content.startsWith('[图片') && !msg.content.startsWith('[视频') &&
            !msg.content.startsWith('[媒体组')) {
          content = msg.content;
        }
      }
    }

    // 如果内容仍为空，则生成内容
    if (!content && allAttachments.length > 0) {
      content = `[媒体组: ${allAttachments.length} 个文件]`;
    }

    // 创建合并后的消息
    const mergedMessage: IMMessage = {
      ...firstMessage,
      content,
      attachments: allAttachments,
    };

    log(`[Telegram 网关] 媒体组合并完成:`, JSON.stringify({
      groupId,
      messageCount: buffer.messages.length,
      attachmentsCount: allAttachments.length,
    }));

    await this.processMessage(mergedMessage, buffer.ctx);
  }

  /**
   * 处理单条消息（或合并后的媒体组）
   */
  private async processMessage(imMessage: IMMessage, ctx: Context): Promise<void> {
    const log = this.config?.debug ? console.log : () => {};
    this.status.lastInboundAt = Date.now();

    // 保存最后的聊天 ID 用于通知
    this.lastChatId = ctx.chat?.id ?? null;

    // 创建支持媒体的回复函数
    const replyFn = async (text: string) => {
      // 打印完整的输出消息日志
      console.log(`[Telegram] 发送回复:`, JSON.stringify({
        conversationId: imMessage.conversationId,
        replyLength: text.length,
        reply: text,
      }, null, 2));

      try {
        // 从文本中解析媒体标记
        const markers = parseMediaMarkers(text);
        const validFiles: Array<{ path: string; name?: string; type: string }> = [];

        log(`[Telegram 网关] 解析媒体标记:`, JSON.stringify({
          textLength: text.length,
          markersCount: markers.length,
          markers: markers.map(m => ({ type: m.type, path: m.path, name: m.name })),
        }));

        // 检查哪些文件存在
        for (const marker of markers) {
          // 将 ~ 展开为主目录
          let filePath = marker.path;
          if (filePath.startsWith('~/')) {
            filePath = path.join(process.env.HOME || '', filePath.slice(2));
          }
          if (fs.existsSync(filePath)) {
            const stats = fs.statSync(filePath);
            log(`[Telegram 网关] 发现有效媒体文件:`, JSON.stringify({
              path: filePath,
              name: marker.name,
              type: marker.type,
              fileSize: stats.size,
              fileSizeKB: (stats.size / 1024).toFixed(1),
            }));
            validFiles.push({ path: filePath, name: marker.name, type: marker.type });
          } else {
            console.warn(`[Telegram 网关] 媒体文件未找到: ${filePath}`);
          }
        }

        // 如果有有效文件，从文本中剥离媒体标记
        // 注意：保留原始 markdown 文本，不移除媒体标记
        const textContent = text;

        // 首先发送媒体文件（带重试逻辑）
        const MAX_RETRIES = 3;
        const RETRY_DELAY = 2000; // 2 秒

        for (const file of validFiles) {
          const sendMedia = async (): Promise<boolean> => {
            // 使用 Buffer 而不是文件路径，避免 node-fetch 流式读取问题
            const fileBuffer = fs.readFileSync(file.path);
            const fileName = path.basename(file.path);
            const inputFile = new InputFile(fileBuffer, fileName);
            const ext = path.extname(file.path).toLowerCase();
            const startTime = Date.now();

            // 获取聊天信息用于日志记录
            const chatId = ctx.chat?.id;
            const replyToMessageId = ctx.message?.message_id;
            const botToken = this.config?.botToken || '';
            // 完整 URL（不脱敏，用于调试）

            // 根据文件类型选择适当的发送方法
            if (file.type === 'image' || ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'].includes(ext)) {
              log(`[Telegram 网关] 调用 sendPhoto API:`, JSON.stringify({
                url: `https://api.telegram.org/bot${botToken}/sendPhoto`,
                method: 'POST',
                params: {
                  chat_id: chatId,
                  reply_to_message_id: replyToMessageId,
                  caption: file.name,
                  photo: `[Buffer: ${fileBuffer.length} 字节, 文件名: ${fileName}]`,
                },
              }));
              const result = await ctx.replyWithPhoto(inputFile, {
                caption: file.name,
              });
              log(`[Telegram 网关] sendPhoto 成功:`, JSON.stringify({
                messageId: result.message_id,
                chatId: result.chat.id,
                duration: Date.now() - startTime,
              }));
            } else if (file.type === 'video' || ['.mp4', '.mov', '.avi', '.webm'].includes(ext)) {
              log(`[Telegram 网关] 调用 sendVideo API:`, JSON.stringify({
                url: `https://api.telegram.org/bot${botToken}/sendVideo`,
                method: 'POST',
                params: {
                  chat_id: chatId,
                  reply_to_message_id: replyToMessageId,
                  caption: file.name,
                  video: `[Buffer: ${fileBuffer.length} 字节, 文件名: ${fileName}]`,
                },
              }));
              const result = await ctx.replyWithVideo(inputFile, {
                caption: file.name,
              });
              log(`[Telegram 网关] sendVideo 成功:`, JSON.stringify({
                messageId: result.message_id,
                chatId: result.chat.id,
                duration: Date.now() - startTime,
              }));
            } else if (file.type === 'audio' || ['.mp3', '.ogg', '.wav', '.m4a', '.aac'].includes(ext)) {
              log(`[Telegram 网关] 调用 sendAudio API:`, JSON.stringify({
                url: `https://api.telegram.org/bot${botToken}/sendAudio`,
                method: 'POST',
                params: {
                  chat_id: chatId,
                  reply_to_message_id: replyToMessageId,
                  caption: file.name,
                  title: file.name,
                  audio: `[Buffer: ${fileBuffer.length} 字节, 文件名: ${fileName}]`,
                },
              }));
              const result = await ctx.replyWithAudio(inputFile, {
                caption: file.name,
                title: file.name,
              });
              log(`[Telegram 网关] sendAudio 成功:`, JSON.stringify({
                messageId: result.message_id,
                chatId: result.chat.id,
                duration: Date.now() - startTime,
              }));
            } else {
              // 其他文件类型作为文档发送
              log(`[Telegram 网关] 调用 sendDocument API:`, JSON.stringify({
                url: `https://api.telegram.org/bot${botToken}/sendDocument`,
                method: 'POST',
                params: {
                  chat_id: chatId,
                  reply_to_message_id: replyToMessageId,
                  caption: file.name,
                  document: `[Buffer: ${fileBuffer.length} 字节, 文件名: ${fileName}]`,
                },
              }));
              const result = await ctx.replyWithDocument(inputFile, {
                caption: file.name,
              });
              log(`[Telegram 网关] sendDocument 成功:`, JSON.stringify({
                messageId: result.message_id,
                chatId: result.chat.id,
                duration: Date.now() - startTime,
              }));
            }
            return true;
          };

          // 尝试发送并重试
          let lastError: Error | null = null;
          const ext = path.extname(file.path).toLowerCase();
          const chatId = ctx.chat?.id;
          const replyToMessageId = ctx.message?.message_id;
          const botToken = this.config?.botToken || '';

          // 确定 API 方法
          let apiMethod = 'sendDocument';
          if (file.type === 'image' || ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'].includes(ext)) {
            apiMethod = 'sendPhoto';
          } else if (file.type === 'video' || ['.mp4', '.mov', '.avi', '.webm'].includes(ext)) {
            apiMethod = 'sendVideo';
          } else if (file.type === 'audio' || ['.mp3', '.ogg', '.wav', '.m4a', '.aac'].includes(ext)) {
            apiMethod = 'sendAudio';
          }

          // 完整 URL（不脱敏，用于调试）
          const fullUrl = `https://api.telegram.org/bot${botToken}/${apiMethod}`;

          for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
              const fileStats = fs.statSync(file.path);
              // 在每次尝试前打印详细的请求信息（显示完整 URL）
              console.log(`[Telegram 网关] 发送媒体请求 (尝试 ${attempt}/${MAX_RETRIES}):`, JSON.stringify({
                url: fullUrl,
                method: 'POST',
                params: {
                  chat_id: chatId,
                  reply_to_message_id: replyToMessageId,
                  caption: file.name,
                },
                file: {
                  path: file.path,
                  name: file.name,
                  type: file.type,
                  fileSize: fileStats.size,
                  fileSizeKB: (fileStats.size / 1024).toFixed(1),
                  fileSizeMB: (fileStats.size / 1024 / 1024).toFixed(2),
                },
              }, null, 2));

              await sendMedia();
              lastError = null;
              break; // 成功，退出重试循环
            } catch (mediaError: any) {
              lastError = mediaError;
              // 打印详细的失败信息（显示完整 URL）
              console.error(`[Telegram 网关] 发送媒体失败 (尝试 ${attempt}/${MAX_RETRIES}):`, JSON.stringify({
                url: fullUrl,
                file: file.path,
                error: mediaError.message,
                errorName: mediaError.name,
                errorStack: mediaError.stack?.split('\n').slice(0, 3).join('\n'),
              }, null, 2));

              if (attempt < MAX_RETRIES) {
                console.log(`[Telegram 网关] 等待 ${RETRY_DELAY}ms 后重试...`);
                await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
              }
            }
          }

          if (lastError) {
            console.error(`[Telegram 网关] 媒体发送最终失败 (${MAX_RETRIES}次尝试后):`, JSON.stringify({
              url: fullUrl,
              file: file.path,
              error: lastError.message,
            }));
          }
        }

        // 发送文本内容
        if (textContent.trim()) {
          // 分割长消息（Telegram 限制为 4096 个字符）
          const MAX_LENGTH = 4000;
          const chatId = ctx.chat?.id;
          const replyToMessageId = ctx.message?.message_id;
          const botToken = this.config?.botToken || '';
          // 完整 URL（不脱敏，用于调试）
          const fullUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;

          if (textContent.length <= MAX_LENGTH) {
            const startTime = Date.now();
            log(`[Telegram 网关] 调用 sendMessage API:`, JSON.stringify({
              url: fullUrl,
              method: 'POST',
              params: {
                chat_id: chatId,
                reply_to_message_id: replyToMessageId,
                text: textContent.slice(0, 100) + (textContent.length > 100 ? '...' : ''),
                textLength: textContent.length,
                parse_mode: 'Markdown',
              },
            }));
            try {
              const result = await ctx.reply(textContent, { parse_mode: 'Markdown' });
              log(`[Telegram 网关] sendMessage 成功:`, JSON.stringify({
                messageId: result.message_id,
                chatId: result.chat.id,
                duration: Date.now() - startTime,
              }));
            } catch (mdError) {
              // 如果 markdown 失败，回退到纯文本
              log(`[Telegram 网关] Markdown 解析失败，使用纯文本重试`);
              const result = await ctx.reply(textContent);
              log(`[Telegram 网关] sendMessage (纯文本) 成功:`, JSON.stringify({
                messageId: result.message_id,
                chatId: result.chat.id,
                duration: Date.now() - startTime,
              }));
            }
          } else {
            // 按换行符或长度分割
            const chunks = this.splitMessage(textContent, MAX_LENGTH);
            log(`[Telegram 网关] 消息过长，拆分为 ${chunks.length} 条`);
            for (let i = 0; i < chunks.length; i++) {
              const chunk = chunks[i];
              const startTime = Date.now();
              log(`[Telegram 网关] 调用 sendMessage API (分段 ${i + 1}/${chunks.length}):`, JSON.stringify({
                url: fullUrl,
                method: 'POST',
                params: {
                  chat_id: chatId,
                  reply_to_message_id: i === 0 ? replyToMessageId : undefined,
                  text: chunk.slice(0, 100) + (chunk.length > 100 ? '...' : ''),
                  chunkLength: chunk.length,
                  parse_mode: 'Markdown',
                },
              }));
              try {
                const result = await ctx.reply(chunk, { parse_mode: 'Markdown' });
                log(`[Telegram 网关] sendMessage 成功 (分段 ${i + 1}/${chunks.length}):`, JSON.stringify({
                  messageId: result.message_id,
                  chatId: result.chat.id,
                  duration: Date.now() - startTime,
                }));
              } catch (mdError) {
                const result = await ctx.reply(chunk);
                log(`[Telegram 网关] sendMessage (纯文本) 成功 (分段 ${i + 1}/${chunks.length}):`, JSON.stringify({
                  messageId: result.message_id,
                  chatId: result.chat.id,
                  duration: Date.now() - startTime,
                }));
              }
            }
            log(`[Telegram 网关] 已发送全部 ${chunks.length} 条消息`);
          }
        }
        this.status.lastOutboundAt = Date.now();
      } catch (replyError: any) {
        console.error(`[Telegram 网关] 发送回复失败: ${replyError.message}`);
      }
    };

    // 触发消息事件
    this.emit('message', imMessage);

    // 如果设置了消息回调，则调用
    if (this.onMessageCallback) {
      try {
        await this.onMessageCallback(imMessage, replyFn);
      } catch (error: any) {
        console.error(`[Telegram 网关] 消息回调中出错: ${error.message}`);
        await replyFn(`❌ 处理消息时出错: ${error.message}`);
      }
    }
  }

  /**
   * 为纯媒体消息生成描述
   */
  private generateMediaDescription(attachments: IMMediaAttachment[]): string {
    if (attachments.length === 1) {
      const att = attachments[0];
      switch (att.type) {
        case 'image':
          return `[图片: ${att.localPath}]`;
        case 'video':
          return `[视频: ${att.fileName || att.localPath}]`;
        case 'audio':
          return `[音频: ${att.fileName || att.localPath}]`;
        case 'voice':
          return `[语音消息: ${att.localPath}]`;
        case 'document':
          return `[文件: ${att.fileName || att.localPath}]`;
        case 'sticker':
          return `[贴纸: ${att.localPath}]`;
        default:
          return `[媒体: ${att.localPath}]`;
      }
    }
    return `[媒体组: ${attachments.length} 个文件]`;
  }

  /**
   * 将长消息分割成块
   */
  private splitMessage(text: string, maxLength: number): string[] {
    const chunks: string[] = [];
    let remaining = text;

    while (remaining.length > 0) {
      if (remaining.length <= maxLength) {
        chunks.push(remaining);
        break;
      }

      // 尝试在换行符处分割
      let splitIndex = remaining.lastIndexOf('\n', maxLength);
      if (splitIndex === -1 || splitIndex < maxLength / 2) {
        // 尝试在空格处分割
        splitIndex = remaining.lastIndexOf(' ', maxLength);
      }
      if (splitIndex === -1 || splitIndex < maxLength / 2) {
        // 在 maxLength 处强制分割
        splitIndex = maxLength;
      }

      chunks.push(remaining.slice(0, splitIndex));
      remaining = remaining.slice(splitIndex).trim();
    }

    return chunks;
  }

  /**
   * 向最后已知的聊天发送通知消息。
   */
  async sendNotification(text: string): Promise<void> {
    if (!this.bot || !this.lastChatId) {
      throw new Error('没有可用的会话用于通知');
    }
    await this.bot.api.sendMessage(this.lastChatId, text);
    this.status.lastOutboundAt = Date.now();
  }
}
