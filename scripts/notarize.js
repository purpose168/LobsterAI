/**
 * Electron 应用公证模块
 * 
 * 本模块负责对 macOS 应用进行 Apple 公证（Notarization）处理。
 * 公证是 Apple 要求的安全措施，确保应用经过验证后才能在 macOS 上运行。
 * 
 * 公证流程：
 * 1. 使用 Apple Developer 凭据向 Apple 服务器提交应用
 * 2. Apple 扫描应用以检测恶意软件和安全问题
 * 3. 公证通过后，应用可以正常分发给用户
 * 
 * 使用前需配置环境变量：
 * - APPLE_ID: Apple Developer 账户邮箱
 * - APPLE_APP_SPECIFIC_PASSWORD: Apple 专用密码（需在 appleid.apple.com 生成）
 * - APPLE_TEAM_ID: 开发团队 ID（可在 Apple Developer 账户页面找到）
 */

// 导入 Electron 公证模块，用于与 Apple 公证服务交互
const { notarize } = require('@electron/notarize');

// 导入 Node.js 路径处理模块，用于构建文件路径
const path = require('path');

// 加载 .env 环境变量配置文件
// 从项目根目录的 .env 文件中读取 Apple Developer 凭据
require('dotenv').config();

/**
 * Electron Builder 公证钩子函数
 * 
 * 此函数会在 Electron Builder 打包完成后自动调用，
 * 对生成的 macOS 应用进行公证处理。
 * 
 * @param {Object} context - Electron Builder 提供的上下文对象
 * @param {string} context.electronPlatformName - 当前打包平台名称（darwin、win32、linux 等）
 * @param {string} context.appOutDir - 应用输出目录路径
 * @param {Object} context.packager - 打包器对象，包含应用信息
 * @returns {Promise<void>} 异步函数，无返回值
 * @throws {Error} 公证失败时抛出错误
 */
exports.default = async function notarizing(context) {
  // 从上下文中解构获取平台名称和应用输出目录
  const { electronPlatformName, appOutDir } = context;

  // 仅对 macOS 平台（darwin）进行公证
  // 其他平台（Windows、Linux）不需要 Apple 公证
  if (electronPlatformName !== 'darwin') {
    return;
  }

  // 检查必需的 Apple Developer 凭据是否已配置
  // APPLE_ID: Apple Developer 账户邮箱地址
  // APPLE_APP_SPECIFIC_PASSWORD: 用于公证的专用密码（非 Apple ID 登录密码）
  if (!process.env.APPLE_ID || !process.env.APPLE_APP_SPECIFIC_PASSWORD) {
    console.warn('⚠️  跳过公证: 未设置 APPLE_ID 或 APPLE_APP_SPECIFIC_PASSWORD');
    console.warn('   如需启用公证，请创建 .env 文件并配置 Apple Developer 凭据');
    console.warn('   参考 .env.example 模板');
    return;
  }

  // 检查 Apple Team ID 是否已配置
  // APPLE_TEAM_ID: 标识开发团队的唯一 ID，用于多团队账户
  if (!process.env.APPLE_TEAM_ID) {
    console.warn('⚠️  跳过公证: 未设置 APPLE_TEAM_ID');
    console.warn('   公证需要 APPLE_TEAM_ID');
    return;
  }

  // 获取应用名称（不含扩展名）
  // productFilename 返回应用的产品文件名，如 "LobsterAI"
  const appName = context.packager.appInfo.productFilename;
  
  // 构建应用的完整路径
  // macOS 应用以 .app 为扩展名，位于 appOutDir 目录中
  const appPath = path.join(appOutDir, `${appName}.app`);

  // 输出公证开始信息，便于调试和追踪
  console.log(`🔐 正在公证 ${appName}...`);
  console.log(`   应用路径: ${appPath}`);
  console.log(`   Apple ID: ${process.env.APPLE_ID}`);
  console.log(`   Team ID: ${process.env.APPLE_TEAM_ID}`);

  try {
    // 调用 Electron 公证 API 提交应用进行公证
    // 此操作会将应用上传到 Apple 服务器进行安全扫描
    // 公证过程可能需要几分钟时间
    await notarize({
      appPath: appPath,                                    // 应用文件路径
      appleId: process.env.APPLE_ID,                       // Apple ID 邮箱
      appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,  // 专用密码
      teamId: process.env.APPLE_TEAM_ID,                   // 团队 ID
    });

    // 公证成功提示
    console.log('✅ 公证成功！');
    console.log('   应用已签名并通过公证，可以分发给用户');
  } catch (error) {
    // 公证失败错误处理
    // 常见失败原因：
    // 1. 凭据错误（Apple ID 或密码不正确）
    // 2. 应用签名问题
    // 3. 网络连接问题
    // 4. Apple 服务暂时不可用
    console.error('❌ 公证失败:', error.message);
    console.error('   请检查 Apple Developer 凭据并重试');
    console.error('   访问 https://appstoreconnect.apple.com/notarization-history 查看详情');
    
    // 抛出错误以中断构建流程
    // 确保未通过公证的应用不会被分发
    throw error;
  }
};
