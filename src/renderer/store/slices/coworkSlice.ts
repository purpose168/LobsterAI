import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import type {
  CoworkSession,
  CoworkSessionSummary,
  CoworkMessage,
  CoworkConfig,
  CoworkPermissionRequest,
  CoworkSessionStatus,
} from '../../types/cowork';

/**
 * 协作状态接口 - 定义协同工作功能的所有状态管理字段
 */
interface CoworkState {
  sessions: CoworkSessionSummary[];  // 协作会话摘要列表
  currentSessionId: string | null;  // 当前会话ID
  currentSession: CoworkSession | null;  // 当前会话完整数据
  draftPrompt: string;  // 草稿提示词
  unreadSessionIds: string[];  // 未读会话ID列表
  isCoworkActive: boolean;  // 协作功能是否激活
  isStreaming: boolean;  // 是否正在流式传输
  pendingPermissions: CoworkPermissionRequest[];  // 待处理的权限请求队列
  config: CoworkConfig;  // 协作配置
}

/**
 * 初始状态 - 协作功能的默认状态值
 */
const initialState: CoworkState = {
  sessions: [],
  currentSessionId: null,
  currentSession: null,
  draftPrompt: '',
  unreadSessionIds: [],
  isCoworkActive: false,
  isStreaming: false,
  pendingPermissions: [],
  config: {
    workingDirectory: '',
    systemPrompt: '',
    executionMode: 'local',
    memoryEnabled: true,
    memoryImplicitUpdateEnabled: true,
    memoryLlmJudgeEnabled: false,
    memoryGuardLevel: 'strict',
    memoryUserMemoriesMaxItems: 12,
  },
};

/**
 * 将指定会话标记为已读状态
 * @param state - 协作状态对象
 * @param sessionId - 要标记为已读的会话ID
 */
const markSessionRead = (state: CoworkState, sessionId: string | null) => {
  if (!sessionId) return;
  // 从未读列表中移除该会话ID
  state.unreadSessionIds = state.unreadSessionIds.filter((id) => id !== sessionId);
};

/**
 * 将指定会话标记为未读状态
 * @param state - 协作状态对象
 * @param sessionId - 要标记为未读的会话ID
 */
const markSessionUnread = (state: CoworkState, sessionId: string) => {
  // 如果当前正查看该会话，则不标记为未读
  if (state.currentSessionId === sessionId) return;
  // 如果已在未读列表中，则不重复添加
  if (state.unreadSessionIds.includes(sessionId)) return;
  state.unreadSessionIds.push(sessionId);
};

/**
 * 协作切片 - 管理协同工作相关状态的Redux切片
 * 包含会话管理、消息处理、权限控制等功能
 */
const coworkSlice = createSlice({
  name: 'cowork',
  initialState,
  reducers: {
    /**
     * 设置协作功能是否激活
     */
    setCoworkActive(state, action: PayloadAction<boolean>) {
      state.isCoworkActive = action.payload;
    },

    /**
     * 设置会话列表
     * @param action.payload - 新的会话摘要列表
     */
    setSessions(state, action: PayloadAction<CoworkSessionSummary[]>) {
      state.sessions = action.payload;
      // 过滤未读会话ID，只保留有效且非当前会话的未读状态
      const validSessionIds = new Set(action.payload.map((session) => session.id));
      state.unreadSessionIds = state.unreadSessionIds.filter((id) => {
        return validSessionIds.has(id) && id !== state.currentSessionId;
      });
    },

    /**
     * 设置当前会话ID
     * @param action.payload - 新的当前会话ID
     */
    setCurrentSessionId(state, action: PayloadAction<string | null>) {
      state.currentSessionId = action.payload;
      markSessionRead(state, action.payload);
    },

    /**
     * 设置当前会话完整数据
     * @param action.payload - 新的当前会话对象
     */
    setCurrentSession(state, action: PayloadAction<CoworkSession | null>) {
      state.currentSession = action.payload;
      if (action.payload) {
        state.currentSessionId = action.payload.id;
        // 非临时会话（以temp-开头）需要添加到会话列表
        if (!action.payload.id.startsWith('temp-')) {
          const { id, title, status, pinned, createdAt, updatedAt } = action.payload;
          const summary: CoworkSessionSummary = {
            id,
            title,
            status,
            pinned: pinned ?? false,
            createdAt,
            updatedAt,
          };
          const sessionIndex = state.sessions.findIndex((session) => session.id === id);
          if (sessionIndex !== -1) {
            // 更新列表中已存在的会话摘要
            state.sessions[sessionIndex] = {
              ...state.sessions[sessionIndex],
              ...summary,
            };
          } else {
            // 将新会话添加到列表顶部
            state.sessions.unshift(summary);
          }
        }
        markSessionRead(state, action.payload.id);
      }
    },

    /**
     * 设置草稿提示词
     * @param action.payload - 新的草稿提示词文本
     */
    setDraftPrompt(state, action: PayloadAction<string>) {
      state.draftPrompt = action.payload;
    },

    /**
     * 添加新会话
     * @param action.payload - 要添加的会话对象
     */
    addSession(state, action: PayloadAction<CoworkSession>) {
      const summary: CoworkSessionSummary = {
        id: action.payload.id,
        title: action.payload.title,
        status: action.payload.status,
        pinned: action.payload.pinned ?? false,
        createdAt: action.payload.createdAt,
        updatedAt: action.payload.updatedAt,
      };
      state.sessions.unshift(summary);
      state.currentSession = action.payload;
      state.currentSessionId = action.payload.id;
      markSessionRead(state, action.payload.id);
    },

    /**
     * 更新会话状态
     * @param action.payload - 包含sessionId和status的对象
     */
    updateSessionStatus(state, action: PayloadAction<{ sessionId: string; status: CoworkSessionStatus }>) {
      const { sessionId, status } = action.payload;

      // 更新会话列表中的会话状态
      const sessionIndex = state.sessions.findIndex(s => s.id === sessionId);
      if (sessionIndex !== -1) {
        state.sessions[sessionIndex].status = status;
        state.sessions[sessionIndex].updatedAt = Date.now();
      }

      // 如果是当前打开的会话，同时更新currentSession的状态
      if (state.currentSession?.id === sessionId) {
        state.currentSession.status = status;
        state.currentSession.updatedAt = Date.now();
        // 流式状态仅与当前打开的会话绑定
        state.isStreaming = status === 'running';
      }
    },

    /**
     * 删除会话
     * @param action.payload - 要删除的会话ID
     */
    deleteSession(state, action: PayloadAction<string>) {
      const sessionId = action.payload;
      // 从会话列表中移除
      state.sessions = state.sessions.filter(s => s.id !== sessionId);
      // 从未读列表中移除
      state.unreadSessionIds = state.unreadSessionIds.filter((id) => id !== sessionId);

      // 如果删除的是当前会话，清空当前会话状态
      if (state.currentSessionId === sessionId) {
        state.currentSessionId = null;
        state.currentSession = null;
      }
    },

    /**
     * 添加消息到会话
     * @param action.payload - 包含sessionId和message的对象
     */
    addMessage(state, action: PayloadAction<{ sessionId: string; message: CoworkMessage }>) {
      const { sessionId, message } = action.payload;

      // 如果是当前会话，添加消息到消息列表
      if (state.currentSession?.id === sessionId) {
        const exists = state.currentSession.messages.some((item) => item.id === message.id);
        if (!exists) {
          state.currentSession.messages.push(message);
          state.currentSession.updatedAt = message.timestamp;
        }
      }

      // 更新会话列表中该会话的更新时间
      const sessionIndex = state.sessions.findIndex(s => s.id === sessionId);
      if (sessionIndex !== -1) {
        state.sessions[sessionIndex].updatedAt = message.timestamp;
      }

      // 标记该会话为未读
      markSessionUnread(state, sessionId);
    },

    /**
     * 更新消息内容
     * @param action.payload - 包含sessionId、messageId和content的对象
     */
    updateMessageContent(state, action: PayloadAction<{ sessionId: string; messageId: string; content: string }>) {
      const { sessionId, messageId, content } = action.payload;

      // 如果是当前会话，更新消息内容
      if (state.currentSession?.id === sessionId) {
        const messageIndex = state.currentSession.messages.findIndex(m => m.id === messageId);
        if (messageIndex !== -1) {
          state.currentSession.messages[messageIndex].content = content;
        }
      }

      // 标记该会话为未读（因为有新内容更新）
      markSessionUnread(state, sessionId);
    },

    /**
     * 设置流式传输状态
     * @param action.payload - 是否正在流式传输
     */
    setStreaming(state, action: PayloadAction<boolean>) {
      state.isStreaming = action.payload;
    },

    /**
     * 更新会话置顶状态
     * @param action.payload - 包含sessionId和pinned状态的对象
     */
    updateSessionPinned(state, action: PayloadAction<{ sessionId: string; pinned: boolean }>) {
      const { sessionId, pinned } = action.payload;
      const sessionIndex = state.sessions.findIndex(s => s.id === sessionId);
      if (sessionIndex !== -1) {
        state.sessions[sessionIndex].pinned = pinned;
      }
      if (state.currentSession?.id === sessionId) {
        state.currentSession.pinned = pinned;
      }
    },

    /**
     * 更新会话标题
     * @param action.payload - 包含sessionId和title的对象
     */
    updateSessionTitle(state, action: PayloadAction<{ sessionId: string; title: string }>) {
      const { sessionId, title } = action.payload;
      const sessionIndex = state.sessions.findIndex(s => s.id === sessionId);
      if (sessionIndex !== -1) {
        state.sessions[sessionIndex].title = title;
        state.sessions[sessionIndex].updatedAt = Date.now();
      }
      if (state.currentSession?.id === sessionId) {
        state.currentSession.title = title;
        state.currentSession.updatedAt = Date.now();
      }
    },

    /**
     * 将权限请求加入待处理队列
     * @param action.payload - 权限请求对象
     */
    enqueuePendingPermission(state, action: PayloadAction<CoworkPermissionRequest>) {
      // 检查是否已在队列中，避免重复添加
      const alreadyQueued = state.pendingPermissions.some(
        (permission) => permission.requestId === action.payload.requestId
      );
      if (alreadyQueued) return;
      state.pendingPermissions.push(action.payload);
    },

    /**
     * 从待处理队列中移除权限请求
     * @param action.payload - 包含requestId的对象，如果不提供则移除队列第一个元素
     */
    dequeuePendingPermission(state, action: PayloadAction<{ requestId?: string } | undefined>) {
      const requestId = action.payload?.requestId;
      if (!requestId) {
        // 未指定ID时，移除队列第一个元素
        state.pendingPermissions.shift();
        return;
      }
      state.pendingPermissions = state.pendingPermissions.filter(
        (permission) => permission.requestId !== requestId
      );
    },

    /**
     * 清空所有待处理的权限请求
     */
    clearPendingPermissions(state) {
      state.pendingPermissions = [];
    },

    /**
     * 设置协作配置
     * @param action.payload - 新的配置对象
     */
    setConfig(state, action: PayloadAction<CoworkConfig>) {
      state.config = action.payload;
    },

    /**
     * 更新协作配置（部分更新）
     * @param action.payload - 要更新的配置字段
     */
    updateConfig(state, action: PayloadAction<Partial<CoworkConfig>>) {
      state.config = { ...state.config, ...action.payload };
    },

    /**
     * 清空当前会话
     * 重置当前会话相关状态
     */
    clearCurrentSession(state) {
      state.currentSessionId = null;
      state.currentSession = null;
      state.isStreaming = false;
    },
  },
});

// 导出所有action creators
export const {
  setCoworkActive,
  setSessions,
  setCurrentSessionId,
  setCurrentSession,
  setDraftPrompt,
  addSession,
  updateSessionStatus,
  deleteSession,
  addMessage,
  updateMessageContent,
  setStreaming,
  updateSessionPinned,
  updateSessionTitle,
  enqueuePendingPermission,
  dequeuePendingPermission,
  clearPendingPermissions,
  setConfig,
  updateConfig,
  clearCurrentSession,
} = coworkSlice.actions;

// 导出reducer
export default coworkSlice.reducer;
