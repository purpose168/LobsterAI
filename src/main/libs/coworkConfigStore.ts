import { app } from 'electron';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs';
import { join } from 'path';

/**
 * 协作 API 类型定义
 * 支持 'anthropic' 或 'openai' 两种 API 类型
 */
export type CoworkApiType = 'anthropic' | 'openai';

/**
 * 协作 API 配置接口
 * 定义了 API 密钥、基础 URL、模型名称和 API 类型
 */
export type CoworkApiConfig = {
  apiKey: string;      // API 密钥
  baseURL: string;     // API 基础 URL
  model: string;       // 模型名称
  apiType?: CoworkApiType;  // API 类型（可选）
};

// 配置文件名称
const CONFIG_FILE_NAME = 'api-config.json';

/**
 * 获取配置文件的完整路径
 * @returns 配置文件的绝对路径
 */
function getConfigPath(): string {
  const userDataPath = app.getPath('userData');
  return join(userDataPath, CONFIG_FILE_NAME);
}

/**
 * 加载协作 API 配置
 * 从配置文件中读取并验证 API 配置信息
 * @returns 成功返回 CoworkApiConfig 对象，失败返回 null
 */
export function loadCoworkApiConfig(): CoworkApiConfig | null {
  try {
    const configPath = getConfigPath();
    // 检查配置文件是否存在
    if (!existsSync(configPath)) {
      return null;
    }

    // 读取并解析配置文件
    const raw = readFileSync(configPath, 'utf8');
    const config = JSON.parse(raw) as CoworkApiConfig;
    
    // 验证必需的配置项
    if (config.apiKey && config.baseURL && config.model) {
      // 规范化 API 类型，默认为 'anthropic'
      const normalizedApiType =
        config.apiType === 'openai' || config.apiType === 'anthropic'
          ? config.apiType
          : 'anthropic';
      config.apiType = normalizedApiType;
      return config;
    }

    return null;
  } catch (error) {
    console.error('[协作配置] 加载 API 配置失败:', error);
    return null;
  }
}

/**
 * 保存协作 API 配置
 * 将配置信息写入配置文件
 * @param config - 要保存的 API 配置对象
 * @throws 当配置缺少必需字段时抛出错误
 */
export function saveCoworkApiConfig(config: CoworkApiConfig): void {
  const configPath = getConfigPath();
  const userDataPath = app.getPath('userData');

  // 确保用户数据目录存在
  if (!existsSync(userDataPath)) {
    mkdirSync(userDataPath, { recursive: true });
  }

  // 验证必需的配置项
  if (!config.apiKey || !config.baseURL || !config.model) {
    throw new Error('无效的配置：apiKey、baseURL 和 model 为必填项');
  }

  // 规范化配置数据
  const normalized: CoworkApiConfig = {
    apiKey: config.apiKey.trim(),
    baseURL: config.baseURL.trim(),
    model: config.model.trim(),
    apiType: config.apiType === 'openai' ? 'openai' : 'anthropic',
  };

  // 写入配置文件
  writeFileSync(configPath, JSON.stringify(normalized, null, 2), 'utf8');
  console.info('[协作配置] API 配置保存成功');
}

/**
 * 删除协作 API 配置
 * 删除配置文件，清除已保存的 API 配置
 */
export function deleteCoworkApiConfig(): void {
  try {
    const configPath = getConfigPath();
    if (existsSync(configPath)) {
      unlinkSync(configPath);
      console.info('[协作配置] API 配置已删除');
    }
  } catch (error) {
    console.error('[协作配置] 删除 API 配置失败:', error);
  }
}
