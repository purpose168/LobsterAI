/**
 * 托盘管理器模块
 * 负责管理系统托盘图标的创建、更新和销毁
 */

import { app, Tray, Menu, nativeImage, BrowserWindow } from 'electron';
import path from 'path';
import { APP_NAME } from './appConstants';
import type { SqliteStore } from './sqliteStore';

// 托盘实例
let tray: Tray | null = null;
// 上下文菜单实例
let contextMenu: Menu | null = null;
// 单击事件处理器
let clickHandler: (() => void) | null = null;
// 右键点击事件处理器
let rightClickHandler: (() => void) | null = null;

/**
 * 获取托盘图标路径
 * 根据不同操作系统返回对应的图标文件路径
 * @returns 托盘图标的完整路径
 */
function getTrayIconPath(): string {
  // 判断是否为 macOS 系统
  const isMac = process.platform === 'darwin';
  // 判断是否为 Windows 系统
  const isWin = process.platform === 'win32';

  // 根据应用是否打包确定资源路径
  const basePath = app.isPackaged
    ? path.join(process.resourcesPath, 'tray')
    : path.join(__dirname, '..', 'resources', 'tray');

  // macOS 系统使用专用的 PNG 图标
  if (isMac) {
    return path.join(basePath, 'tray-icon-mac.png');
  }
  // Windows 系统使用 ICO 格式图标
  if (isWin) {
    return path.join(basePath, 'tray-icon.ico');
  }
  // Linux系统使用标准 PNG 图标
  return path.join(basePath, 'tray-icon.png');
}

/**
 * 获取菜单标签文本
 * 根据应用配置的语言设置返回对应的菜单文本
 * @param store - SQLite 存储实例，用于读取应用配置
 * @returns 包含各菜单项标签文本的对象
 */
function getLabels(store: SqliteStore): { showWindow: string; newTask: string; settings: string; quit: string } {
  try {
    // 从存储中读取应用配置
    const config = store.get<{ language?: string }>('app_config');
    // 判断语言设置，默认为中文
    const lang = config?.language === 'en' ? 'en' : 'zh';
    // 根据语言返回对应的菜单文本
    return lang === 'en'
      ? { showWindow: 'Open LobsterAI', newTask: 'New Task', settings: 'Settings', quit: 'Quit' }
      : { showWindow: '打开 LobsterAI', newTask: '新建任务', settings: '设置', quit: '退出' };
  } catch {
    // 发生错误时返回默认中文文本
    return { showWindow: '打开 LobsterAI', newTask: '新建任务', settings: '设置', quit: '退出' };
  }
}

/**
 * 构建上下文菜单
 * 创建托盘图标的右键菜单，包含打开窗口、新建任务、设置和退出等选项
 * @param getWindow - 获取主窗口实例的函数
 * @param store - SQLite 存储实例
 * @returns 构建完成的菜单实例
 */
function buildContextMenu(getWindow: () => BrowserWindow | null, store: SqliteStore): Menu {
  // 获取当前语言的菜单标签
  const labels = getLabels(store);

  // 使用模板构建菜单
  return Menu.buildFromTemplate([
    {
      label: labels.showWindow,
      click: () => {
        // 获取窗口实例
        const win = getWindow();
        if (win && !win.isDestroyed()) {
          // 如果窗口不可见则显示窗口
          if (!win.isVisible()) win.show();
          // 如果窗口未获得焦点则聚焦窗口
          if (!win.isFocused()) win.focus();
        }
      },
    },
    {
      label: labels.newTask,
      click: () => {
        const win = getWindow();
        if (win && !win.isDestroyed()) {
          // 显示并聚焦窗口
          if (!win.isVisible()) win.show();
          if (!win.isFocused()) win.focus();
          // 向渲染进程发送新建任务事件
          win.webContents.send('app:newTask');
        }
      },
    },
    // 分隔线
    { type: 'separator' },
    {
      label: labels.settings,
      click: () => {
        const win = getWindow();
        if (win && !win.isDestroyed()) {
          // 显示并聚焦窗口
          if (!win.isVisible()) win.show();
          if (!win.isFocused()) win.focus();
          // 向渲染进程发送打开设置事件
          win.webContents.send('app:openSettings');
        }
      },
    },
    // 分隔线
    { type: 'separator' },
    {
      label: labels.quit,
      click: () => {
        // 退出应用
        app.quit();
      },
    },
  ]);
}

/**
 * 创建系统托盘
 * 初始化托盘图标、设置工具提示和事件监听器
 * @param getWindow - 获取主窗口实例的函数
 * @param store - SQLite 存储实例
 * @returns 创建的托盘实例
 */
export function createTray(getWindow: () => BrowserWindow | null, store: SqliteStore): Tray {
  // 如果托盘已存在则直接返回
  if (tray) {
    return tray;
  }

  // 获取图标路径并创建原生图像
  const iconPath = getTrayIconPath();
  let icon = nativeImage.createFromPath(iconPath);

  // macOS 特殊处理
  if (process.platform === 'darwin') {
    icon.setTemplateImage(false);
    // 保持托盘图标在 macOS 菜单栏边界内
    if (icon.getSize().height > 18) {
      // 调整图标大小以适应菜单栏
      icon = icon.resize({ height: 18 });
      icon.setTemplateImage(false);
    }
  }

  // 创建托盘实例并设置工具提示
  tray = new Tray(icon);
  tray.setToolTip(APP_NAME);

  // 构建上下文菜单
  contextMenu = buildContextMenu(getWindow, store);

  // 设置单击事件处理器：显示并聚焦窗口
  clickHandler = () => {
    const win = getWindow();
    if (!win || win.isDestroyed()) return;
    if (!win.isVisible()) win.show();
    if (!win.isFocused()) win.focus();
  };

  // 设置右键点击事件处理器：显示上下文菜单
  rightClickHandler = () => {
    if (contextMenu) {
      tray?.popUpContextMenu(contextMenu);
    }
  };

  // 注册事件监听器
  tray.on('click', clickHandler);
  tray.on('right-click', rightClickHandler);

  return tray;
}

/**
 * 更新托盘菜单
 * 重新构建托盘的上下文菜单（通常在语言设置更改时调用）
 * @param getWindow - 获取主窗口实例的函数
 * @param store - SQLite 存储实例
 */
export function updateTrayMenu(getWindow: () => BrowserWindow | null, store: SqliteStore): void {
  if (!tray) return;
  // 重新构建上下文菜单
  contextMenu = buildContextMenu(getWindow, store);
}

/**
 * 销毁托盘
 * 清理托盘相关资源，移除事件监听器并销毁托盘实例
 */
export function destroyTray(): void {
  if (tray) {
    // 移除事件监听器
    if (clickHandler) tray.removeListener('click', clickHandler);
    if (rightClickHandler) tray.removeListener('right-click', rightClickHandler);
    // 销毁托盘实例
    tray.destroy();
    // 重置所有变量
    tray = null;
    contextMenu = null;
    clickHandler = null;
    rightClickHandler = null;
  }
}
