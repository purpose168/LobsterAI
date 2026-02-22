import React from 'react';

/**
 * 撰写图标组件
 * 显示一个带有编辑笔的方框图标，通常用于表示撰写、编辑或创建新内容的操作
 * @param className - 可选的 CSS 类名，用于自定义图标样式
 */
const ComposeIcon: React.FC<{ className?: string }> = ({ className }) => {
  return (
    // SVG 图标：包含一个方框和一支编辑笔
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {/* 方框路径：表示文档或内容区域 */}
      <path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      {/* 编辑笔路径：表示撰写或编辑操作 */}
      <path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z" />
    </svg>
  );
};

export default ComposeIcon;
