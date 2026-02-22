/**
 * 网页搜索技能配置
 */

export interface BrowserConfig {
  /** Chrome 可执行文件路径（如果未提供则自动检测） */
  chromePath?: string;
  /** CDP 调试端口 */
  cdpPort: number;
  /** 用于浏览器隔离的用户数据目录 */
  userDataDir?: string;
  /** 是否以无头模式运行浏览器 */
  headless: boolean;
  /** 额外的 Chrome 启动参数 */
  chromeFlags?: string[];
}

export interface ServerConfig {
  /** 桥接服务器端口 */
  port: number;
  /** 桥接服务器主机 */
  host: string;
}

export interface SearchConfig {
  /** 默认搜索引擎 */
  defaultEngine: 'auto' | 'bing' | 'google';
  /** 当 defaultEngine 为 auto 时的引擎回退顺序 */
  fallbackOrder: Array<'google' | 'bing'>;
  /** 每次搜索的默认最大结果数 */
  defaultMaxResults: number;
  /** 搜索超时时间（毫秒） */
  searchTimeout: number;
  /** 导航超时时间（毫秒） */
  navigationTimeout: number;
}

export interface Config {
  browser: BrowserConfig;
  server: ServerConfig;
  search: SearchConfig;
}

/**
 * 默认配置
 */
export const defaultConfig: Config = {
  browser: {
    cdpPort: 9222,
    headless: false, // 始终可见以保持透明性
    chromeFlags: [
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding'
    ]
  },
  server: {
    port: 8923,
    host: '127.0.0.1' // 仅限本地主机以确保安全
  },
  search: {
    defaultEngine: 'auto',
    fallbackOrder: ['google', 'bing'],
    defaultMaxResults: 10,
    searchTimeout: 30000, // 30 秒
    navigationTimeout: 15000 // 15 秒
  }
};

/**
 * 合并用户配置与默认配置
 */
export function mergeConfig(userConfig?: Partial<Config>): Config {
  if (!userConfig) {
    return defaultConfig;
  }

  return {
    browser: { ...defaultConfig.browser, ...userConfig.browser },
    server: { ...defaultConfig.server, ...userConfig.server },
    search: { ...defaultConfig.search, ...userConfig.search }
  };
}
