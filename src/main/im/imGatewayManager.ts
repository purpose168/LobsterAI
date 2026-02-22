/**
 * IM 网关管理器
 * 钉钉、飞书、Telegram 和 Discord 网关的统一管理器
 */

import { EventEmitter } from 'events';
import axios from 'axios';
import { DingTalkGateway } from './dingtalkGateway';
import { FeishuGateway } from './feishuGateway';
import { TelegramGateway } from './telegramGateway';
import { DiscordGateway } from './discordGateway';
import { IMChatHandler } from './imChatHandler';
import { IMCoworkHandler } from './imCoworkHandler';
import { IMStore } from './imStore';
import { getOapiAccessToken } from './dingtalkMedia';
import {
  IMGatewayConfig,
  IMGatewayStatus,
  IMPlatform,
  IMMessage,
  IMConnectivityCheck,
  IMConnectivityTestResult,
  IMConnectivityVerdict,
} from './types';
import type { Database } from 'sql.js';
import type { CoworkRunner } from '../libs/coworkRunner';
import type { CoworkStore } from '../coworkStore';

// 连通性测试超时时间（毫秒）
const CONNECTIVITY_TIMEOUT_MS = 10_000;
// 入站活动警告阈值（毫秒）- 2分钟后开始检查入站消息
const INBOUND_ACTIVITY_WARN_AFTER_MS = 2 * 60 * 1000;

/**
 * IM 网关管理器选项接口
 */
export interface IMGatewayManagerOptions {
  /** Cowork 协作运行器实例 */
  coworkRunner?: CoworkRunner;
  /** Cowork 协作存储实例 */
  coworkStore?: CoworkStore;
}

export class IMGatewayManager extends EventEmitter {
  /** 钉钉网关实例 */
  private dingtalkGateway: DingTalkGateway;
  /** 飞书网关实例 */
  private feishuGateway: FeishuGateway;
  /** Telegram 网关实例 */
  private telegramGateway: TelegramGateway;
  /** Discord 网关实例 */
  private discordGateway: DiscordGateway;
  /** IM 存储实例 */
  private imStore: IMStore;
  /** 聊天处理器实例 */
  private chatHandler: IMChatHandler | null = null;
  /** Cowork 协作处理器实例 */
  private coworkHandler: IMCoworkHandler | null = null;
  /** 获取 LLM 配置的函数 */
  private getLLMConfig: (() => Promise<any>) | null = null;
  /** 获取技能提示的函数 */
  private getSkillsPrompt: (() => Promise<string | null>) | null = null;

  // Cowork 协作依赖项
  /** Cowork 协作运行器实例 */
  private coworkRunner: CoworkRunner | null = null;
  /** Cowork 协作存储实例 */
  private coworkStore: CoworkStore | null = null;

  constructor(db: Database, saveDb: () => void, options?: IMGatewayManagerOptions) {
    super();

    this.imStore = new IMStore(db, saveDb);
    this.dingtalkGateway = new DingTalkGateway();
    this.feishuGateway = new FeishuGateway();
    this.telegramGateway = new TelegramGateway();
    this.discordGateway = new DiscordGateway();

    // 如果提供了 Cowork 协作依赖项，则存储它们
    if (options?.coworkRunner && options?.coworkStore) {
      this.coworkRunner = options.coworkRunner;
      this.coworkStore = options.coworkStore;
    }

    // 转发网关事件
    this.setupGatewayEventForwarding();
  }

  /**
   * 设置网关事件转发
   */
  private setupGatewayEventForwarding(): void {
    // 钉钉事件
    this.dingtalkGateway.on('connected', () => {
      this.emit('statusChange', this.getStatus());
    });
    this.dingtalkGateway.on('disconnected', () => {
      this.emit('statusChange', this.getStatus());
    });
    this.dingtalkGateway.on('error', (error) => {
      this.emit('error', { platform: 'dingtalk', error });
      this.emit('statusChange', this.getStatus());
    });
    this.dingtalkGateway.on('message', (message: IMMessage) => {
      this.emit('message', message);
    });

    // 飞书事件
    this.feishuGateway.on('connected', () => {
      this.emit('statusChange', this.getStatus());
    });
    this.feishuGateway.on('disconnected', () => {
      this.emit('statusChange', this.getStatus());
    });
    this.feishuGateway.on('error', (error) => {
      this.emit('error', { platform: 'feishu', error });
      this.emit('statusChange', this.getStatus());
    });
    this.feishuGateway.on('message', (message: IMMessage) => {
      this.emit('message', message);
    });

    // Telegram 事件
    this.telegramGateway.on('connected', () => {
      this.emit('statusChange', this.getStatus());
    });
    this.telegramGateway.on('disconnected', () => {
      this.emit('statusChange', this.getStatus());
    });
    this.telegramGateway.on('error', (error) => {
      this.emit('error', { platform: 'telegram', error });
      this.emit('statusChange', this.getStatus());
    });
    this.telegramGateway.on('message', (message: IMMessage) => {
      this.emit('message', message);
    });

    // Discord 事件
    this.discordGateway.on('status', () => {
      this.emit('statusChange', this.getStatus());
    });
    this.discordGateway.on('connected', () => {
      this.emit('statusChange', this.getStatus());
    });
    this.discordGateway.on('disconnected', () => {
      this.emit('statusChange', this.getStatus());
    });
    this.discordGateway.on('error', (error) => {
      this.emit('error', { platform: 'discord', error });
      this.emit('statusChange', this.getStatus());
    });
    this.discordGateway.on('message', (message: IMMessage) => {
      this.emit('message', message);
    });
  }

  /**
   * 重新连接所有已断开的网关
   * 通过 IPC 事件在网络恢复时调用
   */
  reconnectAllDisconnected(): void {
    console.log('[IMGatewayManager] 正在重新连接所有已断开的网关...');

    if (this.dingtalkGateway && !this.dingtalkGateway.isConnected()) {
      console.log('[IMGatewayManager] 正在重新连接钉钉...');
      this.dingtalkGateway.reconnectIfNeeded();
    }

    if (this.feishuGateway && !this.feishuGateway.isConnected()) {
      console.log('[IMGatewayManager] 正在重新连接飞书...');
      this.feishuGateway.reconnectIfNeeded();
    }

    if (this.telegramGateway && !this.telegramGateway.isConnected()) {
      console.log('[IMGatewayManager] 正在重新连接 Telegram...');
      this.telegramGateway.reconnectIfNeeded();
    }

    if (this.discordGateway && !this.discordGateway.isConnected()) {
      console.log('[IMGatewayManager] 正在重新连接 Discord...');
      this.discordGateway.reconnectIfNeeded();
    }
  }

  /**
   * 使用 LLM 和技能提供程序初始化管理器
   * @param options - 初始化选项
   * @param options.getLLMConfig - 获取 LLM 配置的函数
   * @param options.getSkillsPrompt - 获取技能提示的函数（可选）
   */
  initialize(options: {
    /** 获取 LLM 配置的函数 */
    getLLMConfig: () => Promise<any>;
    /** 获取技能提示的函数（可选） */
    getSkillsPrompt?: () => Promise<string | null>;
  }): void {
    this.getLLMConfig = options.getLLMConfig;
    this.getSkillsPrompt = options.getSkillsPrompt ?? null;

    // 为网关设置消息处理器
    this.setupMessageHandlers();
  }

  /**
   * 为两个网关设置消息处理器
   */
  private setupMessageHandlers(): void {
    const messageHandler = async (
      message: IMMessage,
      replyFn: (text: string) => Promise<void>
    ): Promise<void> => {
      try {
        let response: string;

        // 如果处理器可用，始终使用 Cowork 协作模式
        if (this.coworkHandler) {
          console.log('[IMGatewayManager] 使用 Cowork 协作模式处理消息');
          response = await this.coworkHandler.processMessage(message);
        } else {
          // 回退到常规聊天处理器
          if (!this.chatHandler) {
            this.updateChatHandler();
          }

          if (!this.chatHandler) {
            throw new Error('聊天处理器不可用');
          }

          response = await this.chatHandler.processMessage(message);
        }

        await replyFn(response);
      } catch (error: any) {
        console.error(`[IMGatewayManager] 处理消息时出错: ${error.message}`);
        // 向用户发送错误消息
        try {
          await replyFn(`处理消息时出错: ${error.message}`);
        } catch (replyError) {
          console.error(`[IMGatewayManager] 发送错误回复失败: ${replyError}`);
        }
      }
    };

    this.dingtalkGateway.setMessageCallback(messageHandler);
    this.feishuGateway.setMessageCallback(messageHandler);
    this.telegramGateway.setMessageCallback(messageHandler);
    this.discordGateway.setMessageCallback(messageHandler);
  }

  /**
   * 使用当前设置更新聊天处理器
   */
  private updateChatHandler(): void {
    if (!this.getLLMConfig) {
      console.warn('[IMGatewayManager] LLM 配置提供程序未设置');
      return;
    }

    const imSettings = this.imStore.getIMSettings();

    this.chatHandler = new IMChatHandler({
      getLLMConfig: this.getLLMConfig,
      getSkillsPrompt: this.getSkillsPrompt || undefined,
      imSettings,
    });

    // 如果依赖项可用，更新或创建 Cowork 协作处理器
    this.updateCoworkHandler();
  }

  /**
   * 更新或创建 Cowork 协作处理器
   * 如果依赖项可用，始终创建处理器（IM 的 Cowork 协作模式始终启用）
   */
  private updateCoworkHandler(): void {
    // 如果拥有所需依赖项，始终创建 Cowork 协作处理器
    if (this.coworkRunner && this.coworkStore && !this.coworkHandler) {
      this.coworkHandler = new IMCoworkHandler({
        coworkRunner: this.coworkRunner,
        coworkStore: this.coworkStore,
        imStore: this.imStore,
        getSkillsPrompt: this.getSkillsPrompt || undefined,
      });
      console.log('[IMGatewayManager] Cowork 协作处理器已创建');
    }
  }

  // ==================== 配置 ====================

  /**
   * 获取当前配置
   */
  getConfig(): IMGatewayConfig {
    return this.imStore.getConfig();
  }

  /**
   * 更新配置
   */
  setConfig(config: Partial<IMGatewayConfig>): void {
    this.imStore.setConfig(config);

    // 如果设置发生变化，更新聊天处理器
    if (config.settings) {
      this.updateChatHandler();
    }
  }

  // ==================== 状态 ====================

  /**
   * 获取所有网关的当前状态
   */
  getStatus(): IMGatewayStatus {
    return {
      dingtalk: this.dingtalkGateway.getStatus(),
      feishu: this.feishuGateway.getStatus(),
      telegram: this.telegramGateway.getStatus(),
      discord: this.discordGateway.getStatus(),
    };
  }

  /**
   * 测试平台连通性和对话就绪状态。
   */
  async testGateway(
    platform: IMPlatform,
    configOverride?: Partial<IMGatewayConfig>
  ): Promise<IMConnectivityTestResult> {
    const config = this.buildMergedConfig(configOverride);
    const checks: IMConnectivityCheck[] = [];
    const testedAt = Date.now();

    const addCheck = (check: IMConnectivityCheck) => {
      checks.push(check);
    };

    const missingCredentials = this.getMissingCredentials(platform, config);
    if (missingCredentials.length > 0) {
      addCheck({
        code: 'missing_credentials',
        level: 'fail',
        message: `缺少必要配置项: ${missingCredentials.join(', ')}`,
        suggestion: '请补全配置后重新测试连通性。',
      });

      return {
        platform,
        testedAt,
        verdict: 'fail',
        checks,
      };
    }

    try {
      const authMessage = await this.withTimeout(
        this.runAuthProbe(platform, config),
        CONNECTIVITY_TIMEOUT_MS,
        '鉴权探测超时'
      );
      addCheck({
        code: 'auth_check',
        level: 'pass',
        message: authMessage,
      });
    } catch (error: any) {
      addCheck({
        code: 'auth_check',
        level: 'fail',
        message: `鉴权失败: ${error.message}`,
        suggestion: '请检查 ID/Secret/Token 是否正确，且机器人权限已开通。',
      });
      return {
        platform,
        testedAt,
        verdict: 'fail',
        checks,
      };
    }

    const status = this.getStatus();
    const enabled = Boolean(config[platform]?.enabled);
    const connected = this.isConnected(platform);

    if (enabled && !connected) {
      const discordStarting = platform === 'discord' && status.discord.starting;
      addCheck({
        code: 'gateway_running',
        level: discordStarting ? 'info' : 'warn',
        message: discordStarting
          ? 'IM 渠道正在启动，请稍后重试。'
          : 'IM 渠道已启用但当前未连接。',
        suggestion: discordStarting
          ? '等待启动完成后重新测试。'
          : '请检查网络、机器人配置和平台侧事件开关。',
      });
    } else {
      addCheck({
        code: 'gateway_running',
        level: connected ? 'pass' : 'info',
        message: connected ? 'IM 渠道已启用且运行正常。' : 'IM 渠道当前未启用。',
        suggestion: connected ? undefined : '请点击对应 IM 渠道胶囊按钮启用该渠道。',
      });
    }

    const startedAt = this.getStartedAtMs(platform, status);
    const lastInboundAt = this.getLastInboundAt(platform, status);
    const lastOutboundAt = this.getLastOutboundAt(platform, status);

    if (connected && startedAt && testedAt - startedAt >= INBOUND_ACTIVITY_WARN_AFTER_MS) {
      if (!lastInboundAt) {
        addCheck({
          code: 'inbound_activity',
          level: 'warn',
          message: '已连接超过 2 分钟，但尚未收到任何入站消息。',
          suggestion: '请确认机器人已在目标会话中，或按平台规则 @机器人 触发消息。',
        });
      } else {
        addCheck({
          code: 'inbound_activity',
          level: 'pass',
          message: '已检测到入站消息。',
        });
      }
    } else if (connected) {
      addCheck({
        code: 'inbound_activity',
        level: 'info',
        message: '网关刚启动，入站活动检查将在 2 分钟后更准确。',
      });
    }

    if (connected && lastInboundAt) {
      if (!lastOutboundAt) {
        addCheck({
          code: 'outbound_activity',
          level: 'warn',
          message: '已收到消息，但尚未观察到成功回发。',
          suggestion: '请检查消息发送权限、机器人可见范围和会话回包权限。',
        });
      } else {
        addCheck({
          code: 'outbound_activity',
          level: 'pass',
          message: '已检测到成功回发消息。',
        });
      }
    } else if (connected) {
      addCheck({
        code: 'outbound_activity',
        level: 'info',
        message: '尚未收到可用于评估回发能力的入站消息。',
      });
    }

    const lastError = this.getLastError(platform, status);
    if (lastError) {
      addCheck({
        code: 'platform_last_error',
        level: connected ? 'warn' : 'fail',
        message: `最近错误: ${lastError}`,
        suggestion: connected
          ? '当前已连接，但建议修复该错误避免后续中断。'
          : '该错误可能阻断对话，请优先修复后重试。',
      });
    }

    if (platform === 'feishu') {
      addCheck({
        code: 'feishu_group_requires_mention',
        level: 'info',
        message: '飞书群聊中仅响应 @机器人的消息。',
        suggestion: '请在群聊中使用 @机器人 + 内容触发对话。',
      });
      addCheck({
        code: 'feishu_event_subscription_required',
        level: 'info',
        message: '飞书需要开启消息事件订阅（im.message.receive_v1）才能收消息。',
        suggestion: '请在飞书开发者后台确认事件订阅、权限和发布状态。',
      });
    } else if (platform === 'discord') {
      addCheck({
        code: 'discord_group_requires_mention',
        level: 'info',
        message: 'Discord 群聊中仅响应 @机器人的消息。',
        suggestion: '请在频道中使用 @机器人 + 内容触发对话。',
      });
    } else if (platform === 'telegram') {
      addCheck({
        code: 'telegram_privacy_mode_hint',
        level: 'info',
        message: 'Telegram 可能受 Bot Privacy Mode 影响。',
        suggestion: '若群聊中不响应，请在 @BotFather 检查 Privacy Mode 配置。',
      });
    } else if (platform === 'dingtalk') {
      addCheck({
        code: 'dingtalk_bot_membership_hint',
        level: 'info',
        message: '钉钉机器人需被加入目标会话并具备发言权限。',
        suggestion: '请确认机器人在目标会话中，且企业权限配置允许收发消息。',
      });
    }

    return {
      platform,
      testedAt,
      verdict: this.calculateVerdict(checks),
      checks,
    };
  }

  // ==================== 网关控制 ====================

  /**
   * 启动特定网关
   */
  async startGateway(platform: IMPlatform): Promise<void> {
    const config = this.getConfig();

    // 确保聊天处理器已就绪
    this.updateChatHandler();

    if (platform === 'dingtalk') {
      await this.dingtalkGateway.start(config.dingtalk);
    } else if (platform === 'feishu') {
      await this.feishuGateway.start(config.feishu);
    } else if (platform === 'telegram') {
      await this.telegramGateway.start(config.telegram);
    } else if (platform === 'discord') {
      await this.discordGateway.start(config.discord);
    }
  }

  /**
   * 停止特定网关
   */
  async stopGateway(platform: IMPlatform): Promise<void> {
    if (platform === 'dingtalk') {
      await this.dingtalkGateway.stop();
    } else if (platform === 'feishu') {
      await this.feishuGateway.stop();
    } else if (platform === 'telegram') {
      await this.telegramGateway.stop();
    } else if (platform === 'discord') {
      await this.discordGateway.stop();
    }
  }

  /**
   * 启动所有已启用的网关
   */
  async startAllEnabled(): Promise<void> {
    const config = this.getConfig();

    if (config.dingtalk.enabled && config.dingtalk.clientId && config.dingtalk.clientSecret) {
      try {
        await this.startGateway('dingtalk');
      } catch (error: any) {
        console.error(`[IMGatewayManager] 启动钉钉失败: ${error.message}`);
      }
    }

    if (config.feishu.enabled && config.feishu.appId && config.feishu.appSecret) {
      try {
        await this.startGateway('feishu');
      } catch (error: any) {
        console.error(`[IMGatewayManager] 启动飞书失败: ${error.message}`);
      }
    }

    if (config.telegram.enabled && config.telegram.botToken) {
      try {
        await this.startGateway('telegram');
      } catch (error: any) {
        console.error(`[IMGatewayManager] 启动 Telegram 失败: ${error.message}`);
      }
    }

    if (config.discord.enabled && config.discord.botToken) {
      try {
        await this.startGateway('discord');
      } catch (error: any) {
        console.error(`[IMGatewayManager] 启动 Discord 失败: ${error.message}`);
      }
    }
  }

  /**
   * 停止所有网关
   */
  async stopAll(): Promise<void> {
    await Promise.all([
      this.dingtalkGateway.stop(),
      this.feishuGateway.stop(),
      this.telegramGateway.stop(),
      this.discordGateway.stop(),
    ]);
  }

  /**
   * 检查是否有任何网关已连接
   */
  isAnyConnected(): boolean {
    return this.dingtalkGateway.isConnected() || this.feishuGateway.isConnected() || this.telegramGateway.isConnected() || this.discordGateway.isConnected();
  }

  /**
   * 检查特定网关是否已连接
   */
  isConnected(platform: IMPlatform): boolean {
    if (platform === 'dingtalk') {
      return this.dingtalkGateway.isConnected();
    }
    if (platform === 'telegram') {
      return this.telegramGateway.isConnected();
    }
    if (platform === 'discord') {
      return this.discordGateway.isConnected();
    }
    return this.feishuGateway.isConnected();
  }

  /**
   * 通过特定平台发送通知消息。
   * 使用平台特定的广播机制。
   * 如果成功发送则返回 true，如果平台未连接则返回 false。
   */
  async sendNotification(platform: IMPlatform, text: string): Promise<boolean> {
    if (!this.isConnected(platform)) {
      console.warn(`[IMGatewayManager] 无法发送通知: ${platform} 未连接`);
      return false;
    }

    try {
      if (platform === 'dingtalk') {
        await this.dingtalkGateway.sendNotification(text);
      } else if (platform === 'feishu') {
        await this.feishuGateway.sendNotification(text);
      } else if (platform === 'telegram') {
        await this.telegramGateway.sendNotification(text);
      } else if (platform === 'discord') {
        await this.discordGateway.sendNotification(text);
      }
      return true;
    } catch (error: any) {
      console.error(`[IMGatewayManager] 通过 ${platform} 发送通知失败:`, error.message);
      return false;
    }
  }

  /**
   * 构建合并后的配置
   * @param configOverride - 配置覆盖项
   * @returns 合并后的完整配置
   */
  private buildMergedConfig(configOverride?: Partial<IMGatewayConfig>): IMGatewayConfig {
    const current = this.getConfig();
    if (!configOverride) {
      return current;
    }
    return {
      ...current,
      ...configOverride,
      dingtalk: { ...current.dingtalk, ...(configOverride.dingtalk || {}) },
      feishu: { ...current.feishu, ...(configOverride.feishu || {}) },
      telegram: { ...current.telegram, ...(configOverride.telegram || {}) },
      discord: { ...current.discord, ...(configOverride.discord || {}) },
      settings: { ...current.settings, ...(configOverride.settings || {}) },
    };
  }

  /**
   * 获取缺失的凭证字段
   * @param platform - IM 平台
   * @param config - 网关配置
   * @returns 缺失的凭证字段名称数组
   */
  private getMissingCredentials(platform: IMPlatform, config: IMGatewayConfig): string[] {
    if (platform === 'dingtalk') {
      const fields: string[] = [];
      if (!config.dingtalk.clientId) fields.push('clientId');
      if (!config.dingtalk.clientSecret) fields.push('clientSecret');
      return fields;
    }
    if (platform === 'feishu') {
      const fields: string[] = [];
      if (!config.feishu.appId) fields.push('appId');
      if (!config.feishu.appSecret) fields.push('appSecret');
      return fields;
    }
    if (platform === 'telegram') {
      return config.telegram.botToken ? [] : ['botToken'];
    }
    return config.discord.botToken ? [] : ['botToken'];
  }

  /**
   * 运行鉴权探测
   * @param platform - IM 平台
   * @param config - 网关配置
   * @returns 鉴权成功的消息
   */
  private async runAuthProbe(platform: IMPlatform, config: IMGatewayConfig): Promise<string> {
    if (platform === 'dingtalk') {
      await getOapiAccessToken(config.dingtalk.clientId, config.dingtalk.clientSecret);
      return '钉钉鉴权通过。';
    }

    if (platform === 'feishu') {
      const Lark = await import('@larksuiteoapi/node-sdk');
      const domain = this.resolveFeishuDomain(config.feishu.domain, Lark);
      const client = new Lark.Client({
        appId: config.feishu.appId,
        appSecret: config.feishu.appSecret,
        appType: Lark.AppType.SelfBuild,
        domain,
      });
      const response: any = await client.request({
        method: 'GET',
        url: '/open-apis/bot/v3/info',
      });
      if (response.code !== 0) {
        throw new Error(response.msg || `code ${response.code}`);
      }
      const botName = response.data?.app_name ?? response.data?.bot?.app_name ?? 'unknown';
      return `飞书鉴权通过（Bot: ${botName}）。`;
    }

    if (platform === 'telegram') {
      const response = await axios.get(
        `https://api.telegram.org/bot${config.telegram.botToken}/getMe`,
        { timeout: CONNECTIVITY_TIMEOUT_MS }
      );
      if (!response.data?.ok) {
        const description = response.data?.description || 'unknown error';
        throw new Error(description);
      }
      const username = response.data?.result?.username ? `@${response.data.result.username}` : 'unknown';
      return `Telegram 鉴权通过（Bot: ${username}）。`;
    }

    const response = await axios.get('https://discord.com/api/v10/users/@me', {
      timeout: CONNECTIVITY_TIMEOUT_MS,
      headers: {
        Authorization: `Bot ${config.discord.botToken}`,
      },
    });
    const username = response.data?.username ? `${response.data.username}#${response.data.discriminator || '0000'}` : 'unknown';
    return `Discord 鉴权通过（Bot: ${username}）。`;
  }

  /**
   * 解析飞书域名
   * @param domain - 域名配置
   * @param Lark - Lark SDK 实例
   * @returns 解析后的域名
   */
  private resolveFeishuDomain(domain: string, Lark: any): any {
    if (domain === 'lark') return Lark.Domain.Lark;
    if (domain === 'feishu') return Lark.Domain.Feishu;
    return domain.replace(/\/+$/, '');
  }

  /**
   * 为 Promise 添加超时限制
   * @param promise - 要执行的 Promise
   * @param timeoutMs - 超时时间（毫秒）
   * @param timeoutError - 超时错误消息
   * @returns 带超时限制的 Promise
   */
  private withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutError: string): Promise<T> {
    let timeoutId: NodeJS.Timeout | null = null;
    const timeoutPromise = new Promise<T>((_resolve, reject) => {
      timeoutId = setTimeout(() => reject(new Error(timeoutError)), timeoutMs);
    });
    return Promise.race([promise, timeoutPromise]).finally(() => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    });
  }

  /**
   * 获取网关启动时间（毫秒）
   * @param platform - IM 平台
   * @param status - 网关状态
   * @returns 启动时间戳（毫秒），如果未启动则返回 null
   */
  private getStartedAtMs(platform: IMPlatform, status: IMGatewayStatus): number | null {
    if (platform === 'feishu') {
      return status.feishu.startedAt ? Date.parse(status.feishu.startedAt) : null;
    }
    if (platform === 'dingtalk') return status.dingtalk.startedAt;
    if (platform === 'telegram') return status.telegram.startedAt;
    return status.discord.startedAt;
  }

  /**
   * 获取最后入站消息时间
   * @param platform - IM 平台
   * @param status - 网关状态
   * @returns 最后入站消息时间戳（毫秒），如果没有则返回 null
   */
  private getLastInboundAt(platform: IMPlatform, status: IMGatewayStatus): number | null {
    if (platform === 'dingtalk') return status.dingtalk.lastInboundAt;
    if (platform === 'feishu') return status.feishu.lastInboundAt;
    if (platform === 'telegram') return status.telegram.lastInboundAt;
    return status.discord.lastInboundAt;
  }

  /**
   * 获取最后出站消息时间
   * @param platform - IM 平台
   * @param status - 网关状态
   * @returns 最后出站消息时间戳（毫秒），如果没有则返回 null
   */
  private getLastOutboundAt(platform: IMPlatform, status: IMGatewayStatus): number | null {
    if (platform === 'dingtalk') return status.dingtalk.lastOutboundAt;
    if (platform === 'feishu') return status.feishu.lastOutboundAt;
    if (platform === 'telegram') return status.telegram.lastOutboundAt;
    return status.discord.lastOutboundAt;
  }

  /**
   * 获取最后的错误信息
   * @param platform - IM 平台
   * @param status - 网关状态
   * @returns 最后的错误信息，如果没有则返回 null
   */
  private getLastError(platform: IMPlatform, status: IMGatewayStatus): string | null {
    if (platform === 'dingtalk') return status.dingtalk.lastError;
    if (platform === 'feishu') return status.feishu.error;
    if (platform === 'telegram') return status.telegram.lastError;
    return status.discord.lastError;
  }

  /**
   * 计算连通性测试结果判定
   * @param checks - 连通性检查项列表
   * @returns 判定结果：'fail'（失败）、'warn'（警告）或 'pass'（通过）
   */
  private calculateVerdict(checks: IMConnectivityCheck[]): IMConnectivityVerdict {
    if (checks.some((check) => check.level === 'fail')) {
      return 'fail';
    }
    if (checks.some((check) => check.level === 'warn')) {
      return 'warn';
    }
    return 'pass';
  }
}
