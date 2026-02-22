import { store } from '../store';
import {
  setSessions,
  setCurrentSession,
  addSession,
  updateSessionStatus,
  deleteSession as deleteSessionAction,
  addMessage,
  updateMessageContent,
  setStreaming,
  updateSessionPinned,
  updateSessionTitle,
  enqueuePendingPermission,
  dequeuePendingPermission,
  setConfig,
  clearCurrentSession,
} from '../store/slices/coworkSlice';
import type {
  CoworkSession,
  CoworkConfigUpdate,
  CoworkApiConfig,
  CoworkSandboxStatus,
  CoworkSandboxProgress,
  CoworkUserMemoryEntry,
  CoworkMemoryStats,
  CoworkPermissionResult,
  CoworkStartOptions,
  CoworkContinueOptions,
} from '../types/cowork';

class CoworkService {
  // 流监听器清理函数数组
  private streamListenerCleanups: Array<() => void> = [];
  // 初始化标志
  private initialized = false;

  /**
   * 初始化协作服务
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    // 加载初始配置
    await this.loadConfig();

    // 加载会话列表
    await this.loadSessions();

    // 设置流监听器
    this.setupStreamListeners();

    this.initialized = true;
  }

  /**
   * 设置流监听器
   */
  private setupStreamListeners(): void {
    const cowork = window.electron?.cowork;
    if (!cowork) return;

    // 清理现有的监听器
    this.cleanupListeners();

    // 消息监听器 - 同时检查会话是否存在（用于IM创建的会话）
    const messageCleanup = cowork.onStreamMessage(async ({ sessionId, message }) => {
      // 检查会话是否存在于当前列表中
      const state = store.getState().cowork;
      const sessionExists = state.sessions.some(s => s.id === sessionId);

      if (!sessionExists) {
        // 会话是由IM或其他来源创建的，刷新会话列表
        await this.loadSessions();
      }

      // 新的用户轮次意味着此会话正在主动运行
      // （对于不从渲染器调用continueSession的IM触发轮次尤为重要）
      if (message.type === 'user') {
        store.dispatch(updateSessionStatus({ sessionId, status: 'running' }));
      }

      // 不要在任意消息上将状态强制恢复为"running"
      // 晚到的流块可能在错误/完成事件之后到达
      store.dispatch(addMessage({ sessionId, message }));
    });
    this.streamListenerCleanups.push(messageCleanup);

    // 消息更新监听器（用于流式内容更新）
    const messageUpdateCleanup = cowork.onStreamMessageUpdate(({ sessionId, messageId, content }) => {
      store.dispatch(updateMessageContent({ sessionId, messageId, content }));
    });
    this.streamListenerCleanups.push(messageUpdateCleanup);

    // 权限请求监听器
    const permissionCleanup = cowork.onStreamPermission(({ sessionId, request }) => {
      store.dispatch(enqueuePendingPermission({
        sessionId,
        toolName: request.toolName,
        toolInput: request.toolInput,
        requestId: request.requestId,
        toolUseId: request.toolUseId ?? null,
      }));
    });
    this.streamListenerCleanups.push(permissionCleanup);

    // 完成监听器
    const completeCleanup = cowork.onStreamComplete(({ sessionId }) => {
      store.dispatch(updateSessionStatus({ sessionId, status: 'completed' }));
    });
    this.streamListenerCleanups.push(completeCleanup);

    // 错误监听器
    const errorCleanup = cowork.onStreamError(({ sessionId }) => {
      store.dispatch(updateSessionStatus({ sessionId, status: 'error' }));
    });
    this.streamListenerCleanups.push(errorCleanup);
  }

  /**
   * 清理监听器
   */
  private cleanupListeners(): void {
    this.streamListenerCleanups.forEach(cleanup => cleanup());
    this.streamListenerCleanups = [];
  }

  /**
   * 加载会话列表
   */
  async loadSessions(): Promise<void> {
    const result = await window.electron?.cowork?.listSessions();
    if (result?.success && result.sessions) {
      store.dispatch(setSessions(result.sessions));
    }
  }

  /**
   * 加载配置
   */
  async loadConfig(): Promise<void> {
    const result = await window.electron?.cowork?.getConfig();
    if (result?.success && result.config) {
      store.dispatch(setConfig(result.config));
    }
  }

  /**
   * 启动会话
   * @param options 会话启动选项
   * @returns 会话对象或null
   */
  async startSession(options: CoworkStartOptions): Promise<CoworkSession | null> {
    const cowork = window.electron?.cowork;
    if (!cowork) {
      console.error('协作API不可用');
      return null;
    }

    store.dispatch(setStreaming(true));

    const result = await cowork.startSession(options);
    if (result.success && result.session) {
      store.dispatch(addSession(result.session));
      return result.session;
    }

    store.dispatch(setStreaming(false));
    console.error('启动会话失败:', result.error);
    return null;
  }

  /**
   * 继续会话
   * @param options 会话继续选项
   * @returns 是否成功
   */
  async continueSession(options: CoworkContinueOptions): Promise<boolean> {
    const cowork = window.electron?.cowork;
    if (!cowork) {
      console.error('协作API不可用');
      return false;
    }

    store.dispatch(setStreaming(true));
    store.dispatch(updateSessionStatus({ sessionId: options.sessionId, status: 'running' }));

    const result = await cowork.continueSession({
      sessionId: options.sessionId,
      prompt: options.prompt,
      systemPrompt: options.systemPrompt,
      activeSkillIds: options.activeSkillIds,
    });
    if (!result.success) {
      store.dispatch(setStreaming(false));
      store.dispatch(updateSessionStatus({ sessionId: options.sessionId, status: 'error' }));
      console.error('继续会话失败:', result.error);
      return false;
    }

    return true;
  }

  /**
   * 停止会话
   * @param sessionId 会话ID
   * @returns 是否成功
   */
  async stopSession(sessionId: string): Promise<boolean> {
    const cowork = window.electron?.cowork;
    if (!cowork) return false;

    const result = await cowork.stopSession(sessionId);
    if (result.success) {
      store.dispatch(setStreaming(false));
      store.dispatch(updateSessionStatus({ sessionId, status: 'idle' }));
      return true;
    }

    console.error('停止会话失败:', result.error);
    return false;
  }

  /**
   * 删除会话
   * @param sessionId 会话ID
   * @returns 是否成功
   */
  async deleteSession(sessionId: string): Promise<boolean> {
    const cowork = window.electron?.cowork;
    if (!cowork) return false;

    const result = await cowork.deleteSession(sessionId);
    if (result.success) {
      store.dispatch(deleteSessionAction(sessionId));
      return true;
    }

    console.error('删除会话失败:', result.error);
    return false;
  }

  /**
   * 设置会话置顶状态
   * @param sessionId 会话ID
   * @param pinned 是否置顶
   * @returns 是否成功
   */
  async setSessionPinned(sessionId: string, pinned: boolean): Promise<boolean> {
    const cowork = window.electron?.cowork;
    if (!cowork?.setSessionPinned) return false;

    const result = await cowork.setSessionPinned({ sessionId, pinned });
    if (result.success) {
      store.dispatch(updateSessionPinned({ sessionId, pinned }));
      return true;
    }

    console.error('更新会话置顶状态失败:', result.error);
    return false;
  }

  /**
   * 重命名会话
   * @param sessionId 会话ID
   * @param title 新标题
   * @returns 是否成功
   */
  async renameSession(sessionId: string, title: string): Promise<boolean> {
    const cowork = window.electron?.cowork;
    if (!cowork?.renameSession) return false;

    const normalizedTitle = title.trim();
    if (!normalizedTitle) return false;

    const result = await cowork.renameSession({ sessionId, title: normalizedTitle });
    if (result.success) {
      store.dispatch(updateSessionTitle({ sessionId, title: normalizedTitle }));
      return true;
    }

    console.error('重命名会话失败:', result.error);
    return false;
  }

  /**
   * 导出会话结果图片
   * @param options 导出选项（包含矩形区域和默认文件名）
   * @returns 导出结果
   */
  async exportSessionResultImage(options: {
    rect: { x: number; y: number; width: number; height: number };
    defaultFileName?: string;
  }): Promise<{ success: boolean; canceled?: boolean; path?: string; error?: string }> {
    const cowork = window.electron?.cowork;
    if (!cowork?.exportResultImage) {
      return { success: false, error: '协作导出API不可用' };
    }

    try {
      const result = await cowork.exportResultImage(options);
      return result ?? { success: false, error: '导出会话图片失败' };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '导出会话图片失败',
      };
    }
  }

  /**
   * 捕获会话图片块
   * @param options 捕获选项（包含矩形区域）
   * @returns 捕获结果（包含图片尺寸和base64数据）
   */
  async captureSessionImageChunk(options: {
    rect: { x: number; y: number; width: number; height: number };
  }): Promise<{ success: boolean; width?: number; height?: number; pngBase64?: string; error?: string }> {
    const cowork = window.electron?.cowork;
    if (!cowork?.captureImageChunk) {
      return { success: false, error: '协作捕获API不可用' };
    }

    try {
      const result = await cowork.captureImageChunk(options);
      return result ?? { success: false, error: '捕获会话图片块失败' };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '捕获会话图片块失败',
      };
    }
  }

  /**
   * 保存会话结果图片
   * @param options 保存选项（包含base64图片数据和默认文件名）
   * @returns 保存结果
   */
  async saveSessionResultImage(options: {
    pngBase64: string;
    defaultFileName?: string;
  }): Promise<{ success: boolean; canceled?: boolean; path?: string; error?: string }> {
    const cowork = window.electron?.cowork;
    if (!cowork?.saveResultImage) {
      return { success: false, error: '协作保存图片API不可用' };
    }

    try {
      const result = await cowork.saveResultImage(options);
      return result ?? { success: false, error: '保存会话图片失败' };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '保存会话图片失败',
      };
    }
  }

  /**
   * 加载会话
   * @param sessionId 会话ID
   * @returns 会话对象或null
   */
  async loadSession(sessionId: string): Promise<CoworkSession | null> {
    const cowork = window.electron?.cowork;
    if (!cowork) return null;

    const result = await cowork.getSession(sessionId);
    if (result.success && result.session) {
      store.dispatch(setCurrentSession(result.session));
      store.dispatch(setStreaming(result.session.status === 'running'));
      return result.session;
    }

    console.error('加载会话失败:', result.error);
    return null;
  }

  /**
   * 响应权限请求
   * @param requestId 请求ID
   * @param result 权限结果
   * @returns 是否成功
   */
  async respondToPermission(requestId: string, result: CoworkPermissionResult): Promise<boolean> {
    const cowork = window.electron?.cowork;
    if (!cowork) return false;

    const response = await cowork.respondToPermission({ requestId, result });
    if (response.success) {
      store.dispatch(dequeuePendingPermission({ requestId }));
      return true;
    }

    console.error('响应权限请求失败:', response.error);
    return false;
  }

  /**
   * 更新配置
   * @param config 配置更新对象
   * @returns 是否成功
   */
  async updateConfig(config: CoworkConfigUpdate): Promise<boolean> {
    const cowork = window.electron?.cowork;
    if (!cowork) return false;

    const result = await cowork.setConfig(config);
    if (result.success) {
      const currentConfig = store.getState().cowork.config;
      store.dispatch(setConfig({ ...currentConfig, ...config }));
      return true;
    }

    console.error('更新配置失败:', result.error);
    return false;
  }

  /**
   * 获取API配置
   * @returns API配置对象或null
   */
  async getApiConfig(): Promise<CoworkApiConfig | null> {
    if (!window.electron?.getApiConfig) {
      return null;
    }
    return window.electron.getApiConfig();
  }

  /**
   * 检查API配置
   * @returns 检查结果
   */
  async checkApiConfig(): Promise<{ hasConfig: boolean; config: CoworkApiConfig | null; error?: string } | null> {
    if (!window.electron?.checkApiConfig) {
      return null;
    }
    return window.electron.checkApiConfig();
  }

  /**
   * 保存API配置
   * @param config API配置对象
   * @returns 保存结果
   */
  async saveApiConfig(config: CoworkApiConfig): Promise<{ success: boolean; error?: string } | null> {
    if (!window.electron?.saveApiConfig) {
      return null;
    }
    return window.electron.saveApiConfig(config);
  }

  /**
   * 获取沙箱状态
   * @returns 沙箱状态或null
   */
  async getSandboxStatus(): Promise<CoworkSandboxStatus | null> {
    if (!window.electron?.cowork?.getSandboxStatus) {
      return null;
    }
    return window.electron.cowork.getSandboxStatus();
  }

  /**
   * 安装沙箱
   * @returns 安装结果
   */
  async installSandbox(): Promise<{ success: boolean; status: CoworkSandboxStatus; error?: string } | null> {
    if (!window.electron?.cowork?.installSandbox) {
      return null;
    }
    return window.electron.cowork.installSandbox();
  }

  /**
   * 列出记忆条目
   * @param input 查询输入参数
   * @returns 记忆条目数组
   */
  async listMemoryEntries(input: {
    query?: string;
    status?: 'created' | 'stale' | 'deleted' | 'all';
    includeDeleted?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<CoworkUserMemoryEntry[]> {
    const api = window.electron?.cowork?.listMemoryEntries;
    if (!api) return [];
    const result = await api(input);
    if (!result?.success || !result.entries) return [];
    return result.entries;
  }

  /**
   * 创建记忆条目
   * @param input 创建输入参数
   * @returns 创建的记忆条目或null
   */
  async createMemoryEntry(input: {
    text: string;
    confidence?: number;
    isExplicit?: boolean;
  }): Promise<CoworkUserMemoryEntry | null> {
    const api = window.electron?.cowork?.createMemoryEntry;
    if (!api) return null;
    const result = await api(input);
    if (!result?.success || !result.entry) return null;
    return result.entry;
  }

  /**
   * 更新记忆条目
   * @param input 更新输入参数
   * @returns 更新后的记忆条目或null
   */
  async updateMemoryEntry(input: {
    id: string;
    text?: string;
    confidence?: number;
    status?: 'created' | 'stale' | 'deleted';
    isExplicit?: boolean;
  }): Promise<CoworkUserMemoryEntry | null> {
    const api = window.electron?.cowork?.updateMemoryEntry;
    if (!api) return null;
    const result = await api(input);
    if (!result?.success || !result.entry) return null;
    return result.entry;
  }

  /**
   * 删除记忆条目
   * @param input 删除输入参数
   * @returns 是否成功
   */
  async deleteMemoryEntry(input: { id: string }): Promise<boolean> {
    const api = window.electron?.cowork?.deleteMemoryEntry;
    if (!api) return false;
    const result = await api(input);
    return Boolean(result?.success);
  }

  /**
   * 获取记忆统计信息
   * @returns 记忆统计信息或null
   */
  async getMemoryStats(): Promise<CoworkMemoryStats | null> {
    const api = window.electron?.cowork?.getMemoryStats;
    if (!api) return null;
    const result = await api();
    if (!result?.success || !result.stats) return null;
    return result.stats;
  }

  /**
   * 监听沙箱下载进度
   * @param callback 进度回调函数
   * @returns 清理函数
   */
  onSandboxDownloadProgress(callback: (progress: CoworkSandboxProgress) => void): () => void {
    if (!window.electron?.cowork?.onSandboxDownloadProgress) {
      return () => {};
    }
    return window.electron.cowork.onSandboxDownloadProgress(callback);
  }

  /**
   * 生成会话标题
   * @param prompt 提示文本
   * @returns 生成的标题或null
   */
  async generateSessionTitle(prompt: string | null): Promise<string | null> {
    if (!window.electron?.generateSessionTitle) {
      return null;
    }
    return window.electron.generateSessionTitle(prompt);
  }

  /**
   * 获取最近的工作目录
   * @param limit 限制数量
   * @returns 工作目录数组
   */
  async getRecentCwds(limit?: number): Promise<string[]> {
    if (!window.electron?.getRecentCwds) {
      return [];
    }
    return window.electron.getRecentCwds(limit);
  }

  /**
   * 清除当前会话
   */
  clearSession(): void {
    store.dispatch(clearCurrentSession());
  }

  /**
   * 销毁服务
   */
  destroy(): void {
    this.cleanupListeners();
    this.initialized = false;
  }
}

export const coworkService = new CoworkService();
