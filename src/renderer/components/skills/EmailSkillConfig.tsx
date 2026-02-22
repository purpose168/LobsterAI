import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ChevronDownIcon,
  ChevronUpIcon,
  SignalIcon,
  CheckCircleIcon,
  XCircleIcon,
} from '@heroicons/react/24/outline';
import { i18nService } from '../../services/i18n';
import { skillService } from '../../services/skill';

const SKILL_ID = 'imap-smtp-email';

/**
 * 邮件服务提供商预设配置接口
 * @property label - 提供商显示名称
 * @property imapHost - IMAP 服务器地址
 * @property imapPort - IMAP 服务器端口
 * @property smtpHost - SMTP 服务器地址
 * @property smtpPort - SMTP 服务器端口
 * @property smtpSecure - SMTP 是否使用 SSL/TLS 安全连接
 * @property hint - 提示信息的国际化键值（可选）
 */
interface ProviderPreset {
  label: string;
  imapHost: string;
  imapPort: string;
  smtpHost: string;
  smtpPort: string;
  smtpSecure: string;
  hint?: string;
}

/**
 * 邮件连接性检查结果
 * @property code - 检查类型：IMAP 连接或 SMTP 连接
 * @property level - 检查结果级别：通过或失败
 * @property message - 检查结果消息
 * @property durationMs - 检查耗时（毫秒）
 */
type EmailConnectivityCheck = {
  code: 'imap_connection' | 'smtp_connection';
  level: 'pass' | 'fail';
  message: string;
  durationMs: number;
};

/**
 * 邮件连接性测试结果
 * @property testedAt - 测试时间戳
 * @property verdict - 总体判定：通过或失败
 * @property checks - 各项检查结果列表
 */
type EmailConnectivityTestResult = {
  testedAt: number;
  verdict: 'pass' | 'fail';
  checks: EmailConnectivityCheck[];
};

/**
 * 邮件服务提供商预设配置
 * 包含常用邮件服务商的 IMAP/SMTP 服务器配置信息
 */
const PROVIDER_PRESETS: Record<string, ProviderPreset> = {
  gmail: {
    label: 'Gmail',
    imapHost: 'imap.gmail.com',
    imapPort: '993',
    smtpHost: 'smtp.gmail.com',
    smtpPort: '587',
    smtpSecure: 'false',
    hint: 'emailHintGmail',
  },
  outlook: {
    label: 'Outlook',
    imapHost: 'outlook.office365.com',
    imapPort: '993',
    smtpHost: 'smtp.office365.com',
    smtpPort: '587',
    smtpSecure: 'false',
  },
  '163': {
    label: '163.com',
    imapHost: 'imap.163.com',
    imapPort: '993',
    smtpHost: 'smtp.163.com',
    smtpPort: '465',
    smtpSecure: 'true',
    hint: 'emailHint163',
  },
  '126': {
    label: '126.com',
    imapHost: 'imap.126.com',
    imapPort: '993',
    smtpHost: 'smtp.126.com',
    smtpPort: '465',
    smtpSecure: 'true',
    hint: 'emailHint163',
  },
  qq: {
    label: 'QQ Mail',
    imapHost: 'imap.qq.com',
    imapPort: '993',
    smtpHost: 'smtp.qq.com',
    smtpPort: '587',
    smtpSecure: 'false',
    hint: 'emailHintQQ',
  },
  custom: {
    label: '',
    imapHost: '',
    imapPort: '993',
    smtpHost: '',
    smtpPort: '587',
    smtpSecure: 'false',
  },
};

/**
 * 根据配置信息检测邮件服务提供商
 * @param config - 邮件配置对象
 * @returns 提供商标识符（如 'gmail'、'outlook'、'163'、'126'、'qq'、'custom' 或空字符串）
 */
const detectProvider = (config: Record<string, string>): string => {
  const imapHost = (config.IMAP_HOST || '').toLowerCase();
  if (imapHost.includes('gmail')) return 'gmail';
  if (imapHost.includes('outlook') || imapHost.includes('office365')) return 'outlook';
  if (imapHost === 'imap.163.com') return '163';
  if (imapHost === 'imap.126.com') return '126';
  if (imapHost.includes('qq.com')) return 'qq';
  if (imapHost) return 'custom';
  return '';
};

/**
 * 邮件技能配置组件属性接口
 * @property onClose - 关闭回调函数（可选）
 */
interface EmailSkillConfigProps {
  onClose?: () => void;
}

/**
 * 邮件技能配置组件
 * 用于配置 IMAP/SMTP 邮件连接参数，支持多种邮件服务提供商预设配置
 */
const EmailSkillConfig: React.FC<EmailSkillConfigProps> = ({ onClose }) => {
  // 邮件服务提供商选择状态
  const [provider, setProvider] = useState('');
  // 邮箱地址
  const [email, setEmail] = useState('');
  // 邮箱密码/授权码
  const [password, setPassword] = useState('');
  // 是否显示高级设置
  const [showAdvanced, setShowAdvanced] = useState(false);
  // IMAP 服务器地址
  const [imapHost, setImapHost] = useState('');
  // IMAP 服务器端口
  const [imapPort, setImapPort] = useState('993');
  // SMTP 服务器地址
  const [smtpHost, setSmtpHost] = useState('');
  // SMTP 服务器端口
  const [smtpPort, setSmtpPort] = useState('587');
  // SMTP 是否使用 SSL 安全连接
  const [smtpSecure, setSmtpSecure] = useState('false');
  // IMAP 是否使用 TLS 加密
  const [imapTls, setImapTls] = useState('true');
  // 默认邮箱文件夹
  const [mailbox, setMailbox] = useState('INBOX');
  // 加载状态
  const [loading, setLoading] = useState(true);
  // 是否正在保存配置
  const [isPersisting, setIsPersisting] = useState(false);
  // 保存错误信息
  const [persistError, setPersistError] = useState<string | null>(null);
  // 是否正在测试连接
  const [isTesting, setIsTesting] = useState(false);
  // 连接测试结果
  const [connectivityResult, setConnectivityResult] = useState<EmailConnectivityTestResult | null>(null);
  // 连接测试错误信息
  const [connectivityError, setConnectivityError] = useState<string | null>(null);

  // 组件挂载状态引用
  const isMountedRef = useRef(true);
  // 是否正在保存中的引用
  const persistInFlightRef = useRef(false);
  // 是否有待保存队列的引用
  const persistQueuedRef = useRef(false);
  // 最新配置引用
  const latestConfigRef = useRef<Record<string, string>>({});

  /**
   * 组件挂载时加载已保存的邮件配置
   */
  useEffect(() => {
    const loadConfig = async () => {
      const config = await skillService.getSkillConfig(SKILL_ID);
      if (config.IMAP_USER) setEmail(config.IMAP_USER);
      if (config.IMAP_PASS) setPassword(config.IMAP_PASS);
      if (config.IMAP_HOST) setImapHost(config.IMAP_HOST);
      if (config.IMAP_PORT) setImapPort(config.IMAP_PORT);
      if (config.SMTP_HOST) setSmtpHost(config.SMTP_HOST);
      if (config.SMTP_PORT) setSmtpPort(config.SMTP_PORT);
      if (config.SMTP_SECURE) setSmtpSecure(config.SMTP_SECURE);
      if (config.IMAP_TLS) setImapTls(config.IMAP_TLS);
      if (config.IMAP_MAILBOX) setMailbox(config.IMAP_MAILBOX);

      const detected = detectProvider(config);
      if (detected) setProvider(detected);

      setLoading(false);
    };
    loadConfig();
  }, []);

  /**
   * 组件卸载时清理挂载状态
   */
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  /**
   * 构建邮件配置对象
   * @returns 包含所有 IMAP/SMTP 配置参数的对象
   */
  const buildConfig = useCallback((): Record<string, string> => ({
    IMAP_HOST: imapHost,
    IMAP_PORT: imapPort,
    IMAP_USER: email,
    IMAP_PASS: password,
    IMAP_TLS: imapTls,
    IMAP_REJECT_UNAUTHORIZED: 'true',
    IMAP_MAILBOX: mailbox,
    SMTP_HOST: smtpHost,
    SMTP_PORT: smtpPort,
    SMTP_SECURE: smtpSecure,
    SMTP_USER: email,
    SMTP_PASS: password,
    SMTP_FROM: email,
    SMTP_REJECT_UNAUTHORIZED: 'true',
  }), [
    email,
    imapHost,
    imapPort,
    imapTls,
    mailbox,
    password,
    smtpHost,
    smtpPort,
    smtpSecure,
  ]);

  /**
   * 同步更新最新配置引用
   */
  useEffect(() => {
    latestConfigRef.current = buildConfig();
  }, [buildConfig]);

  /**
   * 执行保存队列中的配置持久化操作
   * 使用队列机制避免频繁保存请求
   */
  const flushPersistQueue = useCallback(async () => {
    if (persistInFlightRef.current) {
      return;
    }
    persistInFlightRef.current = true;
    if (isMountedRef.current) {
      setIsPersisting(true);
    }

    while (persistQueuedRef.current) {
      persistQueuedRef.current = false;
      const success = await skillService.setSkillConfig(SKILL_ID, latestConfigRef.current);
      if (!isMountedRef.current) {
        continue;
      }
      if (success) {
        setPersistError(null);
      } else {
        setPersistError(i18nService.t('emailConfigError'));
      }
    }

    persistInFlightRef.current = false;
    if (isMountedRef.current) {
      setIsPersisting(false);
    }
  }, []);

  /**
   * 将配置保存操作加入队列
   * 更新最新配置并触发异步保存
   */
  const queuePersist = useCallback(() => {
    latestConfigRef.current = buildConfig();
    persistQueuedRef.current = true;
    void flushPersistQueue();
  }, [buildConfig, flushPersistQueue]);

  /**
   * 处理邮件服务提供商选择变更
   * 当选择预设提供商时，自动填充对应的服务器配置
   * @param newProvider - 新选择的提供商标识符
   */
  const handleProviderChange = (newProvider: string) => {
    setProvider(newProvider);
    if (newProvider && newProvider !== 'custom') {
      const preset = PROVIDER_PRESETS[newProvider];
      if (preset) {
        setImapHost(preset.imapHost);
        setImapPort(preset.imapPort);
        setSmtpHost(preset.smtpHost);
        setSmtpPort(preset.smtpPort);
        setSmtpSecure(preset.smtpSecure);
        setImapTls('true');
      }
    }
  };

  /**
   * 处理邮件连接性测试
   * 测试 IMAP 和 SMTP 服务器的连接状态
   */
  const handleConnectivityTest = async () => {
    setConnectivityError(null);
    setConnectivityResult(null);
    setIsTesting(true);
    const result = await skillService.testEmailConnectivity(SKILL_ID, buildConfig());
    if (result) {
      setConnectivityResult(result);
    } else {
      setConnectivityError(i18nService.t('connectionFailed'));
    }
    setIsTesting(false);
  };

  // 获取当前提供商预设配置
  const currentPreset = provider ? PROVIDER_PRESETS[provider] : null;
  // 提示信息的国际化键值
  const hintKey = currentPreset?.hint;
  // 是否可以进行连接测试（邮箱和密码已填写）
  const canTest = Boolean(email && password && imapHost && smtpHost);
  // 连接测试是否通过
  const connectivityPassed = connectivityResult?.verdict === 'pass';

  // 输入框样式类名
  const inputClassName = 'block w-full rounded-xl bg-claude-surfaceInset dark:bg-claude-darkSurfaceInset dark:border-claude-darkBorder border-claude-border border focus:border-claude-accent focus:ring-1 focus:ring-claude-accent/30 dark:text-claude-darkText text-claude-text px-3 py-2 text-xs';
  // 标签样式类名
  const labelClassName = 'block text-xs font-medium dark:text-claude-darkText text-claude-text mb-1';

  // 加载中状态显示
  if (loading) {
    return (
      <div className="p-4 text-xs dark:text-claude-darkTextSecondary text-claude-textSecondary">
        {i18nService.t('loading')}...
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4 rounded-xl border dark:border-claude-darkBorder border-claude-border dark:bg-claude-darkSurface/30 bg-claude-surface/30">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium dark:text-claude-darkText text-claude-text">
          {i18nService.t('emailConfig')}
        </h4>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="text-xs dark:text-claude-darkTextSecondary text-claude-textSecondary hover:text-claude-accent transition-colors"
          >
            {i18nService.t('collapse')}
          </button>
        )}
      </div>
      {(isPersisting || persistError) && (
        <div className={`text-xs ${persistError ? 'text-red-600 dark:text-red-400' : 'text-claude-textSecondary dark:text-claude-darkTextSecondary'}`}>
          {persistError || `${i18nService.t('saving')}...`}
        </div>
      )}

      {/* 提供商选择 */}
      <div>
        <label className={labelClassName}>{i18nService.t('emailProvider')}</label>
        <select
          value={provider}
          onChange={(e) => handleProviderChange(e.target.value)}
          onBlur={queuePersist}
          className={inputClassName}
        >
          <option value="">{i18nService.t('emailSelectProvider')}</option>
          {Object.entries(PROVIDER_PRESETS).map(([key, preset]) => (
            <option key={key} value={key}>
              {key === 'custom' ? i18nService.t('emailCustomProvider') : preset.label}
            </option>
          ))}
        </select>
      </div>

      {/* 提示信息 */}
      {hintKey && (
        <div className="text-xs dark:text-claude-darkTextSecondary text-claude-textSecondary bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg px-3 py-2">
          {i18nService.t(hintKey)}
        </div>
      )}

      {/* 邮箱地址 */}
      <div>
        <label className={labelClassName}>{i18nService.t('emailAddress')}</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onBlur={queuePersist}
          className={inputClassName}
          placeholder="your@email.com"
        />
      </div>

      {/* 邮箱密码 */}
      <div>
        <label className={labelClassName}>{i18nService.t('emailPassword')}</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onBlur={queuePersist}
          className={inputClassName}
          placeholder={i18nService.t('emailPasswordPlaceholder')}
        />
      </div>

      {/* 高级设置切换按钮 */}
      <button
        type="button"
        onClick={() => setShowAdvanced(!showAdvanced)}
        className="flex items-center gap-1 text-xs dark:text-claude-darkTextSecondary text-claude-textSecondary hover:text-claude-accent transition-colors"
      >
        {showAdvanced ? (
          <ChevronUpIcon className="h-3.5 w-3.5" />
        ) : (
          <ChevronDownIcon className="h-3.5 w-3.5" />
        )}
        {i18nService.t('emailAdvancedSettings')}
      </button>

      {/* 高级设置面板 */}
      {showAdvanced && (
        <div className="space-y-3 pl-2 border-l-2 border-claude-border dark:border-claude-darkBorder">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClassName}>IMAP 服务器</label>
              <input
                type="text"
                value={imapHost}
                onChange={(e) => setImapHost(e.target.value)}
                onBlur={queuePersist}
                className={inputClassName}
                placeholder="imap.example.com"
              />
            </div>
            <div>
              <label className={labelClassName}>IMAP 端口</label>
              <input
                type="text"
                value={imapPort}
                onChange={(e) => setImapPort(e.target.value)}
                onBlur={queuePersist}
                className={inputClassName}
                placeholder="993"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClassName}>SMTP 服务器</label>
              <input
                type="text"
                value={smtpHost}
                onChange={(e) => setSmtpHost(e.target.value)}
                onBlur={queuePersist}
                className={inputClassName}
                placeholder="smtp.example.com"
              />
            </div>
            <div>
              <label className={labelClassName}>SMTP 端口</label>
              <input
                type="text"
                value={smtpPort}
                onChange={(e) => setSmtpPort(e.target.value)}
                onBlur={queuePersist}
                className={inputClassName}
                placeholder="587"
              />
            </div>
          </div>

          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-xs dark:text-claude-darkText text-claude-text">
              <input
                type="checkbox"
                checked={imapTls === 'true'}
                onChange={(e) => setImapTls(e.target.checked ? 'true' : 'false')}
                onBlur={queuePersist}
                className="h-3.5 w-3.5 text-claude-accent focus:ring-claude-accent rounded"
              />
              IMAP TLS 加密
            </label>
            <label className="flex items-center gap-2 text-xs dark:text-claude-darkText text-claude-text">
              <input
                type="checkbox"
                checked={smtpSecure === 'true'}
                onChange={(e) => setSmtpSecure(e.target.checked ? 'true' : 'false')}
                onBlur={queuePersist}
                className="h-3.5 w-3.5 text-claude-accent focus:ring-claude-accent rounded"
              />
              SMTP SSL 加密
            </label>
          </div>

          <div>
            <label className={labelClassName}>{i18nService.t('emailMailbox')}</label>
            <input
              type="text"
              value={mailbox}
              onChange={(e) => setMailbox(e.target.value)}
              onBlur={queuePersist}
              className={inputClassName}
              placeholder="INBOX"
            />
          </div>
        </div>
      )}

      {/* 连接测试 */}
      <div className="space-y-3 pt-1">
        <button
          type="button"
          onClick={handleConnectivityTest}
          disabled={isTesting || !canTest}
          className="inline-flex items-center px-3 py-1.5 text-xs font-medium rounded-xl border dark:border-claude-darkBorder border-claude-border dark:text-claude-darkText text-claude-text dark:hover:bg-claude-darkSurfaceHover hover:bg-claude-surfaceHover disabled:opacity-50 disabled:cursor-not-allowed transition-colors active:scale-[0.98]"
        >
          <SignalIcon className="h-3.5 w-3.5 mr-1.5" />
          {isTesting ? i18nService.t('imConnectivityTesting') : i18nService.t('imConnectivityTest')}
        </button>

        {connectivityError && (
          <div className="text-xs text-red-600 dark:text-red-400">
            {connectivityError}
          </div>
        )}

        {connectivityResult && (
          <div className="space-y-2">
            <div className={`flex items-center gap-1 text-xs ${connectivityPassed ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
              {connectivityPassed ? (
                <CheckCircleIcon className="h-4 w-4" />
              ) : (
                <XCircleIcon className="h-4 w-4" />
              )}
              <span>
                {connectivityPassed ? i18nService.t('connectionSuccess') : i18nService.t('connectionFailed')}
              </span>
              <span className="text-[11px] text-claude-textSecondary dark:text-claude-darkTextSecondary">
                {new Date(connectivityResult.testedAt).toLocaleString()}
              </span>
            </div>
            <div className="space-y-1.5">
              {connectivityResult.checks.map((check) => {
                const checkPassed = check.level === 'pass';
                const checkLabel = check.code === 'imap_connection' ? 'IMAP' : 'SMTP';
                return (
                  <div
                    key={check.code}
                    className="rounded-lg border dark:border-claude-darkBorder/60 border-claude-border/60 px-2.5 py-2 dark:bg-claude-darkSurface/25 bg-white/70"
                  >
                    <div className={`flex items-center gap-1 text-xs font-medium ${checkPassed ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                      {checkPassed ? (
                        <CheckCircleIcon className="h-3.5 w-3.5" />
                      ) : (
                        <XCircleIcon className="h-3.5 w-3.5" />
                      )}
                      <span>{checkLabel}</span>
                    </div>
                    <div className="mt-1 text-xs dark:text-claude-darkTextSecondary text-claude-textSecondary">
                      {check.message}
                    </div>
                    <div className="mt-1 text-[11px] dark:text-claude-darkTextSecondary text-claude-textSecondary">
                      {`${check.durationMs}ms`}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default EmailSkillConfig;
