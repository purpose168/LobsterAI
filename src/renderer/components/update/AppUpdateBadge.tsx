import React from 'react';
import { i18nService } from '../../services/i18n';

/**
 * 应用更新徽章组件的属性接口
 */
interface AppUpdateBadgeProps {
  /** 最新版本号 */
  latestVersion: string;
  /** 点击徽章时的回调函数 */
  onClick: () => void;
}

/**
 * 应用更新徽章组件
 * 显示一个可点击的徽章，提示用户有新版本可用
 */
const AppUpdateBadge: React.FC<AppUpdateBadgeProps> = ({ latestVersion, onClick }) => {
  return (
    <button
      type="button"
      onClick={onClick}
      className="non-draggable inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/12 px-3 py-1 text-xs font-medium text-emerald-600 hover:bg-emerald-500/18 dark:text-emerald-400 transition-colors"
      title={`${i18nService.t('updateAvailablePill')} ${latestVersion}`}
      aria-label={`${i18nService.t('updateAvailablePill')} ${latestVersion}`}
    >
      {/* 绿色圆点指示器 */}
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 dark:bg-emerald-400" />
      {/* 更新可用文本 */}
      <span>{i18nService.t('updateAvailablePill')}</span>
    </button>
  );
};

export default AppUpdateBadge;
