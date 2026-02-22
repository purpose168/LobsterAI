/**
 * IM 网关类型定义
 * 钉钉、飞书和 Telegram 即时通讯机器人集成的类型定义
 */

// ==================== 钉钉类型 ====================

export interface DingTalkConfig {
  enabled: boolean;              // 是否启用
  clientId: string;              // 客户端 ID
  clientSecret: string;          // 客户端密钥
  robotCode?: string;            // 机器人代码
  corpId?: string;               // 企业 ID
  agentId?: string;              // 应用 ID
  messageType: 'markdown' | 'card';  // 消息类型：markdown 或卡片
  cardTemplateId?: string;       // 卡片模板 ID
  debug?: boolean;               // 是否开启调试模式
}

export interface DingTalkGatewayStatus {
  connected: boolean;            // 是否已连接
  startedAt: number | null;      // 启动时间戳
  lastError: string | null;      // 最后一次错误信息
  lastInboundAt: number | null;  // 最后一次接收消息时间戳
  lastOutboundAt: number | null; // 最后一次发送消息时间戳
}

export interface DingTalkInboundMessage {
  msgId: string;                 // 消息 ID
  msgtype: 'text' | 'richText' | 'audio' | string;  // 消息类型
  createAt: number;              // 创建时间戳
  text?: { content: string };    // 文本内容
  content?: {
    downloadCode?: string;       // 下载码
    fileName?: string;           // 文件名
    recognition?: string;        // 语音识别文本
    richText?: Array<{ text?: string }>;  // 富文本内容
  };
  conversationType: '1' | '2';   // 会话类型：1-单聊，2-群聊
  conversationId: string;        // 会话 ID
  senderId: string;              // 发送者 ID
  senderStaffId?: string;        // 发送者员工 ID
  senderNick?: string;           // 发送者昵称
  chatbotUserId: string;         // 机器人用户 ID
  sessionWebhook: string;        // 会话 Webhook 地址
}

// ==================== 飞书类型 ====================

export interface FeishuConfig {
  enabled: boolean;              // 是否启用
  appId: string;                 // 应用 ID
  appSecret: string;             // 应用密钥
  domain: 'feishu' | 'lark' | string;  // 域名：飞书或 Lark
  encryptKey?: string;           // 加密密钥
  verificationToken?: string;    // 验证令牌
  renderMode: 'text' | 'card';   // 渲染模式：文本或卡片
  debug?: boolean;               // 是否开启调试模式
}

export interface FeishuGatewayStatus {
  connected: boolean;            // 是否已连接
  startedAt: string | null;      // 启动时间
  botOpenId: string | null;      // 机器人 OpenId
  error: string | null;          // 错误信息
  lastInboundAt: number | null;  // 最后一次接收消息时间戳
  lastOutboundAt: number | null; // 最后一次发送消息时间戳
}

export interface FeishuMessageContext {
  chatId: string;                // 聊天 ID
  messageId: string;             // 消息 ID
  senderId: string;              // 发送者 ID
  senderOpenId: string;          // 发送者 OpenId
  chatType: 'p2p' | 'group';     // 聊天类型：单聊或群聊
  mentionedBot: boolean;         // 是否提及机器人
  rootId?: string;               // 根消息 ID
  parentId?: string;             // 父消息 ID
  content: string;               // 消息内容
  contentType: string;           // 内容类型
}

// ==================== Telegram 类型 ====================

export interface TelegramConfig {
  enabled: boolean;              // 是否启用
  botToken: string;              // 机器人令牌
  debug?: boolean;               // 是否开启调试模式
}

export interface TelegramGatewayStatus {
  connected: boolean;            // 是否已连接
  startedAt: number | null;      // 启动时间戳
  lastError: string | null;      // 最后一次错误信息
  botUsername: string | null;    // 机器人用户名
  lastInboundAt: number | null;  // 最后一次接收消息时间戳
  lastOutboundAt: number | null; // 最后一次发送消息时间戳
}

// ==================== Discord 类型 ====================

export interface DiscordConfig {
  enabled: boolean;              // 是否启用
  botToken: string;              // 机器人令牌
  debug?: boolean;               // 是否开启调试模式
}

export interface DiscordGatewayStatus {
  connected: boolean;            // 是否已连接
  starting: boolean;             // 是否正在启动
  startedAt: number | null;      // 启动时间戳
  lastError: string | null;      // 最后一次错误信息
  botUsername: string | null;    // 机器人用户名
  lastInboundAt: number | null;  // 最后一次接收消息时间戳
  lastOutboundAt: number | null; // 最后一次发送消息时间戳
}

// ==================== 通用 IM 类型 ====================

export type IMPlatform = 'dingtalk' | 'feishu' | 'telegram' | 'discord';

export interface IMGatewayConfig {
  dingtalk: DingTalkConfig;      // 钉钉配置
  feishu: FeishuConfig;          // 飞书配置
  telegram: TelegramConfig;      // Telegram 配置
  discord: DiscordConfig;        // Discord 配置
  settings: IMSettings;          // IM 设置
}

export interface IMSettings {
  systemPrompt?: string;         // 系统提示词
  skillsEnabled: boolean;        // 是否启用技能
}

export interface IMGatewayStatus {
  dingtalk: DingTalkGatewayStatus;   // 钉钉网关状态
  feishu: FeishuGatewayStatus;       // 飞书网关状态
  telegram: TelegramGatewayStatus;   // Telegram 网关状态
  discord: DiscordGatewayStatus;     // Discord 网关状态
}

// ==================== 媒体附件类型 ====================

export type TelegramMediaType = 'image' | 'video' | 'audio' | 'voice' | 'document' | 'sticker';

export interface IMMediaAttachment {
  type: TelegramMediaType;       // 媒体类型
  localPath: string;             // 下载后的本地路径
  mimeType: string;              // MIME 类型
  fileName?: string;             // 原始文件名
  fileSize?: number;             // 文件大小（字节）
  width?: number;                // 图片/视频宽度
  height?: number;               // 图片/视频高度
  duration?: number;             // 音视频时长（秒）
}

export interface IMMessage {
  platform: IMPlatform;          // 平台类型
  messageId: string;             // 消息 ID
  conversationId: string;        // 会话 ID
  senderId: string;              // 发送者 ID
  senderName?: string;           // 发送者名称
  content: string;               // 消息内容
  chatType: 'direct' | 'group';  // 聊天类型：单聊或群聊
  timestamp: number;             // 时间戳
  // 媒体附件（Telegram 支持）
  attachments?: IMMediaAttachment[];  // 附件列表
  mediaGroupId?: string;         // 媒体组 ID（用于合并多张图片）
}

export interface IMReplyContext {
  platform: IMPlatform;          // 平台类型
  conversationId: string;        // 会话 ID
  messageId?: string;            // 消息 ID
  // 钉钉特有字段
  sessionWebhook?: string;       // 会话 Webhook 地址
  // 飞书特有字段
  chatId?: string;               // 聊天 ID
}

// ==================== IM 会话映射 ====================

export interface IMSessionMapping {
  imConversationId: string;      // IM 会话 ID
  platform: IMPlatform;          // 平台类型
  coworkSessionId: string;       // 协作会话 ID
  createdAt: number;             // 创建时间戳
  lastActiveAt: number;          // 最后活跃时间戳
}

// ==================== IPC 结果类型 ====================

export interface IMConfigResult {
  success: boolean;              // 是否成功
  config?: IMGatewayConfig;      // 网关配置
  error?: string;                // 错误信息
}

export interface IMStatusResult {
  success: boolean;              // 是否成功
  status?: IMGatewayStatus;      // 网关状态
  error?: string;                // 错误信息
}

export interface IMGatewayResult {
  success: boolean;              // 是否成功
  error?: string;                // 错误信息
}

// ==================== 连接性测试类型 ====================

export type IMConnectivityVerdict = 'pass' | 'warn' | 'fail';  // 连接性判定结果：通过、警告、失败

export type IMConnectivityCheckLevel = 'pass' | 'info' | 'warn' | 'fail';  // 检查级别

export type IMConnectivityCheckCode =
  | 'missing_credentials'                    // 缺少凭证
  | 'auth_check'                             // 认证检查
  | 'gateway_running'                        // 网关运行状态
  | 'inbound_activity'                       // 入站活动
  | 'outbound_activity'                      // 出站活动
  | 'platform_last_error'                    // 平台最后错误
  | 'feishu_group_requires_mention'          // 飞书群聊需要提及
  | 'feishu_event_subscription_required'     // 飞书需要事件订阅
  | 'discord_group_requires_mention'         // Discord 群聊需要提及
  | 'telegram_privacy_mode_hint'             // Telegram 隐私模式提示
  | 'dingtalk_bot_membership_hint';          // 钉钉机器人成员提示

export interface IMConnectivityCheck {
  code: IMConnectivityCheckCode; // 检查代码
  level: IMConnectivityCheckLevel;  // 检查级别
  message: string;               // 检查消息
  suggestion?: string;           // 建议信息
}

export interface IMConnectivityTestResult {
  platform: IMPlatform;          // 平台类型
  testedAt: number;              // 测试时间戳
  verdict: IMConnectivityVerdict;  // 判定结果
  checks: IMConnectivityCheck[]; // 检查项列表
}

export interface IMConnectivityTestResponse {
  success: boolean;              // 是否成功
  result?: IMConnectivityTestResult;  // 测试结果
  error?: string;                // 错误信息
}

// ==================== 默认配置 ====================

export const DEFAULT_DINGTALK_CONFIG: DingTalkConfig = {
  enabled: false,                // 默认不启用
  clientId: '',                  // 客户端 ID
  clientSecret: '',              // 客户端密钥
  messageType: 'markdown',       // 默认消息类型为 markdown
  debug: true,                   // 默认开启调试模式
};

export const DEFAULT_FEISHU_CONFIG: FeishuConfig = {
  enabled: false,                // 默认不启用
  appId: '',                     // 应用 ID
  appSecret: '',                 // 应用密钥
  domain: 'feishu',              // 默认域名为飞书
  renderMode: 'card',            // 默认渲染模式为卡片
  debug: true,                   // 默认开启调试模式
};

export const DEFAULT_TELEGRAM_CONFIG: TelegramConfig = {
  enabled: false,                // 默认不启用
  botToken: '',                  // 机器人令牌
  debug: true,                   // 默认开启调试模式
};

export const DEFAULT_DISCORD_CONFIG: DiscordConfig = {
  enabled: false,                // 默认不启用
  botToken: '',                  // 机器人令牌
  debug: true,                   // 默认开启调试模式
};

export const DEFAULT_IM_SETTINGS: IMSettings = {
  systemPrompt: '',              // 默认系统提示词为空
  skillsEnabled: true,           // 默认启用技能
};

export const DEFAULT_IM_CONFIG: IMGatewayConfig = {
  dingtalk: DEFAULT_DINGTALK_CONFIG,  // 钉钉默认配置
  feishu: DEFAULT_FEISHU_CONFIG,      // 飞书默认配置
  telegram: DEFAULT_TELEGRAM_CONFIG,  // Telegram 默认配置
  discord: DEFAULT_DISCORD_CONFIG,    // Discord 默认配置
  settings: DEFAULT_IM_SETTINGS,      // IM 默认设置
};

export const DEFAULT_DINGTALK_STATUS: DingTalkGatewayStatus = {
  connected: false,              // 默认未连接
  startedAt: null,               // 启动时间为空
  lastError: null,               // 最后错误为空
  lastInboundAt: null,           // 最后接收消息时间为空
  lastOutboundAt: null,          // 最后发送消息时间为空
};

export const DEFAULT_FEISHU_STATUS: FeishuGatewayStatus = {
  connected: false,              // 默认未连接
  startedAt: null,               // 启动时间为空
  botOpenId: null,               // 机器人 OpenId 为空
  error: null,                   // 错误为空
  lastInboundAt: null,           // 最后接收消息时间为空
  lastOutboundAt: null,          // 最后发送消息时间为空
};

export const DEFAULT_TELEGRAM_STATUS: TelegramGatewayStatus = {
  connected: false,              // 默认未连接
  startedAt: null,               // 启动时间为空
  lastError: null,               // 最后错误为空
  botUsername: null,             // 机器人用户名为空
  lastInboundAt: null,           // 最后接收消息时间为空
  lastOutboundAt: null,          // 最后发送消息时间为空
};

export const DEFAULT_DISCORD_STATUS: DiscordGatewayStatus = {
  connected: false,              // 默认未连接
  starting: false,               // 默认不在启动中
  startedAt: null,               // 启动时间为空
  lastError: null,               // 最后错误为空
  botUsername: null,             // 机器人用户名为空
  lastInboundAt: null,           // 最后接收消息时间为空
  lastOutboundAt: null,          // 最后发送消息时间为空
};

export const DEFAULT_IM_STATUS: IMGatewayStatus = {
  dingtalk: DEFAULT_DINGTALK_STATUS,  // 钉钉默认状态
  feishu: DEFAULT_FEISHU_STATUS,      // 飞书默认状态
  telegram: DEFAULT_TELEGRAM_STATUS,  // Telegram 默认状态
  discord: DEFAULT_DISCORD_STATUS,    // Discord 默认状态
};

// ==================== 钉钉媒体类型 ====================

// Session Webhook 使用 msgKey + msgParam 格式
export interface DingTalkImageMessage {
  msgKey: 'sampleImageMsg';      // 消息键：图片消息
  sampleImageMsg: { photoURL: string };  // 图片消息内容
}

export interface DingTalkVoiceMessage {
  msgKey: 'sampleAudio';         // 消息键：语音消息
  sampleAudio: { mediaId: string; duration?: string };  // 语音消息内容
}

export interface DingTalkVideoMessage {
  msgKey: 'sampleVideo';         // 消息键：视频消息
  sampleVideo: { mediaId: string; duration?: string; videoType?: string };  // 视频消息内容
}

export interface DingTalkFileMessage {
  msgKey: 'sampleFile';          // 消息键：文件消息
  sampleFile: { mediaId: string; fileName?: string };  // 文件消息内容
}

export type DingTalkMediaMessage =
  | DingTalkImageMessage
  | DingTalkVoiceMessage
  | DingTalkVideoMessage
  | DingTalkFileMessage;

export interface MediaMarker {
  type: 'image' | 'video' | 'audio' | 'file';  // 媒体类型
  path: string;                  // 文件路径
  name?: string;                 // 文件名
  originalMarker: string;        // 原始标记
}
