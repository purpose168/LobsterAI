/**
 * IM 聊天处理器
 * 通过 LLM 服务处理 IM 消息，支持可选的技能集成
 */

import axios from 'axios';
import {
  IMMessage,
  IMSettings,
} from './types';

// LLM 配置接口（映射 app_config 结构）
interface LLMConfig {
  apiKey: string;
  baseUrl: string;
  model?: string;
  provider?: string;
}

export interface IMChatHandlerOptions {
  getLLMConfig: () => Promise<LLMConfig | null>;
  getSkillsPrompt?: () => Promise<string | null>;
  imSettings: IMSettings;
}

export class IMChatHandler {
  private options: IMChatHandlerOptions;

  constructor(options: IMChatHandlerOptions) {
    this.options = options;
  }

  /**
   * 处理传入的 IM 消息并生成响应
   */
  async processMessage(message: IMMessage): Promise<string> {
    const llmConfig = await this.options.getLLMConfig();
    if (!llmConfig) {
      throw new Error('未找到 LLM 配置');
    }

    // 构建系统提示词，包含可选的技能
    let systemPrompt = this.options.imSettings.systemPrompt || '';

    if (this.options.imSettings.skillsEnabled && this.options.getSkillsPrompt) {
      const skillsPrompt = await this.options.getSkillsPrompt();
      if (skillsPrompt) {
        systemPrompt = systemPrompt
          ? `${systemPrompt}\n\n${skillsPrompt}`
          : skillsPrompt;
      }
    }

    // 调用 LLM API
    const response = await this.callLLM(llmConfig, message.content, systemPrompt);
    return response;
  }

  /**
   * 调用 LLM API 并获取响应（为简化实现，使用非流式方式）
   */
  private async callLLM(
    config: LLMConfig,
    userMessage: string,
    systemPrompt?: string
  ): Promise<string> {
    const provider = this.detectProvider(config);

    if (provider === 'anthropic') {
      return this.callAnthropicAPI(config, userMessage, systemPrompt);
    }

    // 默认使用 OpenAI 兼容 API
    return this.callOpenAICompatibleAPI(config, userMessage, systemPrompt);
  }

  /**
   * 从配置中检测提供商
   */
  private detectProvider(config: LLMConfig): 'anthropic' | 'openai' {
    if (config.provider === 'anthropic') return 'anthropic';
    if (config.baseUrl.includes('anthropic')) return 'anthropic';
    if (config.model?.startsWith('claude')) return 'anthropic';
    return 'openai';
  }

  private buildOpenAICompatibleChatCompletionsUrl(config: LLMConfig): string {
    const normalized = config.baseUrl.replace(/\/+$/, '');
    if (!normalized) {
      return '/v1/chat/completions';
    }
    if (normalized.endsWith('/chat/completions')) {
      return normalized;
    }

    const isGeminiLike =
      config.provider === 'gemini'
      || config.model?.startsWith('gemini')
      || normalized.includes('generativelanguage.googleapis.com');
    if (isGeminiLike) {
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

    if (normalized.endsWith('/v1')) {
      return `${normalized}/chat/completions`;
    }
    return `${normalized}/v1/chat/completions`;
  }

  private buildOpenAIResponsesUrl(config: LLMConfig): string {
    const normalized = config.baseUrl.replace(/\/+$/, '');
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

  private shouldUseOpenAIResponsesApi(config: LLMConfig): boolean {
    return config.provider?.toLowerCase() === 'openai';
  }

  private shouldUseMaxCompletionTokens(config: LLMConfig): boolean {
    const provider = config.provider?.toLowerCase();
    if (provider !== 'openai') {
      return false;
    }
    const normalizedModel = config.model?.toLowerCase() || '';
    const resolvedModel = normalizedModel.includes('/')
      ? normalizedModel.slice(normalizedModel.lastIndexOf('/') + 1)
      : normalizedModel;
    return resolvedModel.startsWith('gpt-5')
      || resolvedModel.startsWith('o1')
      || resolvedModel.startsWith('o3')
      || resolvedModel.startsWith('o4');
  }

  /**
   * 调用 Anthropic API
   */
  private async callAnthropicAPI(
    config: LLMConfig,
    userMessage: string,
    systemPrompt?: string
  ): Promise<string> {
    const url = `${config.baseUrl.replace(/\/$/, '')}/v1/messages`;

    const body: any = {
      model: config.model || 'claude-3-5-sonnet-20241022',
      max_tokens: 4096,
      messages: [{ role: 'user', content: userMessage }],
    };

    if (systemPrompt) {
      body.system = systemPrompt;
    }

    const response = await axios.post(url, body, {
      headers: {
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
    });

    // 从响应中提取文本
    const content = response.data.content;
    if (Array.isArray(content)) {
      return content
        .filter((block: any) => block.type === 'text')
        .map((block: any) => block.text)
        .join('\n');
    }

    return content?.text || content || '';
  }

  /**
   * 调用 OpenAI 兼容 API
   */
  private async callOpenAICompatibleAPI(
    config: LLMConfig,
    userMessage: string,
    systemPrompt?: string
  ): Promise<string> {
    const useResponsesApi = this.shouldUseOpenAIResponsesApi(config);
    const url = useResponsesApi
      ? this.buildOpenAIResponsesUrl(config)
      : this.buildOpenAICompatibleChatCompletionsUrl(config);

    const messages: Array<{ role: string; content: string }> = [];

    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }
    messages.push({ role: 'user', content: userMessage });

    const body: Record<string, unknown> = useResponsesApi
      ? {
          model: config.model || 'gpt-4o',
          input: [{ role: 'user', content: [{ type: 'input_text', text: userMessage }] }],
          max_output_tokens: 4096,
        }
      : {
          model: config.model || 'gpt-4o',
          messages,
        };
    if (useResponsesApi && systemPrompt) {
      body.instructions = systemPrompt;
    }
    if (!useResponsesApi) {
      if (this.shouldUseMaxCompletionTokens(config)) {
        body.max_completion_tokens = 4096;
      } else {
        body.max_tokens = 4096;
      }
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (config.apiKey) {
      headers.Authorization = `Bearer ${config.apiKey}`;
    }

    const response = await axios.post(url, body, { headers });

    if (useResponsesApi) {
      return this.extractResponsesText(response.data);
    }
    return response.data.choices?.[0]?.message?.content || '';
  }

  private extractResponsesText(payload: any): string {
    if (typeof payload?.output_text === 'string' && payload.output_text) {
      return payload.output_text;
    }

    const output = Array.isArray(payload?.output) ? payload.output : [];
    const chunks: string[] = [];
    output.forEach((item: any) => {
      if (!Array.isArray(item?.content)) {
        return;
      }
      item.content.forEach((contentItem: any) => {
        if (typeof contentItem?.text === 'string' && contentItem.text) {
          chunks.push(contentItem.text);
        }
      });
    });
    return chunks.join('');
  }

  /**
   * 以流式方式处理消息（用于 AI 卡片）
   */
  async *processMessageStream(
    message: IMMessage
  ): AsyncGenerator<{ content: string; done: boolean }> {
    const llmConfig = await this.options.getLLMConfig();
    if (!llmConfig) {
      throw new Error('未找到 LLM 配置');
    }

    // 构建系统提示词
    let systemPrompt = this.options.imSettings.systemPrompt || '';

    if (this.options.imSettings.skillsEnabled && this.options.getSkillsPrompt) {
      const skillsPrompt = await this.options.getSkillsPrompt();
      if (skillsPrompt) {
        systemPrompt = systemPrompt
          ? `${systemPrompt}\n\n${skillsPrompt}`
          : skillsPrompt;
      }
    }

    // 目前使用非流式方式并一次性返回结果
    // TODO: 实现真正的流式处理以提供更好的用户体验
    const response = await this.callLLM(llmConfig, message.content, systemPrompt);
    yield { content: response, done: true };
  }
}
