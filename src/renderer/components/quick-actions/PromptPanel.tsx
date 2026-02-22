import React from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { RootState } from '../../store';
import { selectPrompt } from '../../store/slices/quickActionSlice';
import type { LocalizedQuickAction, LocalizedPrompt } from '../../types/quickAction';
import { ArrowRightIcon } from '@heroicons/react/24/outline';

/**
 * 提示词面板组件属性接口
 * @property action - 本地化的快速操作对象
 * @property onPromptSelect - 提示词选择回调函数
 */
interface PromptPanelProps {
  action: LocalizedQuickAction;
  onPromptSelect: (prompt: string) => void;
}

/**
 * 提示词面板组件
 * 用于显示和选择快速操作中的提示词列表
 * @param props - 组件属性
 * @param props.action - 本地化的快速操作对象
 * @param props.onPromptSelect - 提示词选择回调函数
 */
const PromptPanel: React.FC<PromptPanelProps> = ({ action, onPromptSelect }) => {
  // 获取 Redux dispatch 函数
  const dispatch = useDispatch();
  // 从 Redux store 中获取当前选中的提示词 ID
  const selectedPromptId = useSelector(
    (state: RootState) => state.quickAction.selectedPromptId
  );

  /**
   * 处理提示词点击事件
   * @param prompt - 被点击的本地化提示词对象
   */
  const handlePromptClick = (prompt: LocalizedPrompt) => {
    // 派发选择提示词的 action 到 Redux store
    dispatch(selectPrompt(prompt.id));
    // 调用父组件传递的回调函数，传递选中的提示词内容
    onPromptSelect(prompt.prompt);
  };

  // 如果没有提示词数据，则不渲染任何内容
  if (!action.prompts || action.prompts.length === 0) {
    return null;
  }

  return (
    <div className="w-full animate-fade-in-up">
      {/* 标题区域 */}
      <div className="mb-2.5 px-0.5">
        <span className="text-xs font-medium dark:text-claude-darkTextSecondary text-claude-textSecondary">
          {action.label}
        </span>
      </div>

      {/* 提示词卡片网格布局 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {action.prompts.map((prompt) => {
          // 判断当前提示词是否被选中
          const isPromptSelected = selectedPromptId === prompt.id;

          return (
            <button
              key={prompt.id}
              type="button"
              onClick={() => handlePromptClick(prompt)}
              className={`
                group relative flex flex-col items-start gap-1.5 px-3.5 py-3 rounded-lg
                border text-left transition-all duration-200
                ${
                  isPromptSelected
                    ? 'dark:bg-claude-accentMuted bg-claude-accentMuted border-claude-accent/50'
                    : 'dark:bg-claude-darkSurface bg-claude-surface dark:border-claude-darkBorder border-claude-border dark:hover:border-claude-darkBorder hover:border-claude-border dark:hover:bg-claude-darkSurfaceHover hover:bg-claude-surfaceHover'
                }
              `}
            >
              {/* 提示词标题和箭头图标 */}
              <div className="flex items-center justify-between w-full">
                <span className={`text-sm font-medium ${isPromptSelected ? 'text-claude-accent' : 'dark:text-claude-darkText text-claude-text'}`}>
                  {prompt.label}
                </span>
                {/* 右箭头图标，选中或悬停时显示 */}
                <ArrowRightIcon
                  className={`
                    w-3.5 h-3.5 transition-all duration-200
                    ${
                      isPromptSelected
                        ? 'text-claude-accent translate-x-0 opacity-100'
                        : 'dark:text-claude-darkTextSecondary text-claude-textSecondary -translate-x-1 opacity-0 group-hover:translate-x-0 group-hover:opacity-100'
                    }
                  `}
                />
              </div>

              {/* 提示词描述（可选） */}
              {prompt.description && (
                <p className="text-xs dark:text-claude-darkTextSecondary text-claude-textSecondary line-clamp-2">
                  {prompt.description}
                </p>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default PromptPanel;
