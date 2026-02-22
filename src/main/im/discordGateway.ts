/**
 * Discord 网关
 * 使用 discord.js 管理 Discord 机器人
 */

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import {
  Client,
  GatewayIntentBits,
  Partials,
  Message,
  Events,
  AttachmentBuilder,
  type Client as DiscordClient,
} from 'discord.js';
import {
  DiscordConfig,
  DiscordGatewayStatus,
  IMMessage,
  DEFAULT_DISCORD_STATUS,
} from './types';
import { parseMediaMarkers, stripMediaMarkers } from './dingtalkMediaParser';

export class DiscordGateway extends EventEmitter {
  private client: Client | null = null;
  private config: DiscordConfig | null = null;
  private status: DiscordGatewayStatus = { ...DEFAULT_DISCORD_STATUS };
  private onMessageCallback?: (message: IMMessage, replyFn: (text: string) => Promise<void>) => Promise<void>;
  private lastChannelId: string | null = null;
  private log: (...args: any[]) => void = () => {};

  constructor() {
    super();
  }

  /**
   * 获取当前网关状态
   */
  getStatus(): DiscordGatewayStatus {
    return { ...this.status };
  }

  /**
   * 检查网关是否已连接
   */
  isConnected(): boolean {
    return this.status.connected;
  }

  /**
   * 外部重连触发的公共方法（例如：网络事件）
   */
  reconnectIfNeeded(): void {
    if (!this.client && this.config) {
      this.log('[Discord Gateway] 外部重连触发');
      this.start(this.config).catch((error) => {
        console.error('[Discord Gateway] 重连失败:', error.message);
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
   * 发出状态变更事件以更新 UI
   */
  private emitStatusChange(): void {
    this.emit('status', this.getStatus());
  }

  /**
   * 启动 Discord 网关
   */
  async start(config: DiscordConfig): Promise<void> {
    if (this.client) {
      this.log('[Discord Gateway] 已在运行中，先停止...');
      await this.stop();
    }

    if (!config.enabled) {
      this.log('[Discord Gateway] Discord 在配置中已禁用');
      return;
    }

    if (!config.botToken) {
      throw new Error('Discord 机器人令牌是必需的');
    }

    // 存储配置以便重连
    this.config = config;

    this.log = config.debug ? console.log.bind(console) : () => {};
    this.log('[Discord Gateway] 正在启动...');
    this.status = {
      connected: false,
      starting: true,
      startedAt: null,
      lastError: null,
      botUsername: null,
      lastInboundAt: null,
      lastOutboundAt: null,
    };
    this.emitStatusChange();

    try {
      // 使用所需的 intents（意图）创建客户端实例
      this.log('[Discord Gateway] 创建 Client 实例, intents: Guilds, GuildMessages, DirectMessages, MessageContent');
      this.client = new Client({
        intents: [
          GatewayIntentBits.Guilds,
          GatewayIntentBits.GuildMessages,
          GatewayIntentBits.DirectMessages,
          GatewayIntentBits.MessageContent,
        ],
        partials: [
          Partials.Channel, // DM（私信）支持所需
          Partials.Message,
        ],
      });

      // 注册错误处理器
      this.log('[Discord Gateway] 注册事件处理器: Error, ClientReady, MessageCreate');
      this.client.on(Events.Error, (error: Error) => {
        console.error(`[Discord Gateway] 客户端错误: ${error.message}`);
        this.status = {
          ...this.status,
          starting: false,
          lastError: error.message,
        };
        this.emitStatusChange();
        this.emit('error', error);
      });

      // 注册就绪处理器
      this.client.once(Events.ClientReady, (readyClient: DiscordClient<true>) => {
        console.log(`[Discord Gateway] 已以 ${readyClient.user.tag} 身份连接`);
        this.status = {
          connected: true,
          starting: false,
          startedAt: Date.now(),
          lastError: null,
          botUsername: readyClient.user.tag,
          lastInboundAt: null,
          lastOutboundAt: null,
        };
        this.emitStatusChange();
        this.emit('connected');
      });

      // 注册消息处理器
      this.client.on(Events.MessageCreate, async (message: Message) => {
        await this.handleMessage(message);
      });

      // 使用机器人令牌登录
      this.log('[Discord Gateway] 正在登录 Bot...');
      await this.client.login(config.botToken);
      this.log('[Discord Gateway] 登录请求已发送, 等待 ClientReady 事件...');

    } catch (error: any) {
      console.error(`[Discord Gateway] 启动失败: ${error.message}`);
      this.status = {
        connected: false,
        starting: false,
        startedAt: null,
        lastError: error.message,
        botUsername: null,
        lastInboundAt: null,
        lastOutboundAt: null,
      };
      this.emitStatusChange();
      this.client = null;
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * 停止 Discord 网关
   */
  async stop(): Promise<void> {
    if (!this.client) {
      this.log('[Discord Gateway] 未在运行');
      return;
    }

    this.log('[Discord Gateway] 正在停止...');

    try {
      const client = this.client;
      this.client = null;

      // 销毁客户端连接
      this.log('[Discord Gateway] 销毁 Client 连接...');
      client.destroy();

      this.status = {
        connected: false,
        starting: false,
        startedAt: null,
        lastError: null,
        botUsername: null,
        lastInboundAt: null,
        lastOutboundAt: null,
      };
      this.emitStatusChange();

      this.log('[Discord Gateway] 已停止');
      this.emit('disconnected');
    } catch (error: any) {
      console.error(`[Discord Gateway] 停止时出错: ${error.message}`);
      this.status.lastError = error.message;
    }
  }

  /**
   * 处理传入的 Discord 消息
   */
  private async handleMessage(message: Message): Promise<void> {
    try {
      // 忽略来自机器人的消息（包括自己）
      if (message.author.bot) {
        return;
      }

      // 忽略空消息
      if (!message.content || message.content.trim() === '') {
        return;
      }

      const isDM = !message.guild;
      const channelId = message.channel.id;
      const guildId = message.guild?.id;

      // 在群聊中，只响应提及机器人的消息
      if (!isDM && this.client?.user) {
        const isMentioned = message.mentions.has(this.client.user.id);
        if (!isMentioned) {
          this.log('[Discord Gateway] 忽略未提及机器人的群消息');
          return;
        }
      }

      // 构建会话 ID
      const conversationId = isDM ? `dm:${message.author.id}` : `guild:${guildId}:${channelId}`;

      // 构建发送者名称
      const senderName = message.member?.displayName || message.author.displayName || message.author.username;
      const senderId = message.author.id;

      // 移除 Discord 提及标记（<@123456789>, <@!123456789>, <#123456789>, <@&123456789>）
      const cleanedContent = message.content
        .replace(/<@!?\d+>/g, '') // 用户提及
        .replace(/<#\d+>/g, '')   // 频道提及
        .replace(/<@&\d+>/g, '')  // 角色提及
        .trim();

      // 忽略移除提及标记后的空消息
      if (!cleanedContent) {
        return;
      }

      // 打印完整的输入消息日志
      this.log(`[Discord] 收到消息:`, JSON.stringify({
        sender: senderName,
        senderId,
        conversationId,
        chatType: isDM ? 'direct' : 'group',
        messageId: message.id,
        content: cleanedContent,
        guildId: guildId || null,
        channelId,
      }, null, 2));

      // 创建 IMMessage
      const imMessage: IMMessage = {
        platform: 'discord',
        messageId: message.id,
        conversationId: conversationId,
        senderId: senderId,
        senderName: senderName,
        content: cleanedContent,
        chatType: isDM ? 'direct' : 'group',
        timestamp: message.createdTimestamp,
      };
      this.status.lastInboundAt = Date.now();

      // 创建支持媒体的回复函数
      // 存储最后的频道 ID 用于通知
      this.lastChannelId = channelId;

      const replyFn = async (text: string) => {
        // 打印完整的输出消息日志
        this.log(`[Discord] 发送回复:`, JSON.stringify({
          conversationId,
          replyLength: text.length,
          reply: text,
        }, null, 2));

        try {
          // 从文本中解析媒体标记
          const markers = parseMediaMarkers(text);
          const validFiles: Array<{ path: string; name?: string }> = [];

          this.log(`[Discord Gateway] 解析媒体标记:`, JSON.stringify({
            textLength: text.length,
            markersCount: markers.length,
            markers: markers.map(m => ({ type: m.type, path: m.path, name: m.name })),
          }));

          // 检查哪些文件存在
          for (const marker of markers) {
            // 将 ~ 展开为用户主目录
            let filePath = marker.path;
            if (filePath.startsWith('~/')) {
              filePath = path.join(process.env.HOME || '', filePath.slice(2));
            }
            if (fs.existsSync(filePath)) {
              const stats = fs.statSync(filePath);
              this.log(`[Discord Gateway] 发现有效媒体文件:`, JSON.stringify({
                path: filePath,
                name: marker.name,
                type: marker.type,
                fileSize: stats.size,
                fileSizeKB: (stats.size / 1024).toFixed(1),
              }));
              validFiles.push({ path: filePath, name: marker.name });
            } else {
              console.warn(`[Discord Gateway] 媒体文件未找到: ${filePath}`);
            }
          }

          // 如果有有效文件，从文本中移除媒体标记
          const textContent = validFiles.length > 0 ? stripMediaMarkers(text, markers) : text;

          // 使用自定义名称构建附件
          const attachments = validFiles.map(file => {
            const attachment = new AttachmentBuilder(file.path);
            if (file.name) {
              const ext = path.extname(file.path);
              attachment.setName(`${file.name}${ext}`);
            }
            return attachment;
          });

          this.log(`[Discord Gateway] 准备发送:`, JSON.stringify({
            textLength: textContent.length,
            attachmentsCount: attachments.length,
            attachmentNames: validFiles.map(f => f.name || path.basename(f.path)),
          }));

          // 拆分长消息（Discord 限制为 2000 个字符）
          const MAX_LENGTH = 1900; // 留出一些余量

          if (textContent.length <= MAX_LENGTH) {
            // 在第一条消息中发送文本和附件
            if (attachments.length > 0) {
              await message.reply({ content: textContent || undefined, files: attachments });
              this.log(`[Discord Gateway] 已发送文本+附件消息`);
            } else if (textContent) {
              await message.reply(textContent);
              this.log(`[Discord Gateway] 已发送纯文本消息`);
            }
          } else {
            // 按换行符或长度拆分
            const chunks = this.splitMessage(textContent, MAX_LENGTH);
            this.log(`[Discord Gateway] 消息过长，拆分为 ${chunks.length} 条`);
            for (let i = 0; i < chunks.length; i++) {
              if (i === 0) {
                // 第一条消息：带附件回复
                if (attachments.length > 0) {
                  await message.reply({ content: chunks[i], files: attachments });
                } else {
                  await message.reply(chunks[i]);
                }
              } else {
                // 后续消息：仅发送文本
                if ('send' in message.channel && typeof message.channel.send === 'function') {
                  await message.channel.send(chunks[i]);
                }
              }
            }
            this.log(`[Discord Gateway] 已发送全部 ${chunks.length} 条消息`);
          }
          this.status.lastOutboundAt = Date.now();
        } catch (replyError: any) {
          console.error(`[Discord Gateway] 发送回复失败: ${replyError.message}`);
        }
      };

      // 发出消息事件
      this.emit('message', imMessage);

      // 如果已设置消息回调，则调用
      if (this.onMessageCallback) {
        try {
          await this.onMessageCallback(imMessage, replyFn);
        } catch (error: any) {
          console.error(`[Discord Gateway] 消息回调出错: ${error.message}`);
          await replyFn(`处理消息时出错: ${error.message}`);
        }
      }
    } catch (error: any) {
      console.error(`[Discord Gateway] 处理消息时出错: ${error.message}`);
      this.status.lastError = error.message;
      this.emit('error', error);
    }
  }

  /**
   * 将长消息拆分为多个块
   */
  private splitMessage(text: string, maxLength: number): string[] {
    const chunks: string[] = [];
    let remaining = text;

    while (remaining.length > 0) {
      if (remaining.length <= maxLength) {
        chunks.push(remaining);
        break;
      }

      // 尝试在换行符处拆分
      let splitIndex = remaining.lastIndexOf('\n', maxLength);
      if (splitIndex === -1 || splitIndex < maxLength / 2) {
        // 尝试在空格处拆分
        splitIndex = remaining.lastIndexOf(' ', maxLength);
      }
      if (splitIndex === -1 || splitIndex < maxLength / 2) {
        // 在 maxLength 处强制拆分
        splitIndex = maxLength;
      }

      chunks.push(remaining.slice(0, splitIndex));
      remaining = remaining.slice(splitIndex).trim();
    }

    return chunks;
  }

  /**
   * 向最后已知的频道发送通知消息
   */
  async sendNotification(text: string): Promise<void> {
    if (!this.client || !this.lastChannelId) {
      throw new Error('没有可用的会话用于通知');
    }
    this.log(`[Discord Gateway] 发送通知消息:`, JSON.stringify({
      channelId: this.lastChannelId,
      textLength: text.length,
      text,
    }));
    const channel = await this.client.channels.fetch(this.lastChannelId);
    if (channel && channel.isTextBased() && 'send' in channel) {
      await (channel as any).send(text);
      this.log(`[Discord Gateway] 通知消息已发送`);
      this.status.lastOutboundAt = Date.now();
    } else {
      throw new Error('频道不是基于文本的或无法访问');
    }
  }
}
