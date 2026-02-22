import React, { useRef, useState } from 'react';
import { PuzzlePieceIcon } from '@heroicons/react/24/outline';
import SkillsPopover from './SkillsPopover';
import { Skill } from '../../types/skill';

/**
 * 技能按钮组件属性接口
 * @property onSelectSkill - 选择技能时的回调函数
 * @property onManageSkills - 管理技能时的回调函数
 * @property className - 可选的自定义样式类名
 */
interface SkillsButtonProps {
  onSelectSkill: (skill: Skill) => void;
  onManageSkills: () => void;
  className?: string;
}

/**
 * 技能按钮组件
 * 用于显示技能选择弹出框的触发按钮
 */
const SkillsButton: React.FC<SkillsButtonProps> = ({
  onSelectSkill,
  onManageSkills,
  className = '',
}) => {
  // 弹出框显示状态
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  // 按钮引用，用于定位弹出框
  const buttonRef = useRef<HTMLButtonElement>(null);

  /**
   * 处理按钮点击事件
   * 切换弹出框的显示状态
   */
  const handleButtonClick = () => {
    setIsPopoverOpen(prev => !prev);
  };

  /**
   * 关闭弹出框
   */
  const handleClosePopover = () => {
    setIsPopoverOpen(false);
  };

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={handleButtonClick}
        className={`p-2 rounded-xl dark:bg-claude-darkSurface bg-claude-surface dark:text-claude-darkTextSecondary text-claude-textSecondary hover:text-claude-accent dark:hover:text-claude-accent hover:bg-claude-surfaceHover dark:hover:bg-claude-darkSurfaceHover transition-colors ${className}`}
        title="技能"
      >
        <PuzzlePieceIcon className="h-5 w-5" />
      </button>
      <SkillsPopover
        isOpen={isPopoverOpen}
        onClose={handleClosePopover}
        onSelectSkill={onSelectSkill}
        onManageSkills={onManageSkills}
        anchorRef={buttonRef}
      />
    </div>
  );
};

export default SkillsButton;
