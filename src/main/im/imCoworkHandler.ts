/**
 * IM 协作处理器
 * 适配器，使 IM（钉钉/飞书/Telegram）能够使用 CoworkRunner 进行支持工具的 AI 执行
 */

import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import type { PermissionResult } from '@anthropic-ai/claude-agent-sdk';
import type { CoworkRunner, PermissionRequest } from '../libs/coworkRunner';
import type { CoworkStore, CoworkMessage } from '../coworkStore';
import type { IMStore } from './imStore';
import type { IMMessage, IMPlatform, IMMediaAttachment } from './types';

/**
 * 消息累加器接口
 * 用于累积会话中的消息并管理响应承诺
 */
interface MessageAccumulator {
  messages: CoworkMessage[];      // 累积的消息列表
  resolve: (text: string) => void; // 成功回调函数
  reject: (error: Error) => void;  // 失败回调函数
  timeoutId?: NodeJS.Timeout;      // 超时定时器ID
}

/**
 * 待处理的 IM 权限请求接口
 * 用于跟踪等待用户确认的权限请求
 */
interface PendingIMPermission {
  key: string;                    // 会话键（格式：platform:conversationId）
  sessionId: string;              // 协作会话ID
  request: PermissionRequest;     // 权限请求对象
  conversationId: string;         // IM 会话ID
  platform: IMPlatform;           // IM 平台类型
  createdAt: number;              // 创建时间戳
  timeoutId?: NodeJS.Timeout;     // 超时定时器ID
}

const PERMISSION_CONFIRM_TIMEOUT_MS = 60_000;  // 权限确认超时时间（60秒）
const IM_ALLOW_RESPONSE_RE = /^(允许|同意|yes|y)$/i;  // 允许操作的响应正则
const IM_DENY_RESPONSE_RE = /^(拒绝|不同意|no|n)$/i;  // 拒绝操作的响应正则
const IM_ALLOW_OPTION_LABEL = '允许本次操作';  // 允许选项的标签文本

/**
 * IM 协作处理器配置选项
 */
export interface IMCoworkHandlerOptions {
  coworkRunner: CoworkRunner;                              // 协作运行器实例
  coworkStore: CoworkStore;                                // 协作存储实例
  imStore: IMStore;                                        // IM 存储实例
  getSkillsPrompt?: () => Promise<string | null>;          // 获取技能提示的函数
  timeout?: number; // 超时时间（毫秒），默认 120000（2分钟）
}

/**
 * IM 协作处理器类
 * 负责处理 IM 平台消息并与 CoworkRunner 集成
 */
export class IMCoworkHandler extends EventEmitter {
  private coworkRunner: CoworkRunner;
  private coworkStore: CoworkStore;
  private imStore: IMStore;
  private getSkillsPrompt?: () => Promise<string | null>;
  private timeout: number;

  // 跟踪活动会话的消息累积
  private messageAccumulators: Map<string, MessageAccumulator> = new Map();

  // 跟踪由 IM 创建的会话（用于过滤事件）
  private imSessionIds: Set<string> = new Set();
  private sessionConversationMap: Map<string, { conversationId: string; platform: IMPlatform }> = new Map();
  private pendingPermissionByConversation: Map<string, PendingIMPermission> = new Map();

  constructor(options: IMCoworkHandlerOptions) {
    super();
    this.coworkRunner = options.coworkRunner;
    this.coworkStore = options.coworkStore;
    this.imStore = options.imStore;
    this.getSkillsPrompt = options.getSkillsPrompt;
    this.timeout = options.timeout ?? 120000;

    this.setupEventListeners();
  }

  /**
   * 为 CoworkRunner 设置事件监听器
   */
  private setupEventListeners(): void {
    this.coworkRunner.on('message', this.handleMessage.bind(this));
    this.coworkRunner.on('messageUpdate', this.handleMessageUpdate.bind(this));
    this.coworkRunner.on('permissionRequest', this.handlePermissionRequest.bind(this));
    this.coworkRunner.on('complete', this.handleComplete.bind(this));
    this.coworkRunner.on('error', this.handleError.bind(this));
  }

  /**
   * 使用 CoworkRunner 处理传入的 IM 消息
   * @param message IM 消息对象
   * @returns 处理结果文本
   */
  async processMessage(message: IMMessage): Promise<string> {
    // 首先检查是否有待处理的权限回复
    const pendingPermissionReply = await this.handlePendingPermissionReply(message);
    if (pendingPermissionReply !== null) {
      return pendingPermissionReply;
    }

    try {
      return await this.processMessageInternal(message, false);
    } catch (error) {
      if (!this.isSessionNotFoundError(error)) {
        throw error;
      }

      console.warn(
        `[IMCoworkHandler] ${message.platform}:${message.conversationId} 的协作会话映射已过期，正在重新创建会话`
      );
      return this.processMessageInternal(message, true);
    }
  }

  /**
   * 内部消息处理方法
   * @param message IM 消息对象
   * @param forceNewSession 是否强制创建新会话
   * @returns 处理结果文本
   */
  private async processMessageInternal(message: IMMessage, forceNewSession: boolean): Promise<string> {
    const coworkSessionId = await this.getOrCreateCoworkSession(
      message.conversationId,
      message.platform,
      forceNewSession
    );
    this.sessionConversationMap.set(coworkSessionId, {
      conversationId: message.conversationId,
      platform: message.platform,
    });

    const responsePromise = this.createAccumulatorPromise(coworkSessionId);

    // 启动或继续会话
    const isActive = this.coworkRunner.isSessionActive(coworkSessionId);
    const formattedContent = this.formatMessageWithMedia(message);
    const systemPrompt = await this.buildSystemPromptWithSkills();
    const hasAvailableSkills = systemPrompt.includes('<available_skills>');
    const session = this.coworkStore.getSession(coworkSessionId);
    if (session && session.systemPrompt !== systemPrompt) {
      // Claude 恢复会话可能会忽略更新的系统提示。
      // 重置 claudeSessionId，以便这一轮使用新的提示启动全新的 SDK 会话。
      this.coworkStore.updateSession(coworkSessionId, {
        systemPrompt,
        claudeSessionId: null,
      });
      console.log('[IMCoworkHandler] 系统提示已更改，重置 IM 会话的 claudeSessionId', JSON.stringify({
        coworkSessionId,
        platform: message.platform,
      }));
    }
    if (!hasAvailableSkills) {
      console.warn('[IMCoworkHandler] 当前 IM 轮次缺少技能自动路由提示');
    }

    // 打印完整的输入消息日志
    console.log(`[IMCoworkHandler] 处理消息:`, JSON.stringify({
      platform: message.platform,
      conversationId: message.conversationId,
      coworkSessionId,
      isActive,
      originalContent: message.content,
      formattedContent,
      attachments: message.attachments,
      hasAvailableSkills,
    }, null, 2));

    const onSessionStartError = (error: unknown) => {
      this.rejectAccumulator(
        coworkSessionId,
        error instanceof Error ? error : new Error(String(error))
      );
    };

    if (isActive) {
      this.coworkRunner.continueSession(coworkSessionId, formattedContent, { systemPrompt })
        .catch(onSessionStartError);
    } else {
      this.coworkRunner.startSession(coworkSessionId, formattedContent, {
        workspaceRoot: session?.cwd,
        confirmationMode: 'text',
        systemPrompt,
      }).catch(onSessionStartError);
    }

    return responsePromise;
  }

  /**
   * 获取或创建 IM 会话的协作会话
   * @param imConversationId IM 会话ID
   * @param platform IM 平台类型
   * @param forceNewSession 是否强制创建新会话
   * @returns 协作会话ID
   */
  private async getOrCreateCoworkSession(
    imConversationId: string,
    platform: IMPlatform,
    forceNewSession: boolean = false
  ): Promise<string> {
    if (forceNewSession) {
      const stale = this.imStore.getSessionMapping(imConversationId, platform);
      if (stale) {
        this.imStore.deleteSessionMapping(imConversationId, platform);
        this.imSessionIds.delete(stale.coworkSessionId);
        this.sessionConversationMap.delete(stale.coworkSessionId);
        this.clearPendingPermissionsBySessionId(stale.coworkSessionId);
        this.coworkRunner.stopSession(stale.coworkSessionId);
      }
    }

    // 检查现有映射
    const existing = forceNewSession ? null : this.imStore.getSessionMapping(imConversationId, platform);
    if (existing) {
      const session = this.coworkStore.getSession(existing.coworkSessionId);
      if (!session) {
        console.warn(
          `[IMCoworkHandler] 发现 ${platform}:${imConversationId} 的过期映射，会话 ${existing.coworkSessionId} 已丢失`
        );
        this.imStore.deleteSessionMapping(imConversationId, platform);
        this.imSessionIds.delete(existing.coworkSessionId);
        this.sessionConversationMap.delete(existing.coworkSessionId);
        this.clearPendingPermissionsBySessionId(existing.coworkSessionId);
        this.coworkRunner.stopSession(existing.coworkSessionId);
      } else {
        this.imStore.updateSessionLastActive(imConversationId, platform);
        this.imSessionIds.add(existing.coworkSessionId);
        this.sessionConversationMap.set(existing.coworkSessionId, {
          conversationId: imConversationId,
          platform,
        });
        return existing.coworkSessionId;
      }
    }

    // 创建新的协作会话
    return this.createCoworkSessionForConversation(imConversationId, platform);
  }

  /**
   * 为会话创建新的协作会话
   * @param imConversationId IM 会话ID
   * @param platform IM 平台类型
   * @returns 协作会话ID
   */
  private async createCoworkSessionForConversation(
    imConversationId: string,
    platform: IMPlatform
  ): Promise<string> {
    // 创建新的协作会话
    const config = this.coworkStore.getConfig();
    const title = `IM-${platform}-${Date.now()}`;
    const systemPrompt = await this.buildSystemPromptWithSkills();

    const selectedWorkspaceRoot = (config.workingDirectory || '').trim();
    if (!selectedWorkspaceRoot) {
      throw new Error('IM 工作目录未配置，请先在应用中选择任务目录。');
    }
    const resolvedWorkspaceRoot = path.resolve(selectedWorkspaceRoot);
    if (!fs.existsSync(resolvedWorkspaceRoot) || !fs.statSync(resolvedWorkspaceRoot).isDirectory()) {
      throw new Error(`IM 工作目录不存在或无效: ${resolvedWorkspaceRoot}`);
    }

    const session = this.coworkStore.createSession(
      title,
      resolvedWorkspaceRoot,
      systemPrompt,
      'local' // IM 始终使用本地模式
    );

    // 保存映射
    this.imStore.createSessionMapping(imConversationId, platform, session.id);
    this.imSessionIds.add(session.id);
    this.sessionConversationMap.set(session.id, {
      conversationId: imConversationId,
      platform,
    });

    return session.id;
  }

  /**
   * 构建包含技能的系统提示
   * @returns 系统提示文本
   */
  private async buildSystemPromptWithSkills(): Promise<string> {
    const config = this.coworkStore.getConfig();
    const imSettings = this.imStore.getIMSettings();
    const systemPrompt = config.systemPrompt || '';

    if (!imSettings.skillsEnabled || !this.getSkillsPrompt) {
      return systemPrompt;
    }

    const skillsPrompt = await this.getSkillsPrompt();
    if (!skillsPrompt) {
      return systemPrompt;
    }

    return systemPrompt
      ? `${skillsPrompt}\n\n${systemPrompt}`
      : skillsPrompt;
  }

  /**
   * 检查是否为会话未找到错误
   * @param error 错误对象
   * @returns 是否为会话未找到错误
   */
  private isSessionNotFoundError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return /^Session\s.+\snot found$/i.test(message.trim());
  }

  /**
   * 处理来自 CoworkRunner 的消息事件
   * @param sessionId 会话ID
   * @param message 协作消息对象
   */
  private handleMessage(sessionId: string, message: CoworkMessage): void {
    // 仅处理来自 IM 会话的消息
    if (!this.imSessionIds.has(sessionId)) return;

    const accumulator = this.messageAccumulators.get(sessionId);
    if (accumulator) {
      accumulator.messages.push(message);
    }
  }

  /**
   * 处理消息更新事件（流式内容）
   * @param sessionId 会话ID
   * @param messageId 消息ID
   * @param content 消息内容
   */
  private handleMessageUpdate(sessionId: string, messageId: string, content: string): void {
    // 仅处理来自 IM 会话的更新
    if (!this.imSessionIds.has(sessionId)) return;

    const accumulator = this.messageAccumulators.get(sessionId);
    if (accumulator) {
      // 更新累加器中的消息内容
      const existingIndex = accumulator.messages.findIndex(m => m.id === messageId);
      if (existingIndex >= 0) {
        accumulator.messages[existingIndex].content = content;
      }
    }
  }

  /**
   * 创建会话键
   * @param conversationId 会话ID
   * @param platform 平台类型
   * @returns 格式化的会话键
   */
  private createConversationKey(conversationId: string, platform: IMPlatform): string {
    return `${platform}:${conversationId}`;
  }

  /**
   * 创建累加器承诺
   * @param sessionId 会话ID
   * @returns 响应承诺
   */
  private createAccumulatorPromise(sessionId: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const existingAccumulator = this.messageAccumulators.get(sessionId);
      if (existingAccumulator) {
        if (existingAccumulator.timeoutId) {
          clearTimeout(existingAccumulator.timeoutId);
        }
        this.messageAccumulators.delete(sessionId);
        existingAccumulator.reject(new Error('已被更新的 IM 请求替换'));
      }

      // 设置超时
      const timeoutId = setTimeout(() => {
        const accumulator = this.messageAccumulators.get(sessionId);
        if (accumulator) {
          this.messageAccumulators.delete(sessionId);
          this.coworkRunner.stopSession(sessionId);
          reject(new Error('请求超时'));
        }
      }, this.timeout);

      // 设置消息累加器
      this.messageAccumulators.set(sessionId, {
        messages: [],
        resolve,
        reject,
        timeoutId,
      });
    });
  }

  /**
   * 拒绝累加器
   * @param sessionId 会话ID
   * @param error 错误对象
   */
  private rejectAccumulator(sessionId: string, error: Error): void {
    const accumulator = this.messageAccumulators.get(sessionId);
    if (!accumulator) return;
    this.cleanupAccumulator(sessionId);
    accumulator.reject(error);
  }

  /**
   * 根据键清除待处理的权限
   * @param key 会话键
   * @returns 被清除的待处理权限对象，如果不存在则返回 null
   */
  private clearPendingPermissionByKey(key: string): PendingIMPermission | null {
    const pending = this.pendingPermissionByConversation.get(key);
    if (!pending) return null;

    if (pending.timeoutId) {
      clearTimeout(pending.timeoutId);
    }
    this.pendingPermissionByConversation.delete(key);
    return pending;
  }

  /**
   * 根据会话ID清除所有待处理的权限
   * @param sessionId 会话ID
   */
  private clearPendingPermissionsBySessionId(sessionId: string): void {
    for (const [key, pending] of this.pendingPermissionByConversation.entries()) {
      if (pending.sessionId !== sessionId) continue;
      this.clearPendingPermissionByKey(key);
    }
  }

  /**
   * 构建 IM 权限提示
   * @param request 权限请求对象
   * @returns 格式化的权限提示文本
   */
  private buildIMPermissionPrompt(request: PermissionRequest): string {
    const questions = Array.isArray(request.toolInput?.questions)
      ? (request.toolInput.questions as Array<Record<string, unknown>>)
      : [];
    const firstQuestion = questions[0];
    const questionText = typeof firstQuestion?.question === 'string'
      ? firstQuestion.question
      : '';

    return [
      `检测到需要安全确认的操作（工具: ${request.toolName}）。`,
      questionText ? `说明: ${questionText}` : '说明: 当前操作涉及删除或访问任务目录外路径。',
      '请在 60 秒内回复"允许"或"拒绝"。',
    ].join('\n');
  }

  /**
   * 构建允许权限结果
   * @param request 权限请求对象
   * @returns 权限结果对象
   */
  private buildAllowPermissionResult(request: PermissionRequest): PermissionResult {
    if (request.toolName !== 'AskUserQuestion') {
      return {
        behavior: 'allow',
        updatedInput: request.toolInput,
      };
    }

    const input = request.toolInput && typeof request.toolInput === 'object'
      ? { ...(request.toolInput as Record<string, unknown>) }
      : {};
    const rawQuestions = Array.isArray(input.questions)
      ? (input.questions as Array<Record<string, unknown>>)
      : [];

    const answers: Record<string, string> = {};
    rawQuestions.forEach((question) => {
      const questionTitle = typeof question?.question === 'string' ? question.question : '';
      if (!questionTitle) return;
      const options = Array.isArray(question?.options)
        ? (question.options as Array<Record<string, unknown>>)
        : [];
      const preferredOption = options.find((option) => {
        const label = typeof option?.label === 'string' ? option.label : '';
        return label.includes(IM_ALLOW_OPTION_LABEL);
      });
      const fallbackOption = options[0];
      const selectedLabel = typeof preferredOption?.label === 'string'
        ? preferredOption.label
        : (typeof fallbackOption?.label === 'string' ? fallbackOption.label : IM_ALLOW_OPTION_LABEL);
      answers[questionTitle] = selectedLabel;
    });

    return {
      behavior: 'allow',
      updatedInput: {
        ...input,
        answers,
      },
    };
  }

  /**
   * 处理待处理的权限回复
   * @param message IM 消息对象
   * @returns 回复文本，如果没有待处理的权限则返回 null
   */
  private async handlePendingPermissionReply(message: IMMessage): Promise<string | null> {
    const key = this.createConversationKey(message.conversationId, message.platform);
    const pending = this.pendingPermissionByConversation.get(key);
    if (!pending) return null;

    const normalizedReply = message.content
      .trim()
      .replace(/[。！!,.，\s]+$/g, '');
    if (!normalizedReply) {
      return '当前有待确认操作，请回复"允许"或"拒绝"（60 秒内）。';
    }

    if (!this.coworkRunner.isSessionActive(pending.sessionId)) {
      this.clearPendingPermissionByKey(key);
      return '该确认请求已过期，请重新发送任务。';
    }

    if (IM_DENY_RESPONSE_RE.test(normalizedReply)) {
      this.clearPendingPermissionByKey(key);
      this.coworkRunner.respondToPermission(pending.request.requestId, {
        behavior: 'deny',
        message: '操作已被 IM 用户确认拒绝。',
      });
      return '已拒绝本次操作，任务未继续执行。';
    }

    if (!IM_ALLOW_RESPONSE_RE.test(normalizedReply)) {
      return '当前有待确认操作，请回复"允许"或"拒绝"（60 秒内）。';
    }

    this.clearPendingPermissionByKey(key);
    const responsePromise = this.createAccumulatorPromise(pending.sessionId);
    this.coworkRunner.respondToPermission(
      pending.request.requestId,
      this.buildAllowPermissionResult(pending.request)
    );
    return responsePromise;
  }

  /**
   * 在 IM 模式下处理权限请求，需要明确的用户确认
   * @param sessionId 会话ID
   * @param request 权限请求对象
   */
  private handlePermissionRequest(sessionId: string, request: PermissionRequest): void {
    // 仅处理来自 IM 会话的权限请求
    if (!this.imSessionIds.has(sessionId)) return;
    const conversation = this.sessionConversationMap.get(sessionId);
    if (!conversation) {
      this.coworkRunner.respondToPermission(request.requestId, {
        behavior: 'deny',
        message: '权限请求缺少 IM 会话映射。',
      });
      return;
    }

    const key = this.createConversationKey(conversation.conversationId, conversation.platform);
    const existingPending = this.clearPendingPermissionByKey(key);
    if (existingPending) {
      this.coworkRunner.respondToPermission(existingPending.request.requestId, {
        behavior: 'deny',
        message: '已被更新的权限请求取代。',
      });
    }

    const timeoutId = setTimeout(() => {
      const currentPending = this.pendingPermissionByConversation.get(key);
      if (!currentPending || currentPending.request.requestId !== request.requestId) {
        return;
      }
      this.clearPendingPermissionByKey(key);
      this.coworkRunner.respondToPermission(request.requestId, {
        behavior: 'deny',
        message: '权限请求在 60 秒后超时',
      });
    }, PERMISSION_CONFIRM_TIMEOUT_MS);

    this.pendingPermissionByConversation.set(key, {
      key,
      sessionId,
      request,
      conversationId: conversation.conversationId,
      platform: conversation.platform,
      createdAt: Date.now(),
      timeoutId,
    });

    const accumulator = this.messageAccumulators.get(sessionId);
    if (accumulator) {
      const confirmationPrompt = this.buildIMPermissionPrompt(request);
      this.cleanupAccumulator(sessionId);
      accumulator.resolve(confirmationPrompt);
    }
  }

  /**
   * 处理会话完成事件
   * @param sessionId 会话ID
   */
  private handleComplete(sessionId: string): void {
    // 仅处理来自 IM 会话的完成事件
    if (!this.imSessionIds.has(sessionId)) return;

    this.clearPendingPermissionsBySessionId(sessionId);
    const accumulator = this.messageAccumulators.get(sessionId);
    if (accumulator) {
      const replyText = this.formatReply(accumulator.messages);

      // 打印完整的输出消息日志
      console.log(`[IMCoworkHandler] 会话完成:`, JSON.stringify({
        sessionId,
        messageCount: accumulator.messages.length,
        replyLength: replyText.length,
        reply: replyText,
      }, null, 2));

      this.cleanupAccumulator(sessionId);
      accumulator.resolve(replyText);
    }
  }

  /**
   * 处理会话错误事件
   * @param sessionId 会话ID
   * @param error 错误消息
   */
  private handleError(sessionId: string, error: string): void {
    // 仅处理来自 IM 会话的错误事件
    if (!this.imSessionIds.has(sessionId)) return;

    this.clearPendingPermissionsBySessionId(sessionId);
    const accumulator = this.messageAccumulators.get(sessionId);
    if (accumulator) {
      this.cleanupAccumulator(sessionId);
      accumulator.reject(new Error(error));
    }
  }

  /**
   * 清理累加器和超时
   * @param sessionId 会话ID
   */
  private cleanupAccumulator(sessionId: string): void {
    const accumulator = this.messageAccumulators.get(sessionId);
    if (accumulator?.timeoutId) {
      clearTimeout(accumulator.timeoutId);
    }
    this.messageAccumulators.delete(sessionId);
  }

  /**
   * 将累积的消息格式化为回复字符串
   * @param messages 消息数组
   * @returns 格式化的回复文本
   */
  private formatReply(messages: CoworkMessage[]): string {
    const parts: string[] = [];

    for (const msg of messages) {
      // 跳过用户消息（它们是输入）
      if (msg.type === 'user') continue;

      // 仅在回复中包含助手消息
      if (msg.type === 'assistant' && msg.content) {
        parts.push(msg.content);
      }
    }

    return parts.join('\n\n') || '处理完成，但没有生成回复。';
  }

  /**
   * 格式化包含媒体附件信息的消息内容
   * 将媒体元数据附加到内容中，以便 AI 可以访问这些文件
   * @param message IM 消息对象
   * @returns 格式化后的消息内容
   */
  private formatMessageWithMedia(message: IMMessage): string {
    let content = message.content;

    if (message.attachments && message.attachments.length > 0) {
      const mediaInfo = message.attachments.map((att: IMMediaAttachment) => {
        const parts = [`类型: ${att.type}`, `路径: ${att.localPath}`];
        if (att.fileName) parts.push(`文件名: ${att.fileName}`);
        if (att.mimeType) parts.push(`MIME: ${att.mimeType}`);
        if (att.width && att.height) parts.push(`尺寸: ${att.width}x${att.height}`);
        if (att.duration) parts.push(`时长: ${att.duration}秒`);
        if (att.fileSize) parts.push(`大小: ${(att.fileSize / 1024).toFixed(1)}KB`);
        return `- ${parts.join(', ')}`;
      }).join('\n');

      content = content
        ? `${content}\n\n[附件信息]\n${mediaInfo}`
        : `[附件信息]\n${mediaInfo}`;
    }

    return content;
  }

  /**
   * 处理器销毁时的清理工作
   */
  destroy(): void {
    // 清除所有待处理的累加器
    for (const [_sessionId, accumulator] of this.messageAccumulators) {
      if (accumulator.timeoutId) {
        clearTimeout(accumulator.timeoutId);
      }
      accumulator.reject(new Error('处理器已销毁'));
    }
    this.messageAccumulators.clear();
    this.imSessionIds.clear();
    this.sessionConversationMap.clear();

    for (const [key, pending] of this.pendingPermissionByConversation.entries()) {
      if (pending.timeoutId) {
        clearTimeout(pending.timeoutId);
      }
      this.pendingPermissionByConversation.delete(key);
    }

    // 移除事件监听器
    this.coworkRunner.removeListener('message', this.handleMessage.bind(this));
    this.coworkRunner.removeListener('messageUpdate', this.handleMessageUpdate.bind(this));
    this.coworkRunner.removeListener('permissionRequest', this.handlePermissionRequest.bind(this));
    this.coworkRunner.removeListener('complete', this.handleComplete.bind(this));
    this.coworkRunner.removeListener('error', this.handleError.bind(this));
  }
}
