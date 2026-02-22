#!/usr/bin/env node
/**
 * 桥接服务器和必应搜索的集成测试
 */

const BridgeServer = require('../dist/server/index').default;

async function testSearchIntegration() {
  console.log('\n=== 网页搜索技能 - 集成测试 ===\n');

  const server = new BridgeServer();
  let connectionId = null;

  try {
    // 启动桥接服务器
    console.log('步骤 1: 正在启动桥接服务器...');
    await server.start();
    console.log('✓ 桥接服务器已启动\n');

    // 等待服务器准备就绪
    await new Promise(resolve => setTimeout(resolve, 1000));

    // 通过 API 启动浏览器
    console.log('步骤 2: 正在通过 API 启动浏览器...');
    const launchResponse = await fetch('http://127.0.0.1:8923/api/browser/launch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    const launchData = await launchResponse.json();
    console.log(`✓ 浏览器已启动: 进程ID ${launchData.data.pid}\n`);

    // 连接到浏览器
    console.log('步骤 3: 正在连接到浏览器...');
    const connectResponse = await fetch('http://127.0.0.1:8923/api/browser/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    const connectData = await connectResponse.json();
    connectionId = connectData.data.connectionId;
    console.log(`✓ 已连接: ${connectionId}\n`);

    // 执行搜索
    console.log('步骤 4: 正在必应搜索 "TypeScript tutorial"...');
    const searchResponse = await fetch('http://127.0.0.1:8923/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        connectionId,
        query: 'TypeScript tutorial',
        maxResults: 5
      })
    });
    const searchData = await searchResponse.json();
    console.log(`✓ 搜索完成，耗时 ${searchData.data.duration}毫秒\n`);

    // 显示结果
    console.log('搜索结果:');
    console.log('─'.repeat(80));
    searchData.data.results.forEach((result, index) => {
      console.log(`\n${index + 1}. ${result.title}`);
      console.log(`   网址: ${result.url}`);
      console.log(`   摘要: ${result.snippet.substring(0, 150)}...`);
    });
    console.log('\n' + '─'.repeat(80));

    // 截取屏幕截图
    console.log('\n步骤 5: 正在截取屏幕截图...');
    const screenshotResponse = await fetch('http://127.0.0.1:8923/api/page/screenshot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        connectionId,
        format: 'png'
      })
    });
    const screenshotData = await screenshotResponse.json();
    console.log(`✓ 屏幕截图已捕获: ${screenshotData.data.size} 字节\n`);

    // 获取页面文本
    console.log('步骤 6: 正在获取页面文本...');
    const textResponse = await fetch('http://127.0.0.1:8923/api/page/text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ connectionId })
    });
    const textData = await textResponse.json();
    console.log(`✓ 页面文本已获取: ${textData.data.text.length} 个字符\n`);

    // 检查状态
    console.log('步骤 7: 正在检查服务器状态...');
    const statusResponse = await fetch('http://127.0.0.1:8923/api/browser/status');
    const statusData = await statusResponse.json();
    console.log(`✓ 状态: ${JSON.stringify(statusData.data, null, 2)}\n`);

    console.log('=== 所有集成测试通过！ ===\n');
  } catch (error) {
    console.error('\n❌ 测试失败:', error);
    process.exit(1);
  } finally {
    // 清理资源
    console.log('正在清理资源...');
    if (connectionId) {
      try {
        await fetch('http://127.0.0.1:8923/api/browser/disconnect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ connectionId })
        });
      } catch (error) {
        console.warn('断开连接失败:', error.message);
      }
    }
    await server.stop();
    console.log('✓ 清理完成\n');
    process.exit(0);
  }
}

// 运行测试
testSearchIntegration().catch(error => {
  console.error('致命错误:', error);
  process.exit(1);
});
