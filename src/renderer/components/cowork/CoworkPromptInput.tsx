import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { PaperAirplaneIcon, StopIcon, FolderIcon } from '@heroicons/react/24/solid';
import { PaperClipIcon, XMarkIcon } from '@heroicons/react/24/outline';
import ModelSelector from '../ModelSelector';
import FolderSelectorPopover from './FolderSelectorPopover';
import { SkillsButton, ActiveSkillBadge } from '../skills';
import { i18nService } from '../../services/i18n';
import { skillService } from '../../services/skill';
import { RootState } from '../../store';
import { setDraftPrompt } from '../../store/slices/coworkSlice';
import { setSkills, toggleActiveSkill } from '../../store/slices/skillSlice';
import { Skill } from '../../types/skill';
import { getCompactFolderName } from '../../utils/path';

/**
 * 协作附件类型定义
 */
type CoworkAttachment = {
  /** 文件路径 */
  path: string;
  /** 文件名 */
  name: string;
};

const INPUT_FILE_LABEL = '输入文件';

/**
 * 从文件路径中提取文件名
 * @param path 文件路径
 * @returns 文件名
 */
const getFileNameFromPath = (path: string): string => {
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] || path;
};

/**
 * 从技能路径中提取技能目录
 * @param skillPath 技能路径
 * @returns 技能目录路径
 */
const getSkillDirectoryFromPath = (skillPath: string): string => {
  const normalized = skillPath.trim().replace(/\\/g, '/');
  return normalized.replace(/\/SKILL\.md$/i, '') || normalized;
};

/**
 * 构建内联技能提示
 * @param skill 技能对象
 * @returns 格式化的技能提示字符串
 */
const buildInlinedSkillPrompt = (skill: Skill): string => {
  const skillDirectory = getSkillDirectoryFromPath(skill.skillPath);
  return [
    `## 技能: ${skill.name}`,
    '<skill_context>',
    `  <location>${skill.skillPath}</location>`,
    `  <directory>${skillDirectory}</directory>`,
    '  <path_rules>',
    '    相对于 <directory> 解析此技能中的相对文件引用。',
    '    不要假设技能位于当前工作区目录下。',
    '  </path_rules>',
    '</skill_context>',
    '',
    skill.prompt,
  ].join('\n');
};

/**
 * 协作提示输入组件的引用接口
 */
export interface CoworkPromptInputRef {
  /** 设置输入框值 */
  setValue: (value: string) => void;
  /** 聚焦输入框 */
  focus: () => void;
}

/**
 * 协作提示输入组件的属性接口
 */
interface CoworkPromptInputProps {
  /** 提交回调函数 */
  onSubmit: (prompt: string, skillPrompt?: string) => void;
  /** 停止回调函数 */
  onStop?: () => void;
  /** 是否正在流式传输 */
  isStreaming?: boolean;
  /** 占位符文本 */
  placeholder?: string;
  /** 是否禁用 */
  disabled?: boolean;
  /** 输入框尺寸 */
  size?: 'normal' | 'large';
  /** 工作目录 */
  workingDirectory?: string;
  /** 工作目录变更回调 */
  onWorkingDirectoryChange?: (dir: string) => void;
  /** 是否显示文件夹选择器 */
  showFolderSelector?: boolean;
  /** 是否显示模型选择器 */
  showModelSelector?: boolean;
  /** 管理技能回调 */
  onManageSkills?: () => void;
}

const CoworkPromptInput = React.forwardRef<CoworkPromptInputRef, CoworkPromptInputProps>(
  (props, ref) => {
    const {
      onSubmit,
      onStop,
      isStreaming = false,
      placeholder = '请输入您的任务...',
      disabled = false,
      size = 'normal',
      workingDirectory = '',
      onWorkingDirectoryChange,
      showFolderSelector = false,
      showModelSelector = false,
      onManageSkills,
    } = props;
    const dispatch = useDispatch();
    const draftPrompt = useSelector((state: RootState) => state.cowork.draftPrompt);
    const [value, setValue] = useState(draftPrompt);
    const [attachments, setAttachments] = useState<CoworkAttachment[]>([]);
    const [showFolderMenu, setShowFolderMenu] = useState(false);
    const [showFolderRequiredWarning, setShowFolderRequiredWarning] = useState(false);
    const [isDraggingFiles, setIsDraggingFiles] = useState(false);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const folderButtonRef = useRef<HTMLButtonElement>(null);
    const dragDepthRef = useRef(0);

  // 暴露方法给父组件
  React.useImperativeHandle(ref, () => ({
    setValue: (newValue: string) => {
      setValue(newValue);
      // 触发自动调整高度
      requestAnimationFrame(() => {
        const textarea = textareaRef.current;
        if (textarea) {
          textarea.style.height = 'auto';
          textarea.style.height = `${Math.min(Math.max(textarea.scrollHeight, minHeight), maxHeight)}px`;
        }
      });
    },
    focus: () => {
      textareaRef.current?.focus();
    },
  }));

  const activeSkillIds = useSelector((state: RootState) => state.skill.activeSkillIds);
  const skills = useSelector((state: RootState) => state.skill.skills);

  const isLarge = size === 'large';
  const minHeight = isLarge ? 60 : 24;
  const maxHeight = isLarge ? 200 : 200;

  // 挂载时加载技能列表
  useEffect(() => {
    const loadSkills = async () => {
      const loadedSkills = await skillService.loadSkills();
      dispatch(setSkills(loadedSkills));
    };
    loadSkills();
  }, [dispatch]);

  // 监听技能变更事件
  useEffect(() => {
    const unsubscribe = skillService.onSkillsChanged(async () => {
      const loadedSkills = await skillService.loadSkills();
      dispatch(setSkills(loadedSkills));
    });
    return () => {
      unsubscribe();
    };
  }, [dispatch]);

  // 自动调整文本框高度
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(Math.max(textarea.scrollHeight, minHeight), maxHeight)}px`;
    }
  }, [value, minHeight, maxHeight]);

  useEffect(() => {
    const handleFocusInput = (event: Event) => {
      const detail = (event as CustomEvent<{ clear?: boolean }>).detail;
      const shouldClear = detail?.clear ?? true;
      if (shouldClear) {
        setValue('');
        setAttachments([]);
      }
      requestAnimationFrame(() => {
        textareaRef.current?.focus();
      });
    };
    window.addEventListener('cowork:focus-input', handleFocusInput);
    return () => {
      window.removeEventListener('cowork:focus-input', handleFocusInput);
    };
  }, []);

  // 当工作目录变化时，隐藏文件夹必选警告
  useEffect(() => {
    if (workingDirectory?.trim()) {
      setShowFolderRequiredWarning(false);
    }
  }, [workingDirectory]);

  // 同步草稿提示到 Redux 状态
  useEffect(() => {
    if (value !== draftPrompt) {
      dispatch(setDraftPrompt(value));
    }
  }, [value, draftPrompt, dispatch]);

  /**
   * 处理提交操作
   * 验证输入并构建最终提示，包括附件和技能提示
   */
  const handleSubmit = useCallback(() => {
    if (showFolderSelector && !workingDirectory?.trim()) {
      setShowFolderRequiredWarning(true);
      return;
    }

    const trimmedValue = value.trim();
    if ((!trimmedValue && attachments.length === 0) || isStreaming || disabled) return;
    setShowFolderRequiredWarning(false);

    // 获取已激活技能的提示并合并
    const activeSkills = activeSkillIds
      .map(id => skills.find(s => s.id === id))
      .filter((s): s is Skill => s !== undefined);
    const skillPrompt = activeSkills.length > 0
      ? activeSkills.map(buildInlinedSkillPrompt).join('\n\n')
      : undefined;

    const attachmentLines = attachments.map((attachment) =>
      `${INPUT_FILE_LABEL}: ${attachment.path}`
    ).join('\n');
    const finalPrompt = trimmedValue
      ? (attachmentLines ? `${trimmedValue}\n\n${attachmentLines}` : trimmedValue)
      : attachmentLines;

    onSubmit(finalPrompt, skillPrompt);
    setValue('');
    dispatch(setDraftPrompt(''));
    setAttachments([]);
  }, [value, isStreaming, disabled, onSubmit, activeSkillIds, skills, attachments, showFolderSelector, workingDirectory, dispatch]);

  /**
   * 选择技能处理函数
   * @param skill 选中的技能
   */
  const handleSelectSkill = useCallback((skill: Skill) => {
    dispatch(toggleActiveSkill(skill.id));
  }, [dispatch]);

  /**
   * 管理技能处理函数
   */
  const handleManageSkills = useCallback(() => {
    if (onManageSkills) {
      onManageSkills();
    }
  }, [onManageSkills]);

  /**
   * 处理键盘按下事件
   * Enter 键提交，Shift+Enter 换行
   */
  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // 处理中文输入法状态
    const isComposing = event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229;
    if (event.key === 'Enter' && !event.shiftKey && !isComposing && !isStreaming && !disabled) {
      event.preventDefault();
      handleSubmit();
    }
  };

  /**
   * 停止按钮点击处理函数
   */
  const handleStopClick = () => {
    if (onStop) {
      onStop();
    }
  };

  const containerClass = isLarge
    ? 'relative rounded-2xl border dark:border-claude-darkBorder border-claude-border dark:bg-claude-darkSurface bg-claude-surface shadow-card focus-within:shadow-elevated focus-within:ring-1 focus-within:ring-claude-accent/40 focus-within:border-claude-accent'
    : 'relative flex items-end gap-2 p-3 rounded-xl border dark:border-claude-darkBorder border-claude-border dark:bg-claude-darkSurface bg-claude-surface';

  const textareaClass = isLarge
    ? `w-full resize-none bg-transparent px-4 pt-2.5 pb-2 dark:text-claude-darkText text-claude-text placeholder:dark:text-claude-darkTextSecondary/60 placeholder:text-claude-textSecondary/60 focus:outline-none text-[15px] leading-6 min-h-[${minHeight}px] max-h-[${maxHeight}px]`
    : 'flex-1 resize-none bg-transparent dark:text-claude-darkText text-claude-text placeholder:dark:text-claude-darkTextSecondary placeholder:text-claude-textSecondary focus:outline-none text-sm leading-relaxed min-h-[24px] max-h-[200px]';

  /**
   * 截断路径显示
   * @param path 文件路径
   * @param maxLength 最大长度
   * @returns 截断后的路径
   */
  const truncatePath = (path: string, maxLength = 30): string => {
    if (!path) return i18nService.t('noFolderSelected');
    return getCompactFolderName(path, maxLength) || i18nService.t('noFolderSelected');
  };

  /**
   * 文件夹选择处理函数
   * @param path 选中的文件夹路径
   */
  const handleFolderSelect = (path: string) => {
    if (onWorkingDirectoryChange) {
      onWorkingDirectoryChange(path);
    }
  };

  /**
   * 添加附件
   * @param path 文件路径
   */
  const addAttachment = useCallback((path: string) => {
    if (!path) return;
    setAttachments((prev) => {
      if (prev.some((attachment) => attachment.path === path)) {
        return prev;
      }
      return [...prev, { path, name: getFileNameFromPath(path) }];
    });
  }, []);

  /**
   * 将文件转换为 Base64 编码
   * @param file 要转换的文件对象
   * @returns Base64 编码的字符串
   */
  const fileToBase64 = useCallback((file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result;
        if (typeof result !== 'string') {
          reject(new Error('读取文件失败'));
          return;
        }
        const commaIndex = result.indexOf(',');
        resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result);
      };
      reader.onerror = () => reject(reader.error ?? new Error('读取文件失败'));
      reader.readAsDataURL(file);
    });
  }, []);

  /**
   * 获取原生文件路径
   * @param file 文件对象
   * @returns 原生文件路径或 null
   */
  const getNativeFilePath = useCallback((file: File): string | null => {
    const maybePath = (file as File & { path?: string }).path;
    if (typeof maybePath === 'string' && maybePath.trim()) {
      return maybePath;
    }
    return null;
  }, []);

  /**
   * 保存内联文件到临时目录
   * @param file 要保存的文件对象
   * @returns 保存后的文件路径或 null
   */
  const saveInlineFile = useCallback(async (file: File): Promise<string | null> => {
    try {
      const dataBase64 = await fileToBase64(file);
      if (!dataBase64) {
        return null;
      }
      const result = await window.electron.dialog.saveInlineFile({
        dataBase64,
        fileName: file.name,
        mimeType: file.type,
        cwd: workingDirectory,
      });
      if (result.success && result.path) {
        return result.path;
      }
      return null;
    } catch (error) {
      console.error('保存内联文件失败:', error);
      return null;
    }
  }, [fileToBase64, workingDirectory]);

  /**
   * 处理传入的文件列表
   * @param fileList 文件列表
   */
  const handleIncomingFiles = useCallback(async (fileList: FileList | File[]) => {
    if (disabled || isStreaming) return;
    const files = Array.from(fileList ?? []);
    if (files.length === 0) return;

    for (const file of files) {
      const nativePath = getNativeFilePath(file);
      if (nativePath) {
        addAttachment(nativePath);
        continue;
      }

      const stagedPath = await saveInlineFile(file);
      if (stagedPath) {
        addAttachment(stagedPath);
      }
    }
  }, [addAttachment, disabled, getNativeFilePath, isStreaming, saveInlineFile]);

  /**
   * 处理添加文件按钮点击
   */
  const handleAddFile = useCallback(async () => {
    try {
      const result = await window.electron.dialog.selectFile({
        title: i18nService.t('coworkAddFile'),
      });
      if (result.success && result.path) {
        addAttachment(result.path);
      }
    } catch (error) {
      console.error('选择文件失败:', error);
    }
  }, [addAttachment]);

  /**
   * 移除附件
   * @param path 要移除的附件路径
   */
  const handleRemoveAttachment = useCallback((path: string) => {
    setAttachments((prev) => prev.filter((attachment) => attachment.path !== path));
  }, []);

  /**
   * 检查数据传输对象是否包含文件
   * @param dataTransfer 数据传输对象
   * @returns 是否包含文件
   */
  const hasFileTransfer = (dataTransfer: DataTransfer | null): boolean => {
    if (!dataTransfer) return false;
    if (dataTransfer.files.length > 0) return true;
    return Array.from(dataTransfer.types).includes('Files');
  };

  /**
   * 处理拖拽进入事件
   */
  const handleDragEnter = (event: React.DragEvent<HTMLDivElement>) => {
    if (!hasFileTransfer(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current += 1;
    if (!disabled && !isStreaming) {
      setIsDraggingFiles(true);
    }
  };

  /**
   * 处理拖拽悬停事件
   */
  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    if (!hasFileTransfer(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = disabled || isStreaming ? 'none' : 'copy';
  };

  /**
   * 处理拖拽离开事件
   */
  const handleDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    if (!hasFileTransfer(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setIsDraggingFiles(false);
    }
  };

  /**
   * 处理文件放置事件
   */
  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    if (!hasFileTransfer(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current = 0;
    setIsDraggingFiles(false);
    if (disabled || isStreaming) return;
    void handleIncomingFiles(event.dataTransfer.files);
  };

  /**
   * 处理粘贴事件
   */
  const handlePaste = useCallback((event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (disabled || isStreaming) return;
    const files = Array.from(event.clipboardData?.files ?? []);
    if (files.length === 0) return;
    event.preventDefault();
    void handleIncomingFiles(files);
  }, [disabled, handleIncomingFiles, isStreaming]);

  const canSubmit = !disabled && (!!value.trim() || attachments.length > 0);
  const enhancedContainerClass = isDraggingFiles
    ? `${containerClass} ring-2 ring-claude-accent/50 border-claude-accent/60`
    : containerClass;

  return (
    <div className="relative">
      {attachments.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {attachments.map((attachment) => (
              <div
                key={attachment.path}
                className="inline-flex items-center gap-1.5 rounded-full border dark:border-claude-darkBorder border-claude-border dark:bg-claude-darkSurface bg-claude-surface px-2.5 py-1 text-xs dark:text-claude-darkText text-claude-text max-w-full"
                title={attachment.path}
              >
                <PaperClipIcon className="h-3.5 w-3.5 flex-shrink-0" />
                <span className="truncate max-w-[180px]">{attachment.name}</span>
                <button
                  type="button"
                  onClick={() => handleRemoveAttachment(attachment.path)}
                  className="ml-0.5 rounded-full p-0.5 hover:bg-claude-surfaceHover dark:hover:bg-claude-darkSurfaceHover"
                  aria-label={i18nService.t('coworkAttachmentRemove')}
                  title={i18nService.t('coworkAttachmentRemove')}
                >
                  <XMarkIcon className="h-3 w-3" />
                </button>
              </div>
          ))}
        </div>
      )}
      <div
        className={enhancedContainerClass}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {isDraggingFiles && (
          <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-[inherit] bg-claude-accent/10 text-xs font-medium text-claude-accent">
            {i18nService.t('coworkDropFileHint')}
          </div>
        )}
        {isLarge ? (
          <>
            <textarea
              ref={textareaRef}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder={placeholder}
              disabled={disabled}
              rows={isLarge ? 2 : 1}
              className={textareaClass}
              style={{ minHeight: `${minHeight}px` }}
            />
            <div className="flex items-center justify-between px-4 pb-2 pt-1.5">
              <div className="flex items-center gap-2 relative">
                {showFolderSelector && (
                  <>
                    <div className="relative group">
                      <button
                        ref={folderButtonRef as React.RefObject<HTMLButtonElement>}
                        type="button"
                        onClick={() => setShowFolderMenu(!showFolderMenu)}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm dark:text-claude-darkTextSecondary text-claude-textSecondary dark:hover:bg-claude-darkSurfaceHover hover:bg-claude-surfaceHover dark:hover:text-claude-darkText hover:text-claude-text transition-colors"
                      >
                        <FolderIcon className="h-4 w-4" />
                        <span className="max-w-[150px] truncate text-xs">
                          {truncatePath(workingDirectory)}
                        </span>
                      </button>
                      {/* 工具提示 - 当文件夹菜单打开时隐藏 */}
                      {!showFolderMenu && (
                        <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 px-3.5 py-2.5 text-[13px] leading-relaxed rounded-xl shadow-xl dark:bg-claude-darkBg bg-claude-bg dark:text-claude-darkText text-claude-text dark:border-claude-darkBorder border-claude-border border opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 pointer-events-none z-50 max-w-[400px] break-all whitespace-nowrap">
                          {truncatePath(workingDirectory, 120)}
                        </div>
                      )}
                    </div>
                    <FolderSelectorPopover
                      isOpen={showFolderMenu}
                      onClose={() => setShowFolderMenu(false)}
                      onSelectFolder={handleFolderSelect}
                      anchorRef={folderButtonRef as React.RefObject<HTMLElement>}
                    />
                  </>
                )}
                {showModelSelector && <ModelSelector dropdownDirection="up" />}
                <button
                  type="button"
                  onClick={handleAddFile}
                  className="flex items-center justify-center p-1.5 rounded-lg text-sm dark:text-claude-darkTextSecondary text-claude-textSecondary dark:hover:bg-claude-darkSurfaceHover hover:bg-claude-surfaceHover dark:hover:text-claude-darkText hover:text-claude-text transition-colors"
                  title={i18nService.t('coworkAddFile')}
                  aria-label={i18nService.t('coworkAddFile')}
                  disabled={disabled || isStreaming}
                >
                  <PaperClipIcon className="h-4 w-4" />
                </button>
                <SkillsButton
                  onSelectSkill={handleSelectSkill}
                  onManageSkills={handleManageSkills}
                />
                <ActiveSkillBadge />
              </div>
              <div className="flex items-center gap-2">
                {isStreaming ? (
                  <button
                    type="button"
                    onClick={handleStopClick}
                    className="p-2 rounded-xl bg-red-500 hover:bg-red-600 text-white transition-all shadow-subtle hover:shadow-card active:scale-95"
                    aria-label="停止"
                  >
                    <StopIcon className="h-5 w-5" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleSubmit}
                    disabled={!canSubmit}
                    className="p-2 rounded-xl bg-claude-accent hover:bg-claude-accentHover text-white transition-all shadow-subtle hover:shadow-card active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                    aria-label="发送"
                  >
                    <PaperAirplaneIcon className="h-5 w-5" />
                  </button>
                )}
              </div>
            </div>
          </>
        ) : (
          <>
            <textarea
              ref={textareaRef}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder={placeholder}
              disabled={disabled}
              rows={1}
              className={textareaClass}
            />

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={handleAddFile}
                className="flex-shrink-0 p-1.5 rounded-lg dark:text-claude-darkTextSecondary text-claude-textSecondary dark:hover:bg-claude-darkSurfaceHover hover:bg-claude-surfaceHover dark:hover:text-claude-darkText hover:text-claude-text transition-colors"
                title={i18nService.t('coworkAddFile')}
                aria-label={i18nService.t('coworkAddFile')}
                disabled={disabled || isStreaming}
              >
                <PaperClipIcon className="h-4 w-4" />
              </button>
            </div>

            {isStreaming ? (
              <button
                type="button"
                onClick={handleStopClick}
                className="flex-shrink-0 p-2 rounded-lg bg-red-500 hover:bg-red-600 text-white transition-all shadow-subtle hover:shadow-card active:scale-95"
                aria-label="停止"
              >
                <StopIcon className="h-4 w-4" />
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!canSubmit}
                className="flex-shrink-0 p-2 rounded-lg bg-claude-accent hover:bg-claude-accentHover text-white transition-all shadow-subtle hover:shadow-card active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                aria-label="发送"
              >
                <PaperAirplaneIcon className="h-4 w-4" />
              </button>
            )}
          </>
        )}
      </div>
      {showFolderRequiredWarning && (
        <div className="mt-2 text-xs text-red-500 dark:text-red-400">
          {i18nService.t('coworkSelectFolderFirst')}
        </div>
      )}
    </div>
  );
  }
);

CoworkPromptInput.displayName = 'CoworkPromptInput';

export default CoworkPromptInput;
