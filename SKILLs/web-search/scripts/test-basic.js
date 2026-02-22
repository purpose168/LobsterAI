#!/usr/bin/env node
/**
 * Playwright 管理器和浏览器启动器的基础测试脚本
 */

const { launchBrowser, closeBrowser } = require('../dist/server/playwright/browser');
const { PlaywrightManager } = require('../dist/server/playwright/manager');
const { defaultConfig } = require('../dist/server/config');

async function testBasicFunctionality() {
  console.log('\n=== 网页搜索技能 - 基础功能测试 ===\n');

  let browserInstance = null;
  let connectionId = null;
  const manager = new PlaywrightManager();

  try {
    // 步骤 1: 启动浏览器
    console.log('步骤 1: 正在启动浏览器...');
    browserInstance = await launchBrowser(defaultConfig.browser);
    console.log('✓ 浏览器启动成功\n');

    // 步骤 2: 通过 Playwright 连接
    console.log('步骤 2: 正在通过 Playwright 连接...');
    connectionId = await manager.connectToCDP(browserInstance.cdpPort);
    console.log(`✓ 连接成功 (ID: ${connectionId})\n`);

    // 步骤 3: 获取页面
    console.log('步骤 3: 正在获取页面...');
    const page = await manager.getPage(connectionId);
    console.log(`✓ 页面获取成功: ${page.url()}\n`);

    // 步骤 4: 导航到测试 URL
    console.log('步骤 4: 正在导航到 example.com...');
    await page.goto('https://example.com', { waitUntil: 'domcontentloaded', timeout: 15000 });
    console.log(`✓ 导航完成: ${page.url()}\n`);

    // 步骤 5: 获取页面标题
    console.log('步骤 5: 正在获取页面标题...');
    const title = await page.title();
    console.log(`✓ 页面标题: "${title}"\n`);

    // 步骤 6: 截取屏幕截图
    console.log('步骤 6: 正在截取屏幕截图...');
    const screenshot = await page.screenshot({ type: 'png' });
    console.log(`✓ 屏幕截图已捕获 (${screenshot.length} 字节)\n`);

    // 步骤 7: 获取文本内容
    console.log('步骤 7: 正在获取文本内容...');
    const text = await page.textContent('body');
    console.log(`✓ 文本内容: ${text?.substring(0, 100)}...\n`);

    console.log('=== 所有测试通过! ===\n');
  } catch (error) {
    console.error('\n❌ 测试失败:', error);
    process.exit(1);
  } finally {
    // 清理工作
    console.log('正在清理...');
    if (connectionId) {
      await manager.disconnect(connectionId);
    }
    if (browserInstance) {
      await closeBrowser(browserInstance);
    }
    console.log('✓ 清理完成\n');
  }
}

// 运行测试
testBasicFunctionality().catch(error => {
  console.error('致命错误:', error);
  process.exit(1);
});
