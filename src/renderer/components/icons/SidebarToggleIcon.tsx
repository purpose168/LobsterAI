import React from 'react';

/**
 * 侧边栏切换图标组件
 * 根据侧边栏的折叠状态显示不同的图标样式
 * @param className - 可选的CSS类名
 * @param isCollapsed - 侧边栏是否处于折叠状态
 */
const SidebarToggleIcon: React.FC<{ className?: string; isCollapsed: boolean }> = ({ className, isCollapsed }) => {
  // 根据折叠状态计算分隔线的X坐标位置
  // 折叠时分隔线靠左（3.5），展开时分隔线靠右（5.5）
  const dividerX = isCollapsed ? 3.5 : 5.5;
  
  return (
    <svg 
      className={className} 
      viewBox="0 0 16 16" 
      fill="none" 
      stroke="currentColor" 
      strokeWidth="1.25" 
      strokeLinecap="round" 
      strokeLinejoin="round"
    >
      {/* 外框矩形：圆角边框 */}
      <rect x="1.5" y="2" width="13" height="12" rx="2" />
      {/* 垂直分隔线：位置随折叠状态变化 */}
      <line x1={dividerX} y1="2" x2={dividerX} y2="14" />
    </svg>
  );
};

export default SidebarToggleIcon;
