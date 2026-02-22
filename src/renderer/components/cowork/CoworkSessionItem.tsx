import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { CoworkSessionSummary, CoworkSessionStatus } from '../../types/cowork';
import { EllipsisHorizontalIcon, ExclamationTriangleIcon, PencilSquareIcon, TrashIcon } from '@heroicons/react/24/outline';
import { i18nService } from '../../services/i18n';

/**
 * 协作会话项组件属性接口
 * @property session - 协作会话摘要信息
 * @property hasUnread - 是否有未读消息
 * @property isActive - 是否为当前激活的会话
 * @property onSelect - 选择会话的回调函数
 * @property onDelete - 删除会话的回调函数
 * @property onTogglePin - 切换会话置顶状态的回调函数
 * @property onRename - 重命名会话的回调函数
 */
interface CoworkSessionItemProps {
  session: CoworkSessionSummary;
  hasUnread: boolean;
  isActive: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onTogglePin: (pinned: boolean) => void;
  onRename: (title: string) => void;
}

// 会话状态标签映射表
const statusLabels: Record<CoworkSessionStatus, string> = {
  idle: 'coworkStatusIdle',       // 空闲状态
  running: 'coworkStatusRunning', // 运行中状态
  completed: 'coworkStatusCompleted', // 已完成状态
  error: 'coworkStatusError',     // 错误状态
};

/**
 * 图钉图标组件
 * 用于显示会话的置顶状态
 * @param slashed - 是否显示斜线（取消置顶时显示）
 */
const PushPinIcon: React.FC<React.SVGProps<SVGSVGElement> & { slashed?: boolean }> = ({
  slashed,
  ...props
}) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    <g transform="rotate(45 12 12)">
      <path d="M9 3h6l-1 5 2 2v2H8v-2l2-2-1-5z" />
      <path d="M12 12v9" />
    </g>
    {slashed && <path d="M5 5L19 19" />}
  </svg>
);

/**
 * 格式化相对时间
 * 将时间戳转换为易读的相对时间格式
 * @param timestamp - 时间戳（毫秒）
 * @returns 包含紧凑格式和完整格式的相对时间对象
 */
const formatRelativeTime = (timestamp: number): { compact: string; full: string } => {
  const now = Date.now();
  const diff = now - timestamp;

  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) {
    return {
      compact: 'now',
      full: i18nService.t('justNow'),
    };
  } else if (minutes < 60) {
    return {
      compact: `${minutes}m`,
      full: `${minutes} ${i18nService.t('minutesAgo')}`,
    };
  } else if (hours < 24) {
    return {
      compact: `${hours}h`,
      full: `${hours} ${i18nService.t('hoursAgo')}`,
    };
  } else if (days === 1) {
    return {
      compact: '1d',
      full: i18nService.t('yesterday'),
    };
  } else {
    return {
      compact: `${days}d`,
      full: `${days} ${i18nService.t('daysAgo')}`,
    };
  }
};

/**
 * 协作会话项组件
 * 显示单个协作会话的信息，包括标题、状态、时间等
 * 支持重命名、置顶、删除等操作
 */
const CoworkSessionItem: React.FC<CoworkSessionItemProps> = ({
  session,
  hasUnread,
  isActive,
  onSelect,
  onDelete,
  onTogglePin,
  onRename,
}) => {
  // 状态管理
  const [showConfirmDelete, setShowConfirmDelete] = useState(false); // 是否显示删除确认对话框
  const [isRenaming, setIsRenaming] = useState(false); // 是否处于重命名状态
  const [renameValue, setRenameValue] = useState(session.title); // 重命名输入值
  const [menuPosition, setMenuPosition] = useState<{ x: number; y: number } | null>(null); // 菜单位置
  
  // DOM引用
  const menuRef = useRef<HTMLDivElement>(null); // 菜单容器引用
  const actionButtonRef = useRef<HTMLButtonElement>(null); // 操作按钮引用
  const renameInputRef = useRef<HTMLInputElement>(null); // 重命名输入框引用
  const ignoreNextBlurRef = useRef(false); // 是否忽略下一次失焦事件

  // 同步重命名值与会话标题
  useEffect(() => {
    if (!isRenaming) {
      setRenameValue(session.title);
      ignoreNextBlurRef.current = false;
    }
  }, [isRenaming, session.title]);

  /**
   * 计算菜单位置
   * 确保菜单在视口内显示
   * @param height - 菜单高度
   * @returns 菜单的x、y坐标，如果无法计算则返回null
   */
  const calculateMenuPosition = (height: number) => {
    const rect = actionButtonRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const menuWidth = 180;
    const padding = 8;
    const x = Math.min(
      Math.max(padding, rect.right - menuWidth),
      window.innerWidth - menuWidth - padding
    );
    const y = Math.min(rect.bottom + 8, window.innerHeight - height - padding);
    return { x, y };
  };

  /**
   * 打开菜单
   * 显示操作菜单，如果菜单已打开则关闭
   */
  const openMenu = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isRenaming) return;
    if (menuPosition) {
      closeMenu();
      return;
    }
    const menuHeight = 120;
    const position = calculateMenuPosition(menuHeight);
    if (position) {
      setMenuPosition(position);
    }
    setShowConfirmDelete(false);
  };

  /**
   * 关闭菜单
   * 重置菜单状态
   */
  const closeMenu = () => {
    setMenuPosition(null);
    setShowConfirmDelete(false);
  };

  /**
   * 处理置顶切换
   * 切换会话的置顶状态
   */
  const handleTogglePin = (e: React.MouseEvent) => {
    e.stopPropagation();
    onTogglePin(!session.pinned);
    closeMenu();
  };

  /**
   * 处理重命名点击
   * 进入重命名模式
   */
  const handleRenameClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    ignoreNextBlurRef.current = false;
    setIsRenaming(true);
    setShowConfirmDelete(false);
    setRenameValue(session.title);
    setMenuPosition(null);
  };

  /**
   * 处理重命名保存
   * 保存新的会话标题
   */
  const handleRenameSave = (e?: React.SyntheticEvent) => {
    e?.stopPropagation();
    ignoreNextBlurRef.current = true;
    const nextTitle = renameValue.trim();
    if (nextTitle && nextTitle !== session.title) {
      onRename(nextTitle);
    }
    setIsRenaming(false);
  };

  /**
   * 处理重命名取消
   * 取消重命名操作，恢复原标题
   */
  const handleRenameCancel = (e?: React.MouseEvent | React.KeyboardEvent) => {
    e?.stopPropagation();
    ignoreNextBlurRef.current = true;
    setRenameValue(session.title);
    setIsRenaming(false);
  };

  /**
   * 处理重命名输入框失焦
   * 失焦时自动保存
   */
  const handleRenameBlur = (event: React.FocusEvent<HTMLInputElement>) => {
    if (ignoreNextBlurRef.current) {
      ignoreNextBlurRef.current = false;
      return;
    }
    handleRenameSave(event);
  };

  /**
   * 处理删除点击
   * 显示删除确认对话框
   */
  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowConfirmDelete(true);
    setMenuPosition(null);
  };

  /**
   * 确认删除
   * 执行删除操作
   */
  const handleConfirmDelete = () => {
    onDelete();
    setShowConfirmDelete(false);
  };

  /**
   * 取消删除
   * 关闭删除确认对话框
   */
  const handleCancelDelete = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    setShowConfirmDelete(false);
  };

  // 监听菜单外部点击和键盘事件
  useEffect(() => {
    if (!menuPosition) return;
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !actionButtonRef.current?.contains(target)) {
        closeMenu();
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeMenu();
      }
    };
    const handleScroll = () => closeMenu();
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', handleScroll);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', handleScroll);
    };
  }, [menuPosition]);

  // 动态调整菜单位置
  useEffect(() => {
    if (!menuPosition) return;
    const menuHeight = showConfirmDelete ? 112 : 120;
    const position = calculateMenuPosition(menuHeight);
    if (position && (position.x !== menuPosition.x || position.y !== menuPosition.y)) {
      setMenuPosition(position);
    }
  }, [menuPosition, showConfirmDelete]);

  // 重命名模式下自动聚焦输入框
  useEffect(() => {
    if (!isRenaming) return;
    requestAnimationFrame(() => {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    });
  }, [isRenaming]);

  // 准备显示数据
  const pinButtonLabel = session.pinned ? i18nService.t('coworkUnpinSession') : i18nService.t('coworkPinSession');
  const actionLabel = i18nService.t('coworkSessionActions');
  const renameLabel = i18nService.t('renameConversation');
  const deleteLabel = i18nService.t('deleteSession');
  const relativeTime = formatRelativeTime(session.updatedAt);
  const showRunningIndicator = session.status === 'running';
  const showUnreadIndicator = !showRunningIndicator && hasUnread;
  const showStatusIndicator = showRunningIndicator || showUnreadIndicator;
  
  // 菜单项配置
  const menuItems = useMemo(() => {
    return [
      { key: 'rename', label: renameLabel, onClick: handleRenameClick, tone: 'neutral' as const },
      { key: 'pin', label: pinButtonLabel, onClick: handleTogglePin, tone: 'neutral' as const },
      { key: 'delete', label: deleteLabel, onClick: handleDeleteClick, tone: 'danger' as const },
    ];
  }, [
    deleteLabel,
    handleDeleteClick,
    handleRenameClick,
    handleTogglePin,
    pinButtonLabel,
    renameLabel,
  ]);

  return (
    <div
      onClick={() => {
        if (isRenaming) return;
        closeMenu();
        onSelect();
      }}
      className={`group relative p-3 rounded-lg cursor-pointer transition-all duration-150 ${
        isActive
          ? 'bg-black/[0.06] dark:bg-white/[0.08]'
          : 'hover:bg-black/[0.04] dark:hover:bg-white/[0.05]'
      }`}
    >
      {/* 内容区域 */}
      <div className="flex items-start">
        <div className="flex-1 min-w-0">
          <div className={`flex items-center mb-1 ${showStatusIndicator ? 'gap-2' : 'gap-0'}`}>
            {/* 状态指示器 */}
            {showStatusIndicator && (
              <span
                className={`block w-2 h-2 rounded-full bg-claude-accent flex-shrink-0 ${
                  showRunningIndicator ? 'shadow-[0_0_6px_rgba(59,130,246,0.5)] animate-pulse' : ''
                }`}
                title={showRunningIndicator ? i18nService.t(statusLabels[session.status]) : undefined}
              />
            )}
            {isRenaming ? (
              <input
                ref={renameInputRef}
                value={renameValue}
                onChange={(event) => setRenameValue(event.target.value)}
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    handleRenameSave(event);
                  }
                  if (event.key === 'Escape') {
                    handleRenameCancel(event);
                  }
                }}
                onBlur={handleRenameBlur}
                className="flex-1 min-w-0 rounded-lg border dark:border-claude-darkBorder border-claude-border dark:bg-claude-darkBg bg-claude-bg px-2 py-1 text-sm font-medium dark:text-claude-darkText text-claude-text focus:outline-none focus:ring-2 focus:ring-claude-accent"
              />
            ) : (
              <h3 className="text-sm font-medium dark:text-claude-darkText text-claude-text truncate">
                {session.title}
              </h3>
            )}
          </div>
          <div className="flex items-center gap-2 text-xs dark:text-claude-darkTextSecondary text-claude-textSecondary">
            <span className="whitespace-nowrap" title={relativeTime.full}>
              {relativeTime.compact}
            </span>
            <span className="text-[10px] uppercase tracking-wider whitespace-nowrap">
              {i18nService.t(statusLabels[session.status])}
            </span>
          </div>
        </div>
      </div>

      {/* 操作按钮 - 绝对定位覆盖层 */}
      <div
        className={`absolute right-1.5 top-1.5 transition-opacity ${
          isRenaming
            ? 'opacity-0 pointer-events-none'
            : session.pinned
              ? 'opacity-100'
              : 'opacity-0 group-hover:opacity-100'
        }`}
      >
        <button
          ref={actionButtonRef}
          onClick={openMenu}
          className="p-1.5 rounded-lg bg-claude-surfaceMuted dark:bg-claude-darkSurfaceMuted dark:text-claude-darkTextSecondary text-claude-textSecondary dark:hover:bg-claude-darkSurface hover:bg-claude-surface transition-colors"
          aria-label={actionLabel}
        >
          {session.pinned ? (
            <span className="relative block h-4 w-4">
              <PushPinIcon className="h-4 w-4 transition-opacity duration-150 group-hover:opacity-0" />
              <EllipsisHorizontalIcon className="absolute inset-0 h-4 w-4 opacity-0 transition-opacity duration-150 group-hover:opacity-100" />
            </span>
          ) : (
            <EllipsisHorizontalIcon className="h-4 w-4" />
          )}
        </button>
      </div>

      {/* 下拉菜单 */}
      {menuPosition && (
        <div
          ref={menuRef}
          className="fixed z-50 min-w-[180px] rounded-xl border dark:border-claude-darkBorder border-claude-border dark:bg-claude-darkSurface bg-claude-surface shadow-lg overflow-hidden"
          style={{ top: menuPosition.y, left: menuPosition.x }}
          role="menu"
        >
          {menuItems.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={item.onClick}
              className={`w-full flex items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
                item.tone === 'danger'
                  ? 'text-red-500 hover:bg-red-500/10'
                  : 'dark:text-claude-darkText text-claude-text hover:bg-claude-surfaceHover dark:hover:bg-claude-darkSurfaceHover'
              }`}
            >
              {item.key === 'rename' && <PencilSquareIcon className="h-4 w-4" />}
              {item.key === 'pin' && (
                <PushPinIcon
                  slashed={session.pinned}
                  className={`h-4 w-4 ${session.pinned ? 'opacity-60' : ''}`}
                />
              )}
              {item.key === 'delete' && <TrashIcon className="h-4 w-4" />}
              {item.label}
            </button>
          ))}
        </div>
      )}

      {/* 删除确认对话框 */}
      {showConfirmDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={handleCancelDelete}
        >
          <div
            className="w-full max-w-sm mx-4 dark:bg-claude-darkSurface bg-claude-surface rounded-2xl shadow-xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 对话框头部 */}
            <div className="flex items-center gap-3 px-5 py-4">
              <div className="p-2 rounded-full bg-red-100 dark:bg-red-900/30">
                <ExclamationTriangleIcon className="h-5 w-5 text-red-600 dark:text-red-500" />
              </div>
              <h2 className="text-base font-semibold dark:text-claude-darkText text-claude-text">
                {i18nService.t('deleteTaskConfirmTitle')}
              </h2>
            </div>

            {/* 对话框内容 */}
            <div className="px-5 pb-4">
              <p className="text-sm dark:text-claude-darkTextSecondary text-claude-textSecondary">
                {i18nService.t('deleteTaskConfirmMessage')}
              </p>
            </div>

            {/* 对话框底部 */}
            <div className="flex items-center justify-end gap-3 px-5 py-4 border-t dark:border-claude-darkBorder border-claude-border">
              <button
                onClick={handleCancelDelete}
                className="px-4 py-2 text-sm font-medium rounded-lg dark:text-claude-darkTextSecondary text-claude-textSecondary dark:hover:bg-claude-darkSurfaceHover hover:bg-claude-surfaceHover transition-colors"
              >
                {i18nService.t('cancel')}
              </button>
              <button
                onClick={handleConfirmDelete}
                className="px-4 py-2 text-sm font-medium rounded-lg bg-red-500 hover:bg-red-600 text-white transition-colors"
              >
                {i18nService.t('deleteSession')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CoworkSessionItem;
