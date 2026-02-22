/**
 * 应用更新模态框组件
 * 用于显示应用版本更新提示，包含最新版本号和用户操作按钮
 */
import React from 'react';
import { i18nService } from '../../services/i18n';

/**
 * AppUpdateModal 组件属性接口
 * @property latestVersion - 最新版本号字符串
 * @property onConfirm - 用户确认更新时的回调函数
 * @property onCancel - 用户取消更新时的回调函数
 */
interface AppUpdateModalProps {
  latestVersion: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * 应用更新模态框组件
 * 显示一个居中的模态对话框，提示用户有新版本可用
 * @param props - 组件属性
 * @param props.latestVersion - 最新版本号
 * @param props.onConfirm - 确认更新的回调函数
 * @param props.onCancel - 取消更新的回调函数
 */
const AppUpdateModal: React.FC<AppUpdateModalProps> = ({ latestVersion, onConfirm, onCancel }) => {
  return (
    // 模态框背景遮罩层，固定定位覆盖整个视口
    <div className="fixed inset-0 z-50 flex items-center justify-center modal-backdrop">
      {/* 模态框内容容器，包含标题、消息和操作按钮 */}
      <div className="modal-content w-full max-w-sm mx-4 dark:bg-claude-darkSurface bg-claude-surface rounded-2xl shadow-modal overflow-hidden">
        {/* 模态框头部区域：标题和更新消息 */}
        <div className="px-5 pt-5 pb-3">
          {/* 更新可用标题 */}
          <h3 className="text-base font-semibold dark:text-claude-darkText text-claude-text">
            {i18nService.t('updateAvailableTitle')}
          </h3>
          {/* 更新提示消息 */}
          <p className="mt-2 text-sm dark:text-claude-darkTextSecondary text-claude-textSecondary">
            {i18nService.t('updateAvailableMessage')}
          </p>
          {/* 显示最新版本号 */}
          <p className="mt-2 text-xs dark:text-claude-darkTextSecondary text-claude-textSecondary">
            {latestVersion}
          </p>
        </div>
        {/* 模态框底部操作按钮区域 */}
        <div className="px-5 pb-5 flex items-center justify-end gap-2">
          {/* 取消按钮 */}
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 text-sm rounded-lg dark:text-claude-darkTextSecondary text-claude-textSecondary dark:hover:bg-claude-darkSurfaceHover hover:bg-claude-surfaceHover transition-colors"
          >
            {i18nService.t('updateAvailableCancel')}
          </button>
          {/* 确认更新按钮 */}
          <button
            type="button"
            onClick={onConfirm}
            className="px-3 py-1.5 text-sm rounded-lg bg-claude-accent text-white hover:bg-claude-accentHover transition-colors"
          >
            {i18nService.t('updateAvailableConfirm')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AppUpdateModal;
