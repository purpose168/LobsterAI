import React from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { RootState } from '../../store';
import { selectTask, setViewMode } from '../../store/slices/scheduledTaskSlice';
import { scheduledTaskService } from '../../services/scheduledTask';
import { i18nService } from '../../services/i18n';
import type { ScheduledTask, Schedule } from '../../types/scheduledTask';
import { EllipsisVerticalIcon, ClockIcon } from '@heroicons/react/24/outline';

// 星期键名映射表：将数字映射到对应的国际化键名
const weekdayKeys: Record<number, string> = {
  0: 'scheduledTasksFormWeekSun',  // 周日
  1: 'scheduledTasksFormWeekMon',  // 周一
  2: 'scheduledTasksFormWeekTue',  // 周二
  3: 'scheduledTasksFormWeekWed',  // 周三
  4: 'scheduledTasksFormWeekThu',  // 周四
  5: 'scheduledTasksFormWeekFri',  // 周五
  6: 'scheduledTasksFormWeekSat',  // 周六
};

/**
 * 格式化计划标签
 * 根据计划类型（一次性、Cron表达式、间隔）生成可读的调度描述
 * @param schedule - 计划配置对象
 * @returns 格式化后的计划描述字符串
 */
function formatScheduleLabel(schedule: Schedule): string {
  // 处理一次性执行计划
  if (schedule.type === 'at') {
    const dt = schedule.datetime ?? '';
    if (dt.includes('T')) {
      const date = new Date(dt);
      return `${i18nService.t('scheduledTasksFormScheduleModeOnce')} · ${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    }
    return i18nService.t('scheduledTasksFormScheduleModeOnce');
  }

  // 处理Cron表达式计划
  if (schedule.type === 'cron' && schedule.expression) {
    const parts = schedule.expression.trim().split(/\s+/);
    if (parts.length >= 5) {
      const [min, hour, dom, , dow] = parts;
      const timeStr = `${hour.padStart(2, '0')}:${min.padStart(2, '0')}`;

      // 每周执行：星期几不为*，日期为*
      if (dow !== '*' && dom === '*') {
        const dayNum = parseInt(dow) || 0;
        return `${i18nService.t('scheduledTasksFormScheduleModeWeekly')} · ${i18nService.t(weekdayKeys[dayNum] ?? 'scheduledTasksFormWeekSun')} ${timeStr}`;
      }
      // 每月执行：日期不为*，星期为*
      if (dom !== '*' && dow === '*') {
        return `${i18nService.t('scheduledTasksFormScheduleModeMonthly')} · ${dom}${i18nService.t('scheduledTasksFormMonthDaySuffix')} ${timeStr}`;
      }
      // 每日执行
      return `${i18nService.t('scheduledTasksFormScheduleModeDaily')} · ${timeStr}`;
    }
  }

  // 处理间隔执行计划
  if (schedule.type === 'interval') {
    return i18nService.t('scheduledTasksFormScheduleModeDaily');
  }

  return '';
}

/**
 * 任务列表项属性接口
 */
interface TaskListItemProps {
  task: ScheduledTask;                              // 计划任务对象
  onRequestDelete: (taskId: string, taskName: string) => void;  // 请求删除任务的回调函数
}

/**
 * 任务列表项组件
 * 显示单个计划任务的信息，包括名称、计划时间、状态和操作菜单
 */
const TaskListItem: React.FC<TaskListItemProps> = ({ task, onRequestDelete }) => {
  const dispatch = useDispatch();
  const [showMenu, setShowMenu] = React.useState(false);  // 控制菜单显示状态
  const menuRef = React.useRef<HTMLDivElement>(null);     // 菜单DOM引用

  // 处理点击菜单外部关闭菜单
  React.useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    };
    if (showMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showMenu]);

  /**
   * 处理任务启用/禁用切换
   * 切换任务的启用状态，并处理可能的警告信息
   */
  const handleToggle = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const warning = await scheduledTaskService.toggleTask(task.id, !task.enabled);
    if (warning) {
      const msg = warning === 'TASK_AT_PAST'
        ? i18nService.t('scheduledTasksToggleWarningAtPast')
        : warning === 'TASK_EXPIRED'
          ? i18nService.t('scheduledTasksToggleWarningExpired')
          : warning;
      window.dispatchEvent(new CustomEvent('app:showToast', { detail: msg }));
    }
  };

  /**
   * 处理立即运行任务
   */
  const handleRunNow = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowMenu(false);
    await scheduledTaskService.runManually(task.id);
  };

  /**
   * 处理编辑任务
   */
  const handleEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowMenu(false);
    dispatch(selectTask(task.id));
    dispatch(setViewMode('edit'));
  };

  /**
   * 处理删除任务
   */
  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowMenu(false);
    onRequestDelete(task.id, task.name);
  };

  return (
    <div
      className="grid grid-cols-[1fr_1fr_80px_40px] items-center gap-3 px-4 py-3 border-b dark:border-claude-darkBorder/50 border-claude-border/50 hover:bg-claude-surfaceHover/50 dark:hover:bg-claude-darkSurfaceHover/50 cursor-pointer transition-colors"
      onClick={() => dispatch(selectTask(task.id))}
    >
      {/* 标题 */}
      <div className={`text-sm truncate ${task.enabled ? 'dark:text-claude-darkText text-claude-text' : 'dark:text-claude-darkTextSecondary text-claude-textSecondary'}`}>
        {task.name}
      </div>

      {/* 计划时间 */}
      <div className="text-sm dark:text-claude-darkTextSecondary text-claude-textSecondary truncate">
        {formatScheduleLabel(task.schedule)}
      </div>

      {/* 状态：开关 + 运行指示器 */}
      <div className="flex items-center gap-1.5">
        {/* 运行指示器 */}
        {task.state.runningAtMs && (
          <span className="inline-flex items-center text-xs text-blue-500">
            <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25" />
              <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="4" strokeLinecap="round" className="opacity-75" />
            </svg>
          </span>
        )}

        {/* 开关按钮 */}
        <button
          type="button"
          onClick={handleToggle}
          className={`relative shrink-0 w-7 h-4 rounded-full transition-colors ${
            task.enabled
              ? 'bg-claude-accent'
              : 'dark:bg-claude-darkSurfaceHover bg-claude-border'
          }`}
        >
          <span
            className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white transition-transform shadow-sm ${
              task.enabled ? 'translate-x-3' : 'translate-x-0'
            }`}
          />
        </button>
      </div>

      {/* 更多操作菜单 */}
      <div className="flex justify-center">
        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setShowMenu(!showMenu); }}
            className="p-1.5 rounded-md dark:text-claude-darkTextSecondary text-claude-textSecondary hover:bg-claude-surfaceHover dark:hover:bg-claude-darkSurfaceHover transition-colors"
          >
            <EllipsisVerticalIcon className="w-5 h-5" />
          </button>
          {showMenu && (
            <div className="absolute right-0 top-full mt-1 w-32 rounded-lg shadow-lg dark:bg-claude-darkSurface bg-white border dark:border-claude-darkBorder border-claude-border z-50 py-1">
              <button
                type="button"
                onClick={handleRunNow}
                disabled={!!task.state.runningAtMs}
                className="w-full text-left px-3 py-1.5 text-sm dark:text-claude-darkText text-claude-text hover:bg-claude-surfaceHover dark:hover:bg-claude-darkSurfaceHover disabled:opacity-50"
              >
                {i18nService.t('scheduledTasksRun')}
              </button>
              <button
                type="button"
                onClick={handleEdit}
                className="w-full text-left px-3 py-1.5 text-sm dark:text-claude-darkText text-claude-text hover:bg-claude-surfaceHover dark:hover:bg-claude-darkSurfaceHover"
              >
                {i18nService.t('scheduledTasksEdit')}
              </button>
              <button
                type="button"
                onClick={handleDelete}
                className="w-full text-left px-3 py-1.5 text-sm text-red-500 hover:bg-claude-surfaceHover dark:hover:bg-claude-darkSurfaceHover"
              >
                {i18nService.t('scheduledTasksDelete')}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

/**
 * 任务列表属性接口
 */
interface TaskListProps {
  onRequestDelete: (taskId: string, taskName: string) => void;  // 请求删除任务的回调函数
}

/**
 * 任务列表组件
 * 显示所有计划任务的列表，包括加载状态和空状态处理
 */
const TaskList: React.FC<TaskListProps> = ({ onRequestDelete }) => {
  const tasks = useSelector((state: RootState) => state.scheduledTask.tasks);    // 获取任务列表
  const loading = useSelector((state: RootState) => state.scheduledTask.loading); // 获取加载状态

  // 加载中状态
  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="dark:text-claude-darkTextSecondary text-claude-textSecondary">
          {i18nService.t('loading')}
        </div>
      </div>
    );
  }

  // 空状态
  if (tasks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-6">
        <ClockIcon className="h-12 w-12 dark:text-claude-darkTextSecondary/40 text-claude-textSecondary/40 mb-4" />
        <p className="text-sm font-medium dark:text-claude-darkTextSecondary text-claude-textSecondary mb-1">
          {i18nService.t('scheduledTasksEmptyState')}
        </p>
        <p className="text-xs dark:text-claude-darkTextSecondary/70 text-claude-textSecondary/70 text-center">
          {i18nService.t('scheduledTasksEmptyHint')}
        </p>
      </div>
    );
  }

  return (
    <div>
      {/* 列标题 */}
      <div className="grid grid-cols-[1fr_1fr_80px_40px] items-center gap-3 px-4 py-2 border-b dark:border-claude-darkBorder/50 border-claude-border/50">
        <div className="text-xs font-medium dark:text-claude-darkTextSecondary text-claude-textSecondary">
          {i18nService.t('scheduledTasksListColTitle')}
        </div>
        <div className="text-xs font-medium dark:text-claude-darkTextSecondary text-claude-textSecondary">
          {i18nService.t('scheduledTasksListColSchedule')}
        </div>
        <div className="text-xs font-medium dark:text-claude-darkTextSecondary text-claude-textSecondary">
          {i18nService.t('scheduledTasksListColStatus')}
        </div>
        <div className="text-xs font-medium dark:text-claude-darkTextSecondary text-claude-textSecondary text-center">
          {i18nService.t('scheduledTasksListColMore')}
        </div>
      </div>
      {tasks.map((task) => (
        <TaskListItem key={task.id} task={task} onRequestDelete={onRequestDelete} />
      ))}
    </div>
  );
};

export default TaskList;
