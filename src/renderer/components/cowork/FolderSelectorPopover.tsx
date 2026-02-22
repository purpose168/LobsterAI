import React, { useState, useEffect, useRef, useCallback } from 'react';
import { FolderPlusIcon, ClockIcon, ChevronRightIcon, FolderIcon } from '@heroicons/react/24/outline';
import { i18nService } from '../../services/i18n';
import { coworkService } from '../../services/cowork';
import { getCompactFolderName } from '../../utils/path';

// 文件夹路径的自定义提示工具
interface PathTooltipProps {
  path: string;
  anchorRect: DOMRect | null;
  visible: boolean;
}

const PathTooltip: React.FC<PathTooltipProps> = ({ path, anchorRect, visible }) => {
  if (!visible || !anchorRect) return null;

  // 将提示工具定位在项目上方，居中显示
  const style: React.CSSProperties = {
    position: 'fixed',
    top: anchorRect.top - 8,
    left: anchorRect.left + anchorRect.width / 2,
    transform: 'translate(-50%, -100%)',
    maxWidth: '400px',
    zIndex: 100,
  };

  return (
    <div
      style={style}
      className="px-3.5 py-2.5 text-[13px] leading-relaxed rounded-xl shadow-xl dark:bg-claude-darkBg bg-claude-bg dark:text-claude-darkText text-claude-text dark:border-claude-darkBorder border-claude-border border break-all pointer-events-none"
    >
      {path}
    </div>
  );
};

interface FolderSelectorPopoverProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectFolder: (path: string) => void;
  anchorRef: React.RefObject<HTMLElement>;
}

const FolderSelectorPopover: React.FC<FolderSelectorPopoverProps> = ({
  isOpen,
  onClose,
  onSelectFolder,
  anchorRef,
}) => {
  const [recentFolders, setRecentFolders] = useState<string[]>([]);
  const [showRecentSubmenu, setShowRecentSubmenu] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [submenuPosition, setSubmenuPosition] = useState({ top: 0, left: 0 });
  const [tooltipState, setTooltipState] = useState<{
    visible: boolean;
    path: string;
    rect: DOMRect | null;
  }>({ visible: false, path: '', rect: null });
  const popoverRef = useRef<HTMLDivElement>(null);
  const submenuRef = useRef<HTMLDivElement>(null);
  const recentFoldersRef = useRef<HTMLDivElement>(null);
  const tooltipTimerRef = useRef<NodeJS.Timeout | null>(null);

  // 组件卸载时清理提示工具定时器
  useEffect(() => {
    return () => {
      if (tooltipTimerRef.current) {
        clearTimeout(tooltipTimerRef.current);
      }
    };
  }, []);

  // 当弹出窗口打开时加载最近使用的文件夹
  useEffect(() => {
    if (isOpen) {
      const loadRecentFolders = async () => {
        setIsLoading(true);
        try {
          const folders = await coworkService.getRecentCwds(10);
          setRecentFolders(folders);
        } catch (error) {
          console.error('加载最近文件夹失败:', error);
          setRecentFolders([]);
        } finally {
          setIsLoading(false);
        }
      };
      loadRecentFolders();
    } else {
      setShowRecentSubmenu(false);
      // 弹出窗口关闭时清除提示工具
      setTooltipState({ visible: false, path: '', rect: null });
      if (tooltipTimerRef.current) {
        clearTimeout(tooltipTimerRef.current);
        tooltipTimerRef.current = null;
      }
    }
  }, [isOpen]);

  // 处理点击外部区域
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      const isInsidePopover = popoverRef.current?.contains(target);
      const isInsideSubmenu = submenuRef.current?.contains(target);
      const isInsideAnchor = anchorRef.current?.contains(target);

      if (!isInsidePopover && !isInsideSubmenu && !isInsideAnchor) {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, onClose, anchorRef]);

  // 处理 ESC 键
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

  // 计算子菜单相对于"最近文件夹"按钮的位置
  useEffect(() => {
    if (showRecentSubmenu && recentFoldersRef.current) {
      const rect = recentFoldersRef.current.getBoundingClientRect();
      setSubmenuPosition({
        top: rect.top,
        left: rect.right + 4, // 4px 间距
      });
    }
  }, [showRecentSubmenu]);

  const handleAddFolder = async () => {
    try {
      const result = await window.electron.dialog.selectDirectory();
      if (result.success && result.path) {
        onSelectFolder(result.path);
        onClose();
      }
    } catch (error) {
      console.error('选择目录失败:', error);
    }
  };

  const handleSelectRecentFolder = (path: string) => {
    onSelectFolder(path);
    onClose();
  };

  const handleFolderMouseEnter = useCallback((path: string, event: React.MouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    // 清除任何现有的定时器
    if (tooltipTimerRef.current) {
      clearTimeout(tooltipTimerRef.current);
    }
    // 延迟显示提示工具
    tooltipTimerRef.current = setTimeout(() => {
      setTooltipState({
        visible: true,
        path: getCompactFolderName(path, 120) || i18nService.t('noFolderSelected'),
        rect,
      });
    }, 300);
  }, []);

  const handleFolderMouseLeave = useCallback(() => {
    if (tooltipTimerRef.current) {
      clearTimeout(tooltipTimerRef.current);
      tooltipTimerRef.current = null;
    }
    setTooltipState({ visible: false, path: '', rect: null });
  }, []);

  const truncatePath = (path: string, maxLength = 40): string => {
    if (!path) return i18nService.t('noFolderSelected');
    return getCompactFolderName(path, maxLength) || i18nService.t('noFolderSelected');
  };

  if (!isOpen) return null;

  return (
    <>
      {/* 主弹出窗口 */}
      <div
        ref={popoverRef}
        className="absolute bottom-full left-0 mb-2 w-56 rounded-lg border dark:border-claude-darkBorder border-claude-border dark:bg-claude-darkSurface bg-claude-surface shadow-lg z-50"
      >
        {/* 添加文件夹选项 */}
        <button
          onClick={handleAddFolder}
          className="w-full flex items-center gap-3 px-3 py-2.5 text-sm dark:text-claude-darkText text-claude-text dark:hover:bg-claude-darkSurfaceHover hover:bg-claude-surfaceHover transition-colors rounded-t-lg"
        >
          <FolderPlusIcon className="h-4 w-4 dark:text-claude-darkTextSecondary text-claude-textSecondary" />
          <span>{i18nService.t('addFolder')}</span>
        </button>

        {/* 最近文件夹选项 */}
        <div
          ref={recentFoldersRef}
          className="relative"
          onMouseEnter={() => setShowRecentSubmenu(true)}
          onMouseLeave={() => setShowRecentSubmenu(false)}
        >
          <button
            className="w-full flex items-center justify-between gap-3 px-3 py-2.5 text-sm dark:text-claude-darkText text-claude-text dark:hover:bg-claude-darkSurfaceHover hover:bg-claude-surfaceHover transition-colors rounded-b-lg"
          >
            <div className="flex items-center gap-3">
              <ClockIcon className="h-4 w-4 dark:text-claude-darkTextSecondary text-claude-textSecondary" />
              <span>{i18nService.t('recentFolders')}</span>
            </div>
            <ChevronRightIcon className="h-3 w-3 dark:text-claude-darkTextSecondary text-claude-textSecondary" />
          </button>
        </div>
      </div>

      {/* 最近文件夹子菜单 - 以类似 portal 的固定元素形式渲染 */}
      {showRecentSubmenu && (
        <div
          ref={submenuRef}
          className="fixed w-64 max-h-80 overflow-y-auto rounded-lg border dark:border-claude-darkBorder border-claude-border dark:bg-claude-darkSurface bg-claude-surface shadow-lg z-[60]"
          style={{ top: submenuPosition.top, left: submenuPosition.left }}
          onMouseEnter={() => setShowRecentSubmenu(true)}
          onMouseLeave={() => setShowRecentSubmenu(false)}
        >
          {isLoading ? (
            <div className="px-3 py-2.5 text-sm dark:text-claude-darkTextSecondary text-claude-textSecondary">
              {i18nService.t('loading')}
            </div>
          ) : recentFolders.length === 0 ? (
            <div className="px-3 py-2.5 text-sm dark:text-claude-darkTextSecondary text-claude-textSecondary">
              {i18nService.t('noRecentFolders')}
            </div>
          ) : (
            recentFolders.map((folder, index) => (
              <button
                key={index}
                onClick={() => handleSelectRecentFolder(folder)}
                onMouseEnter={(e) => handleFolderMouseEnter(folder, e)}
                onMouseLeave={handleFolderMouseLeave}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm dark:text-claude-darkText text-claude-text dark:hover:bg-claude-darkSurfaceHover hover:bg-claude-surfaceHover transition-colors text-left first:rounded-t-lg last:rounded-b-lg"
              >
                <FolderIcon className="h-4 w-4 flex-shrink-0 dark:text-claude-darkTextSecondary text-claude-textSecondary" />
                <span className="truncate">{truncatePath(folder)}</span>
              </button>
            ))
          )}
        </div>
      )}

      {/* 路径提示工具 */}
      <PathTooltip
        path={tooltipState.path}
        anchorRect={tooltipState.rect}
        visible={tooltipState.visible}
      />
    </>
  );
};

export default FolderSelectorPopover;
