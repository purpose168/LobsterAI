/**
 * 使用 electron-log 的日志模块
 * 拦截 console.* 方法并同时写入文件和控制台。
 *
 * 日志文件位置：
 *   macOS:   ~/Library/Logs/LobsterAI/main.log
 *   Windows: %USERPROFILE%\AppData\Roaming\LobsterAI\logs\main.log
 *   Linux:   ~/.config/LobsterAI/logs/main.log
 */

import log from 'electron-log/main';

/**
 * 初始化日志系统。
 * 必须在主进程早期调用，在任何控制台输出之前。
 */
export function initLogger(): void {
  // 文件传输配置
  log.transports.file.level = 'debug';
  log.transports.file.maxSize = 10 * 1024 * 1024; // 10MB，然后轮转到 main.old.log
  log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}';

  // 控制台传输配置
  log.transports.console.level = 'debug';
  log.transports.console.format = '{text}';

  // 拦截 console.* 方法，使得所有现有的 console.log/error/warn
  // 在 25+ 个文件中都能自动被捕获，无需修改任何代码。
  // electron-log 能正确序列化 Error 对象（包含堆栈跟踪），
  // 不像 JSON.stringify 对 Error 实例只会输出 '{}'。
  const originalLog = console.log;
  const originalError = console.error;
  const originalWarn = console.warn;
  const originalInfo = console.info;
  const originalDebug = console.debug;

  console.log = (...args: any[]) => {
    originalLog.apply(console, args);
    log.info(...args);
  };
  console.error = (...args: any[]) => {
    originalError.apply(console, args);
    log.error(...args);
  };
  console.warn = (...args: any[]) => {
    originalWarn.apply(console, args);
    log.warn(...args);
  };
  console.info = (...args: any[]) => {
    originalInfo.apply(console, args);
    log.info(...args);
  };
  console.debug = (...args: any[]) => {
    originalDebug.apply(console, args);
    log.debug(...args);
  };

  // 禁用 electron-log 自身的控制台传输以避免重复打印
  // （我们上面已经调用了 originalLog，所以 electron-log 只需要写入文件）
  log.transports.console.level = false;

  // 记录启动标记
  log.info('='.repeat(60));
  log.info(`LobsterAI 已启动 (${process.platform} ${process.arch})`);
  log.info('='.repeat(60));
}

/**
 * 获取当前日志文件路径
 */
export function getLogFilePath(): string {
  return log.transports.file.getFile().path;
}

/**
 * 日志实例，供需要时直接使用
 */
export { log };
