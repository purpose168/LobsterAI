import React, { useEffect, useMemo, useRef, useState } from 'react';
import { MagnifyingGlassIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { i18nService } from '../../services/i18n';
import type { CoworkSessionSummary } from '../../types/cowork';
import CoworkSessionList from './CoworkSessionList';

/**
 * CoworkSearchModal 组件的属性接口
 * 定义了搜索模态框所需的所有属性
 */
interface CoworkSearchModalProps {
  isOpen: boolean; // 模态框是否打开
  onClose: () => void; // 关闭模态框的回调函数
  sessions: CoworkSessionSummary[]; // 会话摘要列表
  currentSessionId: string | null; // 当前选中的会话ID
  onSelectSession: (sessionId: string) => void; // 选择会话的回调函数
  onDeleteSession: (sessionId: string) => void; // 删除会话的回调函数
  onTogglePin: (sessionId: string, pinned: boolean) => void; // 切换会话置顶状态的回调函数
  onRenameSession: (sessionId: string, title: string) => void; // 重命名会话的回调函数
}

/**
 * CoworkSearchModal 组件
 * 用于搜索和筛选协作会话的模态框组件
 * 提供搜索输入框和会话列表展示功能
 */
const CoworkSearchModal: React.FC<CoworkSearchModalProps> = ({
  isOpen,
  onClose,
  sessions,
  currentSessionId,
  onSelectSession,
  onDeleteSession,
  onTogglePin,
  onRenameSession,
}) => {
  // 搜索查询字符串的状态
  const [searchQuery, setSearchQuery] = useState('');
  // 搜索输入框的引用，用于自动聚焦
  const searchInputRef = useRef<HTMLInputElement>(null);

  /**
   * 根据搜索查询过滤会话列表
   * 使用 useMemo 优化性能，避免不必要的重新计算
   */
  const filteredSessions = useMemo(() => {
    const trimmedQuery = searchQuery.trim().toLowerCase();
    // 如果查询为空，返回所有会话
    if (!trimmedQuery) return sessions;
    // 根据标题进行模糊匹配过滤
    return sessions.filter((session) => session.title.toLowerCase().includes(trimmedQuery));
  }, [sessions, searchQuery]);

  /**
   * 处理模态框打开时的副作用
   * 1. 自动聚焦到搜索输入框
   * 2. 模态框关闭时清空搜索查询
   */
  useEffect(() => {
    if (isOpen) {
      // 使用 requestAnimationFrame 确保在下一帧聚焦，避免动画冲突
      requestAnimationFrame(() => {
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      });
      return;
    }
    // 模态框关闭时清空搜索内容
    setSearchQuery('');
  }, [isOpen]);

  /**
   * 处理键盘事件
   * 监听 ESC 键关闭模态框
   */
  useEffect(() => {
    if (!isOpen) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    // 添加键盘事件监听器
    document.addEventListener('keydown', handleEscape);
    // 清理函数：移除事件监听器
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  /**
   * 处理会话选择
   * 选择会话后自动关闭模态框
   * @param sessionId - 要选择的会话ID
   */
  const handleSelectSession = async (sessionId: string) => {
    await onSelectSession(sessionId);
    onClose();
  };

  // 如果模态框未打开，不渲染任何内容
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center modal-backdrop p-6"
      onClick={onClose} // 点击背景关闭模态框
    >
      <div
        className="modal-content w-full max-w-2xl mt-10 rounded-2xl border dark:border-claude-darkBorder border-claude-border dark:bg-claude-darkSurface bg-claude-surface shadow-modal overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-label={i18nService.t('search')} // 无障碍标签：搜索
        onClick={(event) => event.stopPropagation()} // 阻止点击事件冒泡，防止点击内容区域时关闭模态框
      >
        {/* 搜索输入区域 */}
        <div className="flex items-center gap-3 px-4 py-3 border-b dark:border-claude-darkBorder border-claude-border">
          <div className="relative flex-1">
            {/* 搜索图标 */}
            <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 dark:text-claude-darkTextSecondary text-claude-textSecondary" />
            {/* 搜索输入框 */}
            <input
              ref={searchInputRef}
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder={i18nService.t('searchConversations')} // 占位符：搜索会话
              className="w-full pl-9 pr-3 py-2 text-sm rounded-lg dark:bg-claude-darkSurface bg-claude-surface dark:text-claude-darkText text-claude-text dark:placeholder-claude-darkTextSecondary placeholder-claude-textSecondary border dark:border-claude-darkBorder border-claude-border focus:outline-none focus:ring-2 focus:ring-claude-accent"
            />
          </div>
          {/* 关闭按钮 */}
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg dark:text-claude-darkTextSecondary text-claude-textSecondary hover:bg-claude-surfaceHover dark:hover:bg-claude-darkSurfaceHover transition-colors"
            aria-label={i18nService.t('close')} // 无障碍标签：关闭
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>
        {/* 会话列表区域 */}
        <div className="px-3 py-3 max-h-[60vh] overflow-y-auto">
          {filteredSessions.length === 0 ? (
            // 无搜索结果时的提示
            <div className="py-10 text-center text-sm dark:text-claude-darkTextSecondary text-claude-textSecondary">
              {i18nService.t('searchNoResults')}
            </div>
          ) : (
            // 会话列表组件
            <CoworkSessionList
              sessions={filteredSessions}
              currentSessionId={currentSessionId}
              onSelectSession={handleSelectSession}
              onDeleteSession={onDeleteSession}
              onTogglePin={onTogglePin}
              onRenameSession={onRenameSession}
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default CoworkSearchModal;
