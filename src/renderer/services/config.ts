import { AppConfig, CONFIG_KEYS, defaultConfig } from '../config';
import { localStore } from './store';

/**
 * 获取固定的提供商API格式
 * 根据提供商键值返回固定的API格式类型
 * @param providerKey - 提供商键值（如 'openai', 'gemini', 'anthropic'）
 * @returns API格式类型，或null表示无固定格式
 */
const getFixedProviderApiFormat = (providerKey: string): 'anthropic' | 'openai' | null => {
  // OpenAI 和 Gemini 使用 OpenAI 格式
  if (providerKey === 'openai' || providerKey === 'gemini') {
    return 'openai';
  }
  // Anthropic 使用自己的格式
  if (providerKey === 'anthropic') {
    return 'anthropic';
  }
  // 其他提供商无固定格式
  return null;
};

/**
 * 规范化提供商的基础URL
 * 对提供商的基础URL进行标准化处理，特别是针对Gemini的特殊路径处理
 * @param providerKey - 提供商键值
 * @param baseUrl - 原始基础URL
 * @returns 规范化后的基础URL
 */
const normalizeProviderBaseUrl = (providerKey: string, baseUrl: unknown): string => {
  // 如果不是字符串类型，返回空字符串
  if (typeof baseUrl !== 'string') {
    return '';
  }

  // 去除首尾空格并移除末尾的斜杠
  const normalized = baseUrl.trim().replace(/\/+$/, '');
  // 非Gemini提供商直接返回规范化后的URL
  if (providerKey !== 'gemini') {
    return normalized;
  }

  // Gemini提供商的特殊处理
  // 如果URL为空或不包含Google Generative AI域名，直接返回
  if (!normalized || !normalized.includes('generativelanguage.googleapis.com')) {
    return normalized;
  }

  // 检查是否已经包含正确的路径后缀
  if (normalized.endsWith('/v1beta/openai') || normalized.endsWith('/v1/openai')) {
    return normalized;
  }
  // 如果以/v1beta结尾，添加/openai后缀
  if (normalized.endsWith('/v1beta')) {
    return `${normalized}/openai`;
  }
  // 如果以/v1结尾，转换为/v1beta/openai格式
  if (normalized.endsWith('/v1')) {
    return `${normalized.slice(0, -3)}v1beta/openai`;
  }

  // 默认返回Google Generative AI的标准OpenAI兼容端点
  return 'https://generativelanguage.googleapis.com/v1beta/openai';
};

/**
 * 规范化提供商的API格式
 * 确定提供商应使用的API格式（anthropic或openai）
 * @param providerKey - 提供商键值
 * @param apiFormat - 原始API格式配置
 * @returns 规范化后的API格式
 */
const normalizeProviderApiFormat = (providerKey: string, apiFormat: unknown): 'anthropic' | 'openai' => {
  // 首先检查是否有固定格式
  const fixed = getFixedProviderApiFormat(providerKey);
  if (fixed) {
    return fixed;
  }
  // 如果指定为openai格式，则使用openai
  if (apiFormat === 'openai') {
    return 'openai';
  }
  // 默认使用anthropic格式
  return 'anthropic';
};

/**
 * 规范化所有提供商的配置
 * 遍历所有提供商配置，对每个提供商的baseUrl和apiFormat进行规范化处理
 * @param providers - 提供商配置对象
 * @returns 规范化后的提供商配置
 */
const normalizeProvidersConfig = (providers: AppConfig['providers']): AppConfig['providers'] => {
  // 如果提供商配置不存在，直接返回
  if (!providers) {
    return providers;
  }

  // 遍历所有提供商配置并规范化
  return Object.fromEntries(
    Object.entries(providers).map(([providerKey, providerConfig]) => [
      providerKey,
      {
        ...providerConfig,
        baseUrl: normalizeProviderBaseUrl(providerKey, providerConfig.baseUrl),
        apiFormat: normalizeProviderApiFormat(providerKey, providerConfig.apiFormat),
      },
    ])
  ) as AppConfig['providers'];
};

/**
 * 配置服务类
 * 负责管理应用程序的配置信息，包括加载、存储和更新配置
 */
class ConfigService {
  // 应用配置对象，初始化为默认配置
  private config: AppConfig = defaultConfig;

  /**
   * 初始化配置服务
   * 从本地存储加载配置并与默认配置合并
   */
  async init() {
    try {
      // 从本地存储获取已保存的配置
      const storedConfig = await localStore.getItem<AppConfig>(CONFIG_KEYS.APP_CONFIG);
      if (storedConfig) {
        // 合并提供商配置：将默认配置与存储的配置合并
        const mergedProviders = storedConfig.providers
          ? Object.fromEntries(
              Object.entries({
                ...(defaultConfig.providers ?? {}),
                ...storedConfig.providers,
              }).map(([providerKey, providerConfig]) => [
                providerKey,
                (() => {
                  // 合并单个提供商的配置
                  const mergedProvider = {
                    ...(defaultConfig.providers as Record<string, any>)?.[providerKey],
                    ...providerConfig,
                  };
                  return {
                    ...mergedProvider,
                    baseUrl: normalizeProviderBaseUrl(providerKey, mergedProvider.baseUrl),
                    apiFormat: normalizeProviderApiFormat(providerKey, mergedProvider.apiFormat),
                  };
                })(),
              ])
            )
          : defaultConfig.providers;

        // 构建最终的配置对象，合并所有配置项
        this.config = {
          ...defaultConfig,
          ...storedConfig,
          api: {
            ...defaultConfig.api,
            ...storedConfig.api,
          },
          model: {
            ...defaultConfig.model,
            ...storedConfig.model,
          },
          app: {
            ...defaultConfig.app,
            ...storedConfig.app,
          },
          shortcuts: {
            ...defaultConfig.shortcuts!,
            ...(storedConfig.shortcuts ?? {}),
          } as AppConfig['shortcuts'],
          providers: mergedProviders as AppConfig['providers'],
        };
      }
    } catch (error) {
      // 配置加载失败时输出错误信息
      console.error('加载配置失败:', error);
    }
  }

  /**
   * 获取当前配置
   * @returns 应用配置对象
   */
  getConfig(): AppConfig {
    return this.config;
  }

  /**
   * 更新配置
   * 将新配置与现有配置合并，并保存到本地存储
   * @param newConfig - 部分新配置对象
   */
  async updateConfig(newConfig: Partial<AppConfig>) {
    // 规范化提供商配置
    const normalizedProviders = normalizeProvidersConfig(newConfig.providers as AppConfig['providers'] | undefined);
    // 合并配置
    this.config = {
      ...this.config,
      ...newConfig,
      ...(normalizedProviders ? { providers: normalizedProviders } : {}),
    };
    // 保存到本地存储
    await localStore.setItem(CONFIG_KEYS.APP_CONFIG, this.config);
  }

  /**
   * 获取API配置
   * 返回API密钥和基础URL
   * @returns API配置对象
   */
  getApiConfig() {
    return {
      apiKey: this.config.api.key,
      baseUrl: this.config.api.baseUrl,
    };
  }
}

/**
 * 配置服务实例
 * 导出单例模式的配置服务实例，供整个应用使用
 */
export const configService = new ConfigService(); 
