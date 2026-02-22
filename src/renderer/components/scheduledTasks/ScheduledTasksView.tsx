import React, { useCallback, useEffect, useState } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { RootState } from '../../store';
import { setViewMode, selectTask } from '../../store/slices/scheduledTaskSlice';
import { scheduledTaskService } from '../../services/scheduledTask';
import { i18nService } from '../../services/i18n';
import TaskList from './TaskList';
import TaskForm from './TaskForm';
import TaskDetail from './TaskDetail';
import AllRunsHistory from './AllRunsHistory';
import DeleteConfirmModal from './DeleteConfirmModal';
import { ArrowLeftIcon } from '@heroicons/react/24/outline';
import SidebarToggleIcon from '../icons/SidebarToggleIcon';
import ComposeIcon from '../icons/ComposeIcon';
import WindowTitleBar from '../window/WindowTitleBar';

/**
 * 定时任务视图组件属性接口
 */
interface ScheduledTasksViewProps {
  isSidebarCollapsed?: boolean; // 侧边栏是否折叠
  onToggleSidebar?: () => void; // 切换侧边栏的回调函数
  onNewChat?: () => void; // 新建聊天的回调函数
  updateBadge?: React.ReactNode; // 更新徽章组件
}

/**
 * 标签页类型定义
 * - tasks: 任务列表标签页
 * - history: 历史记录标签页
 */
type TabType = 'tasks' | 'history';

/**
 * 定时任务视图组件
 * 负责展示任务列表、任务表单、任务详情和历史记录
 */
const ScheduledTasksView: React.FC<ScheduledTasksViewProps> = ({
  isSidebarCollapsed,
  onToggleSidebar,
  onNewChat,
  updateBadge,
}) => {
  const dispatch = useDispatch();
  const isMac = window.electron.platform === 'darwin'; // 判断是否为 Mac 系统
  const viewMode = useSelector((state: RootState) => state.scheduledTask.viewMode); // 当前视图模式
  const selectedTaskId = useSelector((state: RootState) => state.scheduledTask.selectedTaskId); // 选中的任务ID
  const tasks = useSelector((state: RootState) => state.scheduledTask.tasks); // 任务列表
  const selectedTask = selectedTaskId ? tasks.find((t) => t.id === selectedTaskId) ?? null : null; // 选中的任务对象
  const [activeTab, setActiveTab] = useState<TabType>('tasks'); // 当前激活的标签页
  const [deleteTaskInfo, setDeleteTaskInfo] = useState<{ id: string; name: string } | null>(null); // 待删除任务信息

  /**
   * 处理删除任务请求
   * @param taskId 任务ID
   * @param taskName 任务名称
   */
  const handleRequestDelete = useCallback((taskId: string, taskName: string) => {
    setDeleteTaskInfo({ id: taskId, name: taskName });
  }, []);

  /**
   * 确认删除任务
   */
  const handleConfirmDelete = useCallback(async () => {
    if (!deleteTaskInfo) return;
    const taskId = deleteTaskInfo.id;
    setDeleteTaskInfo(null);
    await scheduledTaskService.deleteTask(taskId);
    // 如果当前正在查看该任务的详情，则返回列表视图
    if (selectedTaskId === taskId) {
      dispatch(selectTask(null));
      dispatch(setViewMode('list'));
    }
  }, [deleteTaskInfo, selectedTaskId, dispatch]);

  /**
   * 取消删除任务
   */
  const handleCancelDelete = useCallback(() => {
    setDeleteTaskInfo(null);
  }, []);

  /**
   * 组件加载时加载任务列表
   */
  useEffect(() => {
    scheduledTaskService.loadTasks();
  }, []);

  /**
   * 返回任务列表
   */
  const handleBackToList = () => {
    dispatch(selectTask(null));
    dispatch(setViewMode('list'));
  };

  /**
   * 切换标签页
   * @param tab 目标标签页
   */
  const handleTabChange = (tab: TabType) => {
    setActiveTab(tab);
    if (tab === 'tasks') {
      dispatch(selectTask(null));
      dispatch(setViewMode('list'));
    }
  };

  // 仅在列表视图中显示标签页（不在创建/编辑/详情子视图中显示）
  const showTabs = viewMode === 'list' && !selectedTaskId;

  return (
    <div className="flex flex-col h-full">
      {/* 头部区域 */}
      <div className="draggable flex h-12 items-center justify-between px-4 border-b dark:border-claude-darkBorder border-claude-border shrink-0">
        <div className="flex items-center space-x-3 h-8">
          {isSidebarCollapsed && (
            <div className={`non-draggable flex items-center gap-1 ${isMac ? 'pl-[68px]' : ''}`}>
              <button
                type="button"
                onClick={onToggleSidebar}
                className="h-8 w-8 inline-flex items-center justify-center rounded-lg dark:text-claude-darkTextSecondary text-claude-textSecondary hover:bg-claude-surfaceHover dark:hover:bg-claude-darkSurfaceHover transition-colors"
              >
                <SidebarToggleIcon className="h-4 w-4" isCollapsed={true} />
              </button>
              <button
                type="button"
                onClick={onNewChat}
                className="h-8 w-8 inline-flex items-center justify-center rounded-lg dark:text-claude-darkTextSecondary text-claude-textSecondary hover:bg-claude-surfaceHover dark:hover:bg-claude-darkSurfaceHover transition-colors"
              >
                <ComposeIcon className="h-4 w-4" />
              </button>
              {updateBadge}
            </div>
          )}
          {viewMode !== 'list' && (
            <button
              onClick={handleBackToList}
              className="non-draggable p-2 rounded-lg dark:hover:bg-claude-darkSurfaceHover hover:bg-claude-surfaceHover dark:text-claude-darkTextSecondary text-claude-textSecondary transition-colors"
              aria-label={i18nService.t('back')}
            >
              <ArrowLeftIcon className="h-5 w-5" />
            </button>
          )}
          <h1 className="text-lg font-semibold dark:text-claude-darkText text-claude-text">
            {i18nService.t('scheduledTasksTitle')}
          </h1>
        </div>
        <WindowTitleBar inline />
      </div>

      {/* 标签页和新建任务按钮 */}
      {showTabs && (
        <div className="flex items-center justify-between border-b dark:border-claude-darkBorder border-claude-border px-4 shrink-0">
          <div className="flex">
            <button
              type="button"
              onClick={() => handleTabChange('tasks')}
              className={`px-4 py-2.5 text-sm font-medium transition-colors relative ${
                activeTab === 'tasks'
                  ? 'dark:text-claude-darkText text-claude-text'
                  : 'dark:text-claude-darkTextSecondary text-claude-textSecondary hover:dark:text-claude-darkText hover:text-claude-text'
              }`}
            >
              {i18nService.t('scheduledTasksTabTasks')}
              {activeTab === 'tasks' && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-claude-accent rounded-t" />
              )}
            </button>
            <button
              type="button"
              onClick={() => handleTabChange('history')}
              className={`px-4 py-2.5 text-sm font-medium transition-colors relative ${
                activeTab === 'history'
                  ? 'dark:text-claude-darkText text-claude-text'
                  : 'dark:text-claude-darkTextSecondary text-claude-textSecondary hover:dark:text-claude-darkText hover:text-claude-text'
              }`}
            >
              {i18nService.t('scheduledTasksTabHistory')}
              {activeTab === 'history' && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-claude-accent rounded-t" />
              )}
            </button>
          </div>
          {activeTab === 'tasks' && (
            <button
              type="button"
              onClick={() => dispatch(setViewMode('create'))}
              className="px-3 py-1 text-sm font-medium bg-claude-accent text-white rounded-lg hover:bg-claude-accentHover transition-colors"
            >
              {i18nService.t('scheduledTasksNewTask')}
            </button>
          )}
        </div>
      )}

      {/* 内容区域 */}
      <div className="flex-1 overflow-y-auto">
        {showTabs && activeTab === 'history' ? (
          <AllRunsHistory />
        ) : (
          <>
            {viewMode === 'list' && <TaskList onRequestDelete={handleRequestDelete} />}
            {viewMode === 'create' && (
              <TaskForm
                mode="create"
                onCancel={handleBackToList}
                onSaved={handleBackToList}
              />
            )}
            {viewMode === 'edit' && selectedTask && (
              <TaskForm
                mode="edit"
                task={selectedTask}
                onCancel={() => dispatch(setViewMode('detail'))}
                onSaved={() => dispatch(setViewMode('detail'))}
              />
            )}
            {viewMode === 'detail' && selectedTask && (
              <TaskDetail task={selectedTask} onRequestDelete={handleRequestDelete} />
            )}
          </>
        )}
      </div>

      {/* 删除确认对话框 */}
      {deleteTaskInfo && (
        <DeleteConfirmModal
          taskName={deleteTaskInfo.name}
          onConfirm={handleConfirmDelete}
          onCancel={handleCancelDelete}
        />
      )}
    </div>
  );
};

export default ScheduledTasksView;
