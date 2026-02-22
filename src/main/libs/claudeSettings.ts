import { join } from 'path';
import { app } from 'electron';
import type { SqliteStore } from '../sqliteStore';
import type { CoworkApiConfig } from './coworkConfigStore';
import {
  configureCoworkOpenAICompatProxy,
  type OpenAICompatProxyTarget,
  getCoworkOpenAICompatProxyBaseURL,
  getCoworkOpenAICompatProxyStatus,
} from './coworkOpenAICompatProxy';
import { normalizeProviderApiFormat, type AnthropicApiFormat } from './coworkFormatTransform';

/**
 * 提供者模型类型定义
 * 用于描述单个模型的标识信息
 */
type ProviderModel = {
  id: string; // 模型唯一标识符
};

/**
 * 提供者配置类型定义
 * 用于描述 API 提供者的完整配置信息
 */
type ProviderConfig = {
  enabled: boolean; // 是否启用该提供者
  apiKey: string; // API 密钥
  baseUrl: string; // API 基础 URL
  apiFormat?: 'anthropic' | 'openai' | 'native'; // API 格式类型
  models?: ProviderModel[]; // 该提供者支持的模型列表
};

/**
 * 应用配置类型定义
 * 用于描述应用程序的整体配置结构
 */
type AppConfig = {
  model?: {
    defaultModel?: string; // 默认使用的模型
  };
  providers?: Record<string, ProviderConfig>; // 提供者配置映射表
};

/**
 * API 配置解析结果类型定义
 * 用于返回 API 配置解析的结果，包含配置或错误信息
 */
export type ApiConfigResolution = {
  config: CoworkApiConfig | null; // 解析后的 API 配置，失败时为 null
  error?: string; // 错误信息，成功时不存在
};

// 从 main.ts 注入的存储获取函数
let storeGetter: (() => SqliteStore | null) | null = null;

/**
 * 设置存储获取函数
 * @param getter - 用于获取 SqliteStore 实例的函数
 */
export function setStoreGetter(getter: () => SqliteStore | null): void {
  storeGetter = getter;
}

/**
 * 获取存储实例
 * @returns SqliteStore 实例或 null
 */
const getStore = (): SqliteStore | null => {
  if (!storeGetter) {
    return null;
  }
  return storeGetter();
};

/**
 * 获取 Claude Code CLI 路径
 * 根据应用是否打包返回对应的 CLI 文件路径
 * @returns Claude Code CLI 的完整文件路径
 */
export function getClaudeCodePath(): string {
  if (app.isPackaged) {
    return join(
      process.resourcesPath,
      'app.asar.unpacked/node_modules/@anthropic-ai/claude-agent-sdk/cli.js'
    );
  }

  // 在开发模式下，尝试在项目根目录的 node_modules 中查找 SDK
  // app.getAppPath() 可能指向 dist-electron 或其他构建输出目录
  // 我们需要在项目根目录中查找
  const appPath = app.getAppPath();
  // 如果 appPath 以 dist-electron 结尾，则向上一级
  const rootDir = appPath.endsWith('dist-electron') 
    ? join(appPath, '..') 
    : appPath;

  return join(rootDir, 'node_modules/@anthropic-ai/claude-agent-sdk/cli.js');
}

/**
 * 匹配到的提供者类型定义
 * 用于存储解析后的提供者信息
 */
type MatchedProvider = {
  providerName: string; // 提供者名称
  providerConfig: ProviderConfig; // 提供者配置
  modelId: string; // 模型标识符
  apiFormat: AnthropicApiFormat; // API 格式
};

/**
 * 获取有效的提供者 API 格式
 * 根据提供者名称和配置确定实际使用的 API 格式
 * @param providerName - 提供者名称
 * @param apiFormat - 配置中的 API 格式
 * @returns 标准化后的 API 格式
 */
function getEffectiveProviderApiFormat(providerName: string, apiFormat: unknown): AnthropicApiFormat {
  if (providerName === 'openai' || providerName === 'gemini') {
    return 'openai';
  }
  if (providerName === 'anthropic') {
    return 'anthropic';
  }
  return normalizeProviderApiFormat(apiFormat);
}

/**
 * 检查提供者是否需要 API 密钥
 * Ollama 提供者不需要 API 密钥
 * @param providerName - 提供者名称
 * @returns 是否需要 API 密钥
 */
function providerRequiresApiKey(providerName: string): boolean {
  return providerName !== 'ollama';
}

/**
 * 解析匹配的提供者
 * 根据应用配置查找并验证匹配的提供者和模型
 * @param appConfig - 应用配置对象
 * @returns 匹配结果，包含提供者信息或错误信息
 */
function resolveMatchedProvider(appConfig: AppConfig): { matched: MatchedProvider | null; error?: string } {
  const providers = appConfig.providers ?? {};

  // 解析备用模型：当没有指定默认模型时，从已启用的提供者中选择第一个可用模型
  const resolveFallbackModel = (): string | undefined => {
    for (const provider of Object.values(providers)) {
      if (!provider?.enabled || !provider.models || provider.models.length === 0) {
        continue;
      }
      return provider.models[0].id;
    }
    return undefined;
  };

  // 获取模型 ID：优先使用默认模型，否则使用备用模型
  const modelId = appConfig.model?.defaultModel || resolveFallbackModel();
  if (!modelId) {
    return { matched: null, error: '在已启用的提供者中没有配置可用模型。' };
  }

  // 查找包含指定模型的已启用提供者
  const providerEntry = Object.entries(providers).find(([, provider]) => {
    if (!provider?.enabled || !provider.models) {
      return false;
    }
    return provider.models.some((model) => model.id === modelId);
  });

  if (!providerEntry) {
    return { matched: null, error: `未找到模型 ${modelId} 的已启用提供者。` };
  }

  const [providerName, providerConfig] = providerEntry;
  const apiFormat = getEffectiveProviderApiFormat(providerName, providerConfig.apiFormat);
  const baseURL = providerConfig.baseUrl?.trim();

  if (!baseURL) {
    return { matched: null, error: `提供者 ${providerName} 缺少基础 URL。` };
  }

  if (apiFormat === 'anthropic' && providerRequiresApiKey(providerName) && !providerConfig.apiKey?.trim()) {
    return { matched: null, error: `提供者 ${providerName} 在 Anthropic 兼容模式下需要 API 密钥。` };
  }

  return {
    matched: {
      providerName,
      providerConfig,
      modelId,
      apiFormat,
    },
  };
}

/**
 * 解析当前 API 配置
 * 根据应用配置解析出完整的 API 配置信息
 * @param target - OpenAI 兼容代理目标，默认为 'local'
 * @returns API 配置解析结果
 */
export function resolveCurrentApiConfig(target: OpenAICompatProxyTarget = 'local'): ApiConfigResolution {
  const sqliteStore = getStore();
  if (!sqliteStore) {
    return {
      config: null,
      error: '存储未初始化。',
    };
  }

  const appConfig = sqliteStore.get<AppConfig>('app_config');
  if (!appConfig) {
    return {
      config: null,
      error: '未找到应用配置。',
    };
  }

  const { matched, error } = resolveMatchedProvider(appConfig);
  if (!matched) {
    return {
      config: null,
      error,
    };
  }

  // 解析基础 URL 和 API 密钥
  const resolvedBaseURL = matched.providerConfig.baseUrl.trim();
  const resolvedApiKey = matched.providerConfig.apiKey?.trim() || '';
  
  // 对于 Ollama 提供者在 Anthropic 模式下，如果没有 API 密钥则使用默认值
  const effectiveApiKey = matched.providerName === 'ollama'
    && matched.apiFormat === 'anthropic'
    && !resolvedApiKey
    ? 'sk-ollama-local'
    : resolvedApiKey;

  // 如果是 Anthropic 格式，直接返回配置
  if (matched.apiFormat === 'anthropic') {
    return {
      config: {
        apiKey: effectiveApiKey,
        baseURL: resolvedBaseURL,
        model: matched.modelId,
        apiType: 'anthropic',
      },
    };
  }

  // 检查 OpenAI 兼容代理状态
  const proxyStatus = getCoworkOpenAICompatProxyStatus();
  if (!proxyStatus.running) {
    return {
      config: null,
      error: 'OpenAI 兼容代理未运行。',
    };
  }

  // 配置 OpenAI 兼容代理
  configureCoworkOpenAICompatProxy({
    baseURL: resolvedBaseURL,
    apiKey: resolvedApiKey || undefined,
    model: matched.modelId,
    provider: matched.providerName,
  });

  // 获取代理基础 URL
  const proxyBaseURL = getCoworkOpenAICompatProxyBaseURL(target);
  if (!proxyBaseURL) {
    return {
      config: null,
      error: 'OpenAI 兼容代理基础 URL 不可用。',
    };
  }

  return {
    config: {
      apiKey: resolvedApiKey || 'lobsterai-openai-compat',
      baseURL: proxyBaseURL,
      model: matched.modelId,
      apiType: 'openai',
    },
  };
}

/**
 * 获取当前 API 配置
 * 返回解析后的 API 配置对象，不包含错误信息
 * @param target - OpenAI 兼容代理目标，默认为 'local'
 * @returns API 配置对象或 null
 */
export function getCurrentApiConfig(target: OpenAICompatProxyTarget = 'local'): CoworkApiConfig | null {
  return resolveCurrentApiConfig(target).config;
}

/**
 * 根据配置构建环境变量
 * 将 API 配置转换为 Claude Code 所需的环境变量格式
 * @param config - API 配置对象
 * @returns 包含环境变量的记录对象
 */
export function buildEnvForConfig(config: CoworkApiConfig): Record<string, string> {
  // 复制当前进程环境变量作为基础
  const baseEnv = { ...process.env } as Record<string, string>;

  // 设置 Anthropic 相关环境变量
  baseEnv.ANTHROPIC_AUTH_TOKEN = config.apiKey;
  baseEnv.ANTHROPIC_API_KEY = config.apiKey;
  baseEnv.ANTHROPIC_BASE_URL = config.baseURL;
  baseEnv.ANTHROPIC_MODEL = config.model;

  return baseEnv;
}
