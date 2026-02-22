import React, { useEffect } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { RootState } from '../../store';
import { setViewMode } from '../../store/slices/scheduledTaskSlice';
import { scheduledTaskService } from '../../services/scheduledTask';
import { i18nService } from '../../services/i18n';
import type { ScheduledTask, Schedule } from '../../types/scheduledTask';
import TaskRunHistory from './TaskRunHistory';
import { PencilIcon, PlayIcon, TrashIcon } from '@heroicons/react/24/outline';

/**
 * 格式化计划任务标签
 * 根据计划类型生成可读的调度描述字符串
 * @param schedule - 计划配置对象
 * @returns 格式化后的计划描述字符串
 */
function formatScheduleLabel(schedule: Schedule): string {
  switch (schedule.type) {
    case 'at':
      // 单次执行：显示指定的日期时间
      return `${i18nService.t('scheduledTasksScheduleAtLabel')}: ${schedule.datetime ? new Date(schedule.datetime).toLocaleString() : '-'}`;
    case 'interval': {
      // 间隔执行：根据时间单位选择对应的国际化键
      const unitKey = schedule.unit === 'minutes' ? 'scheduledTasksFormIntervalMinutes' :
        schedule.unit === 'hours' ? 'scheduledTasksFormIntervalHours' : 'scheduledTasksFormIntervalDays';
      return `${i18nService.t('scheduledTasksScheduleEvery')} ${schedule.value ?? 0} ${i18nService.t(unitKey)}`;
    }
    case 'cron':
      // Cron表达式：显示cron表达式
      return `${i18nService.t('scheduledTasksScheduleCronLabel')}: ${schedule.expression ?? ''}`;
    default:
      return '';
  }
}

/**
 * 任务详情组件属性接口
 */
interface TaskDetailProps {
  task: ScheduledTask; // 计划任务对象
  onRequestDelete: (taskId: string, taskName: string) => void; // 请求删除任务的回调函数
}

/**
 * 任务详情组件
 * 显示计划任务的详细信息，包括提示词、配置、状态和执行历史
 */
const TaskDetail: React.FC<TaskDetailProps> = ({ task, onRequestDelete }) => {
  const dispatch = useDispatch();
  // 从Redux状态中获取当前任务的执行记录
  const runs = useSelector((state: RootState) => state.scheduledTask.runs[task.id] ?? []);

  // 组件挂载时加载任务执行记录
  useEffect(() => {
    scheduledTaskService.loadRuns(task.id);
  }, [task.id]);

  /**
   * 处理编辑按钮点击
   * 切换到编辑视图模式
   */
  const handleEdit = () => {
    dispatch(setViewMode('edit'));
  };

  /**
   * 处理立即运行按钮点击
   * 手动触发任务执行
   */
  const handleRunNow = async () => {
    await scheduledTaskService.runManually(task.id);
  };

  /**
   * 处理删除按钮点击
   * 调用父组件传入的删除回调函数
   */
  const handleDelete = () => {
    onRequestDelete(task.id, task.name);
  };

  // 获取状态的国际化标签
  const statusLabel = task.state.lastStatus
    ? i18nService.t(`scheduledTasksStatus${task.state.lastStatus.charAt(0).toUpperCase() + task.state.lastStatus.slice(1)}`)
    : '-';

  // 状态对应的颜色样式映射
  const statusColor = {
    success: 'text-green-500', // 成功状态：绿色
    error: 'text-red-500', // 错误状态：红色
    running: 'text-blue-500', // 运行中状态：蓝色
  };

  // 样式类名常量定义
  const sectionClass = 'rounded-lg border dark:border-claude-darkBorder border-claude-border p-4';
  const sectionTitleClass = 'text-sm font-semibold dark:text-claude-darkText text-claude-text mb-3';
  const labelClass = 'text-xs dark:text-claude-darkTextSecondary text-claude-textSecondary';
  const valueClass = 'text-sm dark:text-claude-darkText text-claude-text';

  return (
    <div className="p-4 space-y-4 max-w-2xl mx-auto">
      {/* 头部区域：显示任务名称和操作按钮 */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold dark:text-claude-darkText text-claude-text">
            {task.name}
          </h2>
        </div>
        <div className="flex items-center gap-2">
          {/* 编辑按钮 */}
          <button
            type="button"
            onClick={handleEdit}
            className="p-2 rounded-lg dark:text-claude-darkTextSecondary text-claude-textSecondary hover:bg-claude-surfaceHover dark:hover:bg-claude-darkSurfaceHover transition-colors"
            title={i18nService.t('scheduledTasksEdit')}
          >
            <PencilIcon className="w-4 h-4" />
          </button>
          {/* 立即运行按钮：任务正在运行时禁用 */}
          <button
            type="button"
            onClick={handleRunNow}
            disabled={!!task.state.runningAtMs}
            className="p-2 rounded-lg dark:text-claude-darkTextSecondary text-claude-textSecondary hover:bg-claude-surfaceHover dark:hover:bg-claude-darkSurfaceHover transition-colors disabled:opacity-50"
            title={i18nService.t('scheduledTasksRun')}
          >
            <PlayIcon className="w-4 h-4" />
          </button>
          {/* 删除按钮 */}
          <button
            type="button"
            onClick={handleDelete}
            className="p-2 rounded-lg text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
            title={i18nService.t('scheduledTasksDelete')}
          >
            <TrashIcon className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 提示词区域：显示任务的提示词内容 */}
      <div className={sectionClass}>
        <h3 className={sectionTitleClass}>{i18nService.t('scheduledTasksPrompt')}</h3>
        <div className="text-sm dark:text-claude-darkText text-claude-text whitespace-pre-wrap bg-claude-surfaceHover/30 dark:bg-claude-darkSurfaceHover/30 rounded-md p-3">
          {task.prompt}
        </div>
      </div>

      {/* 配置区域：显示任务的各项配置信息 */}
      <div className={sectionClass}>
        <h3 className={sectionTitleClass}>{i18nService.t('scheduledTasksConfiguration')}</h3>
        <div className="grid grid-cols-2 gap-3">
          {/* 计划配置 */}
          <div>
            <div className={labelClass}>{i18nService.t('scheduledTasksSchedule')}</div>
            <div className={valueClass}>{formatScheduleLabel(task.schedule)}</div>
          </div>
          {/* 启用状态 */}
          <div>
            <div className={labelClass}>{i18nService.t('scheduledTasksFormEnabled')}</div>
            <div className={valueClass}>
              <span className={`inline-flex items-center gap-1 ${task.enabled ? 'text-green-500' : 'dark:text-claude-darkTextSecondary text-claude-textSecondary'}`}>
                {task.enabled ? '✓ ' + i18nService.t('enabled') : i18nService.t('disabled')}
              </span>
            </div>
          </div>
          {/* 工作目录：仅在配置时显示 */}
          {task.workingDirectory && (
            <div className="col-span-2">
              <div className={labelClass}>{i18nService.t('scheduledTasksWorkingDirectory')}</div>
              <div className={valueClass + ' font-mono text-xs'}>{task.workingDirectory}</div>
            </div>
          )}
          {/* 执行模式 */}
          <div>
            <div className={labelClass}>{i18nService.t('scheduledTasksExecutionMode')}</div>
            <div className={valueClass}>{task.executionMode}</div>
          </div>
          {/* 过期日期 */}
          <div>
            <div className={labelClass}>{i18nService.t('scheduledTasksDetailExpiresAt')}</div>
            <div className={valueClass}>
              {task.expiresAt
                ? new Date(task.expiresAt + 'T00:00:00').toLocaleDateString()
                : i18nService.t('scheduledTasksFormExpiresAtNone')}
            </div>
          </div>
          {/* 通知平台 */}
          <div>
            <div className={labelClass}>{i18nService.t('scheduledTasksDetailNotify')}</div>
            <div className={valueClass}>
              {task.notifyPlatforms && task.notifyPlatforms.length > 0
                ? task.notifyPlatforms.map((p) =>
                    i18nService.t(`scheduledTasksFormNotify${p.charAt(0).toUpperCase() + p.slice(1)}`)
                  ).join(', ')
                : i18nService.t('scheduledTasksFormNotifyNone')}
            </div>
          </div>
        </div>
      </div>

      {/* 状态区域：显示任务的执行状态信息 */}
      <div className={sectionClass}>
        <h3 className={sectionTitleClass}>{i18nService.t('scheduledTasksStatus')}</h3>
        <div className="grid grid-cols-2 gap-3">
          {/* 上次执行状态 */}
          <div>
            <div className={labelClass}>{i18nService.t('scheduledTasksLastRun')}</div>
            <div className={valueClass}>
              {task.state.lastStatus && (
                <span className={statusColor[task.state.lastStatus] || ''}>
                  {statusLabel}
                </span>
              )}
              {!task.state.lastStatus && '-'}
              {task.state.lastRunAtMs && (
                <span className="ml-1 text-xs dark:text-claude-darkTextSecondary text-claude-textSecondary">
                  ({new Date(task.state.lastRunAtMs).toLocaleString()})
                </span>
              )}
            </div>
          </div>
          {/* 下次执行时间 */}
          <div>
            <div className={labelClass}>{i18nService.t('scheduledTasksNextRun')}</div>
            <div className={valueClass}>
              {task.state.nextRunAtMs
                ? new Date(task.state.nextRunAtMs).toLocaleString()
                : '-'}
            </div>
          </div>
          {/* 上次执行时长：仅在有时长数据时显示 */}
          {task.state.lastDurationMs !== null && (
            <div>
              <div className={labelClass}>{i18nService.t('scheduledTasksLastDuration')}</div>
              <div className={valueClass}>
                {task.state.lastDurationMs < 1000
                  ? `${task.state.lastDurationMs}ms`
                  : `${(task.state.lastDurationMs / 1000).toFixed(1)}s`}
              </div>
            </div>
          )}
          {/* 连续错误次数：仅在存在错误时显示 */}
          {(task.state.consecutiveErrors ?? 0) > 0 && (
            <div>
              <div className={labelClass}>{i18nService.t('scheduledTasksConsecutiveErrors')}</div>
              <div className="text-sm text-red-500">{task.state.consecutiveErrors}</div>
            </div>
          )}
        </div>
        {/* 最后错误信息：仅在存在错误时显示 */}
        {task.state.lastError && (
          <div className="mt-3 px-3 py-2 text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded">
            {task.state.lastError}
          </div>
        )}
      </div>

      {/* 执行历史区域：显示任务的执行记录列表 */}
      <div className={sectionClass}>
        <h3 className={sectionTitleClass}>{i18nService.t('scheduledTasksRunHistory')}</h3>
        <TaskRunHistory taskId={task.id} runs={runs} />
      </div>
    </div>
  );
};

export default TaskDetail;
