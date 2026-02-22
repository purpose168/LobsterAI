/**
 * 技能管理器组件
 * 用于管理应用程序中的技能模块，包括查看、搜索、添加、删除和启用/禁用技能
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
  ArrowUpTrayIcon,
  FolderOpenIcon,
  LinkIcon,
  MagnifyingGlassIcon,
  PlusCircleIcon,
  PuzzlePieceIcon,
  TrashIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { i18nService } from '../../services/i18n';
import { skillService } from '../../services/skill';
import { setSkills } from '../../store/slices/skillSlice';
import { RootState } from '../../store';
import { Skill } from '../../types/skill';
import ErrorMessage from '../ErrorMessage';
import Tooltip from '../ui/Tooltip';

/**
 * 技能管理器主组件
 * 提供技能的增删改查和导入功能
 */
const SkillsManager: React.FC = () => {
  const dispatch = useDispatch();
  const skills = useSelector((state: RootState) => state.skill.skills);

  // 状态管理：技能搜索查询字符串
  const [skillSearchQuery, setSkillSearchQuery] = useState('');
  // 状态管理：技能下载源（URL或本地路径）
  const [skillDownloadSource, setSkillDownloadSource] = useState('');
  // 状态管理：技能操作错误信息
  const [skillActionError, setSkillActionError] = useState('');
  // 状态管理：是否正在下载技能
  const [isDownloadingSkill, setIsDownloadingSkill] = useState(false);
  // 状态管理：添加技能菜单是否打开
  const [isAddSkillMenuOpen, setIsAddSkillMenuOpen] = useState(false);
  // 状态管理：GitHub导入对话框是否打开
  const [isGithubImportOpen, setIsGithubImportOpen] = useState(false);
  // 状态管理：待删除的技能对象
  const [skillPendingDelete, setSkillPendingDelete] = useState<Skill | null>(null);
  // 状态管理：是否正在删除技能
  const [isDeletingSkill, setIsDeletingSkill] = useState(false);

  // 引用：添加技能菜单的DOM元素
  const addSkillMenuRef = useRef<HTMLDivElement>(null);
  // 引用：添加技能按钮的DOM元素
  const addSkillButtonRef = useRef<HTMLButtonElement>(null);
  // 引用：GitHub导入输入框的DOM元素
  const githubImportInputRef = useRef<HTMLInputElement>(null);

  /**
   * 初始化加载技能列表
   * 并监听技能变更事件
   */
  useEffect(() => {
    let isActive = true;
    const loadSkills = async () => {
      const loadedSkills = await skillService.loadSkills();
      if (!isActive) return;
      dispatch(setSkills(loadedSkills));
    };
    loadSkills();

    // 订阅技能变更事件
    const unsubscribe = skillService.onSkillsChanged(async () => {
      const loadedSkills = await skillService.loadSkills();
      if (!isActive) return;
      dispatch(setSkills(loadedSkills));
    });

    // 清理函数：取消订阅并标记组件已卸载
    return () => {
      isActive = false;
      unsubscribe();
    };
  }, [dispatch]);

  /**
   * 处理添加技能菜单的外部点击和ESC键关闭
   */
  useEffect(() => {
    if (!isAddSkillMenuOpen) return;

    // 处理点击菜单外部关闭菜单
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      const isInsideMenu = addSkillMenuRef.current?.contains(target);
      const isInsideButton = addSkillButtonRef.current?.contains(target);
      if (!isInsideMenu && !isInsideButton) {
        setIsAddSkillMenuOpen(false);
      }
    };

    // 处理按下ESC键关闭菜单
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsAddSkillMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isAddSkillMenuOpen]);

  /**
   * 处理GitHub导入对话框的ESC键关闭和输入框自动聚焦
   */
  useEffect(() => {
    if (!isGithubImportOpen) return;

    // 处理按下ESC键关闭对话框
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsGithubImportOpen(false);
      }
    };

    document.addEventListener('keydown', handleEscape);
    // 自动聚焦到输入框
    setTimeout(() => githubImportInputRef.current?.focus(), 0);
    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isGithubImportOpen]);

  /**
   * 根据搜索查询过滤技能列表
   * 支持按名称和描述进行搜索
   */
  const filteredSkills = useMemo(() => {
    const query = skillSearchQuery.toLowerCase();
    return skills.filter(skill => {
      const matchesSearch = skill.name.toLowerCase().includes(query)
        || skill.description.toLowerCase().includes(query);
      return matchesSearch;
    });
  }, [skills, skillSearchQuery]);

  /**
   * 格式化技能日期显示
   * 根据当前语言环境返回相应格式的日期字符串
   * @param timestamp - 时间戳（毫秒）
   * @returns 格式化后的日期字符串
   */
  const formatSkillDate = (timestamp: number) => {
    const date = new Date(timestamp);
    const locale = i18nService.getLanguage() === 'zh' ? 'zh-CN' : 'en-US';
    return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(date);
  };

  /**
   * 切换技能的启用/禁用状态
   * @param skillId - 技能ID
   */
  const handleToggleSkill = async (skillId: string) => {
    const targetSkill = skills.find(skill => skill.id === skillId);
    if (!targetSkill) return;
    try {
      const updatedSkills = await skillService.setSkillEnabled(skillId, !targetSkill.enabled);
      dispatch(setSkills(updatedSkills));
      setSkillActionError('');
    } catch (error) {
      setSkillActionError(error instanceof Error ? error.message : i18nService.t('skillUpdateFailed'));
    }
  };

  /**
   * 请求删除技能
   * 内置技能不可删除
   * @param skill - 要删除的技能对象
   */
  const handleRequestDeleteSkill = (skill: Skill) => {
    if (skill.isBuiltIn) {
      setSkillActionError(i18nService.t('skillBuiltInCannotDelete'));
      return;
    }
    setSkillActionError('');
    setSkillPendingDelete(skill);
  };

  /**
   * 取消删除技能
   * 关闭删除确认对话框
   */
  const handleCancelDeleteSkill = () => {
    if (isDeletingSkill) return;
    setSkillPendingDelete(null);
  };

  /**
   * 确认删除技能
   * 执行实际的删除操作
   */
  const handleConfirmDeleteSkill = async () => {
    if (!skillPendingDelete || isDeletingSkill) return;
    setIsDeletingSkill(true);
    setSkillActionError('');
    const result = await skillService.deleteSkill(skillPendingDelete.id);
    if (!result.success) {
      setSkillActionError(result.error || i18nService.t('skillDeleteFailed'));
      setIsDeletingSkill(false);
      return;
    }
    if (result.skills) {
      dispatch(setSkills(result.skills));
    }
    setIsDeletingSkill(false);
    setSkillPendingDelete(null);
  };

  /**
   * 从指定源添加技能
   * 支持本地文件路径或GitHub URL
   * @param source - 技能源（文件路径或URL）
   */
  const handleAddSkillFromSource = async (source: string) => {
    const trimmedSource = source.trim();
    if (!trimmedSource) return;
    setIsDownloadingSkill(true);
    setSkillActionError('');
    const result = await skillService.downloadSkill(trimmedSource);
    setIsDownloadingSkill(false);
    if (!result.success) {
      setSkillActionError(result.error || i18nService.t('skillDownloadFailed'));
      return;
    }
    if (result.skills) {
      dispatch(setSkills(result.skills));
    }
    setSkillDownloadSource('');
    setIsAddSkillMenuOpen(false);
    setIsGithubImportOpen(false);
  };

  /**
   * 上传技能ZIP压缩包
   * 打开文件选择对话框选择ZIP文件
   */
  const handleUploadSkillZip = async () => {
    if (isDownloadingSkill) return;
    const result = await window.electron.dialog.selectFile({
      title: i18nService.t('uploadSkillZip'),
      filters: [{ name: 'Zip', extensions: ['zip'] }],
    });
    if (result.success && result.path) {
      await handleAddSkillFromSource(result.path);
    }
  };

  /**
   * 上传技能文件夹
   * 打开文件夹选择对话框
   */
  const handleUploadSkillFolder = async () => {
    if (isDownloadingSkill) return;
    const result = await window.electron.dialog.selectDirectory();
    if (result.success && result.path) {
      await handleAddSkillFromSource(result.path);
    }
  };

  /**
   * 打开GitHub导入对话框
   */
  const handleOpenGithubImport = () => {
    setIsAddSkillMenuOpen(false);
    setSkillActionError('');
    setIsGithubImportOpen(true);
  };

  /**
   * 从GitHub导入技能
   * 使用用户输入的GitHub URL下载技能
   */
  const handleImportFromGithub = async () => {
    if (isDownloadingSkill) return;
    await handleAddSkillFromSource(skillDownloadSource);
  };

  return (
    <div className="space-y-4">
      {/* 技能说明描述 */}
      <div>
        <p className="text-sm dark:text-claude-darkTextSecondary text-claude-textSecondary">
          {i18nService.t('skillsDescription')}
        </p>
      </div>

      {/* 错误消息显示 */}
      {skillActionError && (
        <ErrorMessage
          message={skillActionError}
          onClose={() => setSkillActionError('')}
        />
      )}

      {/* 搜索框和添加技能按钮 */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 dark:text-claude-darkTextSecondary text-claude-textSecondary" />
          <input
            type="text"
            placeholder={i18nService.t('searchSkills')}
            value={skillSearchQuery}
            onChange={(e) => setSkillSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm rounded-xl dark:bg-claude-darkSurface bg-claude-surface dark:text-claude-darkText text-claude-text dark:placeholder-claude-darkTextSecondary placeholder-claude-textSecondary border dark:border-claude-darkBorder border-claude-border focus:outline-none focus:ring-2 focus:ring-claude-accent"
          />
        </div>
        <div className="relative">
          <button
            ref={addSkillButtonRef}
            type="button"
            onClick={() => setIsAddSkillMenuOpen(prev => !prev)}
            className="px-3 py-2 text-sm rounded-xl border transition-colors dark:bg-claude-darkSurface bg-claude-surface dark:border-claude-darkBorder border-claude-border dark:text-claude-darkText text-claude-text dark:hover:bg-claude-darkSurfaceHover hover:bg-claude-surfaceHover flex items-center gap-2"
          >
            <PlusCircleIcon className="h-4 w-4" />
            <span>{i18nService.t('addSkill')}</span>
          </button>

          {/* 添加技能下拉菜单 */}
          {isAddSkillMenuOpen && (
            <div
              ref={addSkillMenuRef}
              className="absolute right-0 mt-2 w-72 rounded-xl border dark:border-claude-darkBorder border-claude-border dark:bg-claude-darkSurface bg-claude-surface shadow-lg z-50 overflow-hidden"
            >
              {/* 上传ZIP文件选项 */}
              <button
                type="button"
                onClick={handleUploadSkillZip}
                disabled={isDownloadingSkill}
                className="w-full flex items-center gap-3 px-3 py-2.5 text-sm dark:text-claude-darkText text-claude-text dark:hover:bg-claude-darkSurfaceHover hover:bg-claude-surfaceHover transition-colors disabled:opacity-50"
              >
                <ArrowUpTrayIcon className="h-4 w-4 dark:text-claude-darkTextSecondary text-claude-textSecondary" />
                <span>{i18nService.t('uploadSkillZip')}</span>
              </button>
              {/* 上传文件夹选项 */}
              <button
                type="button"
                onClick={handleUploadSkillFolder}
                disabled={isDownloadingSkill}
                className="w-full flex items-center gap-3 px-3 py-2.5 text-sm dark:text-claude-darkText text-claude-text dark:hover:bg-claude-darkSurfaceHover hover:bg-claude-surfaceHover transition-colors disabled:opacity-50"
              >
                <FolderOpenIcon className="h-4 w-4 dark:text-claude-darkTextSecondary text-claude-textSecondary" />
                <span>{i18nService.t('uploadSkillFolder')}</span>
              </button>
              {/* 从GitHub导入选项 */}
              <button
                type="button"
                onClick={handleOpenGithubImport}
                className="w-full flex items-center gap-3 px-3 py-2.5 text-sm dark:text-claude-darkText text-claude-text dark:hover:bg-claude-darkSurfaceHover hover:bg-claude-surfaceHover transition-colors"
              >
                <LinkIcon className="h-4 w-4 dark:text-claude-darkTextSecondary text-claude-textSecondary" />
                <span>{i18nService.t('importFromGithub')}</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* 技能卡片网格 */}
      <div className="grid grid-cols-2 gap-3">
        {filteredSkills.length === 0 ? (
          // 无可用技能提示
          <div className="col-span-2 text-center py-8 text-sm dark:text-claude-darkTextSecondary text-claude-textSecondary">
            {i18nService.t('noSkillsAvailable')}
          </div>
        ) : (
          // 技能卡片列表
          filteredSkills.map((skill) => (
            <div
              key={skill.id}
              className="rounded-xl border dark:border-claude-darkBorder border-claude-border dark:bg-claude-darkSurface/50 bg-claude-surface/50 p-3 transition-colors hover:border-claude-accent/50"
            >
              {/* 技能头部：图标、名称和操作按钮 */}
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-7 h-7 rounded-lg dark:bg-claude-darkSurface bg-claude-surface flex items-center justify-center flex-shrink-0">
                    <PuzzlePieceIcon className="h-4 w-4 dark:text-claude-darkTextSecondary text-claude-textSecondary" />
                  </div>
                  <span className="text-sm font-medium dark:text-claude-darkText text-claude-text truncate">
                    {skill.name}
                  </span>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {/* 删除按钮（非内置技能才显示） */}
                  {!skill.isBuiltIn && (
                    <button
                      type="button"
                      onClick={() => handleRequestDeleteSkill(skill)}
                      className="p-1 rounded-lg text-claude-textSecondary dark:text-claude-darkTextSecondary hover:text-red-500 dark:hover:text-red-400 transition-colors"
                      title={i18nService.t('deleteSkill')}
                    >
                      <TrashIcon className="h-4 w-4" />
                    </button>
                  )}
                  {/* 启用/禁用开关 */}
                  <div
                    className={`w-9 h-5 rounded-full flex items-center transition-colors cursor-pointer flex-shrink-0 ${
                      skill.enabled ? 'bg-claude-accent' : 'dark:bg-claude-darkBorder bg-claude-border'
                    }`}
                    onClick={() => handleToggleSkill(skill.id)}
                  >
                    <div
                      className={`w-3.5 h-3.5 rounded-full bg-white shadow-md transform transition-transform ${
                        skill.enabled ? 'translate-x-[18px]' : 'translate-x-[3px]'
                      }`}
                    />
                  </div>
                </div>
              </div>

              {/* 技能描述（带工具提示） */}
              <Tooltip
                content={skill.description}
                position="bottom"
                maxWidth="360px"
                className="block w-full"
              >
                <p className="text-xs dark:text-claude-darkTextSecondary text-claude-textSecondary line-clamp-2 mb-2">
                  {skill.description}
                </p>
              </Tooltip>

              {/* 技能元信息：官方标签和更新日期 */}
              <div className="flex items-center gap-2 text-[10px] dark:text-claude-darkTextSecondary text-claude-textSecondary">
                {skill.isOfficial && (
                  <>
                    <span className="px-1.5 py-0.5 rounded bg-claude-accent/10 text-claude-accent font-medium">
                      {i18nService.t('official')}
                    </span>
                    <span>·</span>
                  </>
                )}
                <span>{formatSkillDate(skill.updatedAt)}</span>
              </div>
            </div>
          ))
        )}
      </div>

      {/* 删除确认对话框 */}
      {skillPendingDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={handleCancelDeleteSkill}
        >
          <div
            className="w-full max-w-sm mx-4 rounded-2xl dark:bg-claude-darkSurface bg-claude-surface border dark:border-claude-darkBorder border-claude-border shadow-2xl p-5"
            onClick={(event) => event.stopPropagation()}
          >
            {/* 对话框标题 */}
            <div className="text-lg font-semibold dark:text-claude-darkText text-claude-text">
              {i18nService.t('deleteSkill')}
            </div>
            {/* 确认消息 */}
            <p className="mt-2 text-sm dark:text-claude-darkTextSecondary text-claude-textSecondary">
              {i18nService.t('skillDeleteConfirm').replace('{name}', skillPendingDelete.name)}
            </p>
            {/* 错误提示 */}
            {skillActionError && (
              <div className="mt-3 text-xs text-red-500">
                {skillActionError}
              </div>
            )}
            {/* 操作按钮 */}
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={handleCancelDeleteSkill}
                disabled={isDeletingSkill}
                className="px-3 py-1.5 text-xs rounded-lg border dark:border-claude-darkBorder border-claude-border dark:text-claude-darkTextSecondary text-claude-textSecondary dark:hover:bg-claude-darkSurfaceHover hover:bg-claude-surfaceHover transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {i18nService.t('cancel')}
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteSkill}
                disabled={isDeletingSkill}
                className="px-3 py-1.5 text-xs rounded-lg bg-red-500 text-white hover:bg-red-600 dark:bg-red-500 dark:hover:bg-red-400 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {i18nService.t('confirmDelete')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* GitHub导入对话框 */}
      {isGithubImportOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={() => setIsGithubImportOpen(false)}
        >
          <div
            className="w-full max-w-md mx-4 rounded-2xl dark:bg-claude-darkSurface bg-claude-surface border dark:border-claude-darkBorder border-claude-border shadow-2xl p-6"
            onClick={(event) => event.stopPropagation()}
          >
            {/* 对话框头部 */}
            <div className="flex items-start justify-between">
              <div>
                <div className="text-lg font-semibold dark:text-claude-darkText text-claude-text">
                  {i18nService.t('githubImportTitle')}
                </div>
                <p className="mt-1 text-sm dark:text-claude-darkTextSecondary text-claude-textSecondary">
                  {i18nService.t('githubImportDescription')}
                </p>
              </div>
              {/* 关闭按钮 */}
              <button
                type="button"
                onClick={() => setIsGithubImportOpen(false)}
                className="p-1.5 rounded-lg dark:text-claude-darkTextSecondary text-claude-textSecondary dark:hover:text-claude-darkText hover:text-claude-text dark:hover:bg-claude-darkSurfaceHover hover:bg-claude-surfaceHover transition-colors"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>

            {/* 导入表单 */}
            <div className="mt-5 space-y-3">
              {/* URL输入框标签 */}
              <div className="text-xs font-semibold tracking-wide dark:text-claude-darkTextSecondary text-claude-textSecondary">
                {i18nService.t('githubImportUrlLabel')}
              </div>
              {/* URL输入框 */}
              <input
                ref={githubImportInputRef}
                type="text"
                value={skillDownloadSource}
                onChange={(e) => setSkillDownloadSource(e.target.value)}
                placeholder={i18nService.t('githubSkillPlaceholder')}
                className="w-full px-3 py-2.5 text-sm rounded-xl dark:bg-claude-darkBg bg-claude-bg dark:text-claude-darkText text-claude-text dark:placeholder-claude-darkTextSecondary placeholder-claude-textSecondary border dark:border-claude-darkBorder border-claude-border focus:outline-none focus:ring-2 focus:ring-claude-accent"
              />
              {/* 示例说明 */}
              <p className="text-xs dark:text-claude-darkTextSecondary text-claude-textSecondary">
                {i18nService.t('githubImportExamples')}
              </p>
              {/* 错误提示 */}
              {skillActionError && (
                <div className="text-xs text-red-500">
                  {skillActionError}
                </div>
              )}
              {/* 导入按钮 */}
              <button
                type="button"
                onClick={handleImportFromGithub}
                disabled={isDownloadingSkill || !skillDownloadSource.trim()}
                className="w-full py-2.5 rounded-xl bg-claude-accent text-white text-sm font-medium hover:bg-claude-accent/90 transition-colors disabled:opacity-50"
              >
                {isDownloadingSkill ? i18nService.t('importingSkill') : i18nService.t('importSkill')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SkillsManager;
