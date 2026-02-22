/**
 * 快捷操作栏组件
 * 用于显示一组可点击的快捷操作按钮
 */
import React from 'react';
import type { LocalizedQuickAction } from '../../types/quickAction';
import {
  PresentationChartBarIcon,
  GlobeAltIcon,
  DevicePhoneMobileIcon,
  ChartBarIcon,
  AcademicCapIcon,
} from '@heroicons/react/24/outline';

/**
 * QuickActionBar 组件的属性接口
 * @property actions - 本地化的快捷操作数组
 * @property onActionSelect - 操作选择回调函数，当用户点击某个操作时触发
 */
interface QuickActionBarProps {
  actions: LocalizedQuickAction[];
  onActionSelect: (actionId: string) => void;
}

/**
 * 图标映射表
 * 将图标名称字符串映射到实际的 React 图标组件
 * 用于动态渲染不同类型的快捷操作图标
 */
const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  PresentationChartBarIcon,
  GlobeAltIcon,
  DevicePhoneMobileIcon,
  ChartBarIcon,
  AcademicCapIcon,
};

/**
 * 快捷操作栏组件
 * 渲染一组快捷操作按钮，每个按钮包含图标和文本标签
 * 支持深色模式，并提供悬停交互效果
 * 
 * @param props - 组件属性
 * @param props.actions - 快捷操作列表
 * @param props.onActionSelect - 操作选择处理函数
 * @returns 快捷操作栏组件，如果没有操作则返回 null
 */
const QuickActionBar: React.FC<QuickActionBarProps> = ({ actions, onActionSelect }) => {
  // 如果没有可用的快捷操作，不渲染任何内容
  if (actions.length === 0) {
    return null;
  }

  return (
    // 外层容器：使用 flexbox 布局，支持换行，居中对齐，按钮间距为 2.5
    <div className="flex flex-wrap items-center justify-center gap-2.5">
      {actions.map((action) => {
        // 根据操作配置获取对应的图标组件
        const IconComponent = iconMap[action.icon];

        return (
          <button
            key={action.id}
            type="button"
            onClick={() => onActionSelect(action.id)}
            // 按钮样式：包含图标和文本，支持深色模式和悬停效果
            className="flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-medium transition-all duration-200 ease-out dark:bg-claude-darkSurface bg-claude-surface dark:border-claude-darkBorder border-claude-border dark:text-claude-darkTextSecondary text-claude-textSecondary dark:hover:bg-claude-darkSurfaceHover hover:bg-claude-surfaceHover hover:border-claude-accent/40"
          >
            {/* 如果图标组件存在，则渲染图标 */}
            {IconComponent && (
              <IconComponent className="w-4 h-4 dark:text-claude-darkTextSecondary text-claude-textSecondary" />
            )}
            {/* 操作文本标签 */}
            <span>{action.label}</span>
          </button>
        );
      })}
    </div>
  );
};

export default QuickActionBar;
