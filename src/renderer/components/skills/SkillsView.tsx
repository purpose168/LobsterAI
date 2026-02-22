import React from 'react';
import { i18nService } from '../../services/i18n';
import SkillsManager from './SkillsManager';
import SidebarToggleIcon from '../icons/SidebarToggleIcon';
import ComposeIcon from '../icons/ComposeIcon';
import WindowTitleBar from '../window/WindowTitleBar';

/**
 * 技能视图组件的属性接口
 * @interface SkillsViewProps
 */
interface SkillsViewProps {
  /** 侧边栏是否折叠 */
  isSidebarCollapsed?: boolean;
  /** 切换侧边栏折叠状态的回调函数 */
  onToggleSidebar?: () => void;
  /** 创建新聊天的回调函数 */
  onNewChat?: () => void;
  /** 更新徽章组件 */
  updateBadge?: React.ReactNode;
}

/**
 * 技能视图组件
 * 用于展示技能管理界面的主视图组件
 * @param props - 组件属性
 * @returns 技能视图组件
 */
const SkillsView: React.FC<SkillsViewProps> = ({ isSidebarCollapsed, onToggleSidebar, onNewChat, updateBadge }) => {
  // 检测当前系统是否为 macOS
  const isMac = window.electron.platform === 'darwin';
  
  return (
    // 主容器：使用 flex 布局，支持深色模式
    <div className="flex-1 flex flex-col dark:bg-claude-darkBg bg-claude-bg h-full">
      {/* 标题栏区域：可拖拽，包含侧边栏控制按钮和窗口标题栏 */}
      <div className="draggable flex h-12 items-center justify-between px-4 border-b dark:border-claude-darkBorder border-claude-border shrink-0">
        <div className="flex items-center space-x-3 h-8">
          {/* 当侧边栏折叠时显示控制按钮 */}
          {isSidebarCollapsed && (
            <div className={`non-draggable flex items-center gap-1 ${isMac ? 'pl-[68px]' : ''}`}>
              {/* 侧边栏切换按钮 */}
              <button
                type="button"
                onClick={onToggleSidebar}
                className="h-8 w-8 inline-flex items-center justify-center rounded-lg dark:text-claude-darkTextSecondary text-claude-textSecondary hover:bg-claude-surfaceHover dark:hover:bg-claude-darkSurfaceHover transition-colors"
              >
                <SidebarToggleIcon className="h-4 w-4" isCollapsed={true} />
              </button>
              {/* 新建聊天按钮 */}
              <button
                type="button"
                onClick={onNewChat}
                className="h-8 w-8 inline-flex items-center justify-center rounded-lg dark:text-claude-darkTextSecondary text-claude-textSecondary hover:bg-claude-surfaceHover dark:hover:bg-claude-darkSurfaceHover transition-colors"
              >
                <ComposeIcon className="h-4 w-4" />
              </button>
              {/* 更新徽章 */}
              {updateBadge}
            </div>
          )}
          {/* 页面标题：显示"技能" */}
          <h1 className="text-lg font-semibold dark:text-claude-darkText text-claude-text">
            {i18nService.t('skills')}
          </h1>
        </div>
        {/* 窗口标题栏 */}
        <WindowTitleBar inline />
      </div>

      {/* 内容区域：可滚动，包含技能管理器组件 */}
      <div className="flex-1 overflow-y-auto min-h-0">
        <div className="max-w-3xl mx-auto px-4 py-6">
          <SkillsManager />
        </div>
      </div>
    </div>
  );
};

export default SkillsView;
