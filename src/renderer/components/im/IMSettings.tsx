/**
 * 即时通讯设置组件
 * 钉钉、飞书和 Telegram 即时通讯机器人的配置界面
 */

import React, { useState, useEffect, useMemo } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { SignalIcon, XMarkIcon, CheckCircleIcon, XCircleIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import { RootState } from '../../store';
import { imService } from '../../services/im';
import { setDingTalkConfig, setFeishuConfig, setTelegramConfig, setDiscordConfig, clearError } from '../../store/slices/imSlice';
import { i18nService } from '../../services/i18n';
import type { IMPlatform, IMConnectivityCheck, IMConnectivityTestResult, IMGatewayConfig } from '../../types/im';
import { getVisibleIMPlatforms } from '../../utils/regionFilter';

// 平台元数据
const platformMeta: Record<IMPlatform, { label: string; logo: string }> = {
  dingtalk: { label: '钉钉', logo: 'dingding.png' },
  feishu: { label: '飞书', logo: 'feishu.png' },
  telegram: { label: 'Telegram', logo: 'telegram.svg' },
  discord: { label: 'Discord', logo: 'discord.svg' },
};

const verdictColorClass: Record<IMConnectivityTestResult['verdict'], string> = {
  pass: 'bg-green-500/15 text-green-600 dark:text-green-400',
  warn: 'bg-yellow-500/15 text-yellow-700 dark:text-yellow-300',
  fail: 'bg-red-500/15 text-red-600 dark:text-red-400',
};

const checkLevelColorClass: Record<IMConnectivityCheck['level'], string> = {
  pass: 'text-green-600 dark:text-green-400',
  info: 'text-sky-600 dark:text-sky-400',
  warn: 'text-yellow-700 dark:text-yellow-300',
  fail: 'text-red-600 dark:text-red-400',
};

const IMSettings: React.FC = () => {
  const dispatch = useDispatch();
  const { config, status, isLoading } = useSelector((state: RootState) => state.im);
  const [activePlatform, setActivePlatform] = useState<IMPlatform>('dingtalk');
  const [testingPlatform, setTestingPlatform] = useState<IMPlatform | null>(null);
  const [connectivityResults, setConnectivityResults] = useState<Partial<Record<IMPlatform, IMConnectivityTestResult>>>({});
  const [connectivityModalPlatform, setConnectivityModalPlatform] = useState<IMPlatform | null>(null);
  const [language, setLanguage] = useState<'zh' | 'en'>(i18nService.getLanguage());

  // 订阅语言变更
  useEffect(() => {
    const unsubscribe = i18nService.subscribe(() => {
      setLanguage(i18nService.getLanguage());
    });
    return unsubscribe;
  }, []);

  // 初始化即时通讯服务并订阅状态更新
  useEffect(() => {
    void imService.init();
    return () => {
      imService.destroy();
    };
  }, []);

  // 处理钉钉配置变更
  const handleDingTalkChange = (field: 'clientId' | 'clientSecret', value: string) => {
    dispatch(setDingTalkConfig({ [field]: value }));
  };

  // 处理飞书配置变更
  const handleFeishuChange = (field: 'appId' | 'appSecret', value: string) => {
    dispatch(setFeishuConfig({ [field]: value }));
  };

  // 处理 Telegram 配置变更
  const handleTelegramChange = (field: 'botToken', value: string) => {
    dispatch(setTelegramConfig({ [field]: value }));
  };

  // 处理 Discord 配置变更
  const handleDiscordChange = (field: 'botToken', value: string) => {
    dispatch(setDiscordConfig({ [field]: value }));
  };

  // 失去焦点时保存配置
  const handleSaveConfig = async () => {
    await imService.updateConfig(config);
  };

  const getCheckTitle = (code: IMConnectivityCheck['code']): string => {
    return i18nService.t(`imConnectivityCheckTitle_${code}`);
  };

  const getCheckSuggestion = (check: IMConnectivityCheck): string | undefined => {
    if (check.suggestion) {
      return check.suggestion;
    }
    if (check.code === 'gateway_running' && check.level === 'pass') {
      return undefined;
    }
    const suggestion = i18nService.t(`imConnectivityCheckSuggestion_${check.code}`);
    if (suggestion.startsWith('imConnectivityCheckSuggestion_')) {
      return undefined;
    }
    return suggestion;
  };

  const formatTestTime = (timestamp: number): string => {
    try {
      return new Date(timestamp).toLocaleString();
    } catch {
      return String(timestamp);
    }
  };

  const runConnectivityTest = async (
    platform: IMPlatform,
    configOverride?: Partial<IMGatewayConfig>
  ) => {
    setTestingPlatform(platform);
    const result = await imService.testGateway(platform, configOverride);
    if (result) {
      setConnectivityResults((prev) => ({ ...prev, [platform]: result }));
    }
    setTestingPlatform(null);
  };

  // 切换网关开关并持久化启用状态
  const toggleGateway = async (platform: IMPlatform) => {
    const isEnabled = config[platform].enabled;
    const newEnabled = !isEnabled;

    // 将平台映射到其 Redux 操作
    const setConfigAction = {
      dingtalk: setDingTalkConfig,
      feishu: setFeishuConfig,
      telegram: setTelegramConfig,
      discord: setDiscordConfig,
    }[platform];

    // 更新 Redux 状态
    dispatch(setConfigAction({ enabled: newEnabled }));

    // 持久化更新的配置（手动构建，因为 Redux 状态尚未重新渲染）
    await imService.updateConfig({ [platform]: { ...config[platform], enabled: newEnabled } });

    if (newEnabled) {
      dispatch(clearError());
      const success = await imService.startGateway(platform);
      if (!success) {
        // 失败时回滚启用状态
        dispatch(setConfigAction({ enabled: false }));
        await imService.updateConfig({ [platform]: { ...config[platform], enabled: false } });
      } else {
        await runConnectivityTest(platform, {
          [platform]: { ...config[platform], enabled: true },
        } as Partial<IMGatewayConfig>);
      }
    } else {
      await imService.stopGateway(platform);
    }
  };

  const dingtalkConnected = status.dingtalk.connected;
  const feishuConnected = status.feishu.connected;
  const telegramConnected = status.telegram.connected;
  const discordConnected = status.discord.connected;

  // 根据语言计算可见平台
  const platforms = useMemo<IMPlatform[]>(() => {
    return getVisibleIMPlatforms(language) as IMPlatform[];
  }, [language]);

  // 当语言变更时确保活动平台始终在可见平台中
  useEffect(() => {
    if (platforms.length > 0 && !platforms.includes(activePlatform)) {
      // 如果当前活动平台不可见，切换到第一个可见平台
      setActivePlatform(platforms[0]);
    }
  }, [platforms, activePlatform]);

  // 检查平台是否可以启动
  const canStart = (platform: IMPlatform): boolean => {
    if (platform === 'dingtalk') {
      return !!(config.dingtalk.clientId && config.dingtalk.clientSecret);
    }
    if (platform === 'telegram') {
      return !!config.telegram.botToken;
    }
    if (platform === 'discord') {
      return !!config.discord.botToken;
    }
    return !!(config.feishu.appId && config.feishu.appSecret);
  };

  // 获取平台启用状态（持久化的切换状态）
  const isPlatformEnabled = (platform: IMPlatform): boolean => {
    return config[platform].enabled;
  };

  // 获取平台连接状态（运行时状态）
  const getPlatformConnected = (platform: IMPlatform): boolean => {
    if (platform === 'dingtalk') return dingtalkConnected;
    if (platform === 'telegram') return telegramConnected;
    if (platform === 'discord') return discordConnected;
    return feishuConnected;
  };

  // 获取平台瞬时启动状态
  const getPlatformStarting = (platform: IMPlatform): boolean => {
    if (platform === 'discord') return status.discord.starting;
    return false;
  };

  const handleConnectivityTest = async (platform: IMPlatform) => {
    setConnectivityModalPlatform(platform);
    await runConnectivityTest(platform, {
      [platform]: config[platform],
    } as Partial<IMGatewayConfig>);
  };

  // 处理平台切换
  const handlePlatformToggle = (platform: IMPlatform) => {
    const isEnabled = isPlatformEnabled(platform);
    // 如果凭据存在则可以开启，始终可以关闭
    const canToggle = isEnabled || canStart(platform);
    if (canToggle && !isLoading) {
      setActivePlatform(platform);
      toggleGateway(platform);
    }
  };

  const renderConnectivityTestButton = (platform: IMPlatform) => (
    <button
      type="button"
      onClick={() => handleConnectivityTest(platform)}
      disabled={isLoading || testingPlatform === platform}
      className="inline-flex items-center px-3 py-1.5 text-xs font-medium rounded-xl border dark:border-claude-darkBorder border-claude-border dark:text-claude-darkText text-claude-text dark:hover:bg-claude-darkSurfaceHover hover:bg-claude-surfaceHover disabled:opacity-50 disabled:cursor-not-allowed transition-colors active:scale-[0.98]"
    >
      <SignalIcon className="h-3.5 w-3.5 mr-1.5" />
      {testingPlatform === platform
        ? i18nService.t('imConnectivityTesting')
        : connectivityResults[platform]
          ? i18nService.t('imConnectivityRetest')
          : i18nService.t('imConnectivityTest')}
    </button>
  );

  useEffect(() => {
    if (!connectivityModalPlatform) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setConnectivityModalPlatform(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [connectivityModalPlatform]);

  return (
    <div className="flex h-full gap-4">
      {/* 平台列表 - 左侧 */}
      <div className="w-48 flex-shrink-0 border-r dark:border-claude-darkBorder border-claude-border pr-3 space-y-2 overflow-y-auto">
        {platforms.map((platform) => {
          const meta = platformMeta[platform];
          const isEnabled = isPlatformEnabled(platform);
          const isConnected = getPlatformConnected(platform) || getPlatformStarting(platform);
          const canToggle = isEnabled || canStart(platform);
          return (
            <div
              key={platform}
              onClick={() => setActivePlatform(platform)}
              className={`flex items-center p-2 rounded-xl cursor-pointer transition-colors ${
                activePlatform === platform
                  ? 'bg-claude-accent/10 dark:bg-claude-accent/20 border border-claude-accent/30'
                  : 'bg-claude-surfaceHover/80 dark:bg-claude-darkSurface/55 dark:bg-gradient-to-br dark:from-claude-darkSurface/70 dark:to-claude-darkSurfaceHover/70 hover:bg-claude-surface dark:hover:from-claude-darkSurface/80 dark:hover:to-claude-darkSurfaceHover/80 dark:border-claude-darkBorder/70 border-claude-border/80 border'
              }`}
            >
              <div className="flex flex-1 items-center">
                <div className="mr-2 flex h-7 w-7 items-center justify-center">
                  <img
                    src={meta.logo}
                    alt={meta.label}
                    className="w-6 h-6 object-contain"
                  />
                </div>
                <span className={`text-sm font-medium truncate ${
                  activePlatform === platform
                    ? 'text-claude-accent'
                    : 'dark:text-claude-darkText text-claude-text'
                }`}>
                  {i18nService.t(platform)}
                </span>
              </div>
              <div className="flex items-center ml-2">
                <div
                  className={`w-7 h-4 rounded-full flex items-center transition-colors ${
                    isEnabled
                      ? (isConnected ? 'bg-green-500' : 'bg-yellow-500')
                      : 'dark:bg-claude-darkBorder bg-claude-border'
                  } ${!canToggle ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    handlePlatformToggle(platform);
                  }}
                >
                  <div
                    className={`w-3 h-3 rounded-full bg-white shadow-md transform transition-transform ${
                      isEnabled ? 'translate-x-3.5' : 'translate-x-0.5'
                    }`}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* 平台设置 - 右侧 */}
      <div className="flex-1 min-w-0 space-y-4 overflow-y-auto">
        {/* 带状态的标题 */}
        <div className="flex items-center gap-3 pb-3 border-b dark:border-claude-darkBorder/60 border-claude-border/60">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-white dark:bg-claude-darkBorder/30 p-1">
              <img
                src={platformMeta[activePlatform].logo}
                alt={platformMeta[activePlatform].label}
                className="w-4 h-4 object-contain"
              />
            </div>
            <h3 className="text-sm font-medium dark:text-claude-darkText text-claude-text">
              {`${i18nService.t(activePlatform)}${i18nService.t('settings')}`}
            </h3>
          </div>
          <div className={`px-2 py-0.5 rounded-full text-xs font-medium ${
            getPlatformConnected(activePlatform) || getPlatformStarting(activePlatform)
              ? 'bg-green-500/15 text-green-600 dark:text-green-400'
              : 'bg-gray-500/15 text-gray-500 dark:text-gray-400'
          }`}>
            {getPlatformConnected(activePlatform)
              ? i18nService.t('connected')
              : getPlatformStarting(activePlatform)
                ? (i18nService.t('starting') || '启动中')
                : i18nService.t('disconnected')}
          </div>
        </div>

        {/* 钉钉设置 */}
        {activePlatform === 'dingtalk' && (
          <div className="space-y-3">
            {/* 客户端 ID */}
            <div className="space-y-1.5">
              <label className="block text-xs font-medium dark:text-claude-darkTextSecondary text-claude-textSecondary">
                客户端 ID (AppKey)
              </label>
              <input
                type="text"
                value={config.dingtalk.clientId}
                onChange={(e) => handleDingTalkChange('clientId', e.target.value)}
                onBlur={handleSaveConfig}
                className="block w-full rounded-lg dark:bg-claude-darkSurface/80 bg-claude-surface/80 dark:border-claude-darkBorder/60 border-claude-border/60 border focus:border-claude-accent focus:ring-1 focus:ring-claude-accent/30 dark:text-claude-darkText text-claude-text px-3 py-2 text-sm transition-colors"
                placeholder="dingxxxxxx"
              />
            </div>

            {/* 客户端密钥 */}
            <div className="space-y-1.5">
              <label className="block text-xs font-medium dark:text-claude-darkTextSecondary text-claude-textSecondary">
                客户端密钥 (AppSecret)
              </label>
              <input
                type="password"
                value={config.dingtalk.clientSecret}
                onChange={(e) => handleDingTalkChange('clientSecret', e.target.value)}
                onBlur={handleSaveConfig}
                className="block w-full rounded-lg dark:bg-claude-darkSurface/80 bg-claude-surface/80 dark:border-claude-darkBorder/60 border-claude-border/60 border focus:border-claude-accent focus:ring-1 focus:ring-claude-accent/30 dark:text-claude-darkText text-claude-text px-3 py-2 text-sm transition-colors"
                placeholder="••••••••••••"
              />
            </div>

            <div className="pt-1">
              {renderConnectivityTestButton('dingtalk')}
            </div>

            {/* 错误显示 */}
            {status.dingtalk.lastError && (
              <div className="text-xs text-red-500 bg-red-500/10 px-3 py-2 rounded-lg">
                {status.dingtalk.lastError}
              </div>
            )}
          </div>
        )}

        {/* 飞书设置 */}
        {activePlatform === 'feishu' && (
          <div className="space-y-3">
            {/* 应用 ID */}
            <div className="space-y-1.5">
              <label className="block text-xs font-medium dark:text-claude-darkTextSecondary text-claude-textSecondary">
                应用 ID
              </label>
              <input
                type="text"
                value={config.feishu.appId}
                onChange={(e) => handleFeishuChange('appId', e.target.value)}
                onBlur={handleSaveConfig}
                className="block w-full rounded-lg dark:bg-claude-darkSurface/80 bg-claude-surface/80 dark:border-claude-darkBorder/60 border-claude-border/60 border focus:border-claude-accent focus:ring-1 focus:ring-claude-accent/30 dark:text-claude-darkText text-claude-text px-3 py-2 text-sm transition-colors"
                placeholder="cli_xxxxx"
              />
            </div>

            {/* 应用密钥 */}
            <div className="space-y-1.5">
              <label className="block text-xs font-medium dark:text-claude-darkTextSecondary text-claude-textSecondary">
                应用密钥
              </label>
              <input
                type="password"
                value={config.feishu.appSecret}
                onChange={(e) => handleFeishuChange('appSecret', e.target.value)}
                onBlur={handleSaveConfig}
                className="block w-full rounded-lg dark:bg-claude-darkSurface/80 bg-claude-surface/80 dark:border-claude-darkBorder/60 border-claude-border/60 border focus:border-claude-accent focus:ring-1 focus:ring-claude-accent/30 dark:text-claude-darkText text-claude-text px-3 py-2 text-sm transition-colors"
                placeholder="••••••••••••"
              />
            </div>

            <div className="pt-1">
              {renderConnectivityTestButton('feishu')}
            </div>

            {/* 错误显示 */}
            {status.feishu.error && (
              <div className="text-xs text-red-500 bg-red-500/10 px-3 py-2 rounded-lg">
                {status.feishu.error}
              </div>
            )}
          </div>
        )}

        {/* Telegram 设置 */}
        {activePlatform === 'telegram' && (
          <div className="space-y-3">
            {/* 机器人令牌 */}
            <div className="space-y-1.5">
              <label className="block text-xs font-medium dark:text-claude-darkTextSecondary text-claude-textSecondary">
                机器人令牌
              </label>
              <input
                type="password"
                value={config.telegram.botToken}
                onChange={(e) => handleTelegramChange('botToken', e.target.value)}
                onBlur={handleSaveConfig}
                className="block w-full rounded-lg dark:bg-claude-darkSurface/80 bg-claude-surface/80 dark:border-claude-darkBorder/60 border-claude-border/60 border focus:border-claude-accent focus:ring-1 focus:ring-claude-accent/30 dark:text-claude-darkText text-claude-text px-3 py-2 text-sm transition-colors"
                placeholder="123456789:ABCdefGHIjklMNOpqrsTUVwxyz"
              />
              <p className="text-xs text-claude-textSecondary dark:text-claude-darkTextSecondary">
                {i18nService.t('telegramTokenHint') || '从 @BotFather 获取 Bot Token'}
              </p>
            </div>

            <div className="pt-1">
              {renderConnectivityTestButton('telegram')}
            </div>

            {/* 机器人用户名显示 */}
            {status.telegram.botUsername && (
              <div className="text-xs text-green-600 dark:text-green-400 bg-green-500/10 px-3 py-2 rounded-lg">
                机器人: @{status.telegram.botUsername}
              </div>
            )}

            {/* 错误显示 */}
            {status.telegram.lastError && (
              <div className="text-xs text-red-500 bg-red-500/10 px-3 py-2 rounded-lg">
                {status.telegram.lastError}
              </div>
            )}
          </div>
        )}

        {/* Discord 设置 */}
        {activePlatform === 'discord' && (
          <div className="space-y-3">
            {/* 机器人令牌 */}
            <div className="space-y-1.5">
              <label className="block text-xs font-medium dark:text-claude-darkTextSecondary text-claude-textSecondary">
                机器人令牌
              </label>
              <input
                type="password"
                value={config.discord.botToken}
                onChange={(e) => handleDiscordChange('botToken', e.target.value)}
                onBlur={handleSaveConfig}
                className="block w-full rounded-lg dark:bg-claude-darkSurface/80 bg-claude-surface/80 dark:border-claude-darkBorder/60 border-claude-border/60 border focus:border-claude-accent focus:ring-1 focus:ring-claude-accent/30 dark:text-claude-darkText text-claude-text px-3 py-2 text-sm transition-colors"
                placeholder="MTIzNDU2Nzg5MDEyMzQ1Njc4OQ..."
              />
              <p className="text-xs text-claude-textSecondary dark:text-claude-darkTextSecondary">
                从 Discord Developer Portal 获取 Bot Token
              </p>
            </div>

            <div className="pt-1">
              {renderConnectivityTestButton('discord')}
            </div>

            {/* 机器人用户名显示 */}
            {status.discord.botUsername && (
              <div className="text-xs text-green-600 dark:text-green-400 bg-green-500/10 px-3 py-2 rounded-lg">
                机器人: {status.discord.botUsername}
              </div>
            )}

            {/* 错误显示 */}
            {status.discord.lastError && (
              <div className="text-xs text-red-500 bg-red-500/10 px-3 py-2 rounded-lg">
                {status.discord.lastError}
              </div>
            )}
          </div>
        )}

        {connectivityModalPlatform && (
          <div
            className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
            onClick={() => setConnectivityModalPlatform(null)}
          >
            <div
              className="w-full max-w-2xl dark:bg-claude-darkSurface bg-claude-surface rounded-2xl shadow-modal border dark:border-claude-darkBorder border-claude-border overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-4 py-3 border-b dark:border-claude-darkBorder border-claude-border flex items-center justify-between">
                <div className="text-sm font-semibold dark:text-claude-darkText text-claude-text">
                  {`${i18nService.t(connectivityModalPlatform)} ${i18nService.t('imConnectivitySectionTitle')}`}
                </div>
                <button
                  type="button"
                  aria-label={i18nService.t('close')}
                  onClick={() => setConnectivityModalPlatform(null)}
                  className="p-1 rounded-md dark:hover:bg-claude-darkSurfaceHover hover:bg-claude-surfaceHover dark:text-claude-darkTextSecondary text-claude-textSecondary"
                >
                  <XMarkIcon className="h-4 w-4" />
                </button>
              </div>

              <div className="p-4 max-h-[65vh] overflow-y-auto">
                {testingPlatform === connectivityModalPlatform ? (
                  <div className="text-sm dark:text-claude-darkTextSecondary text-claude-textSecondary">
                    {i18nService.t('imConnectivityTesting')}
                  </div>
                ) : connectivityResults[connectivityModalPlatform] ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${verdictColorClass[connectivityResults[connectivityModalPlatform]!.verdict]}`}>
                        {connectivityResults[connectivityModalPlatform]!.verdict === 'pass' ? (
                          <CheckCircleIcon className="h-3.5 w-3.5" />
                        ) : connectivityResults[connectivityModalPlatform]!.verdict === 'warn' ? (
                          <ExclamationTriangleIcon className="h-3.5 w-3.5" />
                        ) : (
                          <XCircleIcon className="h-3.5 w-3.5" />
                        )}
                        {i18nService.t(`imConnectivityVerdict_${connectivityResults[connectivityModalPlatform]!.verdict}`)}
                      </div>
                      <div className="text-[11px] dark:text-claude-darkTextSecondary text-claude-textSecondary">
                        {`${i18nService.t('imConnectivityLastChecked')}: ${formatTestTime(connectivityResults[connectivityModalPlatform]!.testedAt)}`}
                      </div>
                    </div>

                    <div className="space-y-2">
                      {connectivityResults[connectivityModalPlatform]!.checks.map((check, index) => (
                        <div
                          key={`${check.code}-${index}`}
                          className="rounded-lg border dark:border-claude-darkBorder/60 border-claude-border/60 px-2.5 py-2 dark:bg-claude-darkSurface/25 bg-white/70"
                        >
                          <div className={`text-xs font-medium ${checkLevelColorClass[check.level]}`}>
                            {getCheckTitle(check.code)}
                          </div>
                          <div className="mt-1 text-xs dark:text-claude-darkTextSecondary text-claude-textSecondary">
                            {check.message}
                          </div>
                          {getCheckSuggestion(check) && (
                            <div className="mt-1 text-[11px] dark:text-claude-darkTextSecondary text-claude-textSecondary">
                              {`${i18nService.t('imConnectivitySuggestion')}: ${getCheckSuggestion(check)}`}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="text-sm dark:text-claude-darkTextSecondary text-claude-textSecondary">
                    {i18nService.t('imConnectivityNoResult')}
                  </div>
                )}
              </div>

              <div className="px-4 py-3 border-t dark:border-claude-darkBorder border-claude-border flex items-center justify-end">
                {renderConnectivityTestButton(connectivityModalPlatform)}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default IMSettings;
