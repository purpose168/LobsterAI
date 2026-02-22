/**
 * 飞书/Lark 网关
 * 管理 WebSocket 连接以接收消息
 * 从 im-gateway 改编用于 Electron 主进程
 */

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import {
  FeishuConfig,
  FeishuGatewayStatus,
  FeishuMessageContext,
  IMMessage,
  DEFAULT_FEISHU_STATUS,
} from './types';
import {
  uploadImageToFeishu,
  uploadFileToFeishu,
  detectFeishuFileType,
  isFeishuImagePath,
  isFeishuAudioPath,
  resolveFeishuMediaPath,
} from './feishuMedia';
import { parseMediaMarkers } from './dingtalkMediaParser';
import { stringifyAsciiJson } from './jsonEncoding';

// 消息去重缓存
const processedMessages = new Map<string, number>();
const MESSAGE_DEDUP_TTL = 5 * 60 * 1000; // 5分钟

// 飞书消息事件结构
interface FeishuMessageEvent {
  message: {
    message_id: string;
    root_id?: string;
    parent_id?: string;
    chat_id: string;
    chat_type: 'p2p' | 'group';
    message_type: string;
    content: string;
    mentions?: Array<{
      key: string;
      id: { open_id?: string; user_id?: string };
      name: string;
    }>;
  };
  sender: {
    sender_id: {
      open_id?: string;
      user_id?: string;
    };
    sender_type: string;
  };
}

export class FeishuGateway extends EventEmitter {
  private wsClient: any = null;
  private restClient: any = null;
  private config: FeishuConfig | null = null;
  private status: FeishuGatewayStatus = { ...DEFAULT_FEISHU_STATUS };
  private botOpenId: string | null = null;
  private onMessageCallback?: (message: IMMessage, replyFn: (text: string) => Promise<void>) => Promise<void>;
  private lastChatId: string | null = null;
  private log: (...args: any[]) => void = () => {};

  constructor() {
    super();
  }

  /**
   * 获取当前网关状态
   */
  getStatus(): FeishuGatewayStatus {
    return { ...this.status };
  }

  /**
   * 检查网关是否已连接
   */
  isConnected(): boolean {
    return this.status.connected;
  }

  /**
   * 外部重连触发公共方法（例如：网络事件）
   */
  reconnectIfNeeded(): void {
    if (!this.wsClient && this.config) {
      this.log('[飞书网关] 外部重连触发');
      this.start(this.config).catch((error) => {
        console.error('[飞书网关] 重连失败:', error.message);
      });
    }
  }

  /**
   * 设置消息回调
   */
  setMessageCallback(
    callback: (message: IMMessage, replyFn: (text: string) => Promise<void>) => Promise<void>
  ): void {
    this.onMessageCallback = callback;
  }

  /**
   * 启动飞书网关
   */
  async start(config: FeishuConfig): Promise<void> {
    if (this.wsClient) {
      throw new Error('飞书网关已在运行中');
    }

    if (!config.enabled) {
      console.log('[飞书网关] 飞书在配置中已禁用');
      return;
    }

    if (!config.appId || !config.appSecret) {
      throw new Error('飞书 appId 和 appSecret 为必填项');
    }

    this.config = config;
    this.log = config.debug ? console.log.bind(console) : () => {};

    this.log('[飞书网关] 正在启动 WebSocket 网关...');

    try {
      // 动态导入 @larksuiteoapi/node-sdk
      const Lark = await import('@larksuiteoapi/node-sdk');

      // 解析域名
      const domain = this.resolveDomain(config.domain, Lark);

      // 创建用于发送消息的 REST 客户端
      this.restClient = new Lark.Client({
        appId: config.appId,
        appSecret: config.appSecret,
        appType: Lark.AppType.SelfBuild,
        domain,
      });

      // 探测机器人信息以获取 open_id
      const probeResult = await this.probeBot();
      if (!probeResult.ok) {
        throw new Error(`探测机器人失败: ${probeResult.error}`);
      }

      this.botOpenId = probeResult.botOpenId || null;
      this.log(`[飞书网关] 机器人信息: ${probeResult.botName} (${this.botOpenId})`);

      // 创建 WebSocket 客户端
      this.wsClient = new Lark.WSClient({
        appId: config.appId,
        appSecret: config.appSecret,
        domain,
        loggerLevel: config.debug ? Lark.LoggerLevel.debug : Lark.LoggerLevel.info,
      });

      // 创建事件分发器
      const eventDispatcher = new Lark.EventDispatcher({
        encryptKey: config.encryptKey,
        verificationToken: config.verificationToken,
      });

      // 注册事件处理器
      eventDispatcher.register({
        'im.message.receive_v1': async (data: any) => {
          try {
            const event = data as FeishuMessageEvent;

            // 检查重复消息
            if (this.isMessageProcessed(event.message.message_id)) {
              this.log(`[飞书网关] 忽略重复消息: ${event.message.message_id}`);
              return;
            }

            const ctx = this.parseMessageEvent(event);
            await this.handleInboundMessage(ctx);
          } catch (err: any) {
            console.error(`[飞书网关] 处理消息时出错: ${err.message}`);
          }
        },
        'im.message.message_read_v1': async () => {
          // 忽略已读回执
        },
        'im.chat.member.bot.added_v1': async (data: any) => {
          this.log(`[飞书网关] 机器人已添加到群聊 ${data.chat_id}`);
        },
        'im.chat.member.bot.deleted_v1': async (data: any) => {
          this.log(`[飞书网关] 机器人已从群聊移除 ${data.chat_id}`);
        },
      });

      // 启动 WebSocket 客户端
      this.wsClient.start({ eventDispatcher });

      this.status = {
        connected: true,
        startedAt: new Date().toISOString(),
        botOpenId: this.botOpenId,
        error: null,
        lastInboundAt: null,
        lastOutboundAt: null,
      };

      this.log('[飞书网关] WebSocket 网关启动成功');
      this.emit('connected');
    } catch (error: any) {
      this.wsClient = null;
      this.restClient = null;
      this.status = {
        connected: false,
        startedAt: null,
        botOpenId: null,
        error: error.message,
        lastInboundAt: null,
        lastOutboundAt: null,
      };
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * 停止飞书网关
   */
  async stop(): Promise<void> {
    if (!this.wsClient) {
      this.log('[飞书网关] 未在运行');
      return;
    }

    this.log('[飞书网关] 正在停止 WebSocket 网关...');

    this.wsClient = null;
    this.restClient = null;
    this.config = null;
    this.status = {
      connected: false,
      startedAt: null,
      botOpenId: this.status.botOpenId,
      error: null,
      lastInboundAt: null,
      lastOutboundAt: null,
    };

    this.log('[飞书网关] WebSocket 网关已停止');
    this.emit('disconnected');
  }

  /**
   * 将域名解析为 Lark SDK 域名
   */
  private resolveDomain(domain: string, Lark: any): any {
    if (domain === 'lark') return Lark.Domain.Lark;
    if (domain === 'feishu') return Lark.Domain.Feishu;
    return domain.replace(/\/+$/, '');
  }

  /**
   * 探测机器人信息
   */
  private async probeBot(): Promise<{
    ok: boolean;
    error?: string;
    botName?: string;
    botOpenId?: string;
  }> {
    try {
      const response: any = await this.restClient.request({
        method: 'GET',
        url: '/open-apis/bot/v3/info',
      });

      if (response.code !== 0) {
        return { ok: false, error: response.msg };
      }

      return {
        ok: true,
        botName: response.data?.app_name ?? response.data?.bot?.app_name,
        botOpenId: response.data?.open_id ?? response.data?.bot?.open_id,
      };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  }

  /**
   * 检查消息是否已处理（去重）
   */
  private isMessageProcessed(messageId: string): boolean {
    this.cleanupProcessedMessages();
    if (processedMessages.has(messageId)) {
      return true;
    }
    processedMessages.set(messageId, Date.now());
    return false;
  }

  /**
   * 清理缓存中过期的消息
   */
  private cleanupProcessedMessages(): void {
    const now = Date.now();
    for (const [messageId, timestamp] of processedMessages) {
      if (now - timestamp > MESSAGE_DEDUP_TTL) {
        processedMessages.delete(messageId);
      }
    }
  }

  /**
   * 解析消息内容
   */
  private parseMessageContent(content: string, messageType: string): string {
    try {
      const parsed = JSON.parse(content);
      if (messageType === 'text') {
        return parsed.text || '';
      }
      if (messageType === 'post') {
        return this.parsePostContent(content);
      }
      return content;
    } catch {
      return content;
    }
  }

  /**
   * 解析帖子（富文本）内容
   */
  private parsePostContent(content: string): string {
    try {
      const parsed = JSON.parse(content);
      const title = parsed.title || '';
      const contentBlocks = parsed.content || [];
      let textContent = title ? `${title}\n\n` : '';

      for (const paragraph of contentBlocks) {
        if (Array.isArray(paragraph)) {
          for (const element of paragraph) {
            if (element.tag === 'text') {
              textContent += element.text || '';
            } else if (element.tag === 'a') {
              textContent += element.text || element.href || '';
            } else if (element.tag === 'at') {
              textContent += `@${element.user_name || element.user_id || ''}`;
            }
          }
          textContent += '\n';
        }
      }

      return textContent.trim() || '[富文本消息]';
    } catch {
      return '[富文本消息]';
    }
  }

  /**
   * 检查机器人是否被提及
   */
  private checkBotMentioned(event: FeishuMessageEvent): boolean {
    const mentions = event.message.mentions ?? [];
    if (mentions.length === 0) return false;
    if (!this.botOpenId) return mentions.length > 0;
    return mentions.some((m) => m.id.open_id === this.botOpenId);
  }

  /**
   * 从文本中移除机器人提及
   */
  private stripBotMention(text: string, mentions?: FeishuMessageEvent['message']['mentions']): string {
    if (!mentions || mentions.length === 0) return text;
    let result = text;
    for (const mention of mentions) {
      result = result.replace(new RegExp(`@${mention.name}\\s*`, 'g'), '').trim();
      result = result.replace(new RegExp(mention.key, 'g'), '').trim();
    }
    return result;
  }

  /**
   * 解析飞书消息事件
   */
  private parseMessageEvent(event: FeishuMessageEvent): FeishuMessageContext {
    const rawContent = this.parseMessageContent(event.message.content, event.message.message_type);
    const mentionedBot = this.checkBotMentioned(event);
    const content = this.stripBotMention(rawContent, event.message.mentions);

    return {
      chatId: event.message.chat_id,
      messageId: event.message.message_id,
      senderId: event.sender.sender_id.user_id || event.sender.sender_id.open_id || '',
      senderOpenId: event.sender.sender_id.open_id || '',
      chatType: event.message.chat_type,
      mentionedBot,
      rootId: event.message.root_id,
      parentId: event.message.parent_id,
      content,
      contentType: event.message.message_type,
    };
  }

  /**
   * 解析 receive_id_type
   */
  private resolveReceiveIdType(target: string): 'open_id' | 'user_id' | 'chat_id' {
    if (target.startsWith('ou_')) return 'open_id';
    if (target.startsWith('oc_')) return 'chat_id';
    return 'chat_id';
  }

  /**
   * 发送文本消息
   */
  private async sendTextMessage(to: string, text: string, replyToMessageId?: string): Promise<void> {
    const receiveIdType = this.resolveReceiveIdType(to);
    const content = stringifyAsciiJson({ text });

    if (replyToMessageId) {
      const response = await this.restClient.im.message.reply({
        path: { message_id: replyToMessageId },
        data: { content, msg_type: 'text' },
      });

      if (response.code !== 0) {
        throw new Error(`飞书回复失败: ${response.msg || `错误码 ${response.code}`}`);
      }
      return;
    }

    const response = await this.restClient.im.message.create({
      params: { receive_id_type: receiveIdType },
      data: { receive_id: to, content, msg_type: 'text' },
    });

    if (response.code !== 0) {
      throw new Error(`飞书发送失败: ${response.msg || `错误码 ${response.code}`}`);
    }
  }

  /**
   * 构建 Markdown 卡片
   */
  private buildMarkdownCard(text: string): Record<string, unknown> {
    return {
      config: { wide_screen_mode: true },
      elements: [{ tag: 'markdown', content: text }],
    };
  }

  /**
   * 发送卡片消息
   */
  private async sendCardMessage(to: string, text: string, replyToMessageId?: string): Promise<void> {
    const receiveIdType = this.resolveReceiveIdType(to);
    const card = this.buildMarkdownCard(text);
    const content = stringifyAsciiJson(card);

    if (replyToMessageId) {
      const response = await this.restClient.im.message.reply({
        path: { message_id: replyToMessageId },
        data: { content, msg_type: 'interactive' },
      });

      if (response.code !== 0) {
        throw new Error(`飞书卡片回复失败: ${response.msg || `错误码 ${response.code}`}`);
      }
      return;
    }

    const response = await this.restClient.im.message.create({
      params: { receive_id_type: receiveIdType },
      data: { receive_id: to, content, msg_type: 'interactive' },
    });

    if (response.code !== 0) {
      throw new Error(`飞书卡片发送失败: ${response.msg || `错误码 ${response.code}`}`);
    }
  }

  /**
   * 发送消息（根据配置自动选择格式）
   */
  private async sendMessage(to: string, text: string, replyToMessageId?: string): Promise<void> {
    const renderMode = this.config?.renderMode || 'text';

    this.log(`[飞书网关] 发送文本消息:`, JSON.stringify({
      to,
      renderMode,
      replyToMessageId,
      textLength: text.length,
    }));

    if (renderMode === 'card') {
      await this.sendCardMessage(to, text, replyToMessageId);
    } else {
      await this.sendTextMessage(to, text, replyToMessageId);
    }
  }

  /**
   * 发送图片消息
   */
  private async sendImageMessage(to: string, imageKey: string, replyToMessageId?: string): Promise<void> {
    const receiveIdType = this.resolveReceiveIdType(to);
    const content = stringifyAsciiJson({ image_key: imageKey });

    this.log(`[飞书网关] 发送图片消息:`, JSON.stringify({
      to,
      imageKey,
      receiveIdType,
      replyToMessageId,
    }));

    if (replyToMessageId) {
      const response = await this.restClient.im.message.reply({
        path: { message_id: replyToMessageId },
        data: { content, msg_type: 'image' },
      });
      if (response.code !== 0) {
        throw new Error(`飞书图片回复失败: ${response.msg || `错误码 ${response.code}`}`);
      }
      return;
    }

    const response = await this.restClient.im.message.create({
      params: { receive_id_type: receiveIdType },
      data: { receive_id: to, content, msg_type: 'image' },
    });
    if (response.code !== 0) {
      throw new Error(`飞书图片发送失败: ${response.msg || `错误码 ${response.code}`}`);
    }
  }

  /**
   * 发送文件消息
   */
  private async sendFileMessage(to: string, fileKey: string, replyToMessageId?: string): Promise<void> {
    const receiveIdType = this.resolveReceiveIdType(to);
    const content = stringifyAsciiJson({ file_key: fileKey });

    this.log(`[飞书网关] 发送文件消息:`, JSON.stringify({
      to,
      fileKey,
      receiveIdType,
      replyToMessageId,
    }));

    if (replyToMessageId) {
      const response = await this.restClient.im.message.reply({
        path: { message_id: replyToMessageId },
        data: { content, msg_type: 'file' },
      });
      if (response.code !== 0) {
        throw new Error(`飞书文件回复失败: ${response.msg || `错误码 ${response.code}`}`);
      }
      return;
    }

    const response = await this.restClient.im.message.create({
      params: { receive_id_type: receiveIdType },
      data: { receive_id: to, content, msg_type: 'file' },
    });
    if (response.code !== 0) {
      throw new Error(`飞书文件发送失败: ${response.msg || `错误码 ${response.code}`}`);
    }
  }

  /**
   * 发送音频消息
   */
  private async sendAudioMessage(to: string, fileKey: string, duration?: number, replyToMessageId?: string): Promise<void> {
    const receiveIdType = this.resolveReceiveIdType(to);
    const content = stringifyAsciiJson({
      file_key: fileKey,
      ...(duration !== undefined && { duration: Math.floor(duration).toString() })
    });

    this.log(`[飞书网关] 发送音频消息:`, JSON.stringify({
      to,
      fileKey,
      duration,
      receiveIdType,
      replyToMessageId,
    }));

    if (replyToMessageId) {
      const response = await this.restClient.im.message.reply({
        path: { message_id: replyToMessageId },
        data: { content, msg_type: 'audio' },
      });
      if (response.code !== 0) {
        throw new Error(`飞书音频回复失败: ${response.msg || `错误码 ${response.code}`}`);
      }
      return;
    }

    const response = await this.restClient.im.message.create({
      params: { receive_id_type: receiveIdType },
      data: { receive_id: to, content, msg_type: 'audio' },
    });
    if (response.code !== 0) {
      throw new Error(`飞书音频发送失败: ${response.msg || `错误码 ${response.code}`}`);
    }
  }

  /**
   * 从文件路径上传并发送媒体文件
   * @param customFileName - 从 Markdown 解析出的自定义文件名（如 [今日新闻](file.txt) 中的"今日新闻"）
   */
  private async uploadAndSendMedia(
    to: string,
    filePath: string,
    mediaType: 'image' | 'video' | 'audio' | 'file',
    replyToMessageId?: string,
    customFileName?: string
  ): Promise<void> {
    // 解析路径
    const absPath = resolveFeishuMediaPath(filePath);

    if (!fs.existsSync(absPath)) {
      console.warn(`[飞书网关] 文件未找到: ${absPath}`);
      return;
    }

    // 使用自定义文件名或从路径提取，保留原始扩展名
    const originalFileName = path.basename(absPath);
    const ext = path.extname(absPath);
    const fileName = customFileName ? `${customFileName}${ext}` : originalFileName;
    const fileStats = fs.statSync(absPath);

    this.log(`[飞书网关] 上传媒体:`, JSON.stringify({
      absPath,
      mediaType,
      originalFileName,
      customFileName,
      fileName,
      fileSize: fileStats.size,
      fileSizeKB: (fileStats.size / 1024).toFixed(1),
    }));

    if (mediaType === 'image' || isFeishuImagePath(absPath)) {
      // 上传图片
      this.log(`[飞书网关] 开始上传图片: ${fileName}`);
      const result = await uploadImageToFeishu(this.restClient, absPath);
      this.log(`[飞书网关] 图片上传结果:`, JSON.stringify(result));
      if (!result.success || !result.imageKey) {
        console.warn(`[飞书网关] 图片上传失败: ${result.error}`);
        return;
      }
      await this.sendImageMessage(to, result.imageKey, replyToMessageId);
    } else if (mediaType === 'audio' || isFeishuAudioPath(absPath)) {
      // 上传音频
      this.log(`[飞书网关] 开始上传音频: ${fileName}`);
      const result = await uploadFileToFeishu(this.restClient, absPath, fileName, 'opus');
      this.log(`[飞书网关] 音频上传结果:`, JSON.stringify(result));
      if (!result.success || !result.fileKey) {
        console.warn(`[飞书网关] 音频上传失败: ${result.error}`);
        return;
      }
      await this.sendAudioMessage(to, result.fileKey, undefined, replyToMessageId);
    } else {
      // 作为文件上传（包括视频 - 飞书视频需要封面图，为简化处理作为文件发送）
      this.log(`[飞书网关] 开始上传文件: ${fileName}`);
      const fileType = detectFeishuFileType(fileName);
      this.log(`[飞书网关] 检测到文件类型: ${fileType}`);
      const result = await uploadFileToFeishu(this.restClient, absPath, fileName, fileType);
      this.log(`[飞书网关] 文件上传结果:`, JSON.stringify(result));
      if (!result.success || !result.fileKey) {
        console.warn(`[飞书网关] 文件上传失败: ${result.error}`);
        return;
      }
      await this.sendFileMessage(to, result.fileKey, replyToMessageId);
    }
  }

  /**
   * 发送支持媒体的消息 - 检测并上传文本中的媒体文件
   */
  private async sendWithMedia(to: string, text: string, replyToMessageId?: string): Promise<void> {
    // 从文本解析媒体标记
    const markers = parseMediaMarkers(text);

    this.log(`[飞书网关] 解析媒体标记:`, JSON.stringify({
      to,
      replyToMessageId,
      textLength: text.length,
      markersCount: markers.length,
      markers: markers.map(m => ({ type: m.type, path: m.path, name: m.name })),
    }));

    if (markers.length === 0) {
      // 无媒体，作为文本/卡片发送
      await this.sendMessage(to, text, replyToMessageId);
      return;
    }

    // 上传并发送每个媒体文件
    for (const marker of markers) {
      try {
        this.log(`[飞书网关] 处理媒体:`, JSON.stringify(marker));
        // 传递从 markdown 解析出的文件名
        await this.uploadAndSendMedia(to, marker.path, marker.type, replyToMessageId, marker.name);
      } catch (error: any) {
        console.error(`[飞书网关] 发送媒体失败: ${error.message}`);
      }
    }

    // 发送文本消息（保留完整文本作为上下文）
    await this.sendMessage(to, text, replyToMessageId);
  }

  /**
   * 处理入站消息
   */
  private async handleInboundMessage(ctx: FeishuMessageContext): Promise<void> {
    // 在群聊中，仅当机器人被提及时才响应
    if (ctx.chatType === 'group' && !ctx.mentionedBot) {
      this.log('[飞书网关] 忽略未提及机器人的群聊消息');
      return;
    }

    // 创建 IMMessage
    const message: IMMessage = {
      platform: 'feishu',
      messageId: ctx.messageId,
      conversationId: ctx.chatId,
      senderId: ctx.senderId,
      content: ctx.content,
      chatType: ctx.chatType === 'p2p' ? 'direct' : 'group',
      timestamp: Date.now(),
    };
    this.status.lastInboundAt = Date.now();

    // 打印完整的输入消息日志
    this.log(`[飞书] 收到消息:`, JSON.stringify({
      sender: ctx.senderOpenId,
      senderId: ctx.senderId,
      chatId: ctx.chatId,
      chatType: ctx.chatType === 'p2p' ? 'direct' : 'group',
      messageId: ctx.messageId,
      contentType: ctx.contentType,
      content: ctx.content,
      mentionedBot: ctx.mentionedBot,
      rootId: ctx.rootId,
      parentId: ctx.parentId,
    }, null, 2));

    // 创建支持媒体的回复函数
    const replyFn = async (text: string) => {
      // 打印完整的输出消息日志
      this.log(`[飞书] 发送回复:`, JSON.stringify({
        conversationId: ctx.chatId,
        replyToMessageId: ctx.messageId,
        replyLength: text.length,
        reply: text,
      }, null, 2));

      await this.sendWithMedia(ctx.chatId, text, ctx.messageId);
      this.status.lastOutboundAt = Date.now();
    };

    // 存储最后的聊天 ID 用于通知
    this.lastChatId = ctx.chatId;

    // 触发消息事件
    this.emit('message', message);

    // 如果设置了消息回调则调用
    if (this.onMessageCallback) {
      try {
        await this.onMessageCallback(message, replyFn);
      } catch (error: any) {
        console.error(`[飞书网关] 消息回调出错: ${error.message}`);
        await replyFn(`抱歉，处理消息时出现错误：${error.message}`);
      }
    }
  }

  /**
   * 向最后已知的聊天发送通知消息
   */
  async sendNotification(text: string): Promise<void> {
    if (!this.lastChatId || !this.restClient) {
      throw new Error('没有可用的会话用于发送通知');
    }
    await this.sendMessage(this.lastChatId, text);
    this.status.lastOutboundAt = Date.now();
  }
}
