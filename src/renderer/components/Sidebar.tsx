// React 核心库和状态管理相关导入
import React, { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
// 应用程序内部模块导入
import { RootState } from '../store';
import { coworkService } from '../services/cowork';
import { i18nService } from '../services/i18n';
// 组件导入
import CoworkSessionList from './cowork/CoworkSessionList';
import CoworkSearchModal from './cowork/CoworkSearchModal';
// 图标组件导入
import { MagnifyingGlassIcon, PuzzlePieceIcon, ClockIcon } from '@heroicons/react/24/outline';
import ComposeIcon from './icons/ComposeIcon';
import SidebarToggleIcon from './icons/SidebarToggleIcon';

/**
 * Sidebar 组件的属性接口定义
 * 定义了侧边栏组件所需的所有回调函数和状态属性
 */
interface SidebarProps {
  onShowSettings: () => void; // 显示设置面板的回调函数
  onShowLogin?: () => void; // 显示登录面板的回调函数（可选）
  activeView: 'cowork' | 'skills' | 'scheduledTasks'; // 当前活动视图类型
  onShowSkills: () => void; // 显示技能视图的回调函数
  onShowCowork: () => void; // 显示协作文档视图的回调函数
  onShowScheduledTasks: () => void; // 显示计划任务视图的回调函数
  onNewChat: () => void; // 创建新聊天的回调函数
  isCollapsed: boolean; // 侧边栏是否折叠
  onToggleCollapse: () => void; // 切换折叠状态的回调函数
  updateBadge?: React.ReactNode; // 更新徽章组件（可选）
}

/**
 * Sidebar 侧边栏组件
 * 提供应用程序的主要导航功能，包括新建聊天、搜索、技能管理、计划任务和协作文档历史记录
 * 
 * @param props - 组件属性
 * @returns 侧边栏 JSX 元素
 */
const Sidebar: React.FC<SidebarProps> = ({
  onShowSettings,
  activeView,
  onShowSkills,
  onShowCowork,
  onShowScheduledTasks,
  onNewChat,
  isCollapsed,
  onToggleCollapse,
  updateBadge,
}) => {
  // 从 Redux store 中获取协作文档会话列表和当前会话ID
  const sessions = useSelector((state: RootState) => state.cowork.sessions);
  const currentSessionId = useSelector((state: RootState) => state.cowork.currentSessionId);
  
  // 搜索模态框的显示状态
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  
  // 判断当前操作系统是否为 macOS
  const isMac = window.electron.platform === 'darwin';

  /**
   * 监听搜索快捷键事件
   * 当触发搜索快捷键时，切换到协作文档视图并打开搜索模态框
   */
  useEffect(() => {
    const handleSearch = () => {
      onShowCowork();
      setIsSearchOpen(true);
    };
    window.addEventListener('cowork:shortcut:search', handleSearch);
    return () => {
      window.removeEventListener('cowork:shortcut:search', handleSearch);
    };
  }, [onShowCowork]);

  /**
   * 当侧边栏折叠时，自动关闭搜索模态框
   */
  useEffect(() => {
    if (!isCollapsed) return;
    setIsSearchOpen(false);
  }, [isCollapsed]);

  /**
   * 处理选择会话事件
   * 切换到协作文档视图并加载选中的会话
   * 
   * @param sessionId - 会话ID
   */
  const handleSelectSession = async (sessionId: string) => {
    onShowCowork();
    await coworkService.loadSession(sessionId);
  };

  /**
   * 处理删除会话事件
   * 
   * @param sessionId - 要删除的会话ID
   */
  const handleDeleteSession = async (sessionId: string) => {
    await coworkService.deleteSession(sessionId);
  };

  /**
   * 处理切换会话置顶状态
   * 
   * @param sessionId - 会话ID
   * @param pinned - 是否置顶
   */
  const handleTogglePin = async (sessionId: string, pinned: boolean) => {
    await coworkService.setSessionPinned(sessionId, pinned);
  };

  /**
   * 处理重命名会话事件
   * 
   * @param sessionId - 会话ID
   * @param title - 新的会话标题
   */
  const handleRenameSession = async (sessionId: string, title: string) => {
    await coworkService.renameSession(sessionId, title);
  };

  // 渲染侧边栏 UI
  return (
    <aside
      className={`shrink-0 dark:bg-claude-darkSurfaceMuted bg-claude-surfaceMuted flex flex-col sidebar-transition overflow-hidden ${
        isCollapsed ? 'w-0' : 'w-60'
      }`}
    >
      {/* 侧边栏头部区域 */}
      <div className="pt-3 pb-3">
        {/* 可拖拽的标题栏区域 */}
        <div className="draggable sidebar-header-drag h-8 flex items-center justify-between px-3">
          {/* macOS 平台需要额外的左边距以适应窗口控制按钮 */}
          <div className={`${isMac ? 'pl-[68px]' : ''}`}>
            {updateBadge}
          </div>
          {/* 折叠/展开切换按钮 */}
          <button
            type="button"
            onClick={onToggleCollapse}
            className="non-draggable h-8 w-8 inline-flex items-center justify-center rounded-lg dark:text-claude-darkTextSecondary text-claude-textSecondary hover:bg-claude-surfaceHover dark:hover:bg-claude-darkSurfaceHover transition-colors"
            aria-label={isCollapsed ? i18nService.t('expand') : i18nService.t('collapse')}
          >
            <SidebarToggleIcon className="h-4 w-4" isCollapsed={isCollapsed} />
          </button>
        </div>
        
        {/* 导航按钮组 */}
        <div className="mt-3 space-y-1 px-3">
          {/* 新建聊天按钮 */}
          <button
            type="button"
            onClick={onNewChat}
            className="w-full inline-flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-medium bg-claude-accent/10 text-claude-accent hover:bg-claude-accent/20 transition-colors"
          >
            <ComposeIcon className="h-4 w-4" />
            {i18nService.t('newChat')}
          </button>
          
          {/* 搜索按钮 */}
          <button
            type="button"
            onClick={() => {
              onShowCowork();
              setIsSearchOpen(true);
            }}
            className="w-full inline-flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-medium dark:text-claude-darkTextSecondary text-claude-textSecondary hover:text-claude-text dark:hover:text-claude-darkText hover:bg-claude-surfaceHover dark:hover:bg-claude-darkSurfaceHover transition-colors"
          >
            <MagnifyingGlassIcon className="h-4 w-4" />
            {i18nService.t('search')}
          </button>
          
          {/* 计划任务按钮 */}
          <button
            type="button"
            onClick={() => {
              setIsSearchOpen(false);
              onShowScheduledTasks();
            }}
            className={`w-full inline-flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors ${
              activeView === 'scheduledTasks'
                ? 'dark:text-claude-darkText text-claude-text dark:bg-claude-darkSurfaceHover bg-claude-surfaceHover'
                : 'dark:text-claude-darkTextSecondary text-claude-textSecondary hover:text-claude-text dark:hover:text-claude-darkText hover:bg-claude-surfaceHover dark:hover:bg-claude-darkSurfaceHover'
            }`}
          >
            <ClockIcon className="h-4 w-4" />
            {i18nService.t('scheduledTasks')}
          </button>
          
          {/* 技能按钮 */}
          <button
            type="button"
            onClick={() => {
              setIsSearchOpen(false);
              onShowSkills();
            }}
            className={`w-full inline-flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors ${
              activeView === 'skills'
                ? 'dark:text-claude-darkText text-claude-text dark:bg-claude-darkSurfaceHover bg-claude-surfaceHover'
                : 'dark:text-claude-darkTextSecondary text-claude-textSecondary hover:text-claude-text dark:hover:text-claude-darkText hover:bg-claude-surfaceHover dark:hover:bg-claude-darkSurfaceHover'
            }`}
          >
            <PuzzlePieceIcon className="h-4 w-4" />
            {i18nService.t('skills')}
          </button>
        </div>
      </div>
      
      {/* 协作文档历史记录列表区域 */}
      <div className="flex-1 overflow-y-auto px-2.5 pb-4">
        <div className="px-3 pb-2 text-sm font-medium dark:text-claude-darkTextSecondary text-claude-textSecondary">
          {i18nService.t('coworkHistory')}
        </div>
        <CoworkSessionList
          sessions={sessions}
          currentSessionId={currentSessionId}
          onSelectSession={handleSelectSession}
          onDeleteSession={handleDeleteSession}
          onTogglePin={handleTogglePin}
          onRenameSession={handleRenameSession}
        />
      </div>
      
      {/* 搜索模态框 */}
      <CoworkSearchModal
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
        sessions={sessions}
        currentSessionId={currentSessionId}
        onSelectSession={handleSelectSession}
        onDeleteSession={handleDeleteSession}
        onTogglePin={handleTogglePin}
        onRenameSession={handleRenameSession}
      />
      
      {/* 底部设置按钮 */}
      <div className="px-3 pb-3 pt-1">
        <button
          type="button"
          onClick={() => onShowSettings()}
          className="w-full inline-flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-medium dark:text-claude-darkTextSecondary text-claude-textSecondary hover:text-claude-text dark:hover:text-claude-darkText hover:bg-claude-surfaceHover dark:hover:bg-claude-darkSurfaceHover transition-colors"
          aria-label={i18nService.t('settings')}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="M14 17H5" /><path d="M19 7h-9" /><circle cx="17" cy="17" r="3" /><circle cx="7" cy="7" r="3" /></svg>
          {i18nService.t('settings')}
        </button>
      </div>
    </aside>
  );
};

// 导出 Sidebar 组件
export default Sidebar;
