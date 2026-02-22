import React, { useState, useRef, useEffect } from 'react';
import { ChevronDownIcon } from '@heroicons/react/24/outline';

/**
 * 主题选择器组件属性接口
 */
interface ThemedSelectProps {
  id: string; // 元素唯一标识符
  value: string; // 当前选中的值
  onChange: (value: string) => void; // 值变更时的回调函数
  options: { value: string; label: string }[]; // 选项列表，包含值和标签
  className?: string; // 可选的自定义样式类名
  label?: string; // 可选的标签文本
}

const ThemedSelect: React.FC<ThemedSelectProps> = ({
  id,
  value,
  onChange,
  options,
  className = '',
  label,
}) => {
  const [isOpen, setIsOpen] = useState(false); // 下拉菜单的打开状态
  const dropdownRef = useRef<HTMLDivElement>(null); // 下拉菜单容器的引用

  // 查找当前选中的选项对象
  const selectedOption = options.find(option => option.value === value);

  // 处理点击下拉菜单外部区域以关闭菜单
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      // 如果点击的不是下拉菜单容器内的元素，则关闭菜单
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    // 添加鼠标按下事件监听器
    document.addEventListener('mousedown', handleClickOutside);
    // 组件卸载时移除事件监听器
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // 处理选项点击事件
  const handleOptionClick = (optionValue: string) => {
    onChange(optionValue); // 触发值变更回调
    setIsOpen(false); // 关闭下拉菜单
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <div className="flex items-center space-x-3">
        {label && (
          <label htmlFor={id} className="text-sm font-medium dark:text-claude-darkText text-claude-text whitespace-nowrap">
            {label}
          </label>
        )}
        <div className="flex-1">
          <button
            id={id}
            type="button"
            onClick={() => setIsOpen(!isOpen)}
            className={`flex items-center justify-between w-full rounded-lg dark:bg-claude-darkSurface bg-claude-surface dark:border-claude-darkBorder border-claude-border border focus:border-claude-accent focus:ring-1 focus:ring-claude-accent/40 dark:text-claude-darkText text-claude-text px-4 py-2.5 text-sm ${className}`}
            aria-haspopup="listbox"
            aria-expanded={isOpen}
          >
            <span>{selectedOption?.label || value}</span>
            <ChevronDownIcon className="w-4 h-4 ml-2" />
          </button>

          {isOpen && (
            <div className="absolute z-10 w-full mt-1 overflow-auto rounded-md popover-enter shadow-popover max-h-60 focus:outline-none">
              <ul
                className="py-1 overflow-auto text-sm dark:bg-claude-darkSurface bg-claude-surface border dark:border-claude-darkBorder border-claude-border rounded-lg"
                role="listbox"
                aria-labelledby={id}
              >
                {options.map((option) => (
                  <li
                    key={option.value}
                    className={`cursor-pointer select-none relative py-1.5 pl-3 pr-9 dark:hover:bg-claude-darkSurfaceHover hover:bg-claude-surfaceHover ${
                      option.value === value ? 'dark:bg-claude-darkSurfaceHover bg-claude-surfaceHover' : ''
                    }`}
                    role="option"
                    aria-selected={option.value === value}
                    onClick={() => handleOptionClick(option.value)}
                  >
                    <span className={`block truncate dark:text-claude-darkText text-claude-text ${
                      option.value === value ? 'font-medium' : 'font-normal'
                    }`}>
                      {option.label}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ThemedSelect; 