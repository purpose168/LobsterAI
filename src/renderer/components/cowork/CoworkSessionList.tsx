import React, { useMemo } from 'react';
import { useSelector } from 'react-redux';
import { RootState } from '../../store';
import type { CoworkSessionSummary } from '../../types/cowork';
import CoworkSessionItem from './CoworkSessionItem';
import { i18nService } from '../../services/i18n';

/**
 * 协作会话列表组件属性接口
 */
interface CoworkSessionListProps {
  /** 会话摘要列表 */
  sessions: CoworkSessionSummary[];
  /** 当前选中的会话ID */
  currentSessionId: string | null;
  /** 选择会话的回调函数 */
  onSelectSession: (sessionId: string) => void;
  /** 删除会话的回调函数 */
  onDeleteSession: (sessionId: string) => void;
  /** 切换会话置顶状态的回调函数 */
  onTogglePin: (sessionId: string, pinned: boolean) => void;
  /** 重命名会话的回调函数 */
  onRenameSession: (sessionId: string, title: string) => void;
}

/**
 * 协作会话列表组件
 * 显示所有协作会话，支持置顶、排序和选择功能
 */
const CoworkSessionList: React.FC<CoworkSessionListProps> = ({
  sessions,
  currentSessionId,
  onSelectSession,
  onDeleteSession,
  onTogglePin,
  onRenameSession,
}) => {
  // 从Redux状态中获取未读会话ID列表
  const unreadSessionIds = useSelector((state: RootState) => state.cowork.unreadSessionIds);
  // 将未读会话ID数组转换为Set以提高查询效率
  const unreadSessionIdSet = useMemo(() => new Set(unreadSessionIds), [unreadSessionIds]);

  // 对会话进行排序：置顶会话在前，非置顶会话在后，各自按最近活动时间排序
  const sortedSessions = useMemo(() => {
    // 按最近活动时间排序的比较函数
    const sortByRecentActivity = (a: CoworkSessionSummary, b: CoworkSessionSummary) => {
      // 优先按更新时间降序排列
      if (b.updatedAt !== a.updatedAt) {
        return b.updatedAt - a.updatedAt;
      }
      // 更新时间相同时，按创建时间降序排列
      return b.createdAt - a.createdAt;
    };

    // 筛选并排序置顶会话
    const pinnedSessions = sessions
      .filter((session) => session.pinned)
      .sort(sortByRecentActivity);
    // 筛选并排序非置顶会话
    const unpinnedSessions = sessions
      .filter((session) => !session.pinned)
      .sort(sortByRecentActivity);
    // 合并置顶和非置顶会话列表
    return [...pinnedSessions, ...unpinnedSessions];
  }, [sessions]);

  // 当没有会话时显示空状态提示
  if (sessions.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-sm dark:text-claude-darkTextSecondary text-claude-textSecondary">
          {i18nService.t('coworkNoSessions')}
        </p>
      </div>
    );
  }

  // 渲染会话列表
  return (
    <div className="space-y-2">
      {sortedSessions.map((session) => (
        <CoworkSessionItem
          key={session.id}
          session={session}
          hasUnread={unreadSessionIdSet.has(session.id)}
          isActive={session.id === currentSessionId}
          onSelect={() => onSelectSession(session.id)}
          onDelete={() => onDeleteSession(session.id)}
          onTogglePin={(pinned) => onTogglePin(session.id, pinned)}
          onRename={(title) => onRenameSession(session.id, title)}
        />
      ))}
    </div>
  );
};

export default CoworkSessionList;
