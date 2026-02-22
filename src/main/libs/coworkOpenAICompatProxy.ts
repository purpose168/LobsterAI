import http from 'http';
import { BrowserWindow, session } from 'electron';
import {
  anthropicToOpenAI,
  buildOpenAIChatCompletionsURL,
  formatSSEEvent,
  mapStopReason,
  openAIToAnthropic,
  type OpenAIStreamChunk,
} from './coworkFormatTransform';
import type { ScheduledTaskStore, ScheduledTaskInput } from '../scheduledTaskStore';
import type { Scheduler } from './scheduler';

// OpenAI兼容上游配置类型
export type OpenAICompatUpstreamConfig = {
  baseURL: string;
  apiKey?: string;
  model: string;
  provider?: string;
};

// OpenAI兼容代理目标类型
export type OpenAICompatProxyTarget = 'local' | 'sandbox';

// OpenAI兼容代理状态类型
export type OpenAICompatProxyStatus = {
  running: boolean;
  baseURL: string | null;
  hasUpstream: boolean;
  upstreamBaseURL: string | null;
  upstreamModel: string | null;
  lastError: string | null;
};

// 工具调用状态类型
type ToolCallState = {
  id?: string;
  name?: string;
  extraContent?: unknown;
};

// 流状态类型
type StreamState = {
  messageId: string | null;
  model: string | null;
  contentIndex: number;
  currentBlockType: 'thinking' | 'text' | 'tool_use' | null;
  activeToolIndex: number | null;
  hasMessageStart: boolean;
  hasMessageStop: boolean;
  toolCalls: Record<number, ToolCallState>;
};

// 上游API类型
type UpstreamAPIType = 'chat_completions' | 'responses';

// Responses函数调用状态类型
type ResponsesFunctionCallState = {
  outputIndex: number;
  callId: string;
  itemId: string;
  name: string;
  extraContent?: unknown;
  argumentsBuffer: string;
  finalArguments: string;
  emitted: boolean;
  metadataEmitted: boolean;
};

// Responses流上下文类型
type ResponsesStreamContext = {
  functionCallByOutputIndex: Map<number, ResponsesFunctionCallState>;
  functionCallByCallId: Map<string, ResponsesFunctionCallState>;
  functionCallByItemId: Map<string, ResponsesFunctionCallState>;
  nextToolIndex: number;
  hasAnyDelta: boolean;
};

// 代理绑定主机地址
const PROXY_BIND_HOST = '0.0.0.0';
// 本地主机地址
const LOCAL_HOST = '127.0.0.1';
// 沙箱主机地址
const SANDBOX_HOST = '10.0.2.2';
// Gemini回退思考签名
const GEMINI_FALLBACK_THOUGHT_SIGNATURE = 'skip_thought_signature_validator';

// 代理服务器实例
let proxyServer: http.Server | null = null;
// 代理端口
let proxyPort: number | null = null;
// 上游配置
let upstreamConfig: OpenAICompatUpstreamConfig | null = null;
// 最后的代理错误
let lastProxyError: string | null = null;
// 工具调用额外内容缓存（按ID索引）
const toolCallExtraContentById = new Map<string, unknown>();
// 工具调用额外内容缓存最大数量
const MAX_TOOL_CALL_EXTRA_CONTENT_CACHE = 1024;

// --- 计划任务API依赖 ---
interface ScheduledTaskDeps {
  getScheduledTaskStore: () => ScheduledTaskStore;
  getScheduler: () => Scheduler;
}
// 计划任务依赖实例
let scheduledTaskDeps: ScheduledTaskDeps | null = null;

/**
 * 设置计划任务依赖
 * @param deps - 计划任务依赖对象
 */
export function setScheduledTaskDeps(deps: ScheduledTaskDeps): void {
  scheduledTaskDeps = deps;
}

/**
 * 将值转换为可选对象
 * @param value - 要转换的值
 * @returns 如果是对象则返回该对象，否则返回null
 */
function toOptionalObject(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

/**
 * 将值转换为字符串
 * @param value - 要转换的值
 * @returns 字符串形式的值
 */
function toString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * 将值转换为数组
 * @param value - 要转换的值
 * @returns 数组形式的值
 */
function toArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * 将值转换为数字
 * @param value - 要转换的值
 * @returns 如果是有效数字则返回该数字，否则返回null
 */
function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  return null;
}

/**
 * 将未知值转换为字符串
 * @param value - 要转换的值
 * @returns 字符串形式的值
 */
function stringifyUnknown(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value ?? '');
  } catch {
    return '';
  }
}

/**
 * 规范化函数参数
 * @param value - 要规范化的值
 * @returns 规范化后的字符串参数
 */
function normalizeFunctionArguments(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (value === undefined) {
    return '';
  }
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

/**
 * 规范化计划任务工作目录
 * @param value - 要规范化的值
 * @returns 规范化后的工作目录路径
 */
function normalizeScheduledTaskWorkingDirectory(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return '';

  const normalized = raw.replace(/\\/g, '/').replace(/\/+$/, '');
  // 沙箱访客工作空间根目录不是有效的主机目录
  if (/^(?:[A-Za-z]:)?\/workspace(?:\/project)?$/i.test(normalized)) {
    return '';
  }
  return raw;
}

/**
 * 规范化工具调用额外内容
 * @param toolCallObj - 工具调用对象
 * @returns 规范化后的额外内容
 */
function normalizeToolCallExtraContent(toolCallObj: Record<string, unknown>): unknown {
  if (toolCallObj.extra_content !== undefined) {
    return toolCallObj.extra_content;
  }

  const functionObj = toOptionalObject(toolCallObj.function);
  if (functionObj?.extra_content !== undefined) {
    return functionObj.extra_content;
  }

  const thoughtSignature = toString(functionObj?.thought_signature);
  if (!thoughtSignature) {
    return undefined;
  }

  return {
    google: {
      thought_signature: thoughtSignature,
    },
  };
}

/**
 * 缓存工具调用额外内容
 * @param toolCallId - 工具调用ID
 * @param extraContent - 额外内容
 */
function cacheToolCallExtraContent(toolCallId: string, extraContent: unknown): void {
  if (!toolCallId || extraContent === undefined) {
    return;
  }

  toolCallExtraContentById.set(toolCallId, extraContent);

  if (toolCallExtraContentById.size > MAX_TOOL_CALL_EXTRA_CONTENT_CACHE) {
    const oldestKey = toolCallExtraContentById.keys().next().value;
    if (typeof oldestKey === 'string') {
      toolCallExtraContentById.delete(oldestKey);
    }
  }
}

/**
 * 从OpenAI工具调用缓存额外内容
 * @param toolCalls - 工具调用数组
 */
function cacheToolCallExtraContentFromOpenAIToolCalls(toolCalls: unknown): void {
  for (const toolCall of toArray(toolCalls)) {
    const toolCallObj = toOptionalObject(toolCall);
    if (!toolCallObj) {
      continue;
    }

    const toolCallId = toString(toolCallObj.id);
    const extraContent = normalizeToolCallExtraContent(toolCallObj);
    cacheToolCallExtraContent(toolCallId, extraContent);
  }
}

/**
 * 从OpenAI响应缓存工具调用额外内容
 * @param body - 响应体
 */
function cacheToolCallExtraContentFromOpenAIResponse(body: unknown): void {
  const responseObj = toOptionalObject(body);
  if (!responseObj) {
    return;
  }

  const firstChoice = toOptionalObject(toArray(responseObj.choices)[0]);
  if (!firstChoice) {
    return;
  }

  const message = toOptionalObject(firstChoice.message);
  if (!message) {
    return;
  }

  cacheToolCallExtraContentFromOpenAIToolCalls(message.tool_calls);
}

/**
 * 补充OpenAI请求中的工具调用信息
 * @param body - 请求体
 * @param provider - 提供商名称
 * @param baseURL - 基础URL
 */
function hydrateOpenAIRequestToolCalls(
  body: Record<string, unknown>,
  provider?: string,
  baseURL?: string
): void {
  const isGemini =
    provider === 'gemini' || Boolean(baseURL?.includes('generativelanguage.googleapis.com'));
  const messages = toArray(body.messages);
  for (const message of messages) {
    const messageObj = toOptionalObject(message);
    if (!messageObj) {
      continue;
    }

    for (const toolCall of toArray(messageObj.tool_calls)) {
      const toolCallObj = toOptionalObject(toolCall);
      if (!toolCallObj) {
        continue;
      }

      const existingExtraContent = normalizeToolCallExtraContent(toolCallObj);
      if (existingExtraContent !== undefined) {
        continue;
      }

      const toolCallId = toString(toolCallObj.id);
      if (toolCallId) {
        const cachedExtraContent = toolCallExtraContentById.get(toolCallId);
        if (cachedExtraContent !== undefined) {
          toolCallObj.extra_content = cachedExtraContent;
          continue;
        }
      }

      if (isGemini) {
        // Gemini需要工具调用的思考签名；缺失时使用文档化的回退值
        toolCallObj.extra_content = {
          google: {
            thought_signature: GEMINI_FALLBACK_THOUGHT_SIGNATURE,
          },
        };
      }
    }
  }
}

/**
 * 创建Anthropic错误响应体
 * @param message - 错误消息
 * @param type - 错误类型
 * @returns 错误响应对象
 */
function createAnthropicErrorBody(message: string, type = 'api_error'): Record<string, unknown> {
  return {
    type: 'error',
    error: {
      type,
      message,
    },
  };
}

/**
 * 提取错误消息
 * @param raw - 原始错误文本
 * @returns 提取的错误消息
 */
function extractErrorMessage(raw: string): string {
  if (!raw) {
    return '上游API请求失败';
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const errorObj = parsed.error;
    if (errorObj && typeof errorObj === 'object' && !Array.isArray(errorObj)) {
      const message = (errorObj as Record<string, unknown>).message;
      if (typeof message === 'string' && message) {
        return message;
      }
    }
    if (typeof parsed.message === 'string' && parsed.message) {
      return parsed.message;
    }
  } catch {
    // 忽略解析错误
  }

  return raw;
}

/**
 * 解析上游API类型
 * @param provider - 提供商名称
 * @returns API类型
 */
function resolveUpstreamAPIType(provider?: string): UpstreamAPIType {
  return provider?.toLowerCase() === 'openai' ? 'responses' : 'chat_completions';
}

/**
 * 构建OpenAI Responses URL
 * @param baseURL - 基础URL
 * @returns 完整的Responses API URL
 */
function buildOpenAIResponsesURL(baseURL: string): string {
  const normalized = baseURL.trim().replace(/\/+$/, '');
  if (!normalized) {
    return '/v1/responses';
  }
  if (normalized.endsWith('/responses')) {
    return normalized;
  }
  if (normalized.endsWith('/v1')) {
    return `${normalized}/responses`;
  }
  return `${normalized}/v1/responses`;
}

/**
 * 构建上游目标URL列表
 * @param baseURL - 基础URL
 * @param apiType - API类型
 * @returns 目标URL数组
 */
function buildUpstreamTargetUrls(baseURL: string, apiType: UpstreamAPIType): string[] {
  if (apiType === 'responses') {
    return [buildOpenAIResponsesURL(baseURL)];
  }

  const primary = buildOpenAIChatCompletionsURL(baseURL);
  const urls = new Set<string>([primary]);

  if (primary.includes('generativelanguage.googleapis.com')) {
    if (primary.includes('/v1beta/openai/')) {
      urls.add(primary.replace('/v1beta/openai/', '/v1/openai/'));
    } else if (primary.includes('/v1/openai/')) {
      urls.add(primary.replace('/v1/openai/', '/v1beta/openai/'));
    }
  }

  return Array.from(urls);
}

/**
 * 从聊天内容中提取文本
 * @param content - 内容值
 * @returns 提取的文本
 */
function extractTextFromChatContent(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }

  const chunks: string[] = [];
  for (const part of toArray(content)) {
    const partObj = toOptionalObject(part);
    if (!partObj) {
      continue;
    }
    const partText = toString(partObj.text);
    if (partText) {
      chunks.push(partText);
    }
  }
  return chunks.join('');
}

/**
 * 将用户聊天内容转换为Responses输入格式
 * @param content - 内容值
 * @returns Responses输入数组
 */
function convertUserChatContentToResponsesInput(content: unknown): Array<Record<string, unknown>> {
  if (typeof content === 'string') {
    return content
      ? [{ type: 'input_text', text: content }]
      : [];
  }

  const parts: Array<Record<string, unknown>> = [];
  for (const item of toArray(content)) {
    const itemObj = toOptionalObject(item);
    if (!itemObj) {
      continue;
    }

    const itemType = toString(itemObj.type);
    if (itemType === 'text') {
      const text = toString(itemObj.text);
      if (text) {
        parts.push({ type: 'input_text', text });
      }
      continue;
    }

    if (itemType === 'image_url') {
      const imageURLObj = toOptionalObject(itemObj.image_url);
      const imageURL = toString(imageURLObj?.url) || toString(itemObj.image_url);
      if (imageURL) {
        parts.push({ type: 'input_image', image_url: imageURL });
      }
    }
  }

  return parts;
}

/**
 * 规范化聊天格式中的工具定义为Responses格式
 * @param toolsInput - 工具输入
 * @returns 规范化后的工具数组
 */
function normalizeResponsesToolsFromChat(toolsInput: unknown): Array<Record<string, unknown>> {
  const normalizedTools: Array<Record<string, unknown>> = [];

  for (const tool of toArray(toolsInput)) {
    const toolObj = toOptionalObject(tool);
    if (!toolObj) {
      continue;
    }

    const toolType = toString(toolObj.type);
    if (toolType !== 'function') {
      normalizedTools.push(toolObj);
      continue;
    }

    const functionObj = toOptionalObject(toolObj.function);
    const name = toString(toolObj.name) || toString(functionObj?.name);
    if (!name) {
      continue;
    }

    const normalized: Record<string, unknown> = {
      type: 'function',
      name,
    };

    const description = toString(toolObj.description) || toString(functionObj?.description);
    if (description) {
      normalized.description = description;
    }

    const parameters = toolObj.parameters ?? functionObj?.parameters;
    if (parameters !== undefined) {
      normalized.parameters = parameters;
    }

    const strict = toolObj.strict ?? functionObj?.strict;
    if (typeof strict === 'boolean') {
      normalized.strict = strict;
    }

    normalizedTools.push(normalized);
  }

  return normalizedTools;
}

/**
 * 规范化聊天格式中的工具选择为Responses格式
 * @param toolChoice - 工具选择值
 * @returns 规范化后的工具选择
 */
function normalizeResponsesToolChoiceFromChat(toolChoice: unknown): unknown {
  if (typeof toolChoice === 'string') {
    return toolChoice;
  }

  const toolChoiceObj = toOptionalObject(toolChoice);
  if (!toolChoiceObj) {
    return toolChoice;
  }

  const normalizedType = toString(toolChoiceObj.type).toLowerCase();
  if (normalizedType === 'any') {
    return 'required';
  }
  if (normalizedType === 'auto' || normalizedType === 'none' || normalizedType === 'required') {
    return normalizedType;
  }
  if (normalizedType === 'function' || normalizedType === 'tool') {
    const functionObj = toOptionalObject(toolChoiceObj.function);
    const name = toString(toolChoiceObj.name) || toString(functionObj?.name);
    if (name) {
      return {
        type: 'function',
        name,
      };
    }
  }

  return toolChoice;
}

/**
 * 将聊天完成请求转换为Responses请求
 * @param chatRequest - 聊天完成请求
 * @returns Responses请求对象
 */
function convertChatCompletionsRequestToResponsesRequest(
  chatRequest: Record<string, unknown>
): Record<string, unknown> {
  const request: Record<string, unknown> = {};
  const input: Array<Record<string, unknown>> = [];
  const instructions: string[] = [];
  const unresolvedFunctionCalls = new Map<string, { name: string; hasOutput: boolean }>();

  if (chatRequest.model !== undefined) {
    request.model = chatRequest.model;
  }
  if (chatRequest.stream !== undefined) {
    request.stream = chatRequest.stream;
  }
  if (chatRequest.temperature !== undefined) {
    request.temperature = chatRequest.temperature;
  }
  if (chatRequest.top_p !== undefined) {
    request.top_p = chatRequest.top_p;
  }
  const normalizedTools = normalizeResponsesToolsFromChat(chatRequest.tools);
  if (normalizedTools.length > 0) {
    request.tools = normalizedTools;
  }
  if (chatRequest.tool_choice !== undefined) {
    request.tool_choice = normalizeResponsesToolChoiceFromChat(chatRequest.tool_choice);
  }

  const maxOutputTokens = toNumber(chatRequest.max_output_tokens)
    ?? toNumber(chatRequest.max_completion_tokens)
    ?? toNumber(chatRequest.max_tokens);
  if (maxOutputTokens !== null) {
    request.max_output_tokens = maxOutputTokens;
  }

  for (const message of toArray(chatRequest.messages)) {
    const messageObj = toOptionalObject(message);
    if (!messageObj) {
      continue;
    }

    const role = toString(messageObj.role);
    if (role === 'system') {
      const text = extractTextFromChatContent(messageObj.content);
      if (text) {
        instructions.push(text);
      }
      continue;
    }

    if (role === 'tool') {
      const toolCallId = toString(messageObj.tool_call_id);
      const output = stringifyUnknown(messageObj.content);
      if (toolCallId && output) {
        input.push({
          type: 'function_call_output',
          call_id: toolCallId,
          output,
        });
      }
      continue;
    }

    if (role === 'assistant') {
      const text = extractTextFromChatContent(messageObj.content);
      if (text) {
        input.push({
          role: 'assistant',
          content: [{ type: 'output_text', text }],
        });
      }

      for (const toolCall of toArray(messageObj.tool_calls)) {
        const toolCallObj = toOptionalObject(toolCall);
        const functionObj = toOptionalObject(toolCallObj?.function);
        if (!toolCallObj || !functionObj) {
          continue;
        }
        const callId = toString(toolCallObj.call_id) || toString(toolCallObj.id);
        const name = toString(functionObj.name);
        const argumentsText = normalizeFunctionArguments(functionObj.arguments) || '{}';
        if (!callId || !name) {
          continue;
        }

        const functionCallItem: Record<string, unknown> = {
          type: 'function_call',
          call_id: callId,
          name,
          arguments: argumentsText,
        };
        const extraContent = normalizeToolCallExtraContent(toolCallObj);
        if (extraContent !== undefined) {
          functionCallItem.extra_content = extraContent;
        }
        input.push(functionCallItem);
        unresolvedFunctionCalls.set(callId, {
          name,
          hasOutput: false,
        });
      }
      continue;
    }

    const userParts = convertUserChatContentToResponsesInput(messageObj.content);
    if (userParts.length > 0) {
      input.push({
        role: role || 'user',
        content: userParts,
      });
    }
  }

  if (instructions.length > 0) {
    request.instructions = instructions.join('\n\n');
  }

  for (const messageItem of input) {
    if (toString(messageItem.type) !== 'function_call_output') {
      continue;
    }
    const callId = toString(messageItem.call_id);
    if (!callId) {
      continue;
    }
    const existing = unresolvedFunctionCalls.get(callId);
    if (existing) {
      existing.hasOutput = true;
      unresolvedFunctionCalls.set(callId, existing);
    }
  }

  for (const [callId, callInfo] of unresolvedFunctionCalls.entries()) {
    if (callInfo.hasOutput) {
      continue;
    }
    // OpenAI Responses要求每个历史函数调用都有匹配的输出
    // 当上游工具执行在产生工具结果之前失败时，在此处自动关闭
    input.push({
      type: 'function_call_output',
      call_id: callId,
      output: JSON.stringify({
        error: `函数调用"${callId}"(${callInfo.name || '未知'})缺少工具输出。已由兼容性代理自动关闭。`,
      }),
    });
  }

  request.input = input;

  return request;
}

/**
 * 规范化工具名称
 * @param value - 工具名称值
 * @returns 规范化后的工具名称
 */
function normalizeToolName(value: unknown): string {
  return toString(value).trim().toLowerCase();
}

/**
 * 为特定提供商过滤OpenAI工具
 * @param openAIRequest - OpenAI请求对象
 * @param provider - 提供商名称
 */
function filterOpenAIToolsForProvider(
  openAIRequest: Record<string, unknown>,
  provider?: string
): void {
  if (provider !== 'openai') {
    return;
  }

  const tools = toArray(openAIRequest.tools);
  if (tools.length === 0) {
    return;
  }

  const filteredTools = tools.filter((tool) => {
    const toolObj = toOptionalObject(tool);
    if (!toolObj) return true;
    const functionObj = toOptionalObject(toolObj.function);
    const toolName = normalizeToolName(toolObj.name) || normalizeToolName(functionObj?.name);
    if (!toolName) return true;
    // OpenAI路径应通过常规工具读取SKILL.md来使用技能，而不是Skill工具
    return toolName !== 'skill';
  });

  if (filteredTools.length !== tools.length) {
    openAIRequest.tools = filteredTools;
    const toolChoiceObj = toOptionalObject(openAIRequest.tool_choice);
    if (toolChoiceObj) {
      const forcedName = normalizeToolName(toolChoiceObj.name)
        || normalizeToolName(toOptionalObject(toolChoiceObj.function)?.name);
      if (forcedName === 'skill') {
        openAIRequest.tool_choice = 'auto';
      }
    }
  }
}

/**
 * 从错误消息中提取max_tokens范围
 * @param errorMessage - 错误消息
 * @returns max_tokens范围对象，如果未找到则返回null
 */
function extractMaxTokensRange(errorMessage: string): { min: number; max: number } | null {
  if (!errorMessage) {
    return null;
  }

  const normalized = errorMessage.toLowerCase();
  if (!normalized.includes('max_tokens')) {
    return null;
  }

  const bracketMatch = /max_tokens[^\[]*\[\s*(\d+)\s*,\s*(\d+)\s*\]/i.exec(errorMessage);
  if (bracketMatch) {
    return {
      min: Number(bracketMatch[1]),
      max: Number(bracketMatch[2]),
    };
  }

  const betweenMatch = /max_tokens.*between\s+(\d+)\s*(?:and|-)\s*(\d+)/i.exec(errorMessage);
  if (betweenMatch) {
    return {
      min: Number(betweenMatch[1]),
      max: Number(betweenMatch[2]),
    };
  }

  return null;
}

/**
 * 根据错误消息限制max_tokens值
 * @param openAIRequest - OpenAI请求对象
 * @param errorMessage - 错误消息
 * @returns 修改结果对象
 */
function clampMaxTokensFromError(
  openAIRequest: Record<string, unknown>,
  errorMessage: string
): { changed: boolean; clampedTo?: number } {
  const currentMaxTokens = openAIRequest.max_tokens;
  if (typeof currentMaxTokens !== 'number' || !Number.isFinite(currentMaxTokens)) {
    return { changed: false };
  }

  const range = extractMaxTokensRange(errorMessage);
  if (!range) {
    return { changed: false };
  }

  const normalizedMin = Math.max(1, Math.floor(range.min));
  const normalizedMax = Math.max(normalizedMin, Math.floor(range.max));
  const nextValue = Math.min(Math.max(Math.floor(currentMaxTokens), normalizedMin), normalizedMax);

  if (nextValue === currentMaxTokens) {
    return { changed: false };
  }

  openAIRequest.max_tokens = nextValue;
  return { changed: true, clampedTo: nextValue };
}

/**
 * 判断模型是否应使用max_completion_tokens字段
 * @param model - 模型名称
 * @returns 是否应使用max_completion_tokens
 */
function shouldUseMaxCompletionTokensForModel(model: unknown): boolean {
  if (typeof model !== 'string') {
    return false;
  }
  const normalizedModel = model.toLowerCase();
  const resolvedModel = normalizedModel.includes('/')
    ? normalizedModel.slice(normalizedModel.lastIndexOf('/') + 1)
    : normalizedModel;
  return resolvedModel.startsWith('gpt-5')
    || resolvedModel.startsWith('o1')
    || resolvedModel.startsWith('o3')
    || resolvedModel.startsWith('o4');
}

/**
 * 为OpenAI提供商规范化max_tokens字段
 * @param openAIRequest - OpenAI请求对象
 * @param provider - 提供商名称
 */
function normalizeMaxTokensFieldForOpenAIProvider(
  openAIRequest: Record<string, unknown>,
  provider?: string
): void {
  if (provider !== 'openai') {
    return;
  }
  if (!shouldUseMaxCompletionTokensForModel(openAIRequest.model)) {
    return;
  }
  const maxTokens = openAIRequest.max_tokens;
  if (typeof maxTokens !== 'number' || !Number.isFinite(maxTokens)) {
    return;
  }
  openAIRequest.max_completion_tokens = maxTokens;
  delete openAIRequest.max_tokens;
}

/**
 * 判断是否为max_tokens不支持的错误
 * @param errorMessage - 错误消息
 * @returns 是否为max_tokens不支持错误
 */
function isMaxTokensUnsupportedError(errorMessage: string): boolean {
  const normalized = errorMessage.toLowerCase();
  return normalized.includes('max_tokens')
    && normalized.includes('max_completion_tokens')
    && normalized.includes('not supported');
}

/**
 * 将max_tokens转换为max_completion_tokens
 * @param openAIRequest - OpenAI请求对象
 * @returns 转换结果对象
 */
function convertMaxTokensToMaxCompletionTokens(
  openAIRequest: Record<string, unknown>
): { changed: boolean; convertedTo?: number } {
  const maxTokens = openAIRequest.max_tokens;
  if (typeof maxTokens !== 'number' || !Number.isFinite(maxTokens)) {
    return { changed: false };
  }
  openAIRequest.max_completion_tokens = maxTokens;
  delete openAIRequest.max_tokens;
  return { changed: true, convertedTo: maxTokens };
}

/**
 * 写入JSON响应
 * @param res - 服务器响应对象
 * @param statusCode - HTTP状态码
 * @param body - 响应体
 */
function writeJSON(
  res: http.ServerResponse,
  statusCode: number,
  body: Record<string, unknown>
): void {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

/**
 * 读取请求体
 * @param req - HTTP请求对象
 * @returns 请求体字符串的Promise
 */
function readRequestBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    let settled = false;

    /**
     * 解码请求体
     * @param raw - 原始缓冲区
     * @returns 解码后的字符串
     */
    const decodeBody = (raw: Buffer): string => {
      if (raw.length === 0) {
        return '';
      }

      /**
       * 收集字符串值
       * @param input - 输入值
       * @param out - 输出数组
       */
      const collectStringValues = (input: unknown, out: string[]): void => {
        if (typeof input === 'string') {
          out.push(input);
          return;
        }
        if (Array.isArray(input)) {
          for (const item of input) collectStringValues(item, out);
          return;
        }
        if (input && typeof input === 'object') {
          for (const value of Object.values(input as Record<string, unknown>)) {
            collectStringValues(value, out);
          }
        }
      };

      /**
       * 评分解码后的JSON文本
       * @param text - 文本内容
       * @returns 评分值
       */
      const scoreDecodedJsonText = (text: string): number => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch {
          return -10000;
        }

        const values: string[] = [];
        collectStringValues(parsed, values);
        const joined = values.join('\n');
        if (!joined) return 0;

        const cjkCount = (joined.match(/[\u3400-\u9FFF]/g) || []).length;
        const replacementCount = (joined.match(/\uFFFD/g) || []).length;
        const mojibakeCount = (joined.match(/[ÃÂÐÑØÙÞæçèéêëìíîïðñòóôõöøùúûüýþÿ]/g) || []).length;
        const nonAsciiCount = (joined.match(/[^\x00-\x7F]/g) || []).length;

        return cjkCount * 4 + nonAsciiCount - replacementCount * 8 - mojibakeCount * 3;
      };

      // 首先进行BOM感知解码
      if (raw.length >= 3 && raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf) {
        return new TextDecoder('utf-8', { fatal: false }).decode(raw.subarray(3));
      }
      if (raw.length >= 2 && raw[0] === 0xff && raw[1] === 0xfe) {
        return new TextDecoder('utf-16le', { fatal: false }).decode(raw.subarray(2));
      }
      if (raw.length >= 2 && raw[0] === 0xfe && raw[1] === 0xff) {
        return new TextDecoder('utf-16be', { fatal: false }).decode(raw.subarray(2));
      }

      // 首先尝试严格的UTF-8解码
      let utf8Decoded: string | null = null;
      try {
        utf8Decoded = new TextDecoder('utf-8', { fatal: true }).decode(raw);
      } catch {
        utf8Decoded = null;
      }

      // 在Windows本地shell（特别是Git Bash/curl路径）中，请求
      // 可能使用系统代码页而非UTF-8发出
      if (process.platform === 'win32') {
        let gbDecoded: string | null = null;
        try {
          gbDecoded = new TextDecoder('gb18030', { fatal: true }).decode(raw);
        } catch {
          gbDecoded = null;
        }

        if (utf8Decoded && gbDecoded) {
          const utf8Score = scoreDecodedJsonText(utf8Decoded);
          const gbScore = scoreDecodedJsonText(gbDecoded);
          if (gbScore > utf8Score) {
            console.warn(`[CoworkProxy] 使用gb18030解码请求体 (评分 ${gbScore} > utf8 ${utf8Score})`);
            return gbDecoded;
          }
          return utf8Decoded;
        }

        if (gbDecoded && !utf8Decoded) {
          console.warn('[CoworkProxy] 使用gb18030回退解码请求体');
          return gbDecoded;
        }
      }

      if (utf8Decoded) {
        return utf8Decoded;
      }

      return new TextDecoder('utf-8', { fatal: false }).decode(raw);
    };

    /**
     * 失败处理
     * @param error - 错误对象
     */
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    req.on('data', (chunk: Buffer) => {
      if (settled) return;
      totalBytes += chunk.length;
      if (totalBytes > 20 * 1024 * 1024) {
        fail(new Error('请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (settled) return;
      settled = true;
      const body = decodeBody(Buffer.concat(chunks));
      resolve(body);
    });

    req.on('error', (error) => {
      fail(error instanceof Error ? error : new Error(String(error)));
    });
  });
}

/**
 * 创建流状态对象
 * @returns 初始化的流状态
 */
function createStreamState(): StreamState {
  return {
    messageId: null,
    model: null,
    contentIndex: 0,
    currentBlockType: null,
    activeToolIndex: null,
    hasMessageStart: false,
    hasMessageStop: false,
    toolCalls: {},
  };
}

/**
 * 创建Responses流上下文
 * @returns 初始化的Responses流上下文
 */
function createResponsesStreamContext(): ResponsesStreamContext {
  return {
    functionCallByOutputIndex: new Map<number, ResponsesFunctionCallState>(),
    functionCallByCallId: new Map<string, ResponsesFunctionCallState>(),
    functionCallByItemId: new Map<string, ResponsesFunctionCallState>(),
    nextToolIndex: 0,
    hasAnyDelta: false,
  };
}

/**
 * 解析Responses对象
 * @param body - 响应体
 * @returns Responses对象
 */
function resolveResponsesObject(body: unknown): Record<string, unknown> {
  const source = toOptionalObject(body);
  if (!source) {
    return {};
  }
  const nested = toOptionalObject(source.response);
  if (nested) {
    return nested;
  }
  return source;
}

/**
 * 提取Responses推理文本
 * @param itemObj - 项目对象
 * @returns 推理文本
 */
function extractResponsesReasoningText(itemObj: Record<string, unknown>): string {
  const summaryTexts: string[] = [];
  for (const summaryItem of toArray(itemObj.summary)) {
    const summaryObj = toOptionalObject(summaryItem);
    if (!summaryObj) {
      continue;
    }
    const summaryText = toString(summaryObj.text);
    if (summaryText) {
      summaryTexts.push(summaryText);
    }
  }
  if (summaryTexts.length > 0) {
    return summaryTexts.join('');
  }

  const directText = toString(itemObj.text);
  if (directText) {
    return directText;
  }
  return '';
}

/**
 * 检测Responses完成原因
 * @param responseObj - 响应对象
 * @returns 完成原因字符串
 */
function detectResponsesFinishReason(responseObj: Record<string, unknown>): string {
  const output = toArray(responseObj.output);
  const hasFunctionCall = output.some((item) => toString(toOptionalObject(item)?.type) === 'function_call');
  if (hasFunctionCall) {
    return 'tool_calls';
  }

  const status = toString(responseObj.status);
  const incompleteReason = toString(toOptionalObject(responseObj.incomplete_details)?.reason);
  if (
    status === 'incomplete'
    && (incompleteReason === 'max_output_tokens' || incompleteReason === 'max_tokens')
  ) {
    return 'length';
  }
  return 'stop';
}

/**
 * 将Responses响应转换为OpenAI响应格式
 * @param body - 响应体
 * @returns OpenAI格式的响应对象
 */
function convertResponsesToOpenAIResponse(body: unknown): Record<string, unknown> {
  const responseObj = resolveResponsesObject(body);
  const output = toArray(responseObj.output);

  const textParts: Array<{ type: 'text'; text: string }> = [];
  const reasoningParts: string[] = [];
  const toolCalls: Array<Record<string, unknown>> = [];

  for (const item of output) {
    const itemObj = toOptionalObject(item);
    if (!itemObj) {
      continue;
    }

    const itemType = toString(itemObj.type);
    if (itemType === 'message') {
      for (const contentItem of toArray(itemObj.content)) {
        const contentObj = toOptionalObject(contentItem);
        if (!contentObj) {
          continue;
        }
        const contentType = toString(contentObj.type);
        if (contentType === 'output_text' || contentType === 'text' || contentType === 'input_text') {
          const text = toString(contentObj.text);
          if (text) {
            textParts.push({ type: 'text', text });
          }
        }
      }
      continue;
    }

    if (itemType === 'reasoning') {
      const reasoningText = extractResponsesReasoningText(itemObj);
      if (reasoningText) {
        reasoningParts.push(reasoningText);
      }
      continue;
    }

    if (itemType === 'function_call') {
      const callId = toString(itemObj.call_id) || toString(itemObj.id);
      const name = toString(itemObj.name);
      if (!callId || !name) {
        continue;
      }
      const toolCall: Record<string, unknown> = {
        id: callId,
        type: 'function',
        function: {
          name,
          arguments: normalizeFunctionArguments(itemObj.arguments) || '{}',
        },
      };
      const extraContent = normalizeToolCallExtraContent(itemObj);
      if (extraContent !== undefined) {
        toolCall.extra_content = extraContent;
      }
      toolCalls.push(toolCall);
    }
  }

  const message: Record<string, unknown> = {
    role: 'assistant',
  };
  if (textParts.length === 1 && textParts[0].type === 'text') {
    message.content = textParts[0].text;
  } else if (textParts.length > 1) {
    message.content = textParts;
  } else {
    message.content = null;
  }
  if (toolCalls.length > 0) {
    message.tool_calls = toolCalls;
  }
  if (reasoningParts.length > 0) {
    message.reasoning_content = reasoningParts.join('');
  }

  const usage = toOptionalObject(responseObj.usage);
  return {
    id: toString(responseObj.id),
    model: toString(responseObj.model),
    choices: [
      {
        message,
        finish_reason: detectResponsesFinishReason(responseObj),
      },
    ],
    usage: {
      prompt_tokens: toNumber(usage?.input_tokens) ?? toNumber(usage?.prompt_tokens) ?? 0,
      completion_tokens: toNumber(usage?.output_tokens) ?? toNumber(usage?.completion_tokens) ?? 0,
    },
  };
}

/**
 * 从Responses响应缓存工具调用额外内容
 * @param body - 响应体
 */
function cacheToolCallExtraContentFromResponsesResponse(body: unknown): void {
  const responseObj = resolveResponsesObject(body);
  for (const item of toArray(responseObj.output)) {
    const itemObj = toOptionalObject(item);
    if (!itemObj || toString(itemObj.type) !== 'function_call') {
      continue;
    }
    const toolCallId = toString(itemObj.call_id) || toString(itemObj.id);
    const extraContent = normalizeToolCallExtraContent(itemObj);
    cacheToolCallExtraContent(toolCallId, extraContent);
  }
}

/**
 * 发送SSE事件
 * @param res - 服务器响应对象
 * @param event - 事件名称
 * @param data - 事件数据
 */
function emitSSE(res: http.ServerResponse, event: string, data: Record<string, unknown>): void {
  res.write(formatSSEEvent(event, data));
}

/**
 * 如需要则关闭当前块
 * @param res - 服务器响应对象
 * @param state - 流状态
 */
function closeCurrentBlockIfNeeded(res: http.ServerResponse, state: StreamState): void {
  if (!state.currentBlockType) {
    return;
  }

  emitSSE(res, 'content_block_stop', {
    type: 'content_block_stop',
    index: state.contentIndex,
  });

  state.contentIndex += 1;
  state.currentBlockType = null;
  state.activeToolIndex = null;
}

/**
 * 确保消息开始事件已发送
 * @param res - 服务器响应对象
 * @param state - 流状态
 * @param chunk - OpenAI流块
 */
function ensureMessageStart(
  res: http.ServerResponse,
  state: StreamState,
  chunk: OpenAIStreamChunk
): void {
  if (state.hasMessageStart) {
    return;
  }

  state.messageId = chunk.id ?? state.messageId ?? `chatcmpl-${Date.now()}`;
  state.model = chunk.model ?? state.model ?? 'unknown';

  emitSSE(res, 'message_start', {
    type: 'message_start',
    message: {
      id: state.messageId,
      type: 'message',
      role: 'assistant',
      model: state.model,
      usage: {
        input_tokens: 0,
        output_tokens: 0,
      },
    },
  });

  state.hasMessageStart = true;
}

/**
 * 确保思考块已开始
 * @param res - 服务器响应对象
 * @param state - 流状态
 */
function ensureThinkingBlock(res: http.ServerResponse, state: StreamState): void {
  if (state.currentBlockType === 'thinking') {
    return;
  }

  closeCurrentBlockIfNeeded(res, state);

  emitSSE(res, 'content_block_start', {
    type: 'content_block_start',
    index: state.contentIndex,
    content_block: {
      type: 'thinking',
      thinking: '',
    },
  });

  state.currentBlockType = 'thinking';
}

/**
 * 确保文本块已开始
 * @param res - 服务器响应对象
 * @param state - 流状态
 */
function ensureTextBlock(res: http.ServerResponse, state: StreamState): void {
  if (state.currentBlockType === 'text') {
    return;
  }

  closeCurrentBlockIfNeeded(res, state);

  emitSSE(res, 'content_block_start', {
    type: 'content_block_start',
    index: state.contentIndex,
    content_block: {
      type: 'text',
      text: '',
    },
  });

  state.currentBlockType = 'text';
}

/**
 * 确保工具使用块已开始
 * @param res - 服务器响应对象
 * @param state - 流状态
 * @param index - 工具索引
 * @param toolCall - 工具调用状态
 */
function ensureToolUseBlock(
  res: http.ServerResponse,
  state: StreamState,
  index: number,
  toolCall: ToolCallState
): void {
  const resolvedId = toolCall.id || `tool_call_${index}`;
  const resolvedName = toolCall.name || 'tool';

  if (state.currentBlockType === 'tool_use' && state.activeToolIndex === index) {
    return;
  }

  closeCurrentBlockIfNeeded(res, state);

  const contentBlock: Record<string, unknown> = {
    type: 'tool_use',
    id: resolvedId,
    name: resolvedName,
  };

  if (toolCall.extraContent !== undefined) {
    contentBlock.extra_content = toolCall.extraContent;
  }

  emitSSE(res, 'content_block_start', {
    type: 'content_block_start',
    index: state.contentIndex,
    content_block: contentBlock,
  });

  state.currentBlockType = 'tool_use';
  state.activeToolIndex = index;
}

/**
 * 发送消息增量事件
 * @param res - 服务器响应对象
 * @param state - 流状态
 * @param finishReason - 完成原因
 * @param chunk - OpenAI流块
 */
function emitMessageDelta(
  res: http.ServerResponse,
  state: StreamState,
  finishReason: string | null | undefined,
  chunk: OpenAIStreamChunk
): void {
  closeCurrentBlockIfNeeded(res, state);

  emitSSE(res, 'message_delta', {
    type: 'message_delta',
    delta: {
      stop_reason: mapStopReason(finishReason),
      stop_sequence: null,
    },
    usage: {
      input_tokens: chunk.usage?.prompt_tokens ?? 0,
      output_tokens: chunk.usage?.completion_tokens ?? 0,
    },
  });
}

/**
 * 处理OpenAI流块
 * @param res - 服务器响应对象
 * @param state - 流状态
 * @param chunk - OpenAI流块
 */
function processOpenAIChunk(
  res: http.ServerResponse,
  state: StreamState,
  chunk: OpenAIStreamChunk
): void {
  ensureMessageStart(res, state, chunk);

  const choice = chunk.choices?.[0];
  if (!choice) {
    return;
  }

  const delta = choice.delta;
  const deltaReasoning = delta?.reasoning_content ?? delta?.reasoning;

  if (deltaReasoning) {
    ensureThinkingBlock(res, state);
    emitSSE(res, 'content_block_delta', {
      type: 'content_block_delta',
      index: state.contentIndex,
      delta: {
        type: 'thinking_delta',
        thinking: deltaReasoning,
      },
    });
  }

  if (delta?.content) {
    ensureTextBlock(res, state);
    emitSSE(res, 'content_block_delta', {
      type: 'content_block_delta',
      index: state.contentIndex,
      delta: {
        type: 'text_delta',
        text: delta.content,
      },
    });
  }

  if (Array.isArray(delta?.tool_calls)) {
    for (const item of delta.tool_calls) {
      const toolIndex = item.index ?? 0;
      const existing = state.toolCalls[toolIndex] ?? {};
      const normalizedExtraContent = normalizeToolCallExtraContent(
        item as unknown as Record<string, unknown>
      );
      if (normalizedExtraContent !== undefined) {
        existing.extraContent = normalizedExtraContent;
      }

      if (item.id) {
        existing.id = item.id;
      }
      if (item.function?.name) {
        existing.name = item.function.name;
      }
      state.toolCalls[toolIndex] = existing;
      if (existing.id && existing.extraContent !== undefined) {
        cacheToolCallExtraContent(existing.id, existing.extraContent);
      }

      if (item.function?.name) {
        ensureToolUseBlock(res, state, toolIndex, existing);
      }

      if (item.function?.arguments) {
        ensureToolUseBlock(res, state, toolIndex, existing);
        emitSSE(res, 'content_block_delta', {
          type: 'content_block_delta',
          index: state.contentIndex,
          delta: {
            type: 'input_json_delta',
            partial_json: item.function.arguments,
          },
        });
      }
    }
  }

  if (choice.finish_reason) {
    emitMessageDelta(res, state, choice.finish_reason, chunk);
  }
}

/**
 * 解析SSE数据包
 * @param packet - 数据包字符串
 * @returns 解析后的事件和载荷
 */
function parseSSEPacket(packet: string): { event: string; payload: string } {
  const lines = packet.split(/\r?\n/);
  const dataLines: string[] = [];
  let event = '';

  for (const line of lines) {
    if (line.startsWith('event:')) {
      event = line.slice(6).trimStart();
      continue;
    }
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart());
    }
  }

  return {
    event,
    payload: dataLines.join('\n'),
  };
}

/**
 * 查找SSE数据包边界
 * @param buffer - 缓冲区字符串
 * @returns 边界位置和分隔符长度，如果未找到则返回null
 */
function findSSEPacketBoundary(
  buffer: string
): { index: number; separatorLength: number } | null {
  const match = /\r?\n\r?\n/.exec(buffer);
  if (!match || typeof match.index !== 'number') {
    return null;
  }

  return {
    index: match.index,
    separatorLength: match[0].length,
  };
}

/**
 * 提取Responses函数调用元数据
 * @param payloadObj - 载荷对象
 * @param itemObj - 项目对象
 * @returns 函数调用元数据
 */
function extractResponsesFunctionCallMetadata(
  payloadObj: Record<string, unknown>,
  itemObj: Record<string, unknown> | null
): {
  outputIndex: number | null;
  callId: string;
  itemId: string;
  name: string;
  extraContent: unknown;
} {
  const outputIndex = toNumber(payloadObj.output_index) ?? toNumber(itemObj?.output_index);
  const callId = toString(payloadObj.call_id) || toString(itemObj?.call_id);
  const itemId = toString(payloadObj.item_id) || toString(itemObj?.id);
  const name = toString(payloadObj.name) || toString(itemObj?.name);
  const extraContent = itemObj ? normalizeToolCallExtraContent(itemObj) : undefined;
  return {
    outputIndex,
    callId,
    itemId,
    name,
    extraContent,
  };
}

/**
 * 注册Responses函数调用状态
 * @param context - Responses流上下文
 * @param payloadObj - 载荷对象
 * @param itemObj - 项目对象
 * @returns 函数调用状态
 */
function registerResponsesFunctionCallState(
  context: ResponsesStreamContext,
  payloadObj: Record<string, unknown>,
  itemObj: Record<string, unknown> | null
): ResponsesFunctionCallState {
  const metadata = extractResponsesFunctionCallMetadata(payloadObj, itemObj);

  let callState = metadata.callId
    ? context.functionCallByCallId.get(metadata.callId)
    : undefined;
  if (!callState && metadata.itemId) {
    callState = context.functionCallByItemId.get(metadata.itemId);
  }
  if (!callState && metadata.outputIndex !== null) {
    callState = context.functionCallByOutputIndex.get(metadata.outputIndex);
  }

  if (!callState) {
    const outputIndex = metadata.outputIndex !== null
      ? metadata.outputIndex
      : context.nextToolIndex;
    callState = {
      outputIndex,
      callId: '',
      itemId: '',
      name: '',
      extraContent: undefined,
      argumentsBuffer: '',
      finalArguments: '',
      emitted: false,
      metadataEmitted: false,
    };
    context.functionCallByOutputIndex.set(outputIndex, callState);
    context.nextToolIndex = Math.max(context.nextToolIndex, outputIndex + 1);
  } else if (metadata.outputIndex !== null && callState.outputIndex !== metadata.outputIndex) {
    context.functionCallByOutputIndex.delete(callState.outputIndex);
    callState.outputIndex = metadata.outputIndex;
    context.functionCallByOutputIndex.set(callState.outputIndex, callState);
    context.nextToolIndex = Math.max(context.nextToolIndex, callState.outputIndex + 1);
  } else {
    context.nextToolIndex = Math.max(context.nextToolIndex, callState.outputIndex + 1);
  }

  if (metadata.callId) {
    callState.callId = metadata.callId;
    context.functionCallByCallId.set(metadata.callId, callState);
  }
  if (metadata.itemId) {
    callState.itemId = metadata.itemId;
    context.functionCallByItemId.set(metadata.itemId, callState);
  }
  if (metadata.name) {
    callState.name = metadata.name;
  }
  if (metadata.extraContent !== undefined) {
    callState.extraContent = metadata.extraContent;
  }

  context.functionCallByOutputIndex.set(callState.outputIndex, callState);
  return callState;
}

/**
 * 同步工具调用状态与Responses函数调用
 * @param state - 流状态
 * @param callState - Responses函数调用状态
 * @returns 工具调用状态
 */
function syncToolCallStateWithResponsesFunctionCall(
  state: StreamState,
  callState: ResponsesFunctionCallState
): ToolCallState {
  const toolCall = state.toolCalls[callState.outputIndex] ?? {};
  if (callState.callId) {
    toolCall.id = callState.callId;
  } else if (callState.itemId) {
    toolCall.id = callState.itemId;
  } else if (!toolCall.id) {
    toolCall.id = `tool_call_${callState.outputIndex}`;
  }
  if (callState.name) {
    toolCall.name = callState.name;
  }
  if (callState.extraContent !== undefined) {
    toolCall.extraContent = callState.extraContent;
  }
  state.toolCalls[callState.outputIndex] = toolCall;
  if (toolCall.id && toolCall.extraContent !== undefined) {
    cacheToolCallExtraContent(toolCall.id, toolCall.extraContent);
  }
  return toolCall;
}

/**
 * 发送Responses函数调用块
 * @param res - 服务器响应对象
 * @param state - 流状态
 * @param callState - Responses函数调用状态
 * @param options - 选项对象
 */
function emitResponsesFunctionCallChunk(
  res: http.ServerResponse,
  state: StreamState,
  callState: ResponsesFunctionCallState,
  options: {
    includeName: boolean;
    argumentsText?: string;
    responseId?: string;
    model?: string;
  }
): void {
  const toolCall = syncToolCallStateWithResponsesFunctionCall(state, callState);

  const functionObj: Record<string, unknown> = {};
  if (options.includeName && toolCall.name) {
    functionObj.name = toolCall.name;
  }

  const argumentsText = options.argumentsText ?? '';
  if (argumentsText) {
    functionObj.arguments = argumentsText;
  }

  if (Object.keys(functionObj).length === 0) {
    return;
  }

  processOpenAIChunk(res, state, {
    id: options.responseId || undefined,
    model: options.model || undefined,
    choices: [
      {
        delta: {
          tool_calls: [
            {
              index: callState.outputIndex,
              id: toolCall.id,
              type: 'function',
              function: functionObj,
            },
          ],
        },
      },
    ],
  });
}

/**
 * 发送Responses函数调用元数据（仅一次）
 * @param res - 服务器响应对象
 * @param state - 流状态
 * @param context - Responses流上下文
 * @param callState - Responses函数调用状态
 * @param responseId - 响应ID
 * @param model - 模型名称
 */
function emitResponsesFunctionCallMetadataOnce(
  res: http.ServerResponse,
  state: StreamState,
  context: ResponsesStreamContext,
  callState: ResponsesFunctionCallState,
  responseId?: string,
  model?: string
): void {
  if (callState.metadataEmitted) {
    return;
  }
  if (!callState.name) {
    return;
  }

  emitResponsesFunctionCallChunk(res, state, callState, {
    includeName: true,
    responseId,
    model,
  });
  callState.metadataEmitted = true;
  context.hasAnyDelta = true;
}

/**
 * 发送Responses函数调用参数（仅一次）
 * @param res - 服务器响应对象
 * @param state - 流状态
 * @param context - Responses流上下文
 * @param callState - Responses函数调用状态
 * @param argumentsText - 参数文本
 * @param responseId - 响应ID
 * @param model - 模型名称
 */
function emitResponsesFunctionCallArgumentsOnce(
  res: http.ServerResponse,
  state: StreamState,
  context: ResponsesStreamContext,
  callState: ResponsesFunctionCallState,
  argumentsText: string,
  responseId?: string,
  model?: string
): void {
  if (callState.emitted) {
    return;
  }

  const resolvedArguments = argumentsText
    || callState.finalArguments
    || callState.argumentsBuffer
    || '{}';
  if (!resolvedArguments) {
    return;
  }

  callState.finalArguments = resolvedArguments;
  emitResponsesFunctionCallChunk(res, state, callState, {
    includeName: true,
    argumentsText: resolvedArguments,
    responseId,
    model,
  });
  callState.emitted = true;
  callState.metadataEmitted = true;
  context.hasAnyDelta = true;
}

/**
 * 发送已完成的Responses函数调用
 * @param res - 服务器响应对象
 * @param state - 流状态
 * @param context - Responses流上下文
 * @param responseObj - 响应对象
 */
function emitResponsesCompletedFunctionCalls(
  res: http.ServerResponse,
  state: StreamState,
  context: ResponsesStreamContext,
  responseObj: Record<string, unknown>
): void {
  const responseId = toString(responseObj.id);
  const model = toString(responseObj.model);

  for (const [index, item] of toArray(responseObj.output).entries()) {
    const itemObj = toOptionalObject(item);
    if (!itemObj || toString(itemObj.type) !== 'function_call') {
      continue;
    }

    const payloadObj: Record<string, unknown> = {
      response_id: responseId,
      model,
      call_id: toString(itemObj.call_id),
      item_id: toString(itemObj.id),
      name: toString(itemObj.name),
    };
    const itemOutputIndex = toNumber(itemObj.output_index);
    if (itemOutputIndex !== null) {
      payloadObj.output_index = itemOutputIndex;
    } else {
      payloadObj.output_index = index;
    }

    const callState = registerResponsesFunctionCallState(context, payloadObj, itemObj);
    emitResponsesFunctionCallMetadataOnce(
      res,
      state,
      context,
      callState,
      responseId,
      model
    );

    const finalizedArguments = normalizeFunctionArguments(itemObj.arguments)
      || callState.finalArguments
      || callState.argumentsBuffer
      || '{}';
    emitResponsesFunctionCallArgumentsOnce(
      res,
      state,
      context,
      callState,
      finalizedArguments,
      responseId,
      model
    );
  }
}

/**
 * 发送Responses回退内容
 * @param res - 服务器响应对象
 * @param state - 流状态
 * @param responseObj - 响应对象
 * @param context - Responses流上下文
 */
function emitResponsesFallbackContent(
  res: http.ServerResponse,
  state: StreamState,
  responseObj: Record<string, unknown>,
  context: ResponsesStreamContext
): void {
  const syntheticOpenAIResponse = convertResponsesToOpenAIResponse(responseObj);
  const firstChoice = toOptionalObject(toArray(syntheticOpenAIResponse.choices)[0]);
  const message = toOptionalObject(firstChoice?.message);
  if (!message) {
    return;
  }

  const reasoning = toString(message.reasoning_content) || toString(message.reasoning);
  if (reasoning) {
    processOpenAIChunk(res, state, {
      id: toString(syntheticOpenAIResponse.id),
      model: toString(syntheticOpenAIResponse.model),
      choices: [{ delta: { reasoning } }],
    });
  }

  const messageContent = message.content;
  if (typeof messageContent === 'string' && messageContent) {
    processOpenAIChunk(res, state, {
      id: toString(syntheticOpenAIResponse.id),
      model: toString(syntheticOpenAIResponse.model),
      choices: [{ delta: { content: messageContent } }],
    });
  } else if (Array.isArray(messageContent)) {
    for (const part of messageContent) {
      const partObj = toOptionalObject(part);
      const text = toString(partObj?.text);
      if (text) {
        processOpenAIChunk(res, state, {
          id: toString(syntheticOpenAIResponse.id),
          model: toString(syntheticOpenAIResponse.model),
          choices: [{ delta: { content: text } }],
        });
      }
    }
  }

  for (const toolCall of toArray(message.tool_calls)) {
    const toolCallObj = toOptionalObject(toolCall);
    const functionObj = toOptionalObject(toolCallObj?.function);
    if (!toolCallObj || !functionObj) {
      continue;
    }

    const payloadObj: Record<string, unknown> = {
      response_id: toString(syntheticOpenAIResponse.id),
      model: toString(syntheticOpenAIResponse.model),
      call_id: toString(toolCallObj.id),
      name: toString(functionObj.name),
    };
    const callState = registerResponsesFunctionCallState(context, payloadObj, null);
    emitResponsesFunctionCallMetadataOnce(
      res,
      state,
      context,
      callState,
      toString(syntheticOpenAIResponse.id),
      toString(syntheticOpenAIResponse.model)
    );
    emitResponsesFunctionCallArgumentsOnce(
      res,
      state,
      context,
      callState,
      toString(functionObj.arguments) || '{}',
      toString(syntheticOpenAIResponse.id),
      toString(syntheticOpenAIResponse.model)
    );
  }
}

/**
 * 处理Responses流事件
 * @param res - 服务器响应对象
 * @param state - 流状态
 * @param context - Responses流上下文
 * @param event - 事件名称
 * @param payloadObj - 载荷对象
 */
function processResponsesStreamEvent(
  res: http.ServerResponse,
  state: StreamState,
  context: ResponsesStreamContext,
  event: string,
  payloadObj: Record<string, unknown>
): void {
  const eventType = event || toString(payloadObj.type);

  const responseObjFromPayload = toOptionalObject(payloadObj.response);
  if (responseObjFromPayload) {
    processOpenAIChunk(res, state, {
      id: toString(responseObjFromPayload.id),
      model: toString(responseObjFromPayload.model),
      choices: [],
    });
  }

  if (eventType === 'response.created') {
    return;
  }

  if (eventType === 'response.output_text.delta' || eventType === 'response.output.delta') {
    const textDelta = toString(payloadObj.delta);
    if (textDelta) {
      processOpenAIChunk(res, state, {
        id: toString(payloadObj.response_id),
        model: toString(payloadObj.model),
        choices: [{ delta: { content: textDelta } }],
      });
      context.hasAnyDelta = true;
    }
    return;
  }

  if (
    eventType === 'response.reasoning_summary_text.delta'
    || eventType === 'response.reasoning.delta'
  ) {
    const thinkingDelta = toString(payloadObj.delta);
    if (thinkingDelta) {
      processOpenAIChunk(res, state, {
        id: toString(payloadObj.response_id),
        model: toString(payloadObj.model),
        choices: [{ delta: { reasoning: thinkingDelta } }],
      });
      context.hasAnyDelta = true;
    }
    return;
  }

  if (eventType === 'response.output_item.added' || eventType === 'response.output_item.done') {
    const itemObj = toOptionalObject(payloadObj.item);
    if (!itemObj) {
      return;
    }

    if (toString(itemObj.type) === 'function_call') {
      const callState = registerResponsesFunctionCallState(context, payloadObj, itemObj);
      const responseId = toString(payloadObj.response_id);
      const model = toString(payloadObj.model);
      emitResponsesFunctionCallMetadataOnce(
        res,
        state,
        context,
        callState,
        responseId,
        model
      );

      if (eventType === 'response.output_item.done' && !callState.emitted) {
        const inlineArguments = normalizeFunctionArguments(itemObj.arguments);
        if (inlineArguments) {
          emitResponsesFunctionCallArgumentsOnce(
            res,
            state,
            context,
            callState,
            inlineArguments,
            responseId,
            model
          );
        }
      }
    }
    return;
  }

  if (eventType === 'response.function_call_arguments.delta') {
    const callState = registerResponsesFunctionCallState(context, payloadObj, null);
    const argumentsDelta = normalizeFunctionArguments(payloadObj.delta);
    if (!argumentsDelta) {
      return;
    }
    callState.argumentsBuffer += argumentsDelta;
    return;
  }

  if (eventType === 'response.function_call_arguments.done') {
    const callState = registerResponsesFunctionCallState(context, payloadObj, null);
    const argumentsDone = normalizeFunctionArguments(payloadObj.arguments)
      || callState.argumentsBuffer
      || '{}';
    callState.finalArguments = argumentsDone;
    emitResponsesFunctionCallArgumentsOnce(
      res,
      state,
      context,
      callState,
      argumentsDone,
      toString(payloadObj.response_id),
      toString(payloadObj.model)
    );
    return;
  }

  if (eventType === 'response.completed') {
    const responseObj = resolveResponsesObject(payloadObj);
    if (!context.hasAnyDelta) {
      emitResponsesFallbackContent(res, state, responseObj, context);
    }
    emitResponsesCompletedFunctionCalls(res, state, context, responseObj);

    const usage = toOptionalObject(responseObj.usage);
    processOpenAIChunk(res, state, {
      id: toString(responseObj.id),
      model: toString(responseObj.model),
      choices: [{ finish_reason: detectResponsesFinishReason(responseObj) }],
      usage: {
        prompt_tokens: toNumber(usage?.input_tokens) ?? toNumber(usage?.prompt_tokens) ?? 0,
        completion_tokens: toNumber(usage?.output_tokens) ?? toNumber(usage?.completion_tokens) ?? 0,
      },
    });
  }
}

/**
 * 处理Responses流响应
 * @param upstreamResponse - 上游响应
 * @param res - 服务器响应对象
 */
async function handleResponsesStreamResponse(
  upstreamResponse: Response,
  res: http.ServerResponse
): Promise<void> {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  if (!upstreamResponse.body) {
    emitSSE(res, 'error', createAnthropicErrorBody('上游返回空流', 'stream_error'));
    res.end();
    return;
  }

  const reader = upstreamResponse.body.getReader();
  const decoder = new TextDecoder();
  const state = createStreamState();
  const context = createResponsesStreamContext();

  let buffer = '';
  let sawDoneMarker = false;

  /**
   * 刷新完成标记
   */
  const flushDone = () => {
    if (!state.hasMessageStart) {
      return;
    }
    if (!state.hasMessageStop) {
      closeCurrentBlockIfNeeded(res, state);
      emitSSE(res, 'message_stop', {
        type: 'message_stop',
      });
      state.hasMessageStop = true;
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });

    let boundary = findSSEPacketBoundary(buffer);
    while (boundary) {
      const packet = buffer.slice(0, boundary.index);
      buffer = buffer.slice(boundary.index + boundary.separatorLength);

      const parsedPacket = parseSSEPacket(packet);
      const payload = parsedPacket.payload;
      if (!payload) {
        boundary = findSSEPacketBoundary(buffer);
        continue;
      }

      if (payload === '[DONE]') {
        flushDone();
        sawDoneMarker = true;
        break;
      }

      try {
        const parsed = JSON.parse(payload) as Record<string, unknown>;
        processResponsesStreamEvent(res, state, context, parsedPacket.event, parsed);
      } catch {
        // 忽略格式错误的流块
      }

      boundary = findSSEPacketBoundary(buffer);
    }

    if (sawDoneMarker) {
      break;
    }
  }

  if (sawDoneMarker) {
    try {
      await reader.cancel();
    } catch {
      // 忽略错误
    }
  }

  flushDone();
  res.end();
}

/**
 * 处理聊天完成流响应
 * @param upstreamResponse - 上游响应
 * @param res - 服务器响应对象
 */
async function handleChatCompletionsStreamResponse(
  upstreamResponse: Response,
  res: http.ServerResponse
): Promise<void> {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  if (!upstreamResponse.body) {
    emitSSE(res, 'error', createAnthropicErrorBody('上游返回空流', 'stream_error'));
    res.end();
    return;
  }

  const reader = upstreamResponse.body.getReader();
  const decoder = new TextDecoder();
  const state = createStreamState();

  let buffer = '';
  let sawDoneMarker = false;

  /**
   * 刷新完成标记
   */
  const flushDone = () => {
    if (!state.hasMessageStart) {
      return;
    }
    if (!state.hasMessageStop) {
      closeCurrentBlockIfNeeded(res, state);
      emitSSE(res, 'message_stop', {
        type: 'message_stop',
      });
      state.hasMessageStop = true;
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });

    let boundary = findSSEPacketBoundary(buffer);
    while (boundary) {
      const packet = buffer.slice(0, boundary.index);
      buffer = buffer.slice(boundary.index + boundary.separatorLength);

      const lines = packet.split(/\r?\n/);
      const dataLines: string[] = [];

      for (const line of lines) {
        if (line.startsWith('data:')) {
          dataLines.push(line.slice(5).trimStart());
        }
      }

      const payload = dataLines.join('\n');
      if (!payload) {
        boundary = findSSEPacketBoundary(buffer);
        continue;
      }

      if (payload === '[DONE]') {
        flushDone();
        sawDoneMarker = true;
        break;
      }

      try {
        const parsed = JSON.parse(payload) as OpenAIStreamChunk;
        processOpenAIChunk(res, state, parsed);
      } catch {
        // 忽略格式错误的流块
      }

      boundary = findSSEPacketBoundary(buffer);
    }

    if (sawDoneMarker) {
      break;
    }
  }

  if (sawDoneMarker) {
    try {
      await reader.cancel();
    } catch {
      // 忽略错误
    }
  }

  flushDone();
  res.end();
}

/**
 * 处理创建计划任务请求
 * @param req - HTTP请求对象
 * @param res - 服务器响应对象
 */
async function handleCreateScheduledTask(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  if (!scheduledTaskDeps) {
    writeJSON(res, 503, { success: false, error: '计划任务服务不可用' } as any);
    return;
  }

  let body: string;
  try {
    body = await readRequestBody(req);
  } catch {
    writeJSON(res, 400, { success: false, error: '无效的请求体' } as any);
    return;
  }

  let input: any;
  try {
    input = JSON.parse(body);
  } catch {
    writeJSON(res, 400, { success: false, error: '无效的JSON格式' } as any);
    return;
  }

  // 验证必填字段
  if (!input.name?.trim()) {
    writeJSON(res, 400, { success: false, error: '缺少必填字段: name' } as any);
    return;
  }
  if (!input.prompt?.trim()) {
    writeJSON(res, 400, { success: false, error: '缺少必填字段: prompt' } as any);
    return;
  }
  if (!input.schedule?.type) {
    writeJSON(res, 400, { success: false, error: '缺少必填字段: schedule.type' } as any);
    return;
  }
  if (!['at', 'interval', 'cron'].includes(input.schedule.type)) {
    writeJSON(res, 400, { success: false, error: '无效的计划类型。必须是: at, interval, cron' } as any);
    return;
  }
  if (input.schedule.type === 'cron' && !input.schedule.expression) {
    writeJSON(res, 400, { success: false, error: 'Cron计划需要expression字段' } as any);
    return;
  }
  if (input.schedule.type === 'at' && !input.schedule.datetime) {
    writeJSON(res, 400, { success: false, error: 'At计划需要datetime字段' } as any);
    return;
  }

  // 验证: "at"类型必须是将来的时间
  if (input.schedule.type === 'at' && input.schedule.datetime) {
    const targetMs = new Date(input.schedule.datetime).getTime();
    if (targetMs <= Date.now()) {
      writeJSON(res, 400, { success: false, error: '一次性(at)任务的执行时间必须是将来的时间' } as any);
      return;
    }
  }

  // 验证: expiresAt不能是过去的时间
  if (input.expiresAt) {
    const todayStr = new Date().toISOString().slice(0, 10);
    if (input.expiresAt <= todayStr) {
      writeJSON(res, 400, { success: false, error: '过期日期必须是将来的日期' } as any);
      return;
    }
  }

  // 构建带有默认值的ScheduledTaskInput
  const taskInput: ScheduledTaskInput = {
    name: input.name.trim(),
    description: input.description || '',
    schedule: input.schedule,
    prompt: input.prompt.trim(),
    workingDirectory: normalizeScheduledTaskWorkingDirectory(input.workingDirectory),
    systemPrompt: input.systemPrompt || '',
    executionMode: input.executionMode || 'auto',
    expiresAt: input.expiresAt || null,
    notifyPlatforms: input.notifyPlatforms || [],
    enabled: input.enabled !== false,
  };

  try {
    const task = scheduledTaskDeps.getScheduledTaskStore().createTask(taskInput);
    scheduledTaskDeps.getScheduler().reschedule();

    // 通知渲染器刷新任务列表
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('scheduledTask:statusUpdate', {
        taskId: task.id,
        state: task.state,
      });
    }

    console.log(`[CoworkProxy] 通过API创建计划任务: ${task.id} "${task.name}"`);
    writeJSON(res, 201, { success: true, task } as any);
  } catch (err: any) {
    console.error('[CoworkProxy] 创建计划任务失败:', err);
    writeJSON(res, 500, { success: false, error: err.message } as any);
  }
}

/**
 * 处理HTTP请求
 * @param req - HTTP请求对象
 * @param res - 服务器响应对象
 */
async function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  const method = (req.method || 'GET').toUpperCase();
  const url = new URL(req.url || '/', `http://${LOCAL_HOST}`);

  if (method === 'GET' && url.pathname === '/healthz') {
    writeJSON(res, 200, {
      ok: true,
      running: Boolean(proxyServer),
      hasUpstream: Boolean(upstreamConfig),
      lastError: lastProxyError,
    });
    return;
  }

  // 计划任务创建API
  if (method === 'POST' && url.pathname === '/api/scheduled-tasks') {
    await handleCreateScheduledTask(req, res);
    return;
  }

  if (method !== 'POST' || url.pathname !== '/v1/messages') {
    writeJSON(res, 404, createAnthropicErrorBody('未找到', 'not_found_error'));
    return;
  }

  if (!upstreamConfig) {
    writeJSON(
      res,
      503,
      createAnthropicErrorBody('OpenAI兼容性代理未配置', 'service_unavailable')
    );
    return;
  }

  let requestBodyRaw = '';
  try {
    requestBodyRaw = await readRequestBody(req);
  } catch (error) {
    const message = error instanceof Error ? error.message : '无效的请求体';
    writeJSON(res, 400, createAnthropicErrorBody(message, 'invalid_request_error'));
    return;
  }

  let parsedRequestBody: unknown;
  try {
    parsedRequestBody = JSON.parse(requestBodyRaw);
  } catch {
    writeJSON(res, 400, createAnthropicErrorBody('请求体必须是有效的JSON', 'invalid_request_error'));
    return;
  }

  const upstreamAPIType = resolveUpstreamAPIType(upstreamConfig.provider);
  const openAIRequest = anthropicToOpenAI(parsedRequestBody);
  if (!openAIRequest.model) {
    openAIRequest.model = upstreamConfig.model;
  }
  filterOpenAIToolsForProvider(openAIRequest, upstreamConfig.provider);
  hydrateOpenAIRequestToolCalls(openAIRequest, upstreamConfig.provider, upstreamConfig.baseURL);

  if (upstreamAPIType === 'chat_completions') {
    normalizeMaxTokensFieldForOpenAIProvider(openAIRequest, upstreamConfig.provider);
  }

  const upstreamRequest = upstreamAPIType === 'responses'
    ? convertChatCompletionsRequestToResponsesRequest(openAIRequest)
    : openAIRequest;
  const stream = Boolean(upstreamRequest.stream);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (upstreamConfig.apiKey) {
    headers.Authorization = `Bearer ${upstreamConfig.apiKey}`;
  }

  const targetURLs = buildUpstreamTargetUrls(upstreamConfig.baseURL, upstreamAPIType);
  let currentTargetURL = targetURLs[0];

  /**
   * 发送上游请求
   * @param payload - 请求载荷
   * @param targetURL - 目标URL
   * @returns 响应Promise
   */
  const sendUpstreamRequest = async (
    payload: Record<string, unknown>,
    targetURL: string
  ): Promise<Response> => {
    currentTargetURL = targetURL;
    return session.defaultSession.fetch(targetURL, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
  };

  let upstreamResponse: Response;
  try {
    upstreamResponse = await sendUpstreamRequest(upstreamRequest, targetURLs[0]);
  } catch (error) {
    const message = error instanceof Error ? error.message : '网络错误';
    lastProxyError = message;
    writeJSON(res, 502, createAnthropicErrorBody(message));
    return;
  }

  if (!upstreamResponse.ok) {
    if (upstreamResponse.status === 404 && targetURLs.length > 1) {
      for (let i = 1; i < targetURLs.length; i += 1) {
        const retryURL = targetURLs[i];
        try {
          upstreamResponse = await sendUpstreamRequest(upstreamRequest, retryURL);
        } catch (error) {
          const message = error instanceof Error ? error.message : '网络错误';
          lastProxyError = message;
          writeJSON(res, 502, createAnthropicErrorBody(message));
          return;
        }
        if (upstreamResponse.ok || upstreamResponse.status !== 404) {
          break;
        }
      }
    }

    if (!upstreamResponse.ok) {
      const firstErrorText = await upstreamResponse.text();
      let firstErrorMessage = extractErrorMessage(firstErrorText);
      if (firstErrorMessage === '上游API请求失败') {
        firstErrorMessage = `上游API请求失败 (${upstreamResponse.status}) ${currentTargetURL}`;
      }

      if (upstreamAPIType === 'chat_completions' && upstreamResponse.status === 400) {
        if (isMaxTokensUnsupportedError(firstErrorMessage)) {
          const convertResult = convertMaxTokensToMaxCompletionTokens(upstreamRequest);
          if (convertResult.changed) {
            try {
              upstreamResponse = await sendUpstreamRequest(upstreamRequest, currentTargetURL);
              if (!upstreamResponse.ok) {
                const retryErrorText = await upstreamResponse.text();
                firstErrorMessage = extractErrorMessage(retryErrorText);
              } else {
                console.info(
                  '[cowork-openai-compat-proxy] 已使用max_completion_tokens重试请求 '
                    + `转换自max_tokens=${convertResult.convertedTo}`
                );
              }
            } catch (error) {
              const message = error instanceof Error ? error.message : '网络错误';
              lastProxyError = message;
              writeJSON(res, 502, createAnthropicErrorBody(message));
              return;
            }
          }
        }

        // 某些OpenAI兼容提供商（如DeepSeek）强制执行严格的max_tokens范围
        // 当上游响应包含允许范围时，使用限制后的值重试一次
        if (!upstreamResponse.ok) {
          const clampResult = clampMaxTokensFromError(upstreamRequest, firstErrorMessage);
          if (clampResult.changed) {
            try {
              upstreamResponse = await sendUpstreamRequest(upstreamRequest, currentTargetURL);
              if (!upstreamResponse.ok) {
                const retryErrorText = await upstreamResponse.text();
                firstErrorMessage = extractErrorMessage(retryErrorText);
              } else {
                console.info(
                  `[cowork-openai-compat-proxy] 已使用限制后的max_tokens=${clampResult.clampedTo}重试请求`
                );
              }
            } catch (error) {
              const message = error instanceof Error ? error.message : '网络错误';
              lastProxyError = message;
              writeJSON(res, 502, createAnthropicErrorBody(message));
              return;
            }
          }
        }
      }

      if (!upstreamResponse.ok) {
        lastProxyError = firstErrorMessage;
        writeJSON(res, upstreamResponse.status, createAnthropicErrorBody(firstErrorMessage));
        return;
      }
    }
  }

  lastProxyError = null;

  if (stream) {
    if (upstreamAPIType === 'responses') {
      await handleResponsesStreamResponse(upstreamResponse, res);
    } else {
      await handleChatCompletionsStreamResponse(upstreamResponse, res);
    }
    return;
  }

  let upstreamJSON: unknown;
  try {
    upstreamJSON = await upstreamResponse.json();
  } catch {
    lastProxyError = '解析上游JSON响应失败';
    writeJSON(res, 502, createAnthropicErrorBody('解析上游JSON响应失败'));
    return;
  }

  if (upstreamAPIType === 'responses') {
    const syntheticOpenAIResponse = convertResponsesToOpenAIResponse(upstreamJSON);
    cacheToolCallExtraContentFromOpenAIResponse(syntheticOpenAIResponse);
    cacheToolCallExtraContentFromResponsesResponse(upstreamJSON);
    const anthropicResponse = openAIToAnthropic(syntheticOpenAIResponse);
    writeJSON(res, 200, anthropicResponse);
    return;
  }

  cacheToolCallExtraContentFromOpenAIResponse(upstreamJSON);

  const anthropicResponse = openAIToAnthropic(upstreamJSON);
  writeJSON(res, 200, anthropicResponse);
}

// 测试工具导出
export const __openAICompatProxyTestUtils = {
  createStreamState,
  createResponsesStreamContext,
  findSSEPacketBoundary,
  processResponsesStreamEvent,
  convertChatCompletionsRequestToResponsesRequest,
  filterOpenAIToolsForProvider,
};

/**
 * 启动Cowork OpenAI兼容性代理
 */
export async function startCoworkOpenAICompatProxy(): Promise<void> {
  if (proxyServer) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      void handleRequest(req, res).catch((error) => {
        const message = error instanceof Error ? error.message : '内部代理错误';
        lastProxyError = message;
        if (!res.headersSent) {
          writeJSON(res, 500, createAnthropicErrorBody(message));
        } else {
          res.end();
        }
      });
    });

    server.on('error', (error) => {
      lastProxyError = error.message;
      reject(error);
    });

    server.listen(0, PROXY_BIND_HOST, () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('绑定OpenAI兼容性代理端口失败'));
        return;
      }

      proxyServer = server;
      proxyPort = addr.port;
      lastProxyError = null;
      resolve();
    });
  });
}

/**
 * 停止Cowork OpenAI兼容性代理
 */
export async function stopCoworkOpenAICompatProxy(): Promise<void> {
  if (!proxyServer) {
    return;
  }

  const server = proxyServer;
  proxyServer = null;
  proxyPort = null;

  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

/**
 * 配置Cowork OpenAI兼容性代理
 * @param config - 上游配置
 */
export function configureCoworkOpenAICompatProxy(config: OpenAICompatUpstreamConfig): void {
  upstreamConfig = {
    ...config,
    baseURL: config.baseURL.trim(),
    apiKey: config.apiKey?.trim(),
  };
  lastProxyError = null;
}

/**
 * 获取Cowork OpenAI兼容性代理基础URL
 * @param target - 代理目标类型
 * @returns 代理基础URL，如果未运行则返回null
 */
export function getCoworkOpenAICompatProxyBaseURL(target: OpenAICompatProxyTarget = 'local'): string | null {
  if (!proxyServer || !proxyPort) {
    return null;
  }
  const host = target === 'sandbox' ? SANDBOX_HOST : LOCAL_HOST;
  return `http://${host}:${proxyPort}`;
}

/**
 * 获取内部API使用的基础URL（计划任务等）
 * 与用于LLM代理的getCoworkOpenAICompatProxyBaseURL不同，
 * 此函数始终返回本地代理URL，无论API格式如何。
 * @returns 内部API基础URL，如果未运行则返回null
 */
export function getInternalApiBaseURL(): string | null {
  return getCoworkOpenAICompatProxyBaseURL('local');
}

/**
 * 获取Cowork OpenAI兼容性代理状态
 * @returns 代理状态对象
 */
export function getCoworkOpenAICompatProxyStatus(): OpenAICompatProxyStatus {
  return {
    running: Boolean(proxyServer),
    baseURL: getCoworkOpenAICompatProxyBaseURL(),
    hasUpstream: Boolean(upstreamConfig),
    upstreamBaseURL: upstreamConfig?.baseURL || null,
    upstreamModel: upstreamConfig?.model || null,
    lastError: lastProxyError,
  };
}
