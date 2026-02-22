/**
 * Bing 搜索引擎 - 使用 Playwright 进行搜索并提取结果
 */

import { Page } from 'playwright-core';
import { PlaywrightManager } from '../playwright/manager';
import { SearchResult, SearchResponse } from './types';

export interface BingSearchOptions {
  /** 返回结果的最大数量 */
  maxResults?: number;
  /** 导航超时时间（毫秒） */
  navigationTimeout?: number;
  /** 等待结果的超时时间（毫秒） */
  waitTimeout?: number;
}

export class BingSearch {
  constructor(private playwrightManager: PlaywrightManager) {}

  /**
   * 执行 Bing 搜索并提取结果
   */
  async search(
    connectionId: string,
    query: string,
    options: BingSearchOptions = {}
  ): Promise<SearchResponse> {
    const startTime = Date.now();
    const maxResults = options.maxResults || 10;
    const navigationTimeout = options.navigationTimeout || 15000;
    const waitTimeout = options.waitTimeout || 10000;

    console.log(`[Bing] 正在搜索: "${query}" (最多 ${maxResults} 条结果)`);

    const page = await this.playwrightManager.getPage(connectionId);

    try {
      // 导航到 Bing 搜索页面
      const searchUrl = `https://www.bing.com/search?q=${encodeURIComponent(query)}`;
      console.log(`[Bing] 正在导航至: ${searchUrl}`);

      await page.goto(searchUrl, {
        waitUntil: 'domcontentloaded',
        timeout: navigationTimeout
      });

      console.log(`[Bing] 页面已加载: ${page.url()}`);

      // 等待搜索结果出现
      try {
        await page.waitForSelector('li.b_algo, ol#b_results li', { timeout: waitTimeout });
        console.log(`[Bing] 搜索结果已找到`);
      } catch (error) {
        console.warn(`[Bing] 未找到搜索结果或超时`);
        return {
          query,
          engine: 'bing',
          results: [],
          totalResults: 0,
          timestamp: Date.now(),
          duration: Date.now() - startTime
        };
      }

      // 使用 page.evaluate 提取搜索结果
      // 注意：evaluate 内的代码在浏览器上下文中运行
      const results = await page.evaluate((max) => {
        const items = document.querySelectorAll('li.b_algo');
        const extractedResults: Array<{
          title: string;
          url: string;
          snippet: string;
          source: string;
          position: number;
        }> = [];

        for (let i = 0; i < Math.min(items.length, max); i++) {
          const item = items[i];
          const titleEl = item.querySelector('h2 a');
          const snippetEl = item.querySelector('.b_caption p, .b_caption');

          if (titleEl) {
            const title = titleEl.textContent?.trim() || '';
            const url = (titleEl as HTMLAnchorElement).href || '';
            const snippet = snippetEl?.textContent?.trim() || '';

            if (title && url) {
              extractedResults.push({
                title,
                url,
                snippet,
                source: 'bing',
                position: i + 1
              });
            }
          }
        }

        return extractedResults;
      }, maxResults) as SearchResult[];

      const duration = Date.now() - startTime;
      console.log(`[Bing] 已提取 ${results.length} 条结果，耗时 ${duration}ms`);

      return {
        query,
        engine: 'bing',
        results,
        totalResults: results.length,
        timestamp: Date.now(),
        duration
      };
    } catch (error) {
      console.error(`[Bing] 搜索失败:`, error);
      throw new Error(`Bing 搜索失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 从搜索结果 URL 获取详细内容
   */
  async getResultContent(connectionId: string, url: string): Promise<string> {
    console.log(`[Bing] 正在获取内容: ${url}`);

    const page = await this.playwrightManager.getPage(connectionId);

    try {
      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: 15000
      });

      const content = await page.textContent('body') || '';
      console.log(`[Bing] 内容已获取 (${content.length} 个字符)`);

      return content;
    } catch (error) {
      console.error(`[Bing] 获取内容失败:`, error);
      throw new Error(`获取内容失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
