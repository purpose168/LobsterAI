/**
 * 网页搜索技能 - 桥接服务器
 * 提供浏览器控制和搜索操作的 HTTP API
 */

import express, { NextFunction, Request, Response } from 'express';
import { Server } from 'http';
import { PlaywrightManager } from './playwright/manager';
import { launchBrowser, closeBrowser, isBrowserRunning, BrowserInstance } from './playwright/browser';
import { BingSearch } from './search/bing';
import { GoogleSearch } from './search/google';
import { navigate, screenshot, getContent, getTextContent } from './playwright/operations';
import { Config, mergeConfig } from './config';
import { SearchResponse } from './search/types';

type SearchEngine = 'google' | 'bing';
type SearchEnginePreference = SearchEngine | 'auto';

/**
 * 递归收集对象中的所有字符串值
 * @param input - 输入数据（可以是任意类型）
 * @param out - 输出字符串数组
 */
function collectStringValues(input: unknown, out: string[]): void {
  // 如果输入是字符串，直接添加到输出数组
  if (typeof input === 'string') {
    out.push(input);
    return;
  }

  // 如果输入是数组，递归处理每个元素
  if (Array.isArray(input)) {
    for (const item of input) {
      collectStringValues(item, out);
    }
    return;
  }

  // 如果输入是对象，递归处理每个属性值
  if (input && typeof input === 'object') {
    for (const value of Object.values(input as Record<string, unknown>)) {
      collectStringValues(value, out);
    }
  }
}

/**
 * 对解码后的 JSON 文本进行评分
 * 用于判断哪种编码方式更合适
 * @param text - 待评分的文本
 * @returns 评分值，越高表示编码越合适
 */
function scoreDecodedJsonText(text: string): number {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // JSON 解析失败，返回极低分数
    return -10000;
  }

  // 收集所有字符串值
  const values: string[] = [];
  collectStringValues(parsed, values);
  const joined = values.join('\n');
  if (!joined) return 0;

  // 计算各种字符统计
  const cjkCount = (joined.match(/[\u3400-\u9FFF]/g) || []).length; // 中日韩文字数量
  const replacementCount = (joined.match(/\uFFFD/g) || []).length; // 替换字符数量（表示解码错误）
  const mojibakeCount = (joined.match(/[ÃÂÐÑØÙÞæçèéêëìíîïðñòóôõöøùúûüýþÿ]/g) || []).length; // 乱码字符数量
  const nonAsciiCount = (joined.match(/[^\x00-\x7F]/g) || []).length; // 非ASCII字符数量

  // 计算综合评分：CJK字符加分，非ASCII字符加分，替换字符和乱码字符减分
  return cjkCount * 4 + nonAsciiCount - replacementCount * 8 - mojibakeCount * 3;
}

/**
 * 解码 JSON 请求体
 * 支持多种编码格式，自动检测并选择最佳解码方式
 * @param raw - 原始字节数据
 * @returns 解码后的字符串
 */
function decodeJsonRequestBody(raw: Buffer): string {
  // 空数据直接返回空字符串
  if (raw.length === 0) {
    return '';
  }

  // 检测并处理 BOM（字节顺序标记）
  // UTF-8 BOM
  if (raw.length >= 3 && raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf) {
    return new TextDecoder('utf-8', { fatal: false }).decode(raw.subarray(3));
  }
  // UTF-16 LE BOM（小端序）
  if (raw.length >= 2 && raw[0] === 0xff && raw[1] === 0xfe) {
    return new TextDecoder('utf-16le', { fatal: false }).decode(raw.subarray(2));
  }
  // UTF-16 BE BOM（大端序）
  if (raw.length >= 2 && raw[0] === 0xfe && raw[1] === 0xff) {
    return new TextDecoder('utf-16be', { fatal: false }).decode(raw.subarray(2));
  }

  // 尝试 UTF-8 解码
  let utf8Decoded: string | null = null;
  try {
    utf8Decoded = new TextDecoder('utf-8', { fatal: true }).decode(raw);
  } catch {
    utf8Decoded = null;
  }

  // 尝试 GB18030 解码（中文编码）
  let gbDecoded: string | null = null;
  try {
    gbDecoded = new TextDecoder('gb18030', { fatal: true }).decode(raw);
  } catch {
    gbDecoded = null;
  }

  // 如果两种编码都成功，选择评分更高的
  if (utf8Decoded && gbDecoded) {
    const utf8Score = scoreDecodedJsonText(utf8Decoded);
    const gbScore = scoreDecodedJsonText(gbDecoded);
    if (gbScore > utf8Score) {
      console.warn(`[桥接服务器] 请求体使用 gb18030 解码（评分 ${gbScore} > utf8 ${utf8Score}）`);
      return gbDecoded;
    }
    return utf8Decoded;
  }

  // 优先使用 UTF-8
  if (utf8Decoded) {
    return utf8Decoded;
  }

  // 回退到 GB18030
  if (gbDecoded) {
    console.warn('[桥接服务器] 请求体使用 gb18030 解码作为回退方案');
    return gbDecoded;
  }

  // 最终回退：使用容错模式的 UTF-8
  return new TextDecoder('utf-8', { fatal: false }).decode(raw);
}

/**
 * 桥接服务器类
 * 提供 HTTP API 接口，用于浏览器控制和搜索操作
 */
export class BridgeServer {
  private app: express.Application;
  private playwrightManager: PlaywrightManager;
  private bingSearch: BingSearch;
  private googleSearch: GoogleSearch;
  private browserInstance: BrowserInstance | null = null;
  private httpServer: Server | null = null;
  private config: Config;

  /**
   * 构造函数
   * @param config - 可选的服务器配置
   */
  constructor(config?: Partial<Config>) {
    this.config = mergeConfig(config);
    this.app = express();
    this.playwrightManager = new PlaywrightManager();
    this.bingSearch = new BingSearch(this.playwrightManager);
    this.googleSearch = new GoogleSearch(this.playwrightManager);

    this.setupMiddleware();
    this.setupRoutes();
  }

  /**
   * 设置中间件
   * 包括请求体解析、CORS 处理和请求日志
   */
  private setupMiddleware(): void {
    // 配置原始请求体解析器，支持 JSON 格式
    this.app.use(express.raw({
      type: ['application/json', 'application/*+json'],
      limit: '2mb',
    }));

    // 自定义请求体解析中间件
    this.app.use((req: Request, res: Response, next: NextFunction) => {
      const contentType = req.headers['content-type'];
      const isJsonRequest = Array.isArray(contentType)
        ? contentType.some((value) => value.includes('application/json') || value.includes('+json'))
        : typeof contentType === 'string'
          ? contentType.includes('application/json') || contentType.includes('+json')
          : false;

      // 非 JSON 请求，初始化空对象
      if (!isJsonRequest) {
        if (!req.body || typeof req.body !== 'object' || Buffer.isBuffer(req.body)) {
          req.body = {};
        }
        next();
        return;
      }

      // 解析 JSON 请求体
      const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      if (rawBody.length === 0) {
        req.body = {};
        next();
        return;
      }

      try {
        const decoded = decodeJsonRequestBody(rawBody);
        req.body = JSON.parse(decoded) as Record<string, unknown>;
        next();
      } catch (error) {
        res.status(400).json({
          success: false,
          error: `无效的 JSON 请求体: ${error instanceof Error ? error.message : String(error)}`
        });
      }
    });

    // CORS 配置（仅限本地主机）
    this.app.use((req, res, next) => {
      res.header('Access-Control-Allow-Origin', 'http://127.0.0.1:*');
      res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE');
      res.header('Access-Control-Allow-Headers', 'Content-Type');
      next();
    });

    // 请求日志中间件
    this.app.use((req, res, next) => {
      console.log(`[API] ${req.method} ${req.path}`);
      next();
    });
  }

  /**
   * 设置路由
   * 定义所有 API 端点
   */
  private setupRoutes(): void {
    // 健康检查
    this.app.get('/api/health', this.handleHealth.bind(this));

    // 浏览器管理
    this.app.post('/api/browser/launch', this.handleBrowserLaunch.bind(this));
    this.app.post('/api/browser/connect', this.handleBrowserConnect.bind(this));
    this.app.post('/api/browser/disconnect', this.handleBrowserDisconnect.bind(this));
    this.app.get('/api/browser/status', this.handleBrowserStatus.bind(this));

    // 搜索操作
    this.app.post('/api/search', this.handleSearch.bind(this));
    this.app.post('/api/search/content', this.handleGetContent.bind(this));

    // 页面操作
    this.app.post('/api/page/navigate', this.handleNavigate.bind(this));
    this.app.post('/api/page/screenshot', this.handleScreenshot.bind(this));
    this.app.post('/api/page/content', this.handlePageContent.bind(this));
    this.app.post('/api/page/text', this.handlePageText.bind(this));

    // 连接管理
    this.app.get('/api/connections', this.handleListConnections.bind(this));
  }

  /**
   * 检查浏览器进程是否存活
   * @param instance - 浏览器实例
   * @returns 进程是否存活
   */
  private isBrowserProcessAlive(instance: BrowserInstance | null): boolean {
    if (!instance) {
      return false;
    }

    if (!isBrowserRunning(instance)) {
      return false;
    }

    try {
      // 发送信号 0 检查进程是否存在
      process.kill(instance.pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 检查 CDP（Chrome DevTools Protocol）端口是否可达
   * @param port - CDP 端口号
   * @returns 端口是否可达
   */
  private async isCdpReachable(port: number): Promise<boolean> {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`, {
        signal: AbortSignal.timeout(1500)
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * 重置浏览器状态
   * 断开所有连接并关闭浏览器
   */
  private async resetBrowserState(): Promise<void> {
    await this.playwrightManager.disconnectAll();

    if (this.browserInstance) {
      try {
        await closeBrowser(this.browserInstance);
      } catch (error) {
        console.warn(`[桥接服务器] 关闭过期的浏览器实例失败: ${error instanceof Error ? error.message : String(error)}`);
      }
      this.browserInstance = null;
    }
  }

  /**
   * 确保浏览器准备就绪
   * 检查现有实例或启动新实例
   * @returns 浏览器实例和是否复用的标志
   */
  private async ensureBrowserReady(): Promise<{ instance: BrowserInstance; reused: boolean }> {
    if (this.browserInstance) {
      const processAlive = this.isBrowserProcessAlive(this.browserInstance);
      const cdpReachable = processAlive ? await this.isCdpReachable(this.browserInstance.cdpPort) : false;

      // 如果进程存活且 CDP 可达，复用现有实例
      if (processAlive && cdpReachable) {
        return { instance: this.browserInstance, reused: true };
      }

      console.warn('[桥接服务器] 检测到过期的浏览器实例，正在重新启动...');
      await this.resetBrowserState();
    }

    // 启动新的浏览器实例
    this.browserInstance = await launchBrowser(this.config.browser);
    return { instance: this.browserInstance, reused: false };
  }

  /**
   * 处理健康检查请求
   */
  private handleHealth(req: Request, res: Response): void {
    res.json({
      success: true,
      data: {
        status: 'healthy',
        uptime: process.uptime(),
        connections: this.playwrightManager.getConnectionCount()
      }
    });
  }

  /**
   * 处理浏览器启动请求
   */
  private async handleBrowserLaunch(req: Request, res: Response): Promise<void> {
    try {
      const { instance, reused } = await this.ensureBrowserReady();

      if (reused) {
        res.json({
          success: true,
          data: {
            message: '浏览器已在运行',
            pid: instance.pid,
            cdpPort: instance.cdpPort
          }
        });
        return;
      }

      res.json({
        success: true,
        data: {
          pid: instance.pid,
          cdpPort: instance.cdpPort,
          startTime: instance.startTime
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * 处理浏览器连接请求（通过 Playwright）
   */
  private async handleBrowserConnect(req: Request, res: Response): Promise<void> {
    try {
      const { cdpPort } = req.body;
      let port = cdpPort as number | undefined;

      // 如果客户端未指定端口，确保管理的浏览器健康
      if (!port) {
        const { instance } = await this.ensureBrowserReady();
        port = instance.cdpPort;
      }

      const connectionId = await this.playwrightManager.connectToCDP(port);

      res.json({
        success: true,
        data: {
          connectionId,
          cdpPort: port
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * 处理浏览器断开连接请求
   */
  private async handleBrowserDisconnect(req: Request, res: Response): Promise<void> {
    try {
      const { connectionId } = req.body;

      if (!connectionId) {
        res.status(400).json({
          success: false,
          error: 'connectionId 是必需的'
        });
        return;
      }

      await this.playwrightManager.disconnect(connectionId);

      res.json({
        success: true,
        data: { message: '已成功断开连接' }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * 处理获取浏览器状态请求
   */
  private async handleBrowserStatus(req: Request, res: Response): Promise<void> {
    const processAlive = this.isBrowserProcessAlive(this.browserInstance);
    const cdpReachable = processAlive && this.browserInstance
      ? await this.isCdpReachable(this.browserInstance.cdpPort)
      : false;

    res.json({
      success: true,
      data: {
        browserRunning: processAlive && cdpReachable,
        processAlive,
        cdpReachable,
        connections: this.playwrightManager.getConnectionCount(),
        pid: this.browserInstance?.pid,
        cdpPort: this.browserInstance?.cdpPort
      }
    });
  }

  /**
   * 处理搜索请求
   */
  private async handleSearch(req: Request, res: Response): Promise<void> {
    try {
      const { connectionId, query, maxResults, engine } = req.body;

      if (!connectionId || !query) {
        res.status(400).json({
          success: false,
          error: 'connectionId 和 query 是必需的'
        });
        return;
      }

      const preferredEngine = this.normalizeEnginePreference(engine);
      const results = await this.searchWithFallback(connectionId, query, maxResults, preferredEngine);

      res.json({
        success: true,
        data: results
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * 规范化搜索引擎偏好设置
   * @param engine - 引擎类型
   * @returns 规范化后的搜索引擎偏好
   */
  private normalizeEnginePreference(engine: unknown): SearchEnginePreference {
    if (engine === 'google' || engine === 'bing' || engine === 'auto') {
      return engine;
    }

    return this.config.search.defaultEngine;
  }

  /**
   * 解析搜索引擎顺序
   * 根据偏好设置确定搜索引擎的使用顺序
   * @param preferredEngine - 首选搜索引擎
   * @returns 搜索引擎使用顺序数组
   */
  private resolveSearchEngineOrder(preferredEngine: SearchEnginePreference): SearchEngine[] {
    // 如果指定了特定引擎，只使用该引擎
    if (preferredEngine === 'google' || preferredEngine === 'bing') {
      return [preferredEngine];
    }

    // 使用配置的回退顺序，并确保包含所有可用引擎
    const configuredOrder = this.config.search.fallbackOrder.filter(
      (item): item is SearchEngine => item === 'google' || item === 'bing'
    );
    const fullOrder: SearchEngine[] = [...configuredOrder, 'google', 'bing'];
    return Array.from(new Set<SearchEngine>(fullOrder));
  }

  /**
   * 使用回退机制执行搜索
   * 如果首选引擎失败，自动尝试其他引擎
   * @param connectionId - 连接ID
   * @param query - 搜索查询
   * @param maxResults - 最大结果数
   * @param preferredEngine - 首选搜索引擎
   * @returns 搜索结果
   */
  private async searchWithFallback(
    connectionId: string,
    query: string,
    maxResults: number | undefined,
    preferredEngine: SearchEnginePreference
  ): Promise<SearchResponse> {
    const engineOrder = this.resolveSearchEngineOrder(preferredEngine);
    const errors: string[] = [];

    // 按顺序尝试每个搜索引擎
    for (const engine of engineOrder) {
      try {
        console.log(`[搜索] 尝试使用引擎: ${engine}`);
        if (engine === 'google') {
          return await this.googleSearch.search(connectionId, query, { maxResults });
        }

        return await this.bingSearch.search(connectionId, query, { maxResults });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`${engine}: ${message}`);
        console.warn(`[搜索] 引擎失败 (${engine}): ${message}`);
      }
    }

    throw new Error(`所有配置的搜索引擎均失败。${errors.join(' | ')}`);
  }

  /**
   * 处理获取 URL 内容请求
   */
  private async handleGetContent(req: Request, res: Response): Promise<void> {
    try {
      const { connectionId, url } = req.body;

      if (!connectionId || !url) {
        res.status(400).json({
          success: false,
          error: 'connectionId 和 url 是必需的'
        });
        return;
      }

      const content = await this.bingSearch.getResultContent(connectionId, url);

      res.json({
        success: true,
        data: { content }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * 处理页面导航请求
   */
  private async handleNavigate(req: Request, res: Response): Promise<void> {
    try {
      const { connectionId, url, waitUntil, timeout } = req.body;

      if (!connectionId || !url) {
        res.status(400).json({
          success: false,
          error: 'connectionId 和 url 是必需的'
        });
        return;
      }

      const page = await this.playwrightManager.getPage(connectionId);
      await navigate(page, { url, waitUntil, timeout });

      res.json({
        success: true,
        data: { url: page.url() }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * 处理页面截图请求
   */
  private async handleScreenshot(req: Request, res: Response): Promise<void> {
    try {
      const { connectionId, format = 'png', fullPage = false } = req.body;

      if (!connectionId) {
        res.status(400).json({
          success: false,
          error: 'connectionId 是必需的'
        });
        return;
      }

      const page = await this.playwrightManager.getPage(connectionId);
      const buffer = await screenshot(page, { format, fullPage });

      res.json({
        success: true,
        data: {
          screenshot: buffer.toString('base64'),
          format,
          size: buffer.length
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * 处理获取页面 HTML 内容请求
   */
  private async handlePageContent(req: Request, res: Response): Promise<void> {
    try {
      const { connectionId } = req.body;

      if (!connectionId) {
        res.status(400).json({
          success: false,
          error: 'connectionId 是必需的'
        });
        return;
      }

      const page = await this.playwrightManager.getPage(connectionId);
      const content = await getContent(page);

      res.json({
        success: true,
        data: { content }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * 处理获取页面文本内容请求
   */
  private async handlePageText(req: Request, res: Response): Promise<void> {
    try {
      const { connectionId } = req.body;

      if (!connectionId) {
        res.status(400).json({
          success: false,
          error: 'connectionId 是必需的'
        });
        return;
      }

      const page = await this.playwrightManager.getPage(connectionId);
      const text = await getTextContent(page);

      res.json({
        success: true,
        data: { text }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * 处理列出所有连接请求
   */
  private handleListConnections(req: Request, res: Response): void {
    const connections = this.playwrightManager.listConnections();

    res.json({
      success: true,
      data: { connections }
    });
  }

  /**
   * 启动服务器
   */
  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const server = this.app.listen(this.config.server.port, this.config.server.host);
      this.httpServer = server;

      server.once('error', (error) => {
        this.httpServer = null;
        reject(error);
      });

      server.once('listening', () => {
        console.log(`\n[桥接服务器] 已启动于 http://${this.config.server.host}:${this.config.server.port}`);
        console.log(`[桥接服务器] 健康检查: http://${this.config.server.host}:${this.config.server.port}/api/health\n`);
        resolve();
      });
    });
  }

  /**
   * 停止服务器并清理资源
   */
  async stop(): Promise<void> {
    console.log('\n[桥接服务器] 正在关闭...');

    // 断开所有 Playwright 连接
    await this.playwrightManager.disconnectAll();

    // 关闭运行中的浏览器
    if (this.browserInstance) {
      await closeBrowser(this.browserInstance);
      this.browserInstance = null;
    }

    if (this.httpServer) {
      await new Promise<void>((resolve, reject) => {
        this.httpServer?.close((error?: Error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
      this.httpServer = null;
    }

    console.log('[桥接服务器] 关闭完成\n');
  }
}

// 主入口点
if (require.main === module) {
  const server = new BridgeServer();

  // 处理优雅关闭
  process.on('SIGINT', async () => {
    await server.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await server.stop();
    process.exit(0);
  });

  // 启动服务器
  server.start().catch((error) => {
    console.error('启动服务器失败:', error);
    process.exit(1);
  });
}

export default BridgeServer;
