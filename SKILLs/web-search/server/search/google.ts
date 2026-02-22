/**
 * Google 搜索引擎 - 使用 Playwright 进行搜索并提取结果
 */

import { Page } from 'playwright-core';
import { PlaywrightManager } from '../playwright/manager';
import { SearchResponse, SearchResult } from './types';

export interface GoogleSearchOptions {
  /** 返回结果的最大数量 */
  maxResults?: number;
  /** 页面导航超时时间（毫秒） */
  navigationTimeout?: number;
  /** 等待结果的超时时间（毫秒） */
  waitTimeout?: number;
}

export class GoogleSearch {
  constructor(private playwrightManager: PlaywrightManager) {}

  /**
   * 执行 Google 搜索并提取结果
   */
  async search(
    connectionId: string,
    query: string,
    options: GoogleSearchOptions = {}
  ): Promise<SearchResponse> {
    const startTime = Date.now();
    const maxResults = options.maxResults || 10;
    const navigationTimeout = options.navigationTimeout || 15000;
    const waitTimeout = options.waitTimeout || 10000;

    console.log(`[Google] 正在搜索: "${query}" (最多 ${maxResults} 条结果)`);

    const page = await this.playwrightManager.getPage(connectionId);

    try {
      const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=en`;
      console.log(`[Google] 正在导航至: ${searchUrl}`);

      await page.goto(searchUrl, {
        waitUntil: 'domcontentloaded',
        timeout: navigationTimeout
      });

      console.log(`[Google] 页面已加载: ${page.url()}`);

      try {
        await page.waitForSelector('div#search a h3, div#search div.g', { timeout: waitTimeout });
        console.log('[Google] 搜索结果已找到');
      } catch (error) {
        const isBlocked = await this.isUnavailablePage(page);
        if (isBlocked) {
          throw new Error('Google 在当前网络环境下似乎被阻止或不可用');
        }
        throw new Error('Google 搜索结果未能及时加载');
      }

      const results = await page.evaluate((max) => {
        // 解析 Google 搜索结果中的 URL
        const parseGoogleUrl = (rawUrl: string): string => {
          if (!rawUrl) {
            return '';
          }

          try {
            const parsed = new URL(rawUrl, window.location.origin);
            const normalized = `${parsed.origin}${parsed.pathname}`;

            // 处理 Google 重定向链接
            if (normalized.endsWith('/url')) {
              const target = parsed.searchParams.get('q') || parsed.searchParams.get('url');
              return target || '';
            }

            return parsed.href;
          } catch {
            return '';
          }
        };

        // 判断 URL 是否为 Google 搜索页面链接
        const isSearchPageUrl = (url: string): boolean => {
          if (!url) {
            return true;
          }

          try {
            const parsed = new URL(url);
            if (!parsed.hostname.includes('google.')) {
              return false;
            }

            return parsed.pathname === '/search' || parsed.pathname === '/url';
          } catch {
            return true;
          }
        };

        const extractedResults: Array<{
          title: string;
          url: string;
          snippet: string;
          source: string;
          position: number;
        }> = [];
        const seenUrls = new Set<string>();
        const candidateItems = Array.from(document.querySelectorAll('div#search div.g'));

        // 从搜索结果元素中提取标题和链接
        const pickTitleAndLink = (element: Element): { title: string; url: string } => {
          const titleNode = element.querySelector('h3');
          const anchorNode = titleNode?.closest('a') || element.querySelector('a[href]');
          const title = titleNode?.textContent?.trim() || anchorNode?.textContent?.trim() || '';
          const rawUrl = (anchorNode as HTMLAnchorElement | null)?.href || '';
          const url = parseGoogleUrl(rawUrl);
          return { title, url };
        };

        // 遍历候选搜索结果项
        for (const item of candidateItems) {
          if (extractedResults.length >= max) {
            break;
          }

          const { title, url } = pickTitleAndLink(item);
          const snippetNode = item.querySelector('.VwiC3b, .yXK7lf, span.aCOpRe, div.IsZvec');
          const snippet = snippetNode?.textContent?.trim() || '';

          // 跳过无效或重复的结果
          if (!title || !url || isSearchPageUrl(url) || seenUrls.has(url)) {
            continue;
          }

          seenUrls.add(url);
          extractedResults.push({
            title,
            url,
            snippet,
            source: 'google',
            position: extractedResults.length + 1
          });
        }

        // 如果主选择器未找到结果，尝试备用选择器
        if (extractedResults.length === 0) {
          const titleNodes = Array.from(document.querySelectorAll('div#search a h3'));
          for (const titleNode of titleNodes) {
            if (extractedResults.length >= max) {
              break;
            }

            const anchorNode = titleNode.closest('a');
            const rawUrl = (anchorNode as HTMLAnchorElement | null)?.href || '';
            const url = parseGoogleUrl(rawUrl);
            const title = titleNode.textContent?.trim() || '';

            if (!title || !url || isSearchPageUrl(url) || seenUrls.has(url)) {
              continue;
            }

            seenUrls.add(url);
            extractedResults.push({
              title,
              url,
              snippet: '',
              source: 'google',
              position: extractedResults.length + 1
            });
          }
        }

        return extractedResults;
      }, maxResults) as SearchResult[];

      if (results.length === 0) {
        throw new Error('Google 未返回可解析的结果');
      }

      const duration = Date.now() - startTime;
      console.log(`[Google] 已提取 ${results.length} 条结果，耗时 ${duration}ms`);

      return {
        query,
        engine: 'google',
        results,
        totalResults: results.length,
        timestamp: Date.now(),
        duration
      };
    } catch (error) {
      console.error('[Google] 搜索失败:', error);
      throw new Error(`Google 搜索失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 从搜索结果 URL 获取详细内容
   */
  async getResultContent(connectionId: string, url: string): Promise<string> {
    console.log(`[Google] 正在获取内容: ${url}`);

    const page = await this.playwrightManager.getPage(connectionId);

    try {
      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: 15000
      });

      const content = await page.textContent('body') || '';
      console.log(`[Google] 内容已获取 (${content.length} 个字符)`);

      return content;
    } catch (error) {
      console.error('[Google] 获取内容失败:', error);
      throw new Error(`获取内容失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 检测页面是否为不可用状态（被阻止、验证码等）
   */
  private async isUnavailablePage(page: Page): Promise<boolean> {
    const url = page.url().toLowerCase();
    // 检查 URL 中是否包含阻止或验证页面标识
    if (url.includes('/sorry') || url.includes('consent.google.com')) {
      return true;
    }

    const bodyText = (await page.textContent('body'))?.toLowerCase() || '';
    // 检查页面内容中是否包含异常流量提示或不可达信息
    return (
      bodyText.includes('unusual traffic') ||
      bodyText.includes('before you continue to google') ||
      bodyText.includes('this site can\'t be reached')
    );
  }
}
