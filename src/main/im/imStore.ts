/**
 * IM 网关存储
 * 用于 IM 配置存储的 SQLite 操作
 */

import { Database } from 'sql.js';
import {
  IMGatewayConfig,
  DingTalkConfig,
  FeishuConfig,
  TelegramConfig,
  DiscordConfig,
  IMSettings,
  IMPlatform,
  IMSessionMapping,
  DEFAULT_DINGTALK_CONFIG,
  DEFAULT_FEISHU_CONFIG,
  DEFAULT_TELEGRAM_CONFIG,
  DEFAULT_DISCORD_CONFIG,
  DEFAULT_IM_SETTINGS,
} from './types';

export class IMStore {
  private db: Database;
  private saveDb: () => void;

  constructor(db: Database, saveDb: () => void) {
    this.db = db;
    this.saveDb = saveDb;
    this.initializeTables();
    this.migrateDefaults();
  }

  private initializeTables() {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS im_config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);

    // Cowork 模式的 IM 会话映射表
    this.db.run(`
      CREATE TABLE IF NOT EXISTS im_session_mappings (
        im_conversation_id TEXT NOT NULL,
        platform TEXT NOT NULL,
        cowork_session_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        last_active_at INTEGER NOT NULL,
        PRIMARY KEY (im_conversation_id, platform)
      );
    `);

    this.saveDb();
  }

  /**
   * 迁移现有的 IM 配置以确保稳定的默认值。
   */
  private migrateDefaults(): void {
    const platforms = ['dingtalk', 'feishu', 'telegram', 'discord'] as const;
    let changed = false;

    for (const platform of platforms) {
      const result = this.db.exec('SELECT value FROM im_config WHERE key = ?', [platform]);
      if (!result[0]?.values[0]) continue;

      try {
        const config = JSON.parse(result[0].values[0][0] as string);
        if (config.debug === undefined || config.debug === false) {
          config.debug = true;
          const now = Date.now();
          this.db.run(
            'UPDATE im_config SET value = ?, updated_at = ? WHERE key = ?',
            [JSON.stringify(config), now, platform]
          );
          changed = true;
        }
      } catch {
        // 忽略解析错误
      }
    }

    const settingsResult = this.db.exec('SELECT value FROM im_config WHERE key = ?', ['settings']);
    if (settingsResult[0]?.values[0]) {
      try {
        const settings = JSON.parse(settingsResult[0].values[0][0] as string) as Partial<IMSettings>;
        // 保持 IM 和桌面端行为一致：技能自动路由默认应开启。
        // 历史渲染器默认值可能会意外保留 `skillsEnabled: false`。
        if (settings.skillsEnabled !== true) {
          settings.skillsEnabled = true;
          const now = Date.now();
          this.db.run(
            'UPDATE im_config SET value = ?, updated_at = ? WHERE key = ?',
            [JSON.stringify(settings), now, 'settings']
          );
          changed = true;
        }
      } catch {
        // 忽略解析错误
      }
    }

    if (changed) {
      this.saveDb();
    }
  }

  // ==================== 通用配置操作 ====================

  private getConfigValue<T>(key: string): T | undefined {
    const result = this.db.exec('SELECT value FROM im_config WHERE key = ?', [key]);
    if (!result[0]?.values[0]) return undefined;
    const value = result[0].values[0][0] as string;
    try {
      return JSON.parse(value) as T;
    } catch (error) {
      console.warn(`解析 ${key} 的 im_config 值失败`, error);
      return undefined;
    }
  }

  private setConfigValue<T>(key: string, value: T): void {
    const now = Date.now();
    this.db.run(`
      INSERT INTO im_config (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `, [key, JSON.stringify(value), now]);
    this.saveDb();
  }

  // ==================== 完整配置操作 ====================

  getConfig(): IMGatewayConfig {
    const dingtalk = this.getConfigValue<DingTalkConfig>('dingtalk') ?? DEFAULT_DINGTALK_CONFIG;
    const feishu = this.getConfigValue<FeishuConfig>('feishu') ?? DEFAULT_FEISHU_CONFIG;
    const telegram = this.getConfigValue<TelegramConfig>('telegram') ?? DEFAULT_TELEGRAM_CONFIG;
    const discord = this.getConfigValue<DiscordConfig>('discord') ?? DEFAULT_DISCORD_CONFIG;
    const settings = this.getConfigValue<IMSettings>('settings') ?? DEFAULT_IM_SETTINGS;

    // 解析 enabled 字段：为安全起见默认为 false
    // 用户必须通过设置 enabled: true 显式启用服务
    const resolveEnabled = <T extends { enabled?: boolean }>(stored: T, defaults: T): T => {
      const merged = { ...defaults, ...stored };
      // 如果未显式设置 enabled，则默认为 false（更安全的行为）
      if (stored.enabled === undefined) {
        return { ...merged, enabled: false };
      }
      return merged;
    };

    return {
      dingtalk: resolveEnabled(dingtalk, DEFAULT_DINGTALK_CONFIG),
      feishu: resolveEnabled(feishu, DEFAULT_FEISHU_CONFIG),
      telegram: resolveEnabled(telegram, DEFAULT_TELEGRAM_CONFIG),
      discord: resolveEnabled(discord, DEFAULT_DISCORD_CONFIG),
      settings: { ...DEFAULT_IM_SETTINGS, ...settings },
    };
  }

  setConfig(config: Partial<IMGatewayConfig>): void {
    if (config.dingtalk) {
      this.setDingTalkConfig(config.dingtalk);
    }
    if (config.feishu) {
      this.setFeishuConfig(config.feishu);
    }
    if (config.telegram) {
      this.setTelegramConfig(config.telegram);
    }
    if (config.discord) {
      this.setDiscordConfig(config.discord);
    }
    if (config.settings) {
      this.setIMSettings(config.settings);
    }
  }

  // ==================== 钉钉配置 ====================

  getDingTalkConfig(): DingTalkConfig {
    const stored = this.getConfigValue<DingTalkConfig>('dingtalk');
    return { ...DEFAULT_DINGTALK_CONFIG, ...stored };
  }

  setDingTalkConfig(config: Partial<DingTalkConfig>): void {
    const current = this.getDingTalkConfig();
    this.setConfigValue('dingtalk', { ...current, ...config });
  }

  // ==================== 飞书配置 ====================

  getFeishuConfig(): FeishuConfig {
    const stored = this.getConfigValue<FeishuConfig>('feishu');
    return { ...DEFAULT_FEISHU_CONFIG, ...stored };
  }

  setFeishuConfig(config: Partial<FeishuConfig>): void {
    const current = this.getFeishuConfig();
    this.setConfigValue('feishu', { ...current, ...config });
  }

  // ==================== Telegram 配置 ====================

  getTelegramConfig(): TelegramConfig {
    const stored = this.getConfigValue<TelegramConfig>('telegram');
    return { ...DEFAULT_TELEGRAM_CONFIG, ...stored };
  }

  setTelegramConfig(config: Partial<TelegramConfig>): void {
    const current = this.getTelegramConfig();
    this.setConfigValue('telegram', { ...current, ...config });
  }

  // ==================== Discord 配置 ====================

  getDiscordConfig(): DiscordConfig {
    const stored = this.getConfigValue<DiscordConfig>('discord');
    return { ...DEFAULT_DISCORD_CONFIG, ...stored };
  }

  setDiscordConfig(config: Partial<DiscordConfig>): void {
    const current = this.getDiscordConfig();
    this.setConfigValue('discord', { ...current, ...config });
  }

  // ==================== IM 设置 ====================

  getIMSettings(): IMSettings {
    const stored = this.getConfigValue<IMSettings>('settings');
    return { ...DEFAULT_IM_SETTINGS, ...stored };
  }

  setIMSettings(settings: Partial<IMSettings>): void {
    const current = this.getIMSettings();
    this.setConfigValue('settings', { ...current, ...settings });
  }

  // ==================== 工具方法 ====================

  /**
   * 清除所有 IM 配置
   */
  clearConfig(): void {
    this.db.run('DELETE FROM im_config');
    this.saveDb();
  }

  /**
   * 检查 IM 是否已配置（至少有一个平台配置了凭据）
   */
  isConfigured(): boolean {
    const config = this.getConfig();
    const hasDingTalk = !!(config.dingtalk.clientId && config.dingtalk.clientSecret);
    const hasFeishu = !!(config.feishu.appId && config.feishu.appSecret);
    const hasTelegram = !!config.telegram.botToken;
    const hasDiscord = !!config.discord.botToken;
    return hasDingTalk || hasFeishu || hasTelegram || hasDiscord;
  }

  // ==================== 会话映射操作 ====================

  /**
   * 根据 IM 会话 ID 和平台获取会话映射
   */
  getSessionMapping(imConversationId: string, platform: IMPlatform): IMSessionMapping | null {
    const result = this.db.exec(
      'SELECT im_conversation_id, platform, cowork_session_id, created_at, last_active_at FROM im_session_mappings WHERE im_conversation_id = ? AND platform = ?',
      [imConversationId, platform]
    );
    if (!result[0]?.values[0]) return null;
    const row = result[0].values[0];
    return {
      imConversationId: row[0] as string,
      platform: row[1] as IMPlatform,
      coworkSessionId: row[2] as string,
      createdAt: row[3] as number,
      lastActiveAt: row[4] as number,
    };
  }

  /**
   * 创建新的会话映射
   */
  createSessionMapping(imConversationId: string, platform: IMPlatform, coworkSessionId: string): IMSessionMapping {
    const now = Date.now();
    this.db.run(
      'INSERT INTO im_session_mappings (im_conversation_id, platform, cowork_session_id, created_at, last_active_at) VALUES (?, ?, ?, ?, ?)',
      [imConversationId, platform, coworkSessionId, now, now]
    );
    this.saveDb();
    return {
      imConversationId,
      platform,
      coworkSessionId,
      createdAt: now,
      lastActiveAt: now,
    };
  }

  /**
   * 更新会话映射的最后活跃时间
   */
  updateSessionLastActive(imConversationId: string, platform: IMPlatform): void {
    const now = Date.now();
    this.db.run(
      'UPDATE im_session_mappings SET last_active_at = ? WHERE im_conversation_id = ? AND platform = ?',
      [now, imConversationId, platform]
    );
    this.saveDb();
  }

  /**
   * 删除会话映射
   */
  deleteSessionMapping(imConversationId: string, platform: IMPlatform): void {
    this.db.run(
      'DELETE FROM im_session_mappings WHERE im_conversation_id = ? AND platform = ?',
      [imConversationId, platform]
    );
    this.saveDb();
  }

  /**
   * 列出指定平台的所有会话映射
   */
  listSessionMappings(platform?: IMPlatform): IMSessionMapping[] {
    const query = platform
      ? 'SELECT im_conversation_id, platform, cowork_session_id, created_at, last_active_at FROM im_session_mappings WHERE platform = ? ORDER BY last_active_at DESC'
      : 'SELECT im_conversation_id, platform, cowork_session_id, created_at, last_active_at FROM im_session_mappings ORDER BY last_active_at DESC';
    const params = platform ? [platform] : [];
    const result = this.db.exec(query, params);
    if (!result[0]?.values) return [];
    return result[0].values.map(row => ({
      imConversationId: row[0] as string,
      platform: row[1] as IMPlatform,
      coworkSessionId: row[2] as string,
      createdAt: row[3] as number,
      lastActiveAt: row[4] as number,
    }));
  }
}
