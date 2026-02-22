/**
 * API 响应接口
 * 用于表示 HTTP API 请求的响应结果
 */
interface ApiResponse {
  ok: boolean;                          // 请求是否成功
  status: number;                       // HTTP 状态码
  statusText: string;                   // HTTP 状态文本
  headers: Record<string, string>;      // 响应头信息
  data: any;                            // 响应数据
  error?: string;                       // 错误信息（可选）
}

/**
 * API 流式响应接口
 * 用于表示流式 API 请求的响应结果
 */
interface ApiStreamResponse {
  ok: boolean;                          // 请求是否成功
  status: number;                       // HTTP 状态码
  statusText: string;                   // HTTP 状态文本
  error?: string;                       // 错误信息（可选）
}

/**
 * 协作会话 IPC 类型定义
 */
interface CoworkSession {
  id: string;                           // 会话唯一标识符
  title: string;                        // 会话标题
  claudeSessionId: string | null;       // Claude 会话 ID
  status: 'idle' | 'running' | 'completed' | 'error';  // 会话状态
  pinned: boolean;                      // 是否置顶
  cwd: string;                          // 当前工作目录
  systemPrompt: string;                 // 系统提示词
  executionMode: 'auto' | 'local' | 'sandbox';  // 执行模式
  activeSkillIds: string[];             // 激活的技能 ID 列表
  messages: CoworkMessage[];            // 消息列表
  createdAt: number;                    // 创建时间戳
  updatedAt: number;                    // 更新时间戳
}

/**
 * 协作消息接口
 */
interface CoworkMessage {
  id: string;                           // 消息唯一标识符
  type: 'user' | 'assistant' | 'tool_use' | 'tool_result' | 'system';  // 消息类型
  content: string;                      // 消息内容
  timestamp: number;                    // 时间戳
  metadata?: Record<string, unknown>;   // 元数据（可选）
}

/**
 * 协作会话摘要接口
 */
interface CoworkSessionSummary {
  id: string;                           // 会话唯一标识符
  title: string;                        // 会话标题
  status: 'idle' | 'running' | 'completed' | 'error';  // 会话状态
  pinned: boolean;                      // 是否置顶
  createdAt: number;                    // 创建时间戳
  updatedAt: number;                    // 更新时间戳
}

/**
 * 协作配置接口
 */
interface CoworkConfig {
  workingDirectory: string;             // 工作目录
  systemPrompt: string;                 // 系统提示词
  executionMode: 'auto' | 'local' | 'sandbox';  // 执行模式
  memoryEnabled: boolean;               // 是否启用记忆功能
  memoryImplicitUpdateEnabled: boolean; // 是否启用隐式记忆更新
  memoryLlmJudgeEnabled: boolean;       // 是否启用 LLM 记忆判断
  memoryGuardLevel: 'strict' | 'standard' | 'relaxed';  // 记忆保护级别
  memoryUserMemoriesMaxItems: number;   // 用户记忆最大条目数
}

/**
 * 协作配置更新类型（部分更新）
 */
type CoworkConfigUpdate = Partial<Pick<
  CoworkConfig,
  | 'workingDirectory'
  | 'executionMode'
  | 'memoryEnabled'
  | 'memoryImplicitUpdateEnabled'
  | 'memoryLlmJudgeEnabled'
  | 'memoryGuardLevel'
  | 'memoryUserMemoriesMaxItems'
>>;

/**
 * 协作用户记忆条目接口
 */
interface CoworkUserMemoryEntry {
  id: string;                           // 记忆条目唯一标识符
  text: string;                         // 记忆文本内容
  confidence: number;                   // 置信度
  isExplicit: boolean;                  // 是否为显式记忆
  status: 'created' | 'stale' | 'deleted';  // 记忆状态
  createdAt: number;                    // 创建时间戳
  updatedAt: number;                    // 更新时间戳
  lastUsedAt: number | null;            // 最后使用时间戳
}

/**
 * 协作记忆统计接口
 */
interface CoworkMemoryStats {
  total: number;                        // 总记忆条目数
  created: number;                      // 已创建条目数
  stale: number;                        // 过期条目数
  deleted: number;                      // 已删除条目数
  explicit: number;                     // 显式记忆条目数
  implicit: number;                     // 隐式记忆条目数
}

/**
 * 协作权限请求接口
 */
interface CoworkPermissionRequest {
  sessionId: string;                    // 会话 ID
  toolName: string;                     // 工具名称
  toolInput: Record<string, unknown>;   // 工具输入参数
  requestId: string;                    // 请求 ID
  toolUseId?: string | null;            // 工具使用 ID（可选）
}

/**
 * 协作 API 配置接口
 */
interface CoworkApiConfig {
  apiKey: string;                       // API 密钥
  baseURL: string;                      // API 基础 URL
  model: string;                        // 模型名称
  apiType?: 'anthropic' | 'openai';     // API 类型（可选）
}

/**
 * 协作沙箱状态接口
 */
interface CoworkSandboxStatus {
  supported: boolean;                   // 是否支持沙箱
  runtimeReady: boolean;                // 运行时是否就绪
  imageReady: boolean;                  // 镜像是否就绪
  downloading: boolean;                 // 是否正在下载
  progress?: CoworkSandboxProgress;     // 下载进度（可选）
  error?: string | null;                // 错误信息（可选）
}

/**
 * 协作沙箱下载进度接口
 */
interface CoworkSandboxProgress {
  stage: 'runtime' | 'image';           // 下载阶段
  received: number;                     // 已接收字节数
  total?: number;                       // 总字节数（可选）
  percent?: number;                     // 下载百分比（可选）
  url?: string;                         // 下载 URL（可选）
}

/**
 * 窗口状态接口
 */
interface WindowState {
  isMaximized: boolean;                 // 是否最大化
  isFullscreen: boolean;                // 是否全屏
  isFocused: boolean;                   // 是否聚焦
}

/**
 * 技能接口
 */
interface Skill {
  id: string;                           // 技能唯一标识符
  name: string;                         // 技能名称
  description: string;                  // 技能描述
  enabled: boolean;                     // 是否启用
  isOfficial: boolean;                  // 是否为官方技能
  isBuiltIn: boolean;                   // 是否为内置技能
  updatedAt: number;                    // 更新时间戳
  prompt: string;                       // 系统提示词
  skillPath: string;                    // 技能文件路径
}

/**
 * 邮件连接性检查代码类型
 */
type EmailConnectivityCheckCode = 'imap_connection' | 'smtp_connection';

/**
 * 邮件连接性检查级别类型
 */
type EmailConnectivityCheckLevel = 'pass' | 'fail';

/**
 * 邮件连接性判定结果类型
 */
type EmailConnectivityVerdict = 'pass' | 'fail';

/**
 * 邮件连接性检查项接口
 */
interface EmailConnectivityCheck {
  code: EmailConnectivityCheckCode;     // 检查代码
  level: EmailConnectivityCheckLevel;   // 检查级别
  message: string;                      // 检查消息
  durationMs: number;                   // 检查耗时（毫秒）
}

/**
 * 邮件连接性测试结果接口
 */
interface EmailConnectivityTestResult {
  testedAt: number;                     // 测试时间戳
  verdict: EmailConnectivityVerdict;    // 判定结果
  checks: EmailConnectivityCheck[];     // 检查项列表
}

/**
 * 协作权限结果类型
 */
type CoworkPermissionResult =
  | {
      behavior: 'allow';                // 允许行为
      updatedInput?: Record<string, unknown>;      // 更新后的输入（可选）
      updatedPermissions?: Record<string, unknown>[];  // 更新后的权限（可选）
      toolUseID?: string;               // 工具使用 ID（可选）
    }
  | {
      behavior: 'deny';                 // 拒绝行为
      message: string;                  // 拒绝消息
      interrupt?: boolean;              // 是否中断（可选）
      toolUseID?: string;               // 工具使用 ID（可选）
    };

/**
 * Electron API 接口
 * 定义了渲染进程中可用的所有 Electron API
 */
interface IElectronAPI {
  platform: string;                     // 操作系统平台
  store: {
    get: (key: string) => Promise<any>;                           // 获取存储值
    set: (key: string, value: any) => Promise<void>;              // 设置存储值
    remove: (key: string) => Promise<void>;                       // 删除存储值
  };
  skills: {
    list: () => Promise<{ success: boolean; skills?: Skill[]; error?: string }>;  // 列出所有技能
    setEnabled: (options: { id: string; enabled: boolean }) => Promise<{ success: boolean; skills?: Skill[]; error?: string }>;  // 设置技能启用状态
    delete: (id: string) => Promise<{ success: boolean; skills?: Skill[]; error?: string }>;  // 删除技能
    download: (source: string) => Promise<{ success: boolean; skills?: Skill[]; error?: string }>;  // 下载技能
    getRoot: () => Promise<{ success: boolean; path?: string; error?: string }>;  // 获取技能根目录
    autoRoutingPrompt: () => Promise<{ success: boolean; prompt?: string | null; error?: string }>;  // 获取自动路由提示词
    getConfig: (skillId: string) => Promise<{ success: boolean; config?: Record<string, string>; error?: string }>;  // 获取技能配置
    setConfig: (skillId: string, config: Record<string, string>) => Promise<{ success: boolean; error?: string }>;  // 设置技能配置
    testEmailConnectivity: (           // 测试邮件连接性
      skillId: string,
      config: Record<string, string>
    ) => Promise<{ success: boolean; result?: EmailConnectivityTestResult; error?: string }>;
    onChanged: (callback: () => void) => () => void;              // 监听技能变更
  };
  api: {
    fetch: (options: {                 // 发送 HTTP 请求
      url: string;
      method: string;
      headers: Record<string, string>;
      body?: string;
    }) => Promise<ApiResponse>;
    stream: (options: {                // 发送流式请求
      url: string;
      method: string;
      headers: Record<string, string>;
      body?: string;
      requestId: string;
    }) => Promise<ApiStreamResponse>;
    cancelStream: (requestId: string) => Promise<boolean>;         // 取消流式请求
    onStreamData: (requestId: string, callback: (chunk: string) => void) => () => void;    // 监听流数据
    onStreamDone: (requestId: string, callback: () => void) => () => void;                // 监听流完成
    onStreamError: (requestId: string, callback: (error: string) => void) => () => void;  // 监听流错误
    onStreamAbort: (requestId: string, callback: () => void) => () => void;               // 监听流中止
  };
  getApiConfig: () => Promise<CoworkApiConfig | null>;            // 获取 API 配置
  checkApiConfig: () => Promise<{ hasConfig: boolean; config: CoworkApiConfig | null; error?: string }>;  // 检查 API 配置
  saveApiConfig: (config: CoworkApiConfig) => Promise<{ success: boolean; error?: string }>;  // 保存 API 配置
  generateSessionTitle: (userInput: string | null) => Promise<string>;  // 生成会话标题
  getRecentCwds: (limit?: number) => Promise<string[]>;            // 获取最近工作目录
  ipcRenderer: {
    send: (channel: string, ...args: any[]) => void;              // 发送 IPC 消息
    on: (channel: string, func: (...args: any[]) => void) => () => void;  // 监听 IPC 消息
  };
  window: {
    minimize: () => void;                                            // 最小化窗口
    toggleMaximize: () => void;                                      // 切换最大化状态
    close: () => void;                                               // 关闭窗口
    isMaximized: () => Promise<boolean>;                             // 检查是否最大化
    showSystemMenu: (position: { x: number; y: number }) => void;    // 显示系统菜单
    onStateChanged: (callback: (state: WindowState) => void) => () => void;  // 监听窗口状态变化
  };
  cowork: {
    startSession: (options: { prompt: string; cwd?: string; systemPrompt?: string; title?: string; activeSkillIds?: string[] }) => Promise<{ success: boolean; session?: CoworkSession; error?: string }>;  // 启动会话
    continueSession: (options: { sessionId: string; prompt: string; systemPrompt?: string; activeSkillIds?: string[] }) => Promise<{ success: boolean; session?: CoworkSession; error?: string }>;  // 继续会话
    stopSession: (sessionId: string) => Promise<{ success: boolean; error?: string }>;  // 停止会话
    deleteSession: (sessionId: string) => Promise<{ success: boolean; error?: string }>;  // 删除会话
    setSessionPinned: (options: { sessionId: string; pinned: boolean }) => Promise<{ success: boolean; error?: string }>;  // 设置会话置顶状态
    renameSession: (options: { sessionId: string; title: string }) => Promise<{ success: boolean; error?: string }>;  // 重命名会话
    getSession: (sessionId: string) => Promise<{ success: boolean; session?: CoworkSession; error?: string }>;  // 获取会话
    listSessions: () => Promise<{ success: boolean; sessions?: CoworkSessionSummary[]; error?: string }>;  // 列出所有会话
    exportResultImage: (options: {   // 导出结果图片
      rect: { x: number; y: number; width: number; height: number };
      defaultFileName?: string;
    }) => Promise<{ success: boolean; canceled?: boolean; path?: string; error?: string }>;
    captureImageChunk: (options: {   // 捕获图片块
      rect: { x: number; y: number; width: number; height: number };
    }) => Promise<{ success: boolean; width?: number; height?: number; pngBase64?: string; error?: string }>;
    saveResultImage: (options: {     // 保存结果图片
      pngBase64: string;
      defaultFileName?: string;
    }) => Promise<{ success: boolean; canceled?: boolean; path?: string; error?: string }>;
    respondToPermission: (options: { requestId: string; result: CoworkPermissionResult }) => Promise<{ success: boolean; error?: string }>;  // 响应权限请求
    getConfig: () => Promise<{ success: boolean; config?: CoworkConfig; error?: string }>;  // 获取协作配置
    setConfig: (config: CoworkConfigUpdate) => Promise<{ success: boolean; error?: string }>;  // 设置协作配置
    listMemoryEntries: (input: {     // 列出记忆条目
      query?: string;
      status?: 'created' | 'stale' | 'deleted' | 'all';
      includeDeleted?: boolean;
      limit?: number;
      offset?: number;
    }) => Promise<{ success: boolean; entries?: CoworkUserMemoryEntry[]; error?: string }>;
    createMemoryEntry: (input: {     // 创建记忆条目
      text: string;
      confidence?: number;
      isExplicit?: boolean;
    }) => Promise<{ success: boolean; entry?: CoworkUserMemoryEntry; error?: string }>;
    updateMemoryEntry: (input: {     // 更新记忆条目
      id: string;
      text?: string;
      confidence?: number;
      status?: 'created' | 'stale' | 'deleted';
      isExplicit?: boolean;
    }) => Promise<{ success: boolean; entry?: CoworkUserMemoryEntry; error?: string }>;
    deleteMemoryEntry: (input: { id: string }) => Promise<{ success: boolean; error?: string }>;  // 删除记忆条目
    getMemoryStats: () => Promise<{ success: boolean; stats?: CoworkMemoryStats; error?: string }>;  // 获取记忆统计
    getSandboxStatus: () => Promise<CoworkSandboxStatus>;           // 获取沙箱状态
    installSandbox: () => Promise<{ success: boolean; status: CoworkSandboxStatus; error?: string }>;  // 安装沙箱
    onSandboxDownloadProgress: (callback: (data: CoworkSandboxProgress) => void) => () => void;  // 监听沙箱下载进度
    onStreamMessage: (callback: (data: { sessionId: string; message: CoworkMessage }) => void) => () => void;  // 监听流消息
    onStreamMessageUpdate: (callback: (data: { sessionId: string; messageId: string; content: string }) => void) => () => void;  // 监听流消息更新
    onStreamPermission: (callback: (data: { sessionId: string; request: CoworkPermissionRequest }) => void) => () => void;  // 监听流权限请求
    onStreamComplete: (callback: (data: { sessionId: string; claudeSessionId: string | null }) => void) => () => void;  // 监听流完成
    onStreamError: (callback: (data: { sessionId: string; error: string }) => void) => () => void;  // 监听流错误
  };
  dialog: {
    selectDirectory: () => Promise<{ success: boolean; path: string | null }>;  // 选择目录
    selectFile: (options?: { title?: string; filters?: { name: string; extensions: string[] }[] }) => Promise<{ success: boolean; path: string | null }>;  // 选择文件
    saveInlineFile: (options: { dataBase64: string; fileName?: string; mimeType?: string; cwd?: string }) => Promise<{ success: boolean; path: string | null; error?: string }>;  // 保存内联文件
  };
  shell: {
    openPath: (filePath: string) => Promise<{ success: boolean; error?: string }>;  // 打开路径
    showItemInFolder: (filePath: string) => Promise<{ success: boolean; error?: string }>;  // 在文件夹中显示
    openExternal: (url: string) => Promise<{ success: boolean; error?: string }>;  // 打开外部链接
  };
  autoLaunch: {
    get: () => Promise<{ enabled: boolean }>;                       // 获取开机启动状态
    set: (enabled: boolean) => Promise<{ success: boolean; error?: string }>;  // 设置开机启动
  };
  appInfo: {
    getVersion: () => Promise<string>;                              // 获取应用版本
    getSystemLocale: () => Promise<string>;                         // 获取系统语言
  };
  im: {
    getConfig: () => Promise<{ success: boolean; config?: IMGatewayConfig; error?: string }>;  // 获取 IM 配置
    setConfig: (config: Partial<IMGatewayConfig>) => Promise<{ success: boolean; error?: string }>;  // 设置 IM 配置
    startGateway: (platform: 'dingtalk' | 'feishu' | 'telegram' | 'discord') => Promise<{ success: boolean; error?: string }>;  // 启动网关
    stopGateway: (platform: 'dingtalk' | 'feishu' | 'telegram' | 'discord') => Promise<{ success: boolean; error?: string }>;  // 停止网关
    testGateway: (                   // 测试网关连接
      platform: 'dingtalk' | 'feishu' | 'telegram' | 'discord',
      configOverride?: Partial<IMGatewayConfig>
    ) => Promise<{ success: boolean; result?: IMConnectivityTestResult; error?: string }>;
    getStatus: () => Promise<{ success: boolean; status?: IMGatewayStatus; error?: string }>;  // 获取网关状态
    onStatusChange: (callback: (status: IMGatewayStatus) => void) => () => void;  // 监听状态变化
    onMessageReceived: (callback: (message: IMMessage) => void) => () => void;    // 监听消息接收
  };
  scheduledTasks: {
    list: () => Promise<any>;                                       // 列出所有定时任务
    get: (id: string) => Promise<any>;                              // 获取定时任务
    create: (input: any) => Promise<any>;                           // 创建定时任务
    update: (id: string, input: any) => Promise<any>;               // 更新定时任务
    delete: (id: string) => Promise<any>;                           // 删除定时任务
    toggle: (id: string, enabled: boolean) => Promise<any>;         // 切换定时任务状态
    runManually: (id: string) => Promise<any>;                      // 手动运行定时任务
    stop: (id: string) => Promise<any>;                             // 停止定时任务
    listRuns: (taskId: string, limit?: number, offset?: number) => Promise<any>;  // 列出运行记录
    countRuns: (taskId: string) => Promise<any>;                    // 统计运行记录
    listAllRuns: (limit?: number, offset?: number) => Promise<any>;  // 列出所有运行记录
    onStatusUpdate: (callback: (data: any) => void) => () => void;  // 监听状态更新
    onRunUpdate: (callback: (data: any) => void) => () => void;     // 监听运行更新
  };
  permissions: {
    checkCalendar: () => Promise<{ success: boolean; status?: string; error?: string; autoRequested?: boolean }>;  // 检查日历权限
    requestCalendar: () => Promise<{ success: boolean; granted?: boolean; status?: string; error?: string }>;      // 请求日历权限
  };
  networkStatus: {
    send: (status: 'online' | 'offline') => void;                   // 发送网络状态
  };
}

/**
 * IM 网关配置接口
 */
interface IMGatewayConfig {
  dingtalk: DingTalkConfig;             // 钉钉配置
  feishu: FeishuConfig;                 // 飞书配置
  telegram: TelegramConfig;             // Telegram 配置
  discord: DiscordConfig;               // Discord 配置
  settings: IMSettings;                 // IM 通用设置
}

/**
 * 钉钉配置接口
 */
interface DingTalkConfig {
  enabled: boolean;                     // 是否启用
  clientId: string;                     // 客户端 ID
  clientSecret: string;                 // 客户端密钥
  robotCode?: string;                   // 机器人代码（可选）
  corpId?: string;                      // 企业 ID（可选）
  agentId?: string;                     // 应用 ID（可选）
  messageType: 'markdown' | 'card';     // 消息类型
  cardTemplateId?: string;              // 卡片模板 ID（可选）
  debug?: boolean;                      // 调试模式（可选）
}

/**
 * 飞书配置接口
 */
interface FeishuConfig {
  enabled: boolean;                     // 是否启用
  appId: string;                        // 应用 ID
  appSecret: string;                    // 应用密钥
  domain: 'feishu' | 'lark' | string;   // 域名类型
  encryptKey?: string;                  // 加密密钥（可选）
  verificationToken?: string;           // 验证令牌（可选）
  renderMode: 'text' | 'card';          // 渲染模式
  debug?: boolean;                      // 调试模式（可选）
}

/**
 * Telegram 配置接口
 */
interface TelegramConfig {
  enabled: boolean;                     // 是否启用
  botToken: string;                     // 机器人令牌
  debug?: boolean;                      // 调试模式（可选）
}

/**
 * Discord 配置接口
 */
interface DiscordConfig {
  enabled: boolean;                     // 是否启用
  botToken: string;                     // 机器人令牌
  debug?: boolean;                      // 调试模式（可选）
}

/**
 * IM 通用设置接口
 */
interface IMSettings {
  systemPrompt?: string;                // 系统提示词（可选）
  skillsEnabled: boolean;               // 是否启用技能
}

/**
 * IM 网关状态接口
 */
interface IMGatewayStatus {
  dingtalk: DingTalkGatewayStatus;      // 钉钉网关状态
  feishu: FeishuGatewayStatus;          // 飞书网关状态
  telegram: TelegramGatewayStatus;      // Telegram 网关状态
  discord: DiscordGatewayStatus;        // Discord 网关状态
}

/**
 * IM 连接性判定结果类型
 */
type IMConnectivityVerdict = 'pass' | 'warn' | 'fail';

/**
 * IM 连接性检查级别类型
 */
type IMConnectivityCheckLevel = 'pass' | 'info' | 'warn' | 'fail';

/**
 * IM 连接性检查代码类型
 */
type IMConnectivityCheckCode =
  | 'missing_credentials'               // 缺少凭据
  | 'auth_check'                        // 认证检查
  | 'gateway_running'                   // 网关运行中
  | 'inbound_activity'                  // 入站活动
  | 'outbound_activity'                 // 出站活动
  | 'platform_last_error'               // 平台最后错误
  | 'feishu_group_requires_mention'     // 飞书群组需要 @ 提及
  | 'feishu_event_subscription_required'  // 飞书需要事件订阅
  | 'discord_group_requires_mention'    // Discord 群组需要 @ 提及
  | 'telegram_privacy_mode_hint'        // Telegram 隐私模式提示
  | 'dingtalk_bot_membership_hint';     // 钉钉机器人成员提示

/**
 * IM 连接性检查项接口
 */
interface IMConnectivityCheck {
  code: IMConnectivityCheckCode;        // 检查代码
  level: IMConnectivityCheckLevel;      // 检查级别
  message: string;                      // 检查消息
  suggestion?: string;                  // 建议信息（可选）
}

/**
 * IM 连接性测试结果接口
 */
interface IMConnectivityTestResult {
  platform: 'dingtalk' | 'feishu' | 'telegram' | 'discord';  // 平台类型
  testedAt: number;                     // 测试时间戳
  verdict: IMConnectivityVerdict;       // 判定结果
  checks: IMConnectivityCheck[];        // 检查项列表
}

/**
 * 钉钉网关状态接口
 */
interface DingTalkGatewayStatus {
  connected: boolean;                   // 是否已连接
  startedAt: number | null;             // 启动时间戳
  lastError: string | null;             // 最后错误信息
  lastInboundAt: number | null;         // 最后入站时间戳
  lastOutboundAt: number | null;        // 最后出站时间戳
}

/**
 * 飞书网关状态接口
 */
interface FeishuGatewayStatus {
  connected: boolean;                   // 是否已连接
  startedAt: string | null;             // 启动时间
  botOpenId: string | null;             // 机器人 Open ID
  error: string | null;                 // 错误信息
  lastInboundAt: number | null;         // 最后入站时间戳
  lastOutboundAt: number | null;        // 最后出站时间戳
}

/**
 * Telegram 网关状态接口
 */
interface TelegramGatewayStatus {
  connected: boolean;                   // 是否已连接
  startedAt: number | null;             // 启动时间戳
  lastError: string | null;             // 最后错误信息
  botUsername: string | null;           // 机器人用户名
  lastInboundAt: number | null;         // 最后入站时间戳
  lastOutboundAt: number | null;        // 最后出站时间戳
}

/**
 * Discord 网关状态接口
 */
interface DiscordGatewayStatus {
  connected: boolean;                   // 是否已连接
  starting: boolean;                    // 是否正在启动
  startedAt: number | null;             // 启动时间戳
  lastError: string | null;             // 最后错误信息
  botUsername: string | null;           // 机器人用户名
  lastInboundAt: number | null;         // 最后入站时间戳
  lastOutboundAt: number | null;        // 最后出站时间戳
}

/**
 * IM 消息接口
 */
interface IMMessage {
  platform: 'dingtalk' | 'feishu' | 'telegram' | 'discord';  // 平台类型
  messageId: string;                    // 消息唯一标识符
  conversationId: string;               // 会话 ID
  senderId: string;                     // 发送者 ID
  senderName?: string;                  // 发送者名称（可选）
  content: string;                      // 消息内容
  chatType: 'direct' | 'group';         // 聊天类型
  timestamp: number;                    // 时间戳
}

/**
 * 全局类型声明
 * 为 Window 接口扩展 electron 属性
 */
declare global {
  interface Window {
    electron: IElectronAPI;             // Electron API 实例
  }
}

export {};
