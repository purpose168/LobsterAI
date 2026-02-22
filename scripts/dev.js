/**
 * 开发环境启动脚本
 * 用于同时启动 Vite 开发服务器和 Electron 应用程序
 * 
 * 主要功能：
 * 1. 启动 Vite 开发服务器，提供前端热更新功能
 * 2. 编译 Electron 主进程的 TypeScript 代码
 * 3. 启动 Electron 应用程序并连接到 Vite 服务器
 * 
 * @author purpose168@outlook.com
 */

// 导入 Node.js 子进程模块，用于启动 Electron 进程
const { spawn } = require('child_process');
// 导入 Vite 开发服务器模块，用于创建前端开发服务器
const { createServer } = require('vite');
// 导入 Electron 模块，获取 Electron 可执行文件路径
const electron = require('electron');
// 导入 Node.js 路径模块，用于处理文件路径
const path = require('path');

/**
 * 启动应用程序的主函数
 * 按顺序执行以下步骤：
 * 1. 创建并启动 Vite 开发服务器
 * 2. 编译 Electron 主进程代码
 * 3. 启动 Electron 应用
 * 4. 设置进程退出处理逻辑
 * 
 * @async
 * @returns {Promise<void>}
 */
async function startApp() {
  // 步骤1: 启动 Vite 开发服务器
  // Vite 服务器提供前端资源的热更新功能，提高开发效率
  const server = await createServer();
  await server.listen();

  // 输出服务器启动成功信息
  console.log('Vite开发服务器已启动');

  // 步骤2: 编译 Electron 主进程代码
  // 使用 TypeScript 编译器将主进程的 TS 代码编译为 JS 代码
  // stdio: 'inherit' 使编译输出直接显示在当前控制台
  require('child_process').execSync('tsc --project electron-tsconfig.json', {
    stdio: 'inherit',
  });

  // 输出编译完成信息
  console.log('Electron主进程代码编译完成');

  // 步骤3: 启动 Electron 应用程序
  // spawn 创建子进程运行 Electron，'.' 表示当前目录
  const proc = spawn(electron, ['.'], {
    // 继承标准输入输出，使 Electron 的控制台输出显示在当前终端
    stdio: 'inherit',
    // 设置环境变量
    env: {
      // 复制当前进程的所有环境变量
      ...process.env,
      // 设置 Node 环境为开发模式
      NODE_ENV: 'development',
    },
  });

  // 监听 Electron 进程关闭事件
  // 当 Electron 应用退出时，同时关闭 Vite 服务器并退出当前进程
  proc.on('close', () => {
    server.close();
    process.exit();
  });

  // 步骤4: 处理进程终止信号
  // 当收到 SIGTERM 信号时（如手动终止脚本），优雅地关闭所有服务
  process.on('SIGTERM', () => {
    // 终止 Electron 子进程
    proc.kill();
    // 关闭 Vite 开发服务器
    server.close();
    // 退出当前进程
    process.exit();
  });
}

// 执行启动函数并处理错误
// 如果启动过程中发生错误，输出错误信息并以错误码退出
startApp().catch((err) => {
  console.error('启动应用程序时发生错误:', err);
  // 以错误状态码 1 退出进程
  process.exit(1);
}); 
