import React, { useState, useRef, useCallback, useLayoutEffect, useEffect } from 'react';

/**
 * Tooltip 组件属性接口
 * 定义了工具提示组件所需的所有属性
 */
interface TooltipProps {
  /** 工具提示的内容，可以是文本或 React 节点 */
  content: React.ReactNode;
  /** 触发工具提示的子元素 */
  children: React.ReactNode;
  /** 自定义 CSS 类名 */
  className?: string;
  /** 工具提示的位置：顶部、底部、左侧或右侧 */
  position?: 'top' | 'bottom' | 'left' | 'right';
  /** 显示工具提示的延迟时间（毫秒） */
  delay?: number;
  /** 工具提示的最大宽度 */
  maxWidth?: string;
  /** 是否禁用工具提示 */
  disabled?: boolean;
}

/**
 * Tooltip 工具提示组件
 * 提供一个可自定义位置、延迟和样式的悬浮提示框
 * 支持自动调整位置以避免超出视口
 */
const Tooltip: React.FC<TooltipProps> = ({
  content,
  children,
  className = '',
  position = 'top',
  delay = 300,
  maxWidth = '280px',
  disabled = false,
}) => {
  // 工具提示的可见性状态
  const [isVisible, setIsVisible] = useState(false);
  // 工具提示的样式对象，用于动态定位
  const [tooltipStyle, setTooltipStyle] = useState<React.CSSProperties | null>(null);
  // 延迟显示工具提示的定时器引用
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  // 包裹子元素的容器引用
  const wrapperRef = useRef<HTMLDivElement>(null);
  // 工具提示元素的引用
  const tooltipRef = useRef<HTMLDivElement>(null);

  /**
   * 显示工具提示
   * 在指定的延迟时间后设置工具提示为可见状态
   */
  const showTooltip = useCallback(() => {
    if (disabled) return;
    timeoutRef.current = setTimeout(() => {
      setIsVisible(true);
    }, delay);
  }, [delay, disabled]);

  /**
   * 隐藏工具提示
   * 清除定时器并将工具提示设置为不可见状态
   */
  const hideTooltip = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setIsVisible(false);
  }, []);

  /**
   * 更新工具提示的位置
   * 计算工具提示的最佳显示位置，确保不超出视口边界
   * 如果首选位置不合适，会自动尝试其他位置
   */
  const updatePosition = useCallback(() => {
    if (!wrapperRef.current || !tooltipRef.current) return;
    
    // 获取触发元素和工具提示元素的边界矩形
    const anchorRect = wrapperRef.current.getBoundingClientRect();
    const tooltipRect = tooltipRef.current.getBoundingClientRect();
    
    // 获取视口的宽度和高度
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    
    // 工具提示与视口边缘的最小间距
    const margin = 8;
    
    // 定义工具提示位置类型
    type TooltipPosition = 'top' | 'bottom' | 'left' | 'right';

    // 计算各个位置的具体坐标
    const positions = {
      top: {
        top: anchorRect.top - tooltipRect.height - margin,
        left: anchorRect.left + anchorRect.width / 2 - tooltipRect.width / 2,
      },
      bottom: {
        top: anchorRect.bottom + margin,
        left: anchorRect.left + anchorRect.width / 2 - tooltipRect.width / 2,
      },
      left: {
        top: anchorRect.top + anchorRect.height / 2 - tooltipRect.height / 2,
        left: anchorRect.left - tooltipRect.width - margin,
      },
      right: {
        top: anchorRect.top + anchorRect.height / 2 - tooltipRect.height / 2,
        left: anchorRect.right + margin,
      },
    };

    /**
     * 检查指定位置是否适合显示工具提示
     * 确保工具提示完全在视口内
     */
    const fits = (pos: { top: number; left: number }) =>
      pos.top >= margin &&
      pos.left >= margin &&
      pos.top + tooltipRect.height <= viewportHeight - margin &&
      pos.left + tooltipRect.width <= viewportWidth - margin;

    // 定义位置回退顺序映射表，优先使用首选位置
    const fallbackOrderMap: Record<TooltipPosition, TooltipPosition[]> = {
      top: ['top', 'bottom', 'right', 'left'],
      bottom: ['bottom', 'top', 'right', 'left'],
      left: ['left', 'right', 'top', 'bottom'],
      right: ['right', 'left', 'top', 'bottom'],
    };
    const fallbackOrder = fallbackOrderMap[position];

    // 查找第一个适合的位置
    let chosen = positions[fallbackOrder[0]];
    for (const key of fallbackOrder) {
      const candidate = positions[key];
      if (fits(candidate)) {
        chosen = candidate;
        break;
      }
    }

    // 将位置限制在视口范围内，防止溢出
    const clampedLeft = Math.min(
      Math.max(chosen.left, margin),
      viewportWidth - tooltipRect.width - margin
    );
    const clampedTop = Math.min(
      Math.max(chosen.top, margin),
      viewportHeight - tooltipRect.height - margin
    );

    // 设置工具提示的最终样式
    setTooltipStyle({
      position: 'fixed',
      top: Math.round(clampedTop),
      left: Math.round(clampedLeft),
      maxWidth,
      width: 'max-content',
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
    });
  }, [maxWidth, position]);

  /**
   * 当工具提示变为可见时，立即更新其位置
   * 使用 useLayoutEffect 确保在浏览器绘制前完成位置计算
   */
  useLayoutEffect(() => {
    if (!isVisible) return;
    updatePosition();
  }, [isVisible, updatePosition, content]);

  /**
   * 监听窗口大小变化和滚动事件，实时更新工具提示位置
   * 确保工具提示在用户交互过程中始终保持正确的位置
   */
  useEffect(() => {
    if (!isVisible) return;
    const handleUpdate = () => updatePosition();
    window.addEventListener('resize', handleUpdate);
    window.addEventListener('scroll', handleUpdate, true);
    return () => {
      window.removeEventListener('resize', handleUpdate);
      window.removeEventListener('scroll', handleUpdate, true);
    };
  }, [isVisible, updatePosition]);

  return (
    <div
      ref={wrapperRef}
      className={`relative inline-block ${className}`}
      onMouseEnter={showTooltip}
      onMouseLeave={hideTooltip}
    >
      {children}
      {isVisible && content && (
        <div
          ref={tooltipRef}
          className={`absolute z-[100] px-3.5 py-2.5 text-[13px] leading-relaxed rounded-xl shadow-xl
            dark:bg-claude-darkBg bg-claude-bg
            dark:text-claude-darkText text-claude-text
            dark:border-claude-darkBorder border-claude-border border`}
          style={tooltipStyle ?? { maxWidth }}
        >
          {content}
        </div>
      )}
    </div>
  );
};

export default Tooltip;
