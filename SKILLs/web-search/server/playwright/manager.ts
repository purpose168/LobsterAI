/**
 * Playwright 管理器 - 使用 Playwright 管理浏览器连接和页面会话
 */

import { chromium, Browser, Page, BrowserContext } from 'playwright-core';
import { v4 as uuidv4 } from 'uuid';

export interface Connection {
  id: string;              // 连接唯一标识符
  browser: Browser;        // 浏览器实例
  context: BrowserContext; // 浏览器上下文
  pages: Map<string, Page>; // 页面映射表
  connectedAt: number;     // 连接建立时间戳
}

export class PlaywrightManager {
  private connections: Map<string, Connection> = new Map();

  /**
   * 检查连接是否存活
   * @param conn - 连接对象
   * @returns 连接是否存活
   */
  private isConnectionAlive(conn: Connection): boolean {
    try {
      if (!conn.browser.isConnected()) {
        return false;
      }

      // 当上下文已关闭时，访问页面会抛出异常
      conn.context.pages();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 清理已断开的连接
   */
  private pruneDeadConnections(): void {
    for (const [connectionId, conn] of this.connections.entries()) {
      if (!this.isConnectionAlive(conn)) {
        console.warn(`[Playwright] 正在移除过期连接: ${connectionId}`);
        this.connections.delete(connectionId);
      }
    }
  }

  /**
   * 获取 CDP WebSocket 调试器 URL
   * @param port - 调试端口
   * @returns WebSocket 调试器 URL
   */
  private async getCDPWebSocketUrl(port: number): Promise<string> {
    const response = await fetch(`http://127.0.0.1:${port}/json/version`);
    const data = await response.json() as { webSocketDebuggerUrl: string };
    return data.webSocketDebuggerUrl;
  }

  /**
   * 通过 CDP 连接到 Chrome
   * @param port - CDP 端口号，默认为 9222
   * @returns 连接 ID
   */
  async connectToCDP(port: number = 9222): Promise<string> {
    try {
      console.log(`[Playwright] 正在连接到端口 ${port} 的 CDP`);

      const wsUrl = await this.getCDPWebSocketUrl(port);
      console.log(`[Playwright] CDP WebSocket URL: ${wsUrl}`);

      const browser = await chromium.connectOverCDP(wsUrl);
      console.log(`[Playwright] 已连接到浏览器`);

      // 获取或创建浏览器上下文
      const contexts = browser.contexts();
      let context: BrowserContext;

      if (contexts.length === 0) {
        console.log(`[Playwright] 没有现有上下文，正在创建新上下文`);
        context = await browser.newContext();
      } else {
        console.log(`[Playwright] 使用现有上下文`);
        context = contexts[0];
      }

      const connectionId = uuidv4();
      const connection: Connection = {
        id: connectionId,
        browser,
        context,
        pages: new Map(),
        connectedAt: Date.now()
      };

      this.connections.set(connectionId, connection);

      console.log(`[Playwright] 连接已建立: ${connectionId}`);
      return connectionId;
    } catch (error) {
      console.error(`[Playwright] 连接 CDP 失败:`, error);
      throw new Error(`连接 CDP 失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 获取或创建连接的页面
   * @param connectionId - 连接 ID
   * @returns Page 对象
   */
  async getPage(connectionId: string): Promise<Page> {
    this.pruneDeadConnections();

    const conn = this.connections.get(connectionId);
    if (!conn) {
      throw new Error(`未找到连接: ${connectionId}`);
    }

    if (!this.isConnectionAlive(conn)) {
      this.connections.delete(connectionId);
      throw new Error(`连接未激活: ${connectionId}`);
    }

    // 检查上下文中的现有页面
    const contextPages = conn.context.pages().filter(page => !page.isClosed());

    if (contextPages.length === 0) {
      console.log(`[Playwright] 没有现有页面，正在创建新页面`);
      try {
        const page = await conn.context.newPage();
        conn.pages.set(page.url(), page);
        return page;
      } catch (error) {
        this.connections.delete(connectionId);
        throw new Error(`连接已失效: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // 返回第一个页面（主页面）
    const page = contextPages[0];
    console.log(`[Playwright] 使用现有页面: ${page.url()}`);
    return page;
  }

  /**
   * 在连接中创建新页面
   * @param connectionId - 连接 ID
   * @returns 新创建的 Page 对象
   */
  async createPage(connectionId: string): Promise<Page> {
    this.pruneDeadConnections();

    const conn = this.connections.get(connectionId);
    if (!conn) {
      throw new Error(`未找到连接: ${connectionId}`);
    }

    if (!this.isConnectionAlive(conn)) {
      this.connections.delete(connectionId);
      throw new Error(`连接未激活: ${connectionId}`);
    }

    console.log(`[Playwright] 正在为连接 ${connectionId} 创建新页面`);
    try {
      const page = await conn.context.newPage();
      conn.pages.set(page.url(), page);
      return page;
    } catch (error) {
      this.connections.delete(connectionId);
      throw new Error(`连接已失效: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 关闭特定页面
   * @param connectionId - 连接 ID
   * @param page - 要关闭的页面对象
   */
  async closePage(connectionId: string, page: Page): Promise<void> {
    const conn = this.connections.get(connectionId);
    if (!conn) {
      throw new Error(`未找到连接: ${connectionId}`);
    }

    console.log(`[Playwright] 正在关闭页面: ${page.url()}`);
    await page.close();
    conn.pages.delete(page.url());
  }

  /**
   * 获取连接信息
   * @param connectionId - 连接 ID
   * @returns 连接对象或 undefined
   */
  getConnection(connectionId: string): Connection | undefined {
    this.pruneDeadConnections();
    return this.connections.get(connectionId);
  }

  /**
   * 列出所有活动连接
   * @returns 连接信息数组
   */
  listConnections(): Array<{ id: string; connectedAt: number; pageCount: number }> {
    this.pruneDeadConnections();

    return Array.from(this.connections.values()).map(conn => ({
      id: conn.id,
      connectedAt: conn.connectedAt,
      pageCount: conn.context.pages().filter(page => !page.isClosed()).length
    }));
  }

  /**
   * 断开浏览器连接
   * @param connectionId - 连接 ID
   */
  async disconnect(connectionId: string): Promise<void> {
    const conn = this.connections.get(connectionId);
    if (!conn) {
      console.warn(`[Playwright] 未找到连接: ${connectionId}`);
      return;
    }

    console.log(`[Playwright] 正在断开连接: ${connectionId}`);

    try {
      // 关闭所有页面
      const pages = conn.context.pages();
      for (const page of pages) {
        try {
          await page.close();
        } catch (error) {
          console.warn(`[Playwright] 关闭页面失败:`, error);
        }
      }

      // 关闭上下文（如果我们创建了它）
      try {
        await conn.context.close();
      } catch (error) {
        console.warn(`[Playwright] 关闭上下文失败:`, error);
      }

      // 关闭浏览器连接
      await conn.browser.close();
      console.log(`[Playwright] 浏览器连接已关闭: ${connectionId}`);
    } catch (error) {
      console.error(`[Playwright] 断开连接时出错:`, error);
    } finally {
      this.connections.delete(connectionId);
    }
  }

  /**
   * 断开所有连接
   */
  async disconnectAll(): Promise<void> {
    console.log(`[Playwright] 正在断开所有连接 (${this.connections.size})`);
    const connectionIds = Array.from(this.connections.keys());

    for (const connectionId of connectionIds) {
      await this.disconnect(connectionId);
    }
  }

  /**
   * 检查连接是否存在且有效
   * @param connectionId - 连接 ID
   * @returns 连接是否有效
   */
  isConnected(connectionId: string): boolean {
    this.pruneDeadConnections();

    const conn = this.connections.get(connectionId);
    if (!conn) {
      return false;
    }

    return this.isConnectionAlive(conn);
  }

  /**
   * 获取连接数量
   * @returns 当前连接数量
   */
  getConnectionCount(): number {
    this.pruneDeadConnections();
    return this.connections.size;
  }
}
