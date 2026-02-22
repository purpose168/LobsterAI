import React from 'react';
import { XMarkIcon, InformationCircleIcon } from '@heroicons/react/24/outline';

/**
 * Toast 组件的属性接口
 */
interface ToastProps {
  /** 要显示的消息内容 */
  message: string;
  /** 关闭 Toast 时的回调函数（可选） */
  onClose?: () => void;
}

/**
 * Toast 提示组件
 * 用于显示临时通知消息，支持手动关闭
 */
const Toast: React.FC<ToastProps> = ({ message, onClose }) => {
  return (
    // 全屏遮罩层，居中显示 Toast
    <div className="fixed inset-0 z-50 flex items-center justify-center modal-backdrop">
      {/* Toast 主容器，包含圆角、边框、背景和阴影效果 */}
      <div className="w-full max-w-sm mx-4 rounded-2xl border border-claude-border/60 dark:border-claude-darkBorder/60 bg-white/95 dark:bg-claude-darkSurface/95 text-claude-text dark:text-claude-darkText px-6 py-4 shadow-xl backdrop-blur-md animate-scale-in">
        <div className="flex items-center gap-4">
          {/* 信息图标容器 */}
          <div className="shrink-0 rounded-full bg-claude-accent/10 p-2.5">
            <InformationCircleIcon className="h-5 w-5 text-claude-accent" />
          </div>
          {/* 消息文本 */}
          <div className="flex-1 text-base font-semibold leading-none">
            {message}
          </div>
          {/* 关闭按钮（仅当提供 onClose 回调时显示） */}
          {onClose && (
            <button
              onClick={onClose}
              className="shrink-0 text-claude-textSecondary dark:text-claude-darkTextSecondary hover:text-claude-text dark:hover:text-claude-darkText rounded-full p-1 hover:bg-claude-surfaceHover dark:hover:bg-claude-darkSurfaceHover transition-colors"
              aria-label="关闭"
            >
              <XMarkIcon className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default Toast;
