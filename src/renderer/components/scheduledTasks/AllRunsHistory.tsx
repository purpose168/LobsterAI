import React, { useEffect } from 'react';
import { useSelector } from 'react-redux';
import { RootState } from '../../store';
import { scheduledTaskService } from '../../services/scheduledTask';
import { i18nService } from '../../services/i18n';
import type { ScheduledTaskRunWithName } from '../../types/scheduledTask';
import { ClockIcon } from '@heroicons/react/24/outline';

/**
 * 格式化持续时间
 * 将毫秒数转换为易读的时间格式
 * @param ms - 毫秒数
 * @returns 格式化后的时间字符串
 */
function formatDuration(ms: number | null): string {
  if (!ms) return '-';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 60000)}m`;
}

/**
 * 状态配置映射
 * 定义任务运行状态的标签和颜色
 */
const statusConfig: Record<string, { label: string; color: string }> = {
  success: { label: 'scheduledTasksStatusSuccess', color: 'text-green-500' },
  error: { label: 'scheduledTasksStatusError', color: 'text-red-500' },
  running: { label: 'scheduledTasksStatusRunning', color: 'text-blue-500' },
};

/**
 * 所有运行历史组件
 * 显示所有计划任务的运行历史记录
 */
const AllRunsHistory: React.FC = () => {
  // 从 Redux store 获取所有运行记录
  const allRuns = useSelector((state: RootState) => state.scheduledTask.allRuns);

  // 组件挂载时加载最近50条运行记录
  useEffect(() => {
    scheduledTaskService.loadAllRuns(50);
  }, []);

  /**
   * 加载更多运行记录
   * 从当前已加载的记录数量开始继续加载
   */
  const handleLoadMore = () => {
    scheduledTaskService.loadAllRuns(50, allRuns.length);
  };

  /**
   * 查看会话详情
   * 触发自定义事件以打开对应的会话
   * @param run - 任务运行记录
   */
  const handleViewSession = (run: ScheduledTaskRunWithName) => {
    if (run.sessionId) {
      window.dispatchEvent(new CustomEvent('scheduledTask:viewSession', {
        detail: { sessionId: run.sessionId },
      }));
    }
  };

  // 如果没有运行记录，显示空状态提示
  if (allRuns.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-6">
        <ClockIcon className="h-12 w-12 dark:text-claude-darkTextSecondary/40 text-claude-textSecondary/40 mb-4" />
        <p className="text-sm font-medium dark:text-claude-darkTextSecondary text-claude-textSecondary">
          {i18nService.t('scheduledTasksHistoryEmpty')}
        </p>
      </div>
    );
  }

  return (
    <div>
      {/* 列标题 */}
      <div className="grid grid-cols-[1fr_1fr_80px] items-center gap-3 px-4 py-2 border-b dark:border-claude-darkBorder/50 border-claude-border/50">
        <div className="text-xs font-medium dark:text-claude-darkTextSecondary text-claude-textSecondary">
          {i18nService.t('scheduledTasksHistoryColTitle')}
        </div>
        <div className="text-xs font-medium dark:text-claude-darkTextSecondary text-claude-textSecondary">
          {i18nService.t('scheduledTasksHistoryColTime')}
        </div>
        <div className="text-xs font-medium dark:text-claude-darkTextSecondary text-claude-textSecondary">
          {i18nService.t('scheduledTasksHistoryColStatus')}
        </div>
      </div>

      {/* 运行记录列表 */}
      {allRuns.map((run) => {
        const cfg = statusConfig[run.status] || { label: '', color: '' };
        return (
          <div
            key={run.id}
            className={`grid grid-cols-[1fr_1fr_80px] items-center gap-3 px-4 py-3 border-b dark:border-claude-darkBorder/50 border-claude-border/50 transition-colors ${
              run.sessionId
                ? 'hover:bg-claude-surfaceHover/50 dark:hover:bg-claude-darkSurfaceHover/50 cursor-pointer'
                : ''
            }`}
            onClick={() => handleViewSession(run)}
          >
            {/* 任务标题 */}
            <div className="text-sm dark:text-claude-darkText text-claude-text truncate">
              {run.taskName}
              {run.status === 'running' && (
                <svg className="inline-block w-3 h-3 ml-1.5 animate-spin text-blue-500" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25" />
                  <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="4" strokeLinecap="round" className="opacity-75" />
                </svg>
              )}
            </div>

            {/* 运行时间和持续时间 */}
            <div className="text-sm dark:text-claude-darkTextSecondary text-claude-textSecondary truncate">
              {new Date(run.startedAt).toLocaleString()}
              {run.durationMs !== null && (
                <span className="ml-1.5 text-xs opacity-70">({formatDuration(run.durationMs)})</span>
              )}
            </div>

            {/* 状态 */}
            <div className={`text-sm font-medium ${cfg.color}`}>
              {i18nService.t(cfg.label)}
            </div>
          </div>
        );
      })}

      {/* 加载更多按钮 */}
      {allRuns.length >= 50 && allRuns.length % 50 === 0 && (
        <button
          type="button"
          onClick={handleLoadMore}
          className="w-full py-3 text-sm text-claude-accent hover:text-claude-accentHover transition-colors"
        >
          {i18nService.t('scheduledTasksLoadMore')}
        </button>
      )}
    </div>
  );
};

export default AllRunsHistory;
