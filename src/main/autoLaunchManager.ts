import { app } from 'electron';

/**
 * 获取自动启动设置状态
 * @returns 如果启用了自动启动则返回 true，否则返回 false
 */
export function getAutoLaunchEnabled(): boolean {
  try {
    const settings = app.getLoginItemSettings();
    return settings.openAtLogin;
  } catch (error) {
    console.error('获取自动启动设置失败：', error);
    return false;
  }
}

/**
 * 设置自动启动状态
 * @param enabled - 是否启用自动启动
 */
export function setAutoLaunchEnabled(enabled: boolean): void {
  const isMac = process.platform === 'darwin';

  try {
    app.setLoginItemSettings({
      openAtLogin: enabled,
      // macOS: 自启后窗口不显示，M芯片和Intel均兼容
      openAsHidden: isMac ? enabled : false,
      // Windows: 通过命令行参数标记自启动
      args: enabled ? ['--auto-launched'] : [],
    });
  } catch (error) {
    console.error('设置自动启动失败：', error);
    throw error;
  }
}

/**
 * 检查当前是否是通过自动启动方式启动的
 * @returns 如果是自动启动则返回 true，否则返回 false
 */
export function isAutoLaunched(): boolean {
  try {
    if (process.platform === 'darwin') {
      const settings = app.getLoginItemSettings();
      return settings.wasOpenedAtLogin || false;
    }
    // Windows: 检查命令行参数
    return process.argv.includes('--auto-launched');
  } catch (error) {
    console.error('检查自动启动状态失败：', error);
    return false;
  }
}
