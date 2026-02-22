import React, { useState, useEffect, useRef } from 'react';
import { useSelector } from 'react-redux';
import { MagnifyingGlassIcon, Cog6ToothIcon, PuzzlePieceIcon, CheckIcon } from '@heroicons/react/24/outline';
import { i18nService } from '../../services/i18n';
import { RootState } from '../../store';
import { Skill } from '../../types/skill';

/**
 * 技能弹出框组件属性接口
 */
interface SkillsPopoverProps {
  isOpen: boolean; // 弹出框是否打开
  onClose: () => void; // 关闭弹出框的回调函数
  onSelectSkill: (skill: Skill) => void; // 选择技能的回调函数
  onManageSkills: () => void; // 管理技能的回调函数
  anchorRef: React.RefObject<HTMLElement>; // 锚点元素的引用
}

const SkillsPopover: React.FC<SkillsPopoverProps> = ({
  isOpen,
  onClose,
  onSelectSkill,
  onManageSkills,
  anchorRef,
}) => {
  const [searchQuery, setSearchQuery] = useState(''); // 搜索查询字符串
  const [maxListHeight, setMaxListHeight] = useState(256); // 默认最大高度 max-h-64 = 256px
  const popoverRef = useRef<HTMLDivElement>(null); // 弹出框容器的引用
  const searchInputRef = useRef<HTMLInputElement>(null); // 搜索输入框的引用
  const skills = useSelector((state: RootState) => state.skill.skills); // 从 Redux 获取所有技能
  const activeSkillIds = useSelector((state: RootState) => state.skill.activeSkillIds); // 从 Redux 获取已激活的技能 ID 列表

  // 根据搜索查询过滤已启用的技能
  const filteredSkills = skills
    .filter(s => s.enabled)
    .filter(s =>
      s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.description.toLowerCase().includes(searchQuery.toLowerCase())
    );

  // 当弹出框打开时，计算可用高度并聚焦搜索输入框
  useEffect(() => {
    if (isOpen) {
      // 计算锚点上方的可用空间
      if (anchorRef.current) {
        const anchorRect = anchorRef.current.getBoundingClientRect();
        // 可用高度 = 从视口顶部到锚点的距离，减去搜索栏的填充（约 120px）和一些边距（约 60px）
        const availableHeight = anchorRect.top - 120 - 60;
        // 限制在 120px（最小可用高度）和 256px（默认最大高度）之间
        setMaxListHeight(Math.max(120, Math.min(256, availableHeight)));
      }
      if (searchInputRef.current) {
        setTimeout(() => searchInputRef.current?.focus(), 0);
      }
    }
    if (!isOpen) {
      setSearchQuery('');
    }
  }, [isOpen, anchorRef]);

  // 处理点击外部区域
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      const isInsidePopover = popoverRef.current?.contains(target);
      const isInsideAnchor = anchorRef.current?.contains(target);

      if (!isInsidePopover && !isInsideAnchor) {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, onClose, anchorRef]);

  // 处理 Escape 键
  useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  const handleSelectSkill = (skill: Skill) => {
    onSelectSkill(skill);
    // 不关闭弹出框，以允许多选
  };

  const handleManageSkills = () => {
    onManageSkills();
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div
      ref={popoverRef}
      className="absolute bottom-full left-0 mb-2 w-72 rounded-xl border dark:border-claude-darkBorder border-claude-border dark:bg-claude-darkSurface bg-claude-surface shadow-xl z-50"
    >
      {/* 搜索输入框 */}
      <div className="p-3 border-b dark:border-claude-darkBorder border-claude-border">
        <div className="relative">
          <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 dark:text-claude-darkTextSecondary text-claude-textSecondary" />
          <input
            ref={searchInputRef}
            type="text"
            placeholder={i18nService.t('searchSkills')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm rounded-lg dark:bg-claude-darkSurface bg-claude-surface dark:text-claude-darkText text-claude-text dark:placeholder-claude-darkTextSecondary placeholder-claude-textSecondary border dark:border-claude-darkBorder border-claude-border focus:outline-none focus:ring-2 focus:ring-claude-accent"
          />
        </div>
      </div>

      {/* 技能列表 */}
      <div className="overflow-y-auto py-1" style={{ maxHeight: `${maxListHeight}px` }}>
        {filteredSkills.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm dark:text-claude-darkTextSecondary text-claude-textSecondary">
            {i18nService.t('noSkillsAvailable')}
          </div>
        ) : (
          filteredSkills.map((skill) => {
            const isActive = activeSkillIds.includes(skill.id);
            return (
              <button
                key={skill.id}
                onClick={() => handleSelectSkill(skill)}
                className={`w-full flex items-start gap-3 px-3 py-2.5 text-left transition-colors ${
                  isActive
                    ? 'dark:bg-claude-accent/10 bg-claude-accent/10'
                    : 'dark:hover:bg-claude-darkSurfaceHover hover:bg-claude-surfaceHover'
                }`}
              >
                <div className={`mt-0.5 w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${
                  isActive
                    ? 'bg-claude-accent text-white'
                    : 'dark:bg-claude-darkSurfaceHover bg-claude-surfaceHover'
                }`}>
                  {isActive ? (
                    <CheckIcon className="h-4 w-4" />
                  ) : (
                    <PuzzlePieceIcon className="h-4 w-4 dark:text-claude-darkTextSecondary text-claude-textSecondary" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`text-sm font-medium truncate ${
                      isActive
                        ? 'text-claude-accent'
                        : 'dark:text-claude-darkText text-claude-text'
                    }`}>
                      {skill.name}
                    </span>
                    {skill.isOfficial && (
                      <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-claude-accent/10 text-claude-accent flex-shrink-0">
                        {i18nService.t('official')}
                      </span>
                    )}
                  </div>
                  <p className="text-xs dark:text-claude-darkTextSecondary text-claude-textSecondary truncate mt-0.5">
                    {skill.description}
                  </p>
                </div>
              </button>
            );
          })
        )}
      </div>

      {/* 底部 - 管理技能 */}
      <div className="border-t dark:border-claude-darkBorder border-claude-border">
        <button
          onClick={handleManageSkills}
          className="w-full flex items-center justify-between px-4 py-3 text-sm dark:text-claude-darkText text-claude-text dark:hover:bg-claude-darkSurfaceHover hover:bg-claude-surfaceHover transition-colors rounded-b-xl"
        >
          <span>{i18nService.t('manageSkills')}</span>
          <Cog6ToothIcon className="h-4 w-4 dark:text-claude-darkTextSecondary text-claude-textSecondary" />
        </button>
      </div>
    </div>
  );
};

export default SkillsPopover;
