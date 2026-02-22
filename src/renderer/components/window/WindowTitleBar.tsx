import React, { useEffect, useState } from 'react';

// 窗口标题栏组件属性接口
interface WindowTitleBarProps {
  isOverlayActive?: boolean; // 覆盖层是否激活
  inline?: boolean; // 是否为内联模式
  className?: string; // 自定义样式类名
}

// 窗口状态类型定义
type WindowState = {
  isMaximized: boolean; // 是否最大化
  isFullscreen: boolean; // 是否全屏
  isFocused: boolean; // 是否聚焦
};

// 默认窗口状态
const DEFAULT_STATE: WindowState = {
  isMaximized: false,
  isFullscreen: false,
  isFocused: true,
};

// 窗口标题栏组件
const WindowTitleBar: React.FC<WindowTitleBarProps> = ({
  isOverlayActive = false,
  inline = false,
  className = '',
}) => {
  const [state, setState] = useState<WindowState>(DEFAULT_STATE);

  useEffect(() => {
    let disposed = false; // 组件是否已卸载标记
    // 获取初始最大化状态
    window.electron.window.isMaximized().then((isMaximized) => {
      if (!disposed) {
        setState((prev) => ({ ...prev, isMaximized }));
      }
    }).catch((error) => {
      console.error('获取初始最大化状态失败:', error);
    });

    // 订阅窗口状态变化事件
    const unsubscribe = window.electron.window.onStateChanged((nextState) => {
      setState(nextState);
    });

    // 清理函数：取消订阅
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);

  // 处理最小化窗口
  const handleMinimize = () => {
    window.electron.window.minimize();
  };

  // 处理切换最大化/还原窗口
  const handleToggleMaximize = () => {
    window.electron.window.toggleMaximize();
  };

  // 处理关闭窗口
  const handleClose = () => {
    window.electron.window.close();
  };

  // 处理右键菜单
  const handleContextMenu = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    window.electron.window.showSystemMenu({
      x: event.clientX,
      y: event.clientY,
    });
  };

  // 处理双击标题栏（切换最大化）
  const handleDoubleClick = () => {
    if (!state.isFullscreen) {
      handleToggleMaximize();
    }
  };

  // 非Windows平台不显示标题栏控件
  if (window.electron.platform !== 'win32') {
    return null;
  }

  // 根据模式设置容器样式类名
  const containerClassName = inline
    ? `window-controls-floating non-draggable flex h-8 items-center gap-0.5 transition-colors ${!state.isFocused ? 'opacity-70' : 'opacity-100'} ${className}`.trim()
    : `window-controls-floating non-draggable absolute top-0 right-0 z-[55] flex h-full items-center gap-0.5 rounded-bl-xl pl-1 pb-1 pt-0.5 transition-colors ${
      !state.isFocused ? 'opacity-70' : 'opacity-100'
    } ${
      isOverlayActive
        ? 'bg-transparent'
        : 'dark:bg-claude-darkSurface/35 bg-claude-surface/35 backdrop-blur-sm'
    } ${className}`.trim();

  return (
    <div
      className={containerClassName}
      onDoubleClick={handleDoubleClick}
      onContextMenu={handleContextMenu}
    >
      {/* 最小化按钮 */}
      <button
        type="button"
        onClick={handleMinimize}
        className="non-draggable h-8 w-8 inline-flex items-center justify-center rounded-lg transition-colors dark:text-claude-darkTextSecondary text-claude-textSecondary hover:dark:bg-claude-darkSurfaceHover hover:bg-claude-surfaceHover"
        aria-label="最小化"
        title="最小化"
      >
        <svg viewBox="0 0 12 12" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 6h8" />
        </svg>
      </button>
      {/* 最大化/还原按钮 */}
      <button
        type="button"
        onClick={handleToggleMaximize}
        className="non-draggable h-8 w-8 inline-flex items-center justify-center rounded-lg transition-colors dark:text-claude-darkTextSecondary text-claude-textSecondary hover:dark:bg-claude-darkSurfaceHover hover:bg-claude-surfaceHover"
        aria-label={state.isMaximized ? '还原' : '最大化'}
        title={state.isMaximized ? '还原' : '最大化'}
      >
        {state.isMaximized ? (
          <svg viewBox="0 0 12 12" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 2h6.5v6.5" />
            <path d="M1.5 4h7v7h-7z" />
          </svg>
        ) : (
          <svg viewBox="0 0 12 12" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 2h8v8H2z" />
          </svg>
        )}
      </button>
      {/* 关闭按钮 */}
      <button
        type="button"
        onClick={handleClose}
        className="non-draggable h-8 w-8 inline-flex items-center justify-center rounded-lg transition-colors dark:text-claude-darkTextSecondary text-claude-textSecondary hover:bg-red-500 hover:text-white dark:hover:bg-red-500"
        aria-label="关闭"
        title="关闭"
      >
        <svg viewBox="0 0 12 12" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 3l6 6" />
          <path d="M9 3L3 9" />
        </svg>
      </button>
    </div>
  );
};

export default WindowTitleBar;
