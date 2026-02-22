/**
 * 浏览器操作 - 使用 Playwright Page API 的常见浏览器操作
 */

import { Page } from 'playwright-core';

/**
 * 导航选项接口
 */
export interface NavigateOptions {
  url: string;  // 目标 URL
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle';  // 等待条件：页面加载完成、DOM 内容加载完成或网络空闲
  timeout?: number;  // 超时时间（毫秒）
}

/**
 * 截图选项接口
 */
export interface ScreenshotOptions {
  format?: 'png' | 'jpeg';  // 图片格式
  fullPage?: boolean;  // 是否截取整个页面
  quality?: number;  // 图片质量（仅适用于 JPEG 格式）
}

/**
 * JavaScript 执行选项接口
 */
export interface EvaluateOptions {
  expression: string;  // JavaScript 表达式
  args?: any[];  // 表达式参数
}

/**
 * 导航到指定 URL
 * @param page Playwright 页面对象
 * @param options 导航选项
 */
export async function navigate(page: Page, options: NavigateOptions): Promise<void> {
  console.log(`[操作] 正在导航到: ${options.url}`);

  await page.goto(options.url, {
    waitUntil: options.waitUntil || 'domcontentloaded',
    timeout: options.timeout || 30000
  });

  console.log(`[操作] 导航完成: ${page.url()}`);
}

/**
 * 截取页面截图
 * @param page Playwright 页面对象
 * @param options 截图选项
 * @returns 截图的 Buffer 数据
 */
export async function screenshot(page: Page, options: ScreenshotOptions = {}): Promise<Buffer> {
  console.log(`[操作] 正在截取屏幕截图 (格式: ${options.format || 'png'})`);

  const buffer = await page.screenshot({
    type: options.format || 'png',
    fullPage: options.fullPage || false,
    quality: options.quality
  });

  console.log(`[操作] 截图已捕获 (${buffer.length} 字节)`);
  return buffer;
}

/**
 * 获取页面内容（HTML）
 * @param page Playwright 页面对象
 * @returns 页面的 HTML 内容
 */
export async function getContent(page: Page): Promise<string> {
  console.log(`[操作] 正在获取页面内容`);
  const content = await page.content();
  console.log(`[操作] 内容已获取 (${content.length} 字符)`);
  return content;
}

/**
 * 获取页面文本内容
 * @param page Playwright 页面对象
 * @returns 页面的文本内容
 */
export async function getTextContent(page: Page): Promise<string> {
  console.log(`[操作] 正在获取文本内容`);

  const text = await page.textContent('body') || '';

  console.log(`[操作] 文本内容已获取 (${text.length} 字符)`);
  return text;
}

/**
 * 执行 JavaScript 表达式
 * @param page Playwright 页面对象
 * @param options 执行选项
 * @returns 表达式执行结果
 */
export async function evaluate(page: Page, options: EvaluateOptions): Promise<any> {
  console.log(`[操作] 正在执行表达式`);

  const result = await page.evaluate((args: any) => {
    // eslint-disable-next-line no-eval
    return eval(args.expression);
  }, { expression: options.expression, args: options.args || [] });

  console.log(`[操作] 表达式执行完成`);
  return result;
}

/**
 * 等待选择器出现
 * @param page Playwright 页面对象
 * @param selector CSS 选择器
 * @param timeout 超时时间（毫秒）
 */
export async function waitForSelector(
  page: Page,
  selector: string,
  timeout: number = 10000
): Promise<void> {
  console.log(`[操作] 正在等待选择器: ${selector}`);

  await page.waitForSelector(selector, { timeout });

  console.log(`[操作] 选择器已找到: ${selector}`);
}

/**
 * 点击元素
 * @param page Playwright 页面对象
 * @param selector CSS 选择器
 */
export async function click(page: Page, selector: string): Promise<void> {
  console.log(`[操作] 正在点击元素: ${selector}`);

  await page.click(selector);

  console.log(`[操作] 点击完成: ${selector}`);
}

/**
 * 在输入框中输入文本
 * @param page Playwright 页面对象
 * @param selector CSS 选择器
 * @param text 要输入的文本
 */
export async function type(page: Page, selector: string, text: string): Promise<void> {
  console.log(`[操作] 正在输入文本到: ${selector}`);

  await page.fill(selector, text);

  console.log(`[操作] 输入完成: ${selector}`);
}

/**
 * 获取当前 URL
 * @param page Playwright 页面对象
 * @returns 当前页面的 URL
 */
export function getCurrentUrl(page: Page): string {
  return page.url();
}

/**
 * 获取页面标题
 * @param page Playwright 页面对象
 * @returns 页面标题
 */
export async function getTitle(page: Page): Promise<string> {
  return await page.title();
}

/**
 * 后退到历史记录中的上一页
 * @param page Playwright 页面对象
 */
export async function goBack(page: Page): Promise<void> {
  console.log(`[操作] 正在后退`);
  await page.goBack();
}

/**
 * 前进到历史记录中的下一页
 * @param page Playwright 页面对象
 */
export async function goForward(page: Page): Promise<void> {
  console.log(`[操作] 正在前进`);
  await page.goForward();
}

/**
 * 重新加载页面
 * @param page Playwright 页面对象
 */
export async function reload(page: Page): Promise<void> {
  console.log(`[操作] 正在重新加载页面`);
  await page.reload();
}

/**
 * 等待页面导航完成
 * @param page Playwright 页面对象
 * @param timeout 超时时间（毫秒）
 */
export async function waitForNavigation(
  page: Page,
  timeout: number = 30000
): Promise<void> {
  console.log(`[操作] 正在等待页面导航`);
  await page.waitForNavigation({ timeout });
}

/**
 * 设置视口大小
 * @param page Playwright 页面对象
 * @param width 视口宽度
 * @param height 视口高度
 */
export async function setViewport(page: Page, width: number, height: number): Promise<void> {
  console.log(`[操作] 正在设置视口大小: ${width}x${height}`);
  await page.setViewportSize({ width, height });
}
