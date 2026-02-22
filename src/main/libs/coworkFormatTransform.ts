/**
 * API格式类型定义
 * 支持Anthropic和OpenAI两种API格式
 */
export type AnthropicApiFormat = 'anthropic' | 'openai';

/**
 * OpenAI流式响应数据块类型定义
 * 用于处理流式API返回的数据结构
 */
export type OpenAIStreamChunk = {
  id?: string;
  model?: string;
  choices?: Array<{
    delta?: {
      content?: string;
      reasoning?: string;
      reasoning_content?: string;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        type?: string;
        extra_content?: unknown;
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
};

/**
 * 将未知类型的值转换为对象
 * @param value - 待转换的值
 * @returns 转换后的对象，如果不是有效对象则返回空对象
 */
function toObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

/**
 * 将未知类型的值转换为数组
 * @param value - 待转换的值
 * @returns 转换后的数组，如果不是数组则返回空数组
 */
function toArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * 将未知类型的值转换为字符串
 * @param value - 待转换的值
 * @returns 转换后的字符串，如果不是字符串则返回空字符串
 */
function toString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * 将未知类型的值转换为可选对象
 * @param value - 待转换的值
 * @returns 转换后的对象，如果不是有效对象则返回null
 */
function toOptionalObject(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

/**
 * 将未知类型的值转换为JSON字符串
 * @param value - 待转换的值
 * @returns 转换后的JSON字符串
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
 * 规范化API提供商格式
 * @param format - API格式标识
 * @returns 返回'openai'或'anthropic'格式
 */
export function normalizeProviderApiFormat(format: unknown): AnthropicApiFormat {
  if (format === 'openai') {
    return 'openai';
  }
  return 'anthropic';
}

/**
 * 映射停止原因
 * 将OpenAI的finish_reason映射到Anthropic的stop_reason
 * @param finishReason - OpenAI的结束原因
 * @returns Anthropic格式的停止原因，或null
 */
export function mapStopReason(finishReason?: string | null): string | null {
  if (!finishReason) {
    return null;
  }
  // 工具调用结束映射为tool_use
  if (finishReason === 'tool_calls') {
    return 'tool_use';
  }
  // 正常结束映射为end_turn
  if (finishReason === 'stop') {
    return 'end_turn';
  }
  // 达到最大token数映射为max_tokens
  if (finishReason === 'length') {
    return 'max_tokens';
  }
  return finishReason;
}

/**
 * 格式化SSE（Server-Sent Events）事件
 * @param event - 事件名称
 * @param data - 事件数据
 * @returns 格式化后的SSE事件字符串
 */
export function formatSSEEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * 清理JSON Schema
 * 移除format字段（如果为'uri'），并递归处理properties和items
 * @param schema - 待清理的schema对象
 * @returns 清理后的schema对象
 */
function cleanSchema(schema: unknown): unknown {
  const obj = toObject(schema);
  const output: Record<string, unknown> = { ...obj };

  // 移除uri格式的format字段
  if (output.format === 'uri') {
    delete output.format;
  }

  // 递归处理properties属性
  const properties = toObject(output.properties);
  if (Object.keys(properties).length > 0) {
    const nextProperties: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(properties)) {
      nextProperties[key] = cleanSchema(value);
    }
    output.properties = nextProperties;
  }

  // 递归处理items属性
  if (output.items !== undefined) {
    output.items = cleanSchema(output.items);
  }

  return output;
}

/**
 * 将消息内容转换为OpenAI格式
 * 处理文本、图像、工具调用、工具结果和思考内容等不同类型的消息块
 * @param role - 消息角色（user/assistant/tool）
 * @param content - 消息内容
 * @returns 转换后的OpenAI格式消息数组
 */
function convertMessageToOpenAI(role: string, content: unknown): Array<Record<string, unknown>> {
  const result: Array<Record<string, unknown>> = [];

  // 如果内容是字符串，直接包装为消息对象
  if (typeof content === 'string') {
    result.push({ role, content });
    return result;
  }

  // 将内容转换为块数组
  const blocks = toArray(content);
  if (blocks.length === 0) {
    result.push({ role, content: null });
    return result;
  }

  const contentParts: Array<Record<string, unknown>> = [];
  const toolCalls: Array<Record<string, unknown>> = [];
  const thinkingParts: string[] = [];

  // 遍历处理每个消息块
  for (const block of blocks) {
    const blockObj = toObject(block);
    const blockType = toString(blockObj.type);

    // 处理文本块
    if (blockType === 'text') {
      const text = toString(blockObj.text);
      if (text) {
        contentParts.push({ type: 'text', text });
      }
      continue;
    }

    // 处理图像块
    if (blockType === 'image') {
      const source = toObject(blockObj.source);
      const mediaType = toString(source.media_type) || 'image/png';
      const data = toString(source.data);
      if (data) {
        contentParts.push({
          type: 'image_url',
          image_url: {
            url: `data:${mediaType};base64,${data}`,
          },
        });
      }
      continue;
    }

    // 处理工具使用块
    if (blockType === 'tool_use') {
      const id = toString(blockObj.id);
      const name = toString(blockObj.name);
      const input = blockObj.input ?? {};
      const toolCall: Record<string, unknown> = {
        id,
        type: 'function',
        function: {
          name,
          arguments: stringifyUnknown(input),
        },
      };

      // 处理额外内容（如Google的思考签名）
      let extraContent: unknown = blockObj.extra_content;
      if (extraContent === undefined) {
        const thoughtSignature = toString(blockObj.thought_signature);
        if (thoughtSignature) {
          extraContent = {
            google: {
              thought_signature: thoughtSignature,
            },
          };
        }
      }

      if (extraContent !== undefined) {
        toolCall.extra_content = extraContent;
      }

      toolCalls.push(toolCall);
      continue;
    }

    // 处理工具结果块
    if (blockType === 'tool_result') {
      const toolCallId = toString(blockObj.tool_use_id);
      const toolContent = stringifyUnknown(blockObj.content);
      result.push({
        role: 'tool',
        tool_call_id: toolCallId,
        content: toolContent,
      });
      continue;
    }

    // 处理思考内容块
    if (blockType === 'thinking') {
      const thinking = toString(blockObj.thinking) || toString(blockObj.text);
      if (thinking) {
        thinkingParts.push(thinking);
      }
      continue;
    }
  }

  // 合并思考内容并构建最终消息
  const mergedThinking = thinkingParts.join('');
  if (contentParts.length > 0 || toolCalls.length > 0 || (role === 'assistant' && mergedThinking)) {
    const nextMessage: Record<string, unknown> = { role };

    // 处理内容部分
    if (contentParts.length === 1 && contentParts[0].type === 'text') {
      nextMessage.content = contentParts[0].text;
    } else if (contentParts.length > 0) {
      nextMessage.content = contentParts;
    } else {
      nextMessage.content = null;
    }

    // 添加工具调用
    if (toolCalls.length > 0) {
      nextMessage.tool_calls = toolCalls;
    }

    // 添加思考内容（仅助手角色）
    if (role === 'assistant' && mergedThinking) {
      nextMessage.reasoning_content = mergedThinking;
    }

    result.push(nextMessage);
  }

  return result;
}

/**
 * 将Anthropic格式转换为OpenAI格式
 * 处理系统消息、用户消息、工具定义等内容的格式转换
 * @param body - Anthropic格式的请求体
 * @returns OpenAI格式的请求对象
 */
export function anthropicToOpenAI(body: unknown): Record<string, unknown> {
  const source = toObject(body);
  const output: Record<string, unknown> = {};

  // 复制模型名称
  if (source.model !== undefined) {
    output.model = source.model;
  }

  const messages: Array<Record<string, unknown>> = [];

  // 处理系统消息
  const system = source.system;
  if (typeof system === 'string' && system) {
    messages.push({ role: 'system', content: system });
  } else if (Array.isArray(system)) {
    for (const item of system) {
      const itemObj = toObject(item);
      const text = toString(itemObj.text);
      if (text) {
        messages.push({ role: 'system', content: text });
      }
    }
  }

  // 转换消息列表
  const sourceMessages = toArray(source.messages);
  for (const item of sourceMessages) {
    const itemObj = toObject(item);
    const role = toString(itemObj.role) || 'user';
    const converted = convertMessageToOpenAI(role, itemObj.content);
    messages.push(...converted);
  }

  output.messages = messages;

  // 复制参数配置
  if (source.max_tokens !== undefined) {
    output.max_tokens = source.max_tokens;
  }
  if (source.temperature !== undefined) {
    output.temperature = source.temperature;
  }
  if (source.top_p !== undefined) {
    output.top_p = source.top_p;
  }
  if (source.stop_sequences !== undefined) {
    output.stop = source.stop_sequences;
  }
  if (source.stream !== undefined) {
    output.stream = source.stream;
  }

  // 转换工具定义
  const tools = toArray(source.tools)
    .filter((tool) => toString(toObject(tool).type) !== 'BatchTool')
    .map((tool) => {
      const toolObj = toObject(tool);
      return {
        type: 'function',
        function: {
          name: toString(toolObj.name),
          description: toolObj.description,
          parameters: cleanSchema(toolObj.input_schema ?? {}),
        },
      };
    });

  if (tools.length > 0) {
    output.tools = tools;
  }

  // 复制工具选择配置
  if (source.tool_choice !== undefined) {
    output.tool_choice = source.tool_choice;
  }

  return output;
}

/**
 * 将OpenAI格式转换为Anthropic格式
 * 处理响应消息、工具调用、使用量统计等内容的格式转换
 * @param body - OpenAI格式的响应体
 * @returns Anthropic格式的响应对象
 */
export function openAIToAnthropic(body: unknown): Record<string, unknown> {
  const source = toObject(body);
  const choices = toArray(source.choices);
  const firstChoice = toObject(choices[0]);
  const message = toObject(firstChoice.message);

  const content: Array<Record<string, unknown>> = [];

  // 处理推理/思考内容
  const reasoningContent = toString(message.reasoning_content) || toString(message.reasoning);
  if (reasoningContent) {
    content.push({ type: 'thinking', thinking: reasoningContent });
  }

  // 处理文本内容
  const textContent = message.content;
  if (typeof textContent === 'string' && textContent) {
    content.push({ type: 'text', text: textContent });
  } else if (Array.isArray(textContent)) {
    for (const part of textContent) {
      const partObj = toObject(part);
      if (partObj.type === 'text' && typeof partObj.text === 'string' && partObj.text) {
        content.push({ type: 'text', text: partObj.text });
      }
    }
  }

  // 处理工具调用
  const toolCalls = toArray(message.tool_calls);
  for (const toolCall of toolCalls) {
    const toolCallObj = toObject(toolCall);
    const functionObj = toObject(toolCallObj.function);
    const argsString = toString(functionObj.arguments) || '{}';
    let parsedArgs: unknown = {};
    try {
      parsedArgs = JSON.parse(argsString);
    } catch {
      parsedArgs = {};
    }

    const toolUseBlock: Record<string, unknown> = {
      type: 'tool_use',
      id: toString(toolCallObj.id),
      name: toString(functionObj.name),
      input: parsedArgs,
    };

    // 处理额外内容（如Google的思考签名）
    let extraContent: unknown = toolCallObj.extra_content;
    if (extraContent === undefined) {
      const functionObject = toOptionalObject(toolCallObj.function);
      if (functionObject?.extra_content !== undefined) {
        extraContent = functionObject.extra_content;
      } else {
        const thoughtSignature = toString(functionObject?.thought_signature);
        if (thoughtSignature) {
          extraContent = {
            google: {
              thought_signature: thoughtSignature,
            },
          };
        }
      }
    }

    if (extraContent !== undefined) {
      toolUseBlock.extra_content = extraContent;
    }

    content.push(toolUseBlock);
  }

  // 获取使用量统计
  const usage = toObject(source.usage);

  return {
    id: toString(source.id),
    type: 'message',
    role: 'assistant',
    content,
    model: toString(source.model),
    stop_reason: mapStopReason(
      typeof firstChoice.finish_reason === 'string' ? firstChoice.finish_reason : null
    ),
    stop_sequence: null,
    usage: {
      input_tokens: Number(usage.prompt_tokens) || 0,
      output_tokens: Number(usage.completion_tokens) || 0,
    },
  };
}

/**
 * 构建OpenAI聊天补全API的URL
 * 根据基础URL生成完整的聊天补全端点地址
 * 支持标准OpenAI API和Google Generative AI API的URL格式
 * @param baseURL - 基础URL地址
 * @returns 完整的聊天补全API端点URL
 */
export function buildOpenAIChatCompletionsURL(baseURL: string): string {
  const normalized = baseURL.trim().replace(/\/+$/, '');
  if (!normalized) {
    return '/v1/chat/completions';
  }
  // 如果已经包含/chat/completions，直接返回
  if (normalized.endsWith('/chat/completions')) {
    return normalized;
  }

  // 处理Google Generative AI API的特殊URL格式
  if (normalized.includes('generativelanguage.googleapis.com')) {
    if (normalized.endsWith('/v1beta/openai') || normalized.endsWith('/v1/openai')) {
      return `${normalized}/chat/completions`;
    }
    if (normalized.endsWith('/v1beta') || normalized.endsWith('/v1')) {
      const betaBase = normalized.endsWith('/v1')
        ? `${normalized.slice(0, -3)}v1beta`
        : normalized;
      return `${betaBase}/openai/chat/completions`;
    }
    return `${normalized}/v1beta/openai/chat/completions`;
  }

  // 标准OpenAI API URL处理
  if (normalized.endsWith('/v1')) {
    return `${normalized}/chat/completions`;
  }
  return `${normalized}/v1/chat/completions`;
}
