import React, { useEffect, useState, useRef } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { RootState } from '../../store';
import { clearCurrentSession, setCurrentSession, setStreaming } from '../../store/slices/coworkSlice';
import { clearActiveSkills, setActiveSkillIds } from '../../store/slices/skillSlice';
import { setActions, selectAction, clearSelection } from '../../store/slices/quickActionSlice';
import { coworkService } from '../../services/cowork';
import { skillService } from '../../services/skill';
import { quickActionService } from '../../services/quickAction';
import { i18nService } from '../../services/i18n';
import CoworkPromptInput, { type CoworkPromptInputRef } from './CoworkPromptInput';
import CoworkSessionDetail from './CoworkSessionDetail';
import ModelSelector from '../ModelSelector';
import SidebarToggleIcon from '../icons/SidebarToggleIcon';
import ComposeIcon from '../icons/ComposeIcon';
import WindowTitleBar from '../window/WindowTitleBar';
import { QuickActionBar, PromptPanel } from '../quick-actions';
import type { SettingsOpenOptions } from '../Settings';
import type { CoworkSession } from '../../types/cowork';

export interface CoworkViewProps {
  onRequestAppSettings?: (options?: SettingsOpenOptions) => void;
  onShowSkills?: () => void;
  isSidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
  onNewChat?: () => void;
  updateBadge?: React.ReactNode;
}

const CoworkView: React.FC<CoworkViewProps> = ({ onRequestAppSettings, onShowSkills, isSidebarCollapsed, onToggleSidebar, onNewChat, updateBadge }) => {
  const dispatch = useDispatch();
  const isMac = window.electron.platform === 'darwin';
  const [isInitialized, setIsInitialized] = useState(false);
  // 跟踪是否正在启动会话，以防止重复提交
  const isStartingRef = useRef(false);
  // 跟踪待处理的启动请求，以便停止操作可以取消延迟的启动
  const pendingStartRef = useRef<{ requestId: number; cancelled: boolean } | null>(null);
  const startRequestIdRef = useRef(0);
  // CoworkPromptInput 组件的引用
  const promptInputRef = useRef<CoworkPromptInputRef>(null);

  const {
    currentSession,
    isStreaming,
    config,
  } = useSelector((state: RootState) => state.cowork);

  const activeSkillIds = useSelector((state: RootState) => state.skill.activeSkillIds);
  const skills = useSelector((state: RootState) => state.skill.skills);
  const quickActions = useSelector((state: RootState) => state.quickAction.actions);
  const selectedActionId = useSelector((state: RootState) => state.quickAction.selectedActionId);

  const buildApiConfigNotice = (error?: string) => {
    const baseNotice = i18nService.t('coworkModelSettingsRequired');
    if (!error) {
      return baseNotice;
    }
    const normalizedError = error.trim();
    if (
      normalizedError.startsWith('No enabled provider found for model:')
      || normalizedError === 'No available model configured in enabled providers.'
    ) {
      return baseNotice;
    }
    return `${baseNotice} (${error})`;
  };

  useEffect(() => {
    const init = async () => {
      await coworkService.init();
      // 加载快捷操作并进行本地化
      try {
        quickActionService.initialize();
        const actions = await quickActionService.getLocalizedActions();
        dispatch(setActions(actions));
      } catch (error) {
        console.error('加载快捷操作失败:', error);
      }
      try {
        const apiConfig = await coworkService.checkApiConfig();
        if (apiConfig && !apiConfig.hasConfig) {
          onRequestAppSettings?.({
            initialTab: 'model',
            notice: buildApiConfigNotice(apiConfig.error),
          });
        }
      } catch (error) {
        console.error('检查协作 API 配置失败:', error);
      }
      setIsInitialized(true);
    };
    init();

    // 订阅语言变化以重新加载快捷操作
    const unsubscribe = quickActionService.subscribe(async () => {
      try {
        const actions = await quickActionService.getLocalizedActions();
        dispatch(setActions(actions));
      } catch (error) {
        console.error('重新加载快捷操作失败:', error);
      }
    });

    return () => {
      unsubscribe();
    };
  }, [dispatch]);

  const handleStartSession = async (prompt: string, skillPrompt?: string) => {
    // 防止重复提交
    if (isStartingRef.current) return;
    isStartingRef.current = true;
    const requestId = ++startRequestIdRef.current;
    pendingStartRef.current = { requestId, cancelled: false };
    const isPendingStartCancelled = () => {
      const pending = pendingStartRef.current;
      return !pending || pending.requestId !== requestId || pending.cancelled;
    };

    try {
      try {
        const apiConfig = await coworkService.checkApiConfig();
        if (apiConfig && !apiConfig.hasConfig) {
          onRequestAppSettings?.({
            initialTab: 'model',
            notice: buildApiConfigNotice(),
          });
          isStartingRef.current = false;
          return;
        }
      } catch (error) {
        console.error('检查协作 API 配置失败:', error);
      }

      // 创建一个包含用户消息的临时会话，以便立即显示
      const tempSessionId = `temp-${Date.now()}`;
      const fallbackTitle = prompt.split('\n')[0].slice(0, 50) || i18nService.t('coworkNewSession');
      const now = Date.now();

      // 在清除之前捕获活跃技能 ID
      const sessionSkillIds = [...activeSkillIds];

      const tempSession: CoworkSession = {
        id: tempSessionId,
        title: fallbackTitle,
        claudeSessionId: null,
        status: 'running',
        pinned: false,
        createdAt: now,
        updatedAt: now,
        cwd: config.workingDirectory || '',
        systemPrompt: '',
        executionMode: config.executionMode || 'local',
        activeSkillIds: sessionSkillIds,
        messages: [
          {
            id: `msg-${now}`,
            type: 'user',
            content: prompt,
            timestamp: now,
            metadata: sessionSkillIds.length > 0 ? { skillIds: sessionSkillIds } : undefined,
          },
        ],
      };

      // 立即显示包含用户消息的会话详情页面
      dispatch(setCurrentSession(tempSession));
      dispatch(setStreaming(true));

      // 在启动会话后清除活跃技能和快捷操作选择
      // 这样它们就不会持续到下一个会话
      dispatch(clearActiveSkills());
      dispatch(clearSelection());

      // 将技能提示词与系统提示词组合
      // 如果没有手动选择技能，则使用自动路由提示词
      let effectiveSkillPrompt = skillPrompt;
      if (!skillPrompt) {
        effectiveSkillPrompt = await skillService.getAutoRoutingPrompt() || undefined;
      }
      const combinedSystemPrompt = [effectiveSkillPrompt, config.systemPrompt]
        .filter(p => p?.trim())
        .join('\n\n') || undefined;

      // 在后台生成标题，同时启动会话
      const [generatedTitle] = await Promise.all([
        coworkService.generateSessionTitle(prompt).catch(error => {
          console.error('生成协作会话标题失败:', error);
          return null;
        }),
        // 短暂延迟以确保 UI 在繁重操作之前更新
        new Promise(resolve => setTimeout(resolve, 0)),
      ]);

      if (isPendingStartCancelled()) {
        return;
      }

      const title = generatedTitle?.trim() || fallbackTitle;

      // 启动实际会话 - 这将通过 addSession 替换临时会话
      const startedSession = await coworkService.startSession({
        prompt,
        title,
        cwd: config.workingDirectory || undefined,
        systemPrompt: combinedSystemPrompt,
        activeSkillIds: sessionSkillIds,
      });

      // 如果用户在启动请求进行中时取消，立即停止
      if (isPendingStartCancelled() && startedSession) {
        await coworkService.stopSession(startedSession.id);
      }
    } finally {
      if (pendingStartRef.current?.requestId === requestId) {
        pendingStartRef.current = null;
      }
      isStartingRef.current = false;
    }
  };

  const handleContinueSession = async (prompt: string, skillPrompt?: string) => {
    if (!currentSession) return;

    // 在清除之前捕获活跃技能 ID
    const sessionSkillIds = [...activeSkillIds];

    // 捕获后清除活跃技能，这样它们就不会持续到下一条消息
    if (sessionSkillIds.length > 0) {
      dispatch(clearActiveSkills());
    }

    // 将技能提示词与系统提示词组合以继续会话
    // 如果没有手动选择技能，则使用自动路由提示词
    let effectiveSkillPrompt = skillPrompt;
    if (!skillPrompt) {
      effectiveSkillPrompt = await skillService.getAutoRoutingPrompt() || undefined;
    }
    const combinedSystemPrompt = [effectiveSkillPrompt, config.systemPrompt]
      .filter(p => p?.trim())
      .join('\n\n') || undefined;

    await coworkService.continueSession({
      sessionId: currentSession.id,
      prompt,
      systemPrompt: combinedSystemPrompt,
      activeSkillIds: sessionSkillIds.length > 0 ? sessionSkillIds : undefined,
    });
  };

  const handleStopSession = async () => {
    if (!currentSession) return;
    if (currentSession.id.startsWith('temp-') && pendingStartRef.current) {
      pendingStartRef.current.cancelled = true;
    }
    await coworkService.stopSession(currentSession.id);
  };

  // 获取选中的快捷操作
  const selectedAction = React.useMemo(() => {
    return quickActions.find(action => action.id === selectedActionId);
  }, [quickActions, selectedActionId]);

  // 处理快捷操作按钮点击：选择操作并批量激活技能
  const handleActionSelect = (actionId: string) => {
    dispatch(selectAction(actionId));
    const action = quickActions.find(a => a.id === actionId);
    if (action) {
      const targetSkill = skills.find(s => s.id === action.skillMapping);
      if (targetSkill) {
        dispatch(setActiveSkillIds([targetSkill.id]));
      }
    }
  };

  // 当映射的技能从输入区域停用时，恢复 QuickActionBar
  useEffect(() => {
    if (!selectedActionId) return;
    const action = quickActions.find(a => a.id === selectedActionId);
    if (action) {
      const skillStillActive = activeSkillIds.includes(action.skillMapping);
      if (!skillStillActive) {
        dispatch(clearSelection());
      }
    }
  }, [activeSkillIds]);

  // 处理从 QuickAction 选择提示词
  const handleQuickActionPromptSelect = (prompt: string) => {
    // 将提示词填充到输入框
    promptInputRef.current?.setValue(prompt);
    promptInputRef.current?.focus();
  };

  useEffect(() => {
    const handleNewSession = () => {
      dispatch(clearCurrentSession());
      dispatch(clearSelection());
      window.dispatchEvent(new CustomEvent('cowork:focus-input', {
        detail: { clear: true },
      }));
    };
    window.addEventListener('cowork:shortcut:new-session', handleNewSession);
    return () => {
      window.removeEventListener('cowork:shortcut:new-session', handleNewSession);
    };
  }, [dispatch]);

  if (!isInitialized) {
    return (
      <div className="flex-1 h-full flex flex-col dark:bg-claude-darkBg bg-claude-bg">
        <div className="draggable flex h-12 items-center justify-end px-4 border-b dark:border-claude-darkBorder border-claude-border shrink-0">
          <WindowTitleBar inline />
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="dark:text-claude-darkTextSecondary text-claude-textSecondary">
            {i18nService.t('loading')}
          </div>
        </div>
      </div>
    );
  }

  // 当存在当前会话时，显示会话详情视图
  if (currentSession) {
    return (
      <>
        <CoworkSessionDetail
          onManageSkills={() => onShowSkills?.()}
          onContinue={handleContinueSession}
          onStop={handleStopSession}
          onNavigateHome={() => dispatch(clearCurrentSession())}
          isSidebarCollapsed={isSidebarCollapsed}
          onToggleSidebar={onToggleSidebar}
          onNewChat={onNewChat}
          updateBadge={updateBadge}
        />
      </>
    );
  }

  // 主页视图 - 无当前会话
  return (
    <div className="flex-1 flex flex-col dark:bg-claude-darkBg bg-claude-bg h-full">
      {/* 头部 */}
      <div className="draggable flex h-12 items-center justify-between px-4 border-b dark:border-claude-darkBorder border-claude-border shrink-0">
        <div className="non-draggable h-8 flex items-center">
          {isSidebarCollapsed && (
            <div className={`flex items-center gap-1 mr-2 ${isMac ? 'pl-[68px]' : ''}`}>
              <button
                type="button"
                onClick={onToggleSidebar}
                className="h-8 w-8 inline-flex items-center justify-center rounded-lg dark:text-claude-darkTextSecondary text-claude-textSecondary hover:bg-claude-surfaceHover dark:hover:bg-claude-darkSurfaceHover transition-colors"
              >
                <SidebarToggleIcon className="h-4 w-4" isCollapsed={true} />
              </button>
              <button
                type="button"
                onClick={onNewChat}
                className="h-8 w-8 inline-flex items-center justify-center rounded-lg dark:text-claude-darkTextSecondary text-claude-textSecondary hover:bg-claude-surfaceHover dark:hover:bg-claude-darkSurfaceHover transition-colors"
              >
                <ComposeIcon className="h-4 w-4" />
              </button>
              {updateBadge}
            </div>
          )}
          <ModelSelector />
        </div>
        <WindowTitleBar inline />
      </div>

      {/* 主内容区域 */}
      <div className="flex-1 overflow-y-auto min-h-0">
        <div className="max-w-3xl mx-auto px-4 py-16 space-y-12">
          {/* 欢迎区域 */}
          <div className="text-center space-y-5">
            <img src="logo.png" alt="logo" className="w-16 h-16 mx-auto" />
            <h2 className="text-3xl font-bold tracking-tight dark:text-claude-darkText text-claude-text">
              {i18nService.t('coworkWelcome')}
            </h2>
            <p className="text-sm dark:text-claude-darkTextSecondary text-claude-textSecondary max-w-md mx-auto">
              {i18nService.t('coworkDescription')}
            </p>
          </div>

          {/* 提示词输入区域 - 带文件夹选择器的大版本 */}
          <div className="space-y-3">
            <div className="shadow-glow-accent rounded-2xl">
              <CoworkPromptInput
                ref={promptInputRef}
                onSubmit={handleStartSession}
                onStop={handleStopSession}
                isStreaming={isStreaming}
                placeholder={i18nService.t('coworkPlaceholder')}
                size="large"
                workingDirectory={config.workingDirectory}
                onWorkingDirectoryChange={async (dir: string) => {
                  await coworkService.updateConfig({ workingDirectory: dir });
                }}
                showFolderSelector={true}
                onManageSkills={() => onShowSkills?.()}
              />
            </div>
          </div>

          {/* 快捷操作 */}
          <div className="space-y-4">
            {selectedAction ? (
              <PromptPanel
                action={selectedAction}
                onPromptSelect={handleQuickActionPromptSelect}
              />
            ) : (
              <QuickActionBar actions={quickActions} onActionSelect={handleActionSelect} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default CoworkView;
