/**
 * 错误消息组件
 * 用于显示错误提示信息，支持可选的关闭按钮
 */
import React from 'react';
import { XMarkIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';

/**
 * 错误消息组件的属性接口
 */
interface ErrorMessageProps {
  /** 要显示的错误消息文本 */
  message: string;
  /** 可选的关闭回调函数，当提供时会显示关闭按钮 */
  onClose?: () => void;
}

/**
 * 错误消息组件
 * 显示带有警告图标的错误提示，支持关闭功能
 * @param props - 组件属性
 * @param props.message - 错误消息内容
 * @param props.onClose - 关闭按钮的回调函数（可选）
 */
const ErrorMessage: React.FC<ErrorMessageProps> = ({ message, onClose }) => {
  return (
    // 错误消息容器：渐变背景（红色到橙色），带模糊效果和阴影
    <div className="flex items-center justify-between bg-gradient-to-r from-red-500/90 to-orange-500/90 text-white p-4 rounded-xl shadow-lg m-3 backdrop-blur-sm transition-all duration-200">
      {/* 左侧内容区域：警告图标和错误文本 */}
      <div className="flex items-center space-x-3">
        {/* 警告三角形图标 */}
        <ExclamationTriangleIcon className="h-5 w-5 text-white flex-shrink-0" />
        {/* 错误消息文本 */}
        <span className="text-sm font-medium">{message}</span>
      </div>
      {/* 关闭按钮：仅当提供 onClose 回调时显示 */}
      {onClose && (
        <button
          onClick={onClose}
          className="ml-2 text-white hover:text-red-100 rounded-full p-1 hover:bg-white/10 transition-colors"
        >
          {/* 关闭图标（X标记） */}
          <XMarkIcon className="h-5 w-5" />
        </button>
      )}
    </div>
  );
};

export default ErrorMessage; 