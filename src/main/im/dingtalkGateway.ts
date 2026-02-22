/**
 * 钉钉网关
 * 使用 Stream 模式管理与钉钉的 WebSocket 连接
 * 从 im-gateway 改编，用于 Electron 主进程
 */

import { EventEmitter } from 'events';
import axios from 'axios';
import {
  DingTalkConfig,
  DingTalkGatewayStatus,
  DingTalkInboundMessage,
  DingTalkMediaMessage,
  MediaMarker,
  IMMessage,
  DEFAULT_DINGTALK_STATUS,
} from './types';
import { uploadMediaToDingTalk, detectMediaType, getOapiAccessToken } from './dingtalkMedia';
import { parseMediaMarkers } from './dingtalkMediaParser';
import { createUtf8JsonBody, JSON_UTF8_CONTENT_TYPE, stringifyAsciiJson } from './jsonEncoding';

const DINGTALK_API = 'https://api.dingtalk.com';

// 访问令牌缓存
let accessToken: string | null = null;
let accessTokenExpiry = 0;

// 消息内容提取结果
interface MessageContent {
  text: string;
  messageType: string;
  mediaPath?: string;
  mediaType?: string;
}

export class DingTalkGateway extends EventEmitter {
  private client: any = null;
  private config: DingTalkConfig | null = null;
  private savedConfig: DingTalkConfig | null = null; // 保存的配置，用于重连
  private status: DingTalkGatewayStatus = { ...DEFAULT_DINGTALK_STATUS };
  private onMessageCallback?: (message: IMMessage, replyFn: (text: string) => Promise<void>) => Promise<void>;
  private lastConversation: { conversationType: '1' | '2'; userId?: string; openConversationId?: string; sessionWebhook: string } | null = null;
  private log: (...args: any[]) => void = () => {};

  // 健康检查和自动重连
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private tokenRefreshInterval: NodeJS.Timeout | null = null;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private reconnectDelayMs = 3000; // 减少到 3 秒
  private isReconnecting = false;
  private isStopping = false;
  private lastMessageTime = 0;

  // 健康检查配置
  private readonly HEALTH_CHECK_INTERVAL = 10000; // 10 秒
  private readonly MESSAGE_TIMEOUT = 60000; // 60 秒 - 如果没有消息则强制重连
  private readonly TOKEN_REFRESH_INTERVAL = 3600000; // 1 小时

  constructor() {
    super();
  }

  /**
   * 获取当前网关状态
   */
  getStatus(): DingTalkGatewayStatus {
    return { ...this.status };
  }

  /**
   * 启动健康检查监控
   */
  private startHealthCheck(): void {
    this.stopHealthCheck();

    this.log('[钉钉网关] 启动健康检查监控...');

    // 健康检查间隔
    this.healthCheckInterval = setInterval(() => {
      this.performHealthCheck();
    }, this.HEALTH_CHECK_INTERVAL);

    // 令牌刷新间隔
    this.tokenRefreshInterval = setInterval(() => {
      this.refreshAccessToken();
    }, this.TOKEN_REFRESH_INTERVAL);

    this.lastMessageTime = Date.now();
  }

  /**
   * 停止健康检查监控
   */
  private stopHealthCheck(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }

    if (this.tokenRefreshInterval) {
      clearInterval(this.tokenRefreshInterval);
      this.tokenRefreshInterval = null;
    }

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
  }

  /**
   * 执行健康检查
   */
  private async performHealthCheck(): Promise<void> {
    if (this.isStopping) {
      return;
    }

    // 如果客户端为空，尝试重连（之前的重连可能失败）
    if (!this.client) {
      this.log('[钉钉网关] 客户端为空，尝试重连...');
      await this.reconnect();
      return;
    }

    const now = Date.now();
    const timeSinceLastMessage = now - this.lastMessageTime;

    // 如果超过 MESSAGE_TIMEOUT 没有消息，强制重连
    // 不测试令牌，因为它可能被缓存并产生误报
    if (timeSinceLastMessage > this.MESSAGE_TIMEOUT) {
      console.log(`[钉钉网关] ${Math.floor(timeSinceLastMessage / 1000)}秒内无消息，强制重连...`);
      this.log('[钉钉网关] 检测到长时间静默，SDK 连接可能已断开，强制重连...');
      await this.reconnect();
    }
  }

  /**
   * 主动刷新访问令牌
   */
  private async refreshAccessToken(): Promise<void> {
    if (this.isStopping || (!this.config && !this.savedConfig)) {
      return;
    }

    try {
      this.log('[钉钉网关] 主动刷新访问令牌...');
      // 通过清除缓存强制刷新令牌
      accessToken = null;
      accessTokenExpiry = 0;
      await this.getAccessToken();
      this.log('[钉钉网关] 访问令牌刷新成功');
    } catch (error: any) {
      console.error(`[钉钉网关] 令牌刷新失败: ${error.message}`);
    }
  }

  /**
   * 重连到钉钉
   */
  private async reconnect(): Promise<void> {
    if (this.isReconnecting || this.isStopping) {
      return;
    }

    // 如果 config 为空，使用 savedConfig（重连失败后）
    const configToUse = this.config || this.savedConfig;
    if (!configToUse) {
      console.error('[钉钉网关] 没有可用的配置进行重连');
      return;
    }

    this.isReconnecting = true;

    // 简单的防抖延迟（3 秒），无指数退避
    this.log(`[钉钉网关] ${this.reconnectDelayMs}毫秒后重连...`);

    // 使用可取消的超时
    await new Promise<void>(resolve => {
      this.reconnectTimeout = setTimeout(() => {
        this.reconnectTimeout = null;
        resolve();
      }, this.reconnectDelayMs);
    });

    // 如果在延迟期间触发了停止，则中止重连
    if (this.isStopping) {
      this.isReconnecting = false;
      return;
    }

    try {
      // 停止并重启（使用在重连期间持续存在的 savedConfig）
      await this.stop();
      await this.start(configToUse);

      console.log('[钉钉网关] 重连成功');
    } catch (error: any) {
      console.error(`[钉钉网关] 重连失败: ${error.message}`);
      // 无重试限制，下次健康检查或网络事件将重试
    } finally {
      this.isReconnecting = false;
    }
  }

  /**
   * 检查网关是否已连接
   */
  isConnected(): boolean {
    return this.status.connected;
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
   * 公共方法，用于外部重连触发（例如网络事件）
   */
  reconnectIfNeeded(): void {
    if (!this.client && this.savedConfig) {
      this.log('[钉钉网关] 外部重连触发');
      this.reconnect();
    }
  }

  /**
   * 启动钉钉网关
   */
  async start(config: DingTalkConfig): Promise<void> {
    if (this.client) {
      this.log('[钉钉网关] 已在运行，先停止...');
      await this.stop();
    }

    if (!config.enabled) {
      console.log('[钉钉网关] 钉钉在配置中已禁用');
      return;
    }

    if (!config.clientId || !config.clientSecret) {
      throw new Error('钉钉 clientId 和 clientSecret 是必需的');
    }

    this.config = config;
    this.savedConfig = { ...config }; // 保存配置用于重连
    this.isStopping = false;
    this.log = config.debug ? console.log.bind(console) : () => {};
    this.log('[钉钉网关] 启动中...');

    try {
      // 动态导入 dingtalk-stream
      const { DWClient, TOPIC_ROBOT } = await import('dingtalk-stream');

      this.client = new DWClient({
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        debug: config.debug || false,
        keepAlive: true,
      });

      // 注册消息回调
      this.client.registerCallbackListener(TOPIC_ROBOT, async (res: any) => {
        // 检查客户端是否仍然连接（如果已停止可能为空）
        if (!this.client) {
          this.log('[钉钉网关] 忽略消息，网关已停止');
          return;
        }

        // 更新最后消息时间用于健康检查
        this.lastMessageTime = Date.now();

        const messageId = res.headers?.messageId;
        try {
          // 确认消息接收
          if (messageId && this.client) {
            this.client.socketCallBackResponse(messageId, { success: true });
          }

          const data = JSON.parse(res.data) as DingTalkInboundMessage;
          await this.handleInboundMessage(data);
        } catch (error: any) {
          console.error(`[钉钉网关] 处理消息时出错: ${error.message}`);
          this.status.lastError = error.message;
          this.emit('error', error);
        }
      });

      // 连接到钉钉
      await this.client.connect();

      this.status = {
        connected: true,
        startedAt: Date.now(),
        lastError: null,
        lastInboundAt: null,
        lastOutboundAt: null,
      };

      // 启动健康检查和令牌刷新
      this.startHealthCheck();

      console.log('[钉钉网关] 连接成功，健康监控已启用');
      this.emit('connected');
    } catch (error: any) {
      console.error(`[钉钉网关] 启动失败: ${error.message}`);
      this.status = {
        connected: false,
        startedAt: null,
        lastError: error.message,
        lastInboundAt: null,
        lastOutboundAt: null,
      };
      this.client = null;
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * 停止钉钉网关
   */
  async stop(): Promise<void> {
    if (!this.client) {
      this.log('[钉钉网关] 未运行');
      return;
    }

    this.log('[钉钉网关] 停止中...');
    this.isStopping = true;

    try {
      // 先停止健康检查
      this.stopHealthCheck();

      // 在清除客户端引用之前先断开连接
      const client = this.client;
      this.client = null;
      this.config = null;
      // 保留 savedConfig 用于重连

      // 尝试断开客户端连接
      if (client && typeof client.disconnect === 'function') {
        try {
          await client.disconnect();
        } catch (e) {
          // 忽略断开连接错误
        }
      }

      this.status = {
        connected: false,
        startedAt: null,
        lastError: null,
        lastInboundAt: null,
        lastOutboundAt: null,
      };
      this.log('[钉钉网关] 已停止');
      this.emit('disconnected');
    } catch (error: any) {
      console.error(`[钉钉网关] 停止时出错: ${error.message}`);
      this.status.lastError = error.message;
    } finally {
      this.isStopping = false;
    }
  }

  /**
   * 获取钉钉访问令牌（带缓存）
   */
  private async getAccessToken(): Promise<string> {
    const config = this.config || this.savedConfig;
    if (!config) {
      throw new Error('钉钉配置未设置');
    }

    const now = Date.now();
    if (accessToken && accessTokenExpiry > now + 60000) {
      this.log('[钉钉网关] 使用缓存的 AccessToken');
      return accessToken;
    }

    this.log('[钉钉网关] 获取新的 AccessToken...');
    const response = await axios.post<{ accessToken: string; expireIn: number }>(
      `${DINGTALK_API}/v1.0/oauth2/accessToken`,
      {
        appKey: config.clientId,
        appSecret: config.clientSecret,
      }
    );

    accessToken = response.data.accessToken;
    accessTokenExpiry = now + response.data.expireIn * 1000;
    this.log(`[钉钉网关] AccessToken 获取成功, 过期时间: ${new Date(accessTokenExpiry).toLocaleString()}`);
    return accessToken;
  }

  /**
   * 从钉钉入站消息中提取消息内容
   */
  private extractMessageContent(data: DingTalkInboundMessage): MessageContent {
    const msgtype = data.msgtype || 'text';

    if (msgtype === 'text') {
      return { text: data.text?.content?.trim() || '', messageType: 'text' };
    }

    if (msgtype === 'richText') {
      const richTextParts = data.content?.richText || [];
      let text = '';
      for (const part of richTextParts) {
        if (part.text) text += part.text;
      }
      return { text: text.trim() || '[富文本消息]', messageType: 'richText' };
    }

    if (msgtype === 'audio') {
      return {
        text: data.content?.recognition || '[语音消息]',
        mediaPath: data.content?.downloadCode,
        mediaType: 'audio',
        messageType: 'audio',
      };
    }

    return { text: data.text?.content?.trim() || `[${msgtype}消息]`, messageType: msgtype };
  }

  /**
   * 通过会话 Webhook 发送消息
   */
  private async sendBySession(
    sessionWebhook: string,
    text: string,
    options: { atUserId?: string | null } = {}
  ): Promise<void> {
    const token = await this.getAccessToken();

    // 检测 Markdown
    const hasMarkdown = /^[#*>-]|[*_`#[\]]/.test(text) || text.includes('\n');
    const useMarkdown = hasMarkdown;

    let body: any;
    if (useMarkdown) {
      const title = text.split('\n')[0].replace(/^[#*\s\->]+/, '').slice(0, 20) || 'LobsterAI';
      let finalText = text;
      if (options.atUserId) finalText = `${finalText} @${options.atUserId}`;
      body = { msgtype: 'markdown', markdown: { title, text: finalText } };
    } else {
      body = { msgtype: 'text', text: { content: text } };
    }

    if (options.atUserId) {
      body.at = { atUserIds: [options.atUserId], isAtAll: false };
    }

    this.log(`[钉钉] 发送文本消息:`, JSON.stringify({
      sessionWebhook: sessionWebhook.slice(0, 50) + '...',
      msgType: useMarkdown ? 'markdown' : 'text',
      textLength: text.length,
      text,
    }, null, 2));

    await axios({
      url: sessionWebhook,
      method: 'POST',
      data: createUtf8JsonBody(body),
      headers: { 'x-acs-dingtalk-access-token': token, 'Content-Type': JSON_UTF8_CONTENT_TYPE },
    });
  }

  /**
   * 通过新版 API 发送媒体消息（非会话 Webhook）
   * 单聊: /v1.0/robot/oToMessages/batchSend
   * 群聊: /v1.0/robot/groupMessages/send
   */
  private async sendMediaViaNewApi(
    mediaMessage: DingTalkMediaMessage,
    options: {
      conversationType: '1' | '2'; // 1: 单聊, 2: 群聊
      userId?: string;
      openConversationId?: string;
    }
  ): Promise<void> {
    const token = await this.getAccessToken();
    const robotCode = this.config?.robotCode || this.config?.clientId;

    // msgParam 需要是 JSON 字符串
    const msgKey = mediaMessage.msgKey;
    let msgParam: string;

    if ('sampleAudio' in mediaMessage) {
      msgParam = stringifyAsciiJson(mediaMessage.sampleAudio);
    } else if ('sampleImageMsg' in mediaMessage) {
      msgParam = stringifyAsciiJson(mediaMessage.sampleImageMsg);
    } else if ('sampleVideo' in mediaMessage) {
      msgParam = stringifyAsciiJson(mediaMessage.sampleVideo);
    } else if ('sampleFile' in mediaMessage) {
      msgParam = stringifyAsciiJson(mediaMessage.sampleFile);
    } else {
      throw new Error('未知的媒体消息类型');
    }

    let url: string;
    let body: any;

    if (options.conversationType === '1') {
      // 单聊
      url = `${DINGTALK_API}/v1.0/robot/oToMessages/batchSend`;
      body = {
        robotCode,
        userIds: [options.userId],
        msgKey,
        msgParam,
      };
    } else {
      // 群聊
      url = `${DINGTALK_API}/v1.0/robot/groupMessages/send`;
      body = {
        robotCode,
        openConversationId: options.openConversationId,
        msgKey,
        msgParam,
      };
    }

    this.log(`[钉钉] 发送媒体消息:`, JSON.stringify({
      msgKey,
      msgParam,
      conversationType: options.conversationType,
    }, null, 2));

    const response = await axios({
      url,
      method: 'POST',
      data: createUtf8JsonBody(body),
      headers: { 'x-acs-dingtalk-access-token': token, 'Content-Type': JSON_UTF8_CONTENT_TYPE },
      timeout: 30000,
    });

    // 检查响应 (新版 API 错误格式可能不同)
    if (response.data?.code && response.data.code !== '0') {
      throw new Error(`钉钉API返回错误: ${response.data.message || response.data.code}`);
    }
  }

  /**
   * 发送支持媒体的消息 - 检测并上传文本中的媒体
   */
  private async sendWithMedia(
    sessionWebhook: string,
    text: string,
    options: {
      atUserId?: string | null;
      conversationType?: '1' | '2';
      userId?: string;
      openConversationId?: string;
    } = {}
  ): Promise<void> {
    // 解析媒体标记
    const markers = parseMediaMarkers(text);

    this.log(`[钉钉网关] 解析媒体标记:`, JSON.stringify({
      textLength: text.length,
      markersCount: markers.length,
      markers: markers.map(m => ({ type: m.type, path: m.path, name: m.name })),
    }));

    if (markers.length === 0) {
      // 无媒体，直接发送文本
      await this.sendBySession(sessionWebhook, text, options);
      return;
    }

    // 获取 oapi token（用于媒体上传，与新版 API token 不同）
    if (!this.config) {
      throw new Error('钉钉配置未设置');
    }
    const oapiToken = await getOapiAccessToken(this.config.clientId, this.config.clientSecret);

    const uploadedMarkers: MediaMarker[] = [];

    // 逐个上传媒体文件
    for (const marker of markers) {
      const mediaType = marker.type === 'audio' ? 'voice' : detectMediaType(marker.path);
      this.log(`[钉钉网关] 上传媒体文件:`, JSON.stringify({
        path: marker.path,
        name: marker.name,
        type: marker.type,
        mediaType,
      }));
      // 传递从 markdown 解析出的文件名
      const result = await uploadMediaToDingTalk(oapiToken, marker.path, mediaType, marker.name);

      if (!result.success || !result.mediaId) {
        console.warn(`[钉钉网关] 媒体上传失败: ${result.error}`);
        continue;
      }

      this.log(`[钉钉网关] 媒体上传成功:`, JSON.stringify({
        mediaId: result.mediaId,
        path: marker.path,
      }));

      // 发送媒体消息
      try {
        const mediaMsg = this.buildMediaMessage(mediaType, result.mediaId, marker.name);

        // 使用新版 API 发送媒体消息
        if (options.conversationType && (options.userId || options.openConversationId)) {
          await this.sendMediaViaNewApi(mediaMsg, {
            conversationType: options.conversationType,
            userId: options.userId,
            openConversationId: options.openConversationId,
          });
        } else {
          console.warn(`[钉钉网关] 缺少会话信息，无法发送媒体`);
          continue;
        }

        uploadedMarkers.push(marker);
      } catch (error: any) {
        console.error(`[钉钉网关] 发送媒体失败: ${error.message}`);
      }
    }

    // 发送完整的原始文本（保留 markdown 格式，不移除媒体标记）
    await this.sendBySession(sessionWebhook, text, options);
  }

  /**
   * 构建会话 Webhook 的媒体消息负载
   * 会话 Webhook 使用 msgKey + msgParam 格式
   */
  private buildMediaMessage(mediaType: string, mediaId: string, fileName?: string): DingTalkMediaMessage {
    switch (mediaType) {
      case 'image':
        return { msgKey: 'sampleImageMsg', sampleImageMsg: { photoURL: mediaId } };
      case 'voice':
        return { msgKey: 'sampleAudio', sampleAudio: { mediaId, duration: '60000' } };
      case 'video':
        return { msgKey: 'sampleVideo', sampleVideo: { mediaId, videoType: 'mp4', duration: '60000' } };
      default:
        // 文件类型支持自定义文件名
        return { msgKey: 'sampleFile', sampleFile: { mediaId, fileName } };
    }
  }

  /**
   * 处理钉钉入站消息
   */
  private async handleInboundMessage(data: DingTalkInboundMessage): Promise<void> {
    // 忽略自己的消息
    if (data.senderId === data.chatbotUserId || data.senderStaffId === data.chatbotUserId) {
      return;
    }

    const content = this.extractMessageContent(data);
    if (!content.text) {
      return;
    }

    const isDirect = data.conversationType === '1';
    const senderId = data.senderStaffId || data.senderId;
    const senderName = data.senderNick || 'User';

    // 打印完整的输入消息日志
    this.log(`[钉钉] 收到消息:`, JSON.stringify({
      sender: senderName,
      senderId,
      conversationId: data.conversationId,
      chatType: isDirect ? 'direct' : 'group',
      msgType: content.messageType,
      content: content.text,
      mediaPath: content.mediaPath,
      mediaType: content.mediaType,
    }, null, 2));

    // 创建 IMMessage
    const message: IMMessage = {
      platform: 'dingtalk',
      messageId: data.msgId,
      conversationId: data.conversationId,
      senderId: senderId,
      senderName: senderName,
      content: content.text,
      chatType: isDirect ? 'direct' : 'group',
      timestamp: data.createAt || Date.now(),
    };
    this.status.lastInboundAt = Date.now();

    // 创建带日志的回复函数
    const replyFn = async (text: string) => {
      // 打印完整的输出消息日志
      this.log(`[钉钉] 发送回复:`, JSON.stringify({
        conversationId: data.conversationId,
        replyLength: text.length,
        reply: text,
      }, null, 2));

      await this.sendWithMedia(data.sessionWebhook, text, {
        atUserId: !isDirect ? senderId : null,
        conversationType: data.conversationType,
        userId: senderId,
        openConversationId: data.conversationId,
      });
      this.status.lastOutboundAt = Date.now();
    };

    // 存储最后的会话用于通知
    this.lastConversation = {
      conversationType: data.conversationType as '1' | '2',
      userId: senderId,
      openConversationId: data.conversationId,
      sessionWebhook: data.sessionWebhook,
    };

    // 发送消息事件
    this.emit('message', message);

    // 如果设置了消息回调则调用
    if (this.onMessageCallback) {
      try {
        await this.onMessageCallback(message, replyFn);
      } catch (error: any) {
        console.error(`[钉钉网关] 消息回调出错: ${error.message}`);
        await replyFn(`❌ 处理消息时出错: ${error.message}`);
      }
    }
  }

  /**
   * 向最后已知的会话发送通知消息
   */
  async sendNotification(text: string): Promise<void> {
    if (!this.lastConversation) {
      throw new Error('没有可用的会话用于通知');
    }
    await this.sendBySession(this.lastConversation.sessionWebhook, text);
    this.status.lastOutboundAt = Date.now();
  }
}
