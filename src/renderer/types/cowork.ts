// 协工作会话状态
export type CoworkSessionStatus = 'idle' | 'running' | 'completed' | 'error';

// 协工作消息类型
export type CoworkMessageType = 'user' | 'assistant' | 'tool_use' | 'tool_result' | 'system';

// 协工作执行模式
export type CoworkExecutionMode = 'auto' | 'local' | 'sandbox';

// 协工作消息元数据
export interface CoworkMessageMetadata {
  toolName?: string;  // 工具名称
  toolInput?: Record<string, unknown>;  // 工具输入参数
  toolResult?: string;  // 工具执行结果
  toolUseId?: string | null;  // 工具使用ID
  error?: string;  // 错误信息
  isError?: boolean;  // 是否为错误
  isStreaming?: boolean;  // 是否正在流式传输
  isFinal?: boolean;  // 是否为最终消息
  isThinking?: boolean;  // 是否正在思考
  skillIds?: string[];  // 此消息使用的技能ID列表
  [key: string]: unknown;
}

// 协工作消息
export interface CoworkMessage {
  id: string;
  type: CoworkMessageType;
  content: string;
  timestamp: number;
  metadata?: CoworkMessageMetadata;
}

// 协工作会话
export interface CoworkSession {
  id: string;
  title: string;
  claudeSessionId: string | null;
  status: CoworkSessionStatus;
  pinned: boolean;
  cwd: string;
  systemPrompt: string;
  executionMode: CoworkExecutionMode;
  activeSkillIds: string[];
  messages: CoworkMessage[];
  createdAt: number;
  updatedAt: number;
}

// 协工作配置
export interface CoworkConfig {
  workingDirectory: string;
  systemPrompt: string;
  executionMode: CoworkExecutionMode;
  memoryEnabled: boolean;
  memoryImplicitUpdateEnabled: boolean;
  memoryLlmJudgeEnabled: boolean;
  memoryGuardLevel: 'strict' | 'standard' | 'relaxed';
  memoryUserMemoriesMaxItems: number;
}

// 协工作配置更新（部分更新）
export type CoworkConfigUpdate = Partial<Pick<
  CoworkConfig,
  | 'workingDirectory'
  | 'executionMode'
  | 'memoryEnabled'
  | 'memoryImplicitUpdateEnabled'
  | 'memoryLlmJudgeEnabled'
  | 'memoryGuardLevel'
  | 'memoryUserMemoriesMaxItems'
>>;

// 协工作API配置
export interface CoworkApiConfig {
  apiKey: string;  // API密钥
  baseURL: string;  // API基础URL
  model: string;  // 模型名称
  apiType?: 'anthropic' | 'openai';  // API类型
}

// 协工作沙箱状态
export type CoworkSandboxStatus = {
  supported: boolean;  // 是否支持沙箱
  runtimeReady: boolean;  // 运行时是否就绪
  imageReady: boolean;  // 镜像是否就绪
  downloading: boolean;  // 是否正在下载
  progress?: CoworkSandboxProgress;  // 下载进度
  error?: string | null;  // 错误信息
};

// 协工作沙箱下载进度
export type CoworkSandboxProgress = {
  stage: 'runtime' | 'image';  // 当前下载阶段：运行时或镜像
  received: number;  // 已接收字节数
  total?: number;  // 总字节数
  percent?: number;  // 下载百分比
  url?: string;  // 下载URL
};

// 协工作用户记忆状态
export type CoworkUserMemoryStatus = 'created' | 'stale' | 'deleted';

// 协工作用户记忆条目
export interface CoworkUserMemoryEntry {
  id: string;
  text: string;  // 记忆文本内容
  confidence: number;  // 置信度
  isExplicit: boolean;  // 是否为显式记忆
  status: CoworkUserMemoryStatus;  // 记忆状态
  createdAt: number;  // 创建时间戳
  updatedAt: number;  // 更新时间戳
  lastUsedAt: number | null;  // 最后使用时间戳
}

// 协工作记忆统计信息
export interface CoworkMemoryStats {
  total: number;  // 总数量
  created: number;  // 已创建数量
  stale: number;  // 已过期数量
  deleted: number;  // 已删除数量
  explicit: number;  // 显式记忆数量
  implicit: number;  // 隐式记忆数量
}

// 协工作待处理的权限请求
export interface CoworkPermissionRequest {
  sessionId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  requestId: string;
  toolUseId?: string | null;
}

// 协工作权限结果
export type CoworkPermissionResult =
  | {
      behavior: 'allow';  // 允许执行
      updatedInput?: Record<string, unknown>;  // 更新后的输入参数
      updatedPermissions?: Record<string, unknown>[];  // 更新后的权限列表
      toolUseID?: string;  // 工具使用ID
    }
  | {
      behavior: 'deny';  // 拒绝执行
      message: string;  // 拒绝原因消息
      interrupt?: boolean;  // 是否中断会话
      toolUseID?: string;  // 工具使用ID
    };

// 协工作权限响应
export interface CoworkPermissionResponse {
  requestId: string;
  result: CoworkPermissionResult;
}

// 用于列表显示的会话摘要（不包含完整消息列表）
export interface CoworkSessionSummary {
  id: string;
  title: string;
  status: CoworkSessionStatus;
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
}

// 启动会话选项
export interface CoworkStartOptions {
  prompt: string;
  cwd?: string;
  systemPrompt?: string;
  title?: string;
  activeSkillIds?: string[];
}

// 继续会话选项
export interface CoworkContinueOptions {
  sessionId: string;
  prompt: string;
  systemPrompt?: string;
  activeSkillIds?: string[];
}

// IPC结果类型 - 会话结果
export interface CoworkSessionResult {
  success: boolean;  // 操作是否成功
  session?: CoworkSession;  // 协工作会话对象
  error?: string;  // 错误信息
}

// IPC结果类型 - 会话列表结果
export interface CoworkSessionListResult {
  success: boolean;  // 操作是否成功
  sessions?: CoworkSessionSummary[];  // 会话摘要列表
  error?: string;  // 错误信息
}

// IPC结果类型 - 配置结果
export interface CoworkConfigResult {
  success: boolean;  // 操作是否成功
  config?: CoworkConfig;  // 协工作配置对象
  error?: string;  // 错误信息
}

// 用于IPC通信的流事件类型
export type CoworkStreamEventType =
  | 'message'
  | 'tool_use'
  | 'tool_result'
  | 'permission_request'
  | 'complete'
  | 'error';

// 协工作流事件
export interface CoworkStreamEvent {
  type: CoworkStreamEventType;  // 事件类型
  sessionId: string;  // 会话ID
  data: {
    message?: CoworkMessage;  // 消息数据
    permission?: CoworkPermissionRequest;  // 权限请求数据
    error?: string;  // 错误信息
    claudeSessionId?: string;  // Claude会话ID
  };
}
