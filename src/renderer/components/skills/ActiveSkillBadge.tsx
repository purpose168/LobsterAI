/**
 * 活动技能徽章组件
 * 用于显示当前已激活的技能列表，支持单个移除和全部清除功能
 */
import React from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { PuzzlePieceIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { RootState } from '../../store';
import { toggleActiveSkill, clearActiveSkills } from '../../store/slices/skillSlice';
import { i18nService } from '../../services/i18n';

/**
 * 活动技能徽章组件
 * 显示当前激活的技能标签，每个标签带有移除按钮
 * 当有多个激活技能时，显示"全部清除"按钮
 */
const ActiveSkillBadge: React.FC = () => {
  // 获取 Redux dispatch 函数用于派发动作
  const dispatch = useDispatch();
  // 从 Redux store 中获取当前激活的技能 ID 列表
  const activeSkillIds = useSelector((state: RootState) => state.skill.activeSkillIds);
  // 从 Redux store 中获取所有可用技能列表
  const skills = useSelector((state: RootState) => state.skill.skills);

  // 根据激活的技能 ID 过滤出完整的技能对象列表
  const activeSkills = activeSkillIds
    .map(id => skills.find(s => s.id === id))
    .filter((s): s is NonNullable<typeof s> => s !== undefined);

  // 如果没有激活的技能，则不渲染任何内容
  if (activeSkills.length === 0) return null;

  /**
   * 处理移除单个技能
   * @param e - 鼠标点击事件
   * @param skillId - 要移除的技能 ID
   */
  const handleRemoveSkill = (e: React.MouseEvent, skillId: string) => {
    // 阻止事件冒泡，避免触发父元素的点击事件
    e.stopPropagation();
    // 派发切换技能激活状态的动作
    dispatch(toggleActiveSkill(skillId));
  };

  /**
   * 处理清除所有激活的技能
   * @param e - 鼠标点击事件
   */
  const handleClearAll = (e: React.MouseEvent) => {
    // 阻止事件冒泡
    e.stopPropagation();
    // 派发清除所有激活技能的动作
    dispatch(clearActiveSkills());
  };

  return (
    // 技能徽章容器，使用 flex 布局，支持换行
    <div className="flex items-center gap-1.5 flex-wrap">
      {/* 遍历渲染每个激活的技能徽章 */}
      {activeSkills.map(skill => (
        <div
          key={skill.id}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-claude-accent/10 border border-claude-accent/20"
        >
          {/* 技能图标 */}
          <PuzzlePieceIcon className="h-3 w-3 text-claude-accent" />
          {/* 技能名称，最大宽度 80px，超出部分省略 */}
          <span className="text-xs font-medium text-claude-accent max-w-[80px] truncate">
            {skill.name}
          </span>
          {/* 移除单个技能的按钮 */}
          <button
            type="button"
            onClick={(e) => handleRemoveSkill(e, skill.id)}
            className="p-0.5 rounded hover:bg-claude-accent/20 transition-colors"
            title={i18nService.t('clearSkill')}
          >
            <XMarkIcon className="h-2.5 w-2.5 text-claude-accent" />
          </button>
        </div>
      ))}
      {/* 当激活技能数量大于 1 时，显示"全部清除"按钮 */}
      {activeSkills.length > 1 && (
        <button
          type="button"
          onClick={handleClearAll}
          className="text-xs text-claude-accent/70 hover:text-claude-accent transition-colors"
          title={i18nService.t('clearAllSkills')}
        >
          {i18nService.t('clearAll')}
        </button>
      )}
    </div>
  );
};

export default ActiveSkillBadge;
