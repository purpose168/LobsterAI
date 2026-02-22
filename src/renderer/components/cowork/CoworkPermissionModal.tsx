import React, { useEffect, useMemo, useState } from 'react';
import type { CoworkPermissionRequest, CoworkPermissionResult } from '../../types/cowork';
import { ExclamationTriangleIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { i18nService } from '../../services/i18n';

/**
 * 协作权限模态框组件属性接口
 */
interface CoworkPermissionModalProps {
  permission: CoworkPermissionRequest; // 权限请求信息
  onRespond: (result: CoworkPermissionResult) => void; // 响应回调函数
}

/**
 * 问题选项类型定义
 */
type QuestionOption = {
  label: string; // 选项标签
  description?: string; // 选项描述（可选）
};

/**
 * 问题项类型定义
 */
type QuestionItem = {
  question: string; // 问题内容
  header?: string; // 问题标题（可选）
  options: QuestionOption[]; // 选项列表
  multiSelect?: boolean; // 是否允许多选（可选）
};

/**
 * 协作权限模态框组件
 * 用于显示权限请求并让用户批准或拒绝
 */
const CoworkPermissionModal: React.FC<CoworkPermissionModalProps> = ({
  permission,
  onRespond,
}) => {
  // 获取工具输入参数，默认为空对象
  const toolInput = permission.toolInput ?? {};

  // 解析问题列表（仅当工具为 AskUserQuestion 时）
  const questions = useMemo<QuestionItem[]>(() => {
    if (permission.toolName !== 'AskUserQuestion') return [];
    if (!toolInput || typeof toolInput !== 'object') return [];
    const rawQuestions = (toolInput as Record<string, unknown>).questions;
    if (!Array.isArray(rawQuestions)) return [];

    return rawQuestions
      .map((question) => {
        if (!question || typeof question !== 'object') return null;
        const record = question as Record<string, unknown>;
        // 解析选项列表
        const options = Array.isArray(record.options)
          ? record.options
              .map((option) => {
                if (!option || typeof option !== 'object') return null;
                const optionRecord = option as Record<string, unknown>;
                if (typeof optionRecord.label !== 'string') return null;
                return {
                  label: optionRecord.label,
                  description: typeof optionRecord.description === 'string'
                    ? optionRecord.description
                    : undefined,
                } as QuestionOption;
              })
              .filter(Boolean) as QuestionOption[]
          : [];

        // 验证问题格式是否正确
        if (typeof record.question !== 'string' || options.length === 0) {
          return null;
        }

        return {
          question: record.question,
          header: typeof record.header === 'string' ? record.header : undefined,
          options,
          multiSelect: Boolean(record.multiSelect),
        } as QuestionItem;
      })
      .filter(Boolean) as QuestionItem[];
  }, [permission.toolName, toolInput]);

  // 判断是否为问题工具
  const isQuestionTool = questions.length > 0;

  // 存储用户回答的状态
  const [answers, setAnswers] = useState<Record<string, string>>({});

  // 初始化或更新回答状态
  useEffect(() => {
    if (!isQuestionTool) {
      setAnswers({});
      return;
    }

    // 从工具输入中获取初始回答
    const rawAnswers = (toolInput as Record<string, unknown>).answers;
    if (rawAnswers && typeof rawAnswers === 'object') {
      const initial: Record<string, string> = {};
      Object.entries(rawAnswers as Record<string, unknown>).forEach(([key, value]) => {
        if (typeof value === 'string') {
          initial[key] = value;
        }
      });
      setAnswers(initial);
    } else {
      setAnswers({});
    }
  }, [isQuestionTool, permission.requestId, toolInput]);

  /**
   * 格式化工具输入为可读字符串
   * @param input - 工具输入对象
   * @returns 格式化后的 JSON 字符串
   */
  const formatToolInput = (input: Record<string, unknown>): string => {
    try {
      return JSON.stringify(input, null, 2);
    } catch {
      return String(input);
    }
  };

  // 检测是否为危险的 Bash 命令
  const isDangerousBash = (() => {
    if (permission.toolName !== 'Bash') return false;
    const command = String((permission.toolInput as Record<string, unknown>)?.command ?? '');
    // 定义危险命令模式列表
    const dangerousPatterns = [
      /\brm\s+-rf?\b/i, // 删除命令
      /\bsudo\b/i, // 超级用户权限
      /\bdd\b/i, // 磁盘操作
      /\bmkfs\b/i, // 格式化文件系统
      /\bformat\b/i, // 格式化命令
      />\s*\/dev\//i, // 重定向到设备文件
    ];
    return dangerousPatterns.some(pattern => pattern.test(command));
  })();

  /**
   * 获取问题已选择的值
   * @param question - 问题项
   * @returns 已选择的值数组
   */
  const getSelectedValues = (question: QuestionItem): string[] => {
    const rawValue = answers[question.question] ?? '';
    if (!rawValue) return [];
    if (!question.multiSelect) return [rawValue];
    // 多选模式下，使用 '|||' 分隔符拆分值
    return rawValue
      .split('|||')
      .map((value) => value.trim())
      .filter(Boolean);
  };

  /**
   * 处理选项选择事件
   * @param question - 问题项
   * @param optionLabel - 选项标签
   */
  const handleSelectOption = (question: QuestionItem, optionLabel: string) => {
    setAnswers((prev) => {
      // 单选模式：直接替换
      if (!question.multiSelect) {
        return { ...prev, [question.question]: optionLabel };
      }

      // 多选模式：切换选项状态
      const rawValue = prev[question.question] ?? '';
      const current = new Set(
        rawValue
          .split('|||')
          .map((value) => value.trim())
          .filter(Boolean)
      );
      if (current.has(optionLabel)) {
        current.delete(optionLabel);
      } else {
        current.add(optionLabel);
      }

      return {
        ...prev,
        [question.question]: Array.from(current).join('|||'),
      };
    });
  };

  // 检查是否所有问题都已回答
  const isComplete = isQuestionTool
    ? questions.every((question) => (answers[question.question] ?? '').trim())
    : true;

  // 根据工具类型设置按钮标签
  const denyButtonLabel = isQuestionTool
    ? i18nService.t('coworkDenyRequest')
    : i18nService.t('coworkDeny');
  const approveButtonLabel = isQuestionTool
    ? i18nService.t('coworkConfirmSelection')
    : i18nService.t('coworkApprove');

  /**
   * 处理批准操作
   */
  const handleApprove = () => {
    if (isQuestionTool) {
      if (!isComplete) return;
      // 问题工具：返回带有用户回答的结果
      onRespond({
        behavior: 'allow',
        updatedInput: {
          ...(toolInput && typeof toolInput === 'object' ? toolInput : {}),
          answers,
        },
      });
      return;
    }

    // 其他工具：直接批准
    onRespond({
      behavior: 'allow',
      updatedInput: toolInput && typeof toolInput === 'object' ? toolInput : {},
    });
  };

  /**
   * 处理拒绝操作
   */
  const handleDeny = () => {
    onRespond({
      behavior: 'deny',
      message: '权限被拒绝',
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center modal-backdrop">
      <div className="modal-content w-full max-w-lg mx-4 dark:bg-claude-darkSurface bg-claude-surface rounded-2xl shadow-modal overflow-hidden">
        {/* 标题栏 */}
        <div className="flex items-center gap-3 px-6 py-4 border-b dark:border-claude-darkBorder border-claude-border">
          <div className="p-2 rounded-full bg-yellow-100 dark:bg-yellow-900/30">
            <ExclamationTriangleIcon className="h-6 w-6 text-yellow-600 dark:text-yellow-500" />
          </div>
          <div className="flex-1">
            <h2 className="text-lg font-semibold dark:text-claude-darkText text-claude-text">
              {i18nService.t('coworkPermissionRequired')}
            </h2>
            <p className="text-sm dark:text-claude-darkTextSecondary text-claude-textSecondary">
              {i18nService.t('coworkPermissionDescription')}
            </p>
          </div>
          <button
            onClick={handleDeny}
            className="p-2 rounded-lg dark:hover:bg-claude-darkSurfaceHover hover:bg-claude-surfaceHover dark:text-claude-darkTextSecondary text-claude-textSecondary transition-colors"
            aria-label="关闭"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        {/* 内容区域 */}
        <div className="px-6 py-4 space-y-4 max-h-[60vh] overflow-y-auto">
          {isQuestionTool ? (
            <>
              {questions.map((question) => {
                const selectedValues = getSelectedValues(question);
                return (
                  <div
                    key={question.question}
                    className="rounded-xl border dark:border-claude-darkBorder border-claude-border p-4 space-y-3"
                  >
                    <div className="flex items-start gap-2">
                      {question.header && (
                        <span className="text-[11px] uppercase tracking-wide px-2 py-1 rounded-full bg-claude-surfaceHover dark:bg-claude-darkSurfaceHover dark:text-claude-darkTextSecondary text-claude-textSecondary">
                          {question.header}
                        </span>
                      )}
                      <div className="text-sm font-medium dark:text-claude-darkText text-claude-text">
                        {question.question}
                      </div>
                    </div>
                    <div className="space-y-2">
                      {question.options.map((option) => {
                        const isSelected = selectedValues.includes(option.label);
                        return (
                          <button
                            key={option.label}
                            type="button"
                            onClick={() => handleSelectOption(question, option.label)}
                            className={`w-full text-left rounded-lg border px-3 py-2 transition-colors ${
                              isSelected
                                ? 'border-claude-accent bg-claude-accent/10 text-claude-text dark:text-claude-darkText'
                                : 'border-claude-border dark:border-claude-darkBorder dark:text-claude-darkTextSecondary text-claude-textSecondary hover:bg-claude-surfaceHover dark:hover:bg-claude-darkSurfaceHover'
                            }`}
                          >
                            <div className="text-sm font-medium">{option.label}</div>
                            {option.description && (
                              <div className="text-xs mt-1 opacity-80">{option.description}</div>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </>
          ) : (
            <>
              {/* 工具名称 */}
              <div>
                <label className="block text-xs font-medium dark:text-claude-darkTextSecondary text-claude-textSecondary uppercase tracking-wider mb-1">
                  {i18nService.t('coworkToolName')}
                </label>
                <div className="px-3 py-2 rounded-lg dark:bg-claude-darkBg bg-claude-bg">
                  <code className="text-sm dark:text-claude-darkText text-claude-text">
                    {permission.toolName}
                  </code>
                </div>
              </div>

              {/* 工具输入 */}
              <div>
                <label className="block text-xs font-medium dark:text-claude-darkTextSecondary text-claude-textSecondary uppercase tracking-wider mb-1">
                  {i18nService.t('coworkToolInput')}
                </label>
                <div className="px-3 py-2 rounded-lg dark:bg-claude-darkBg bg-claude-bg max-h-48 overflow-y-auto">
                  <pre className="text-xs dark:text-claude-darkText text-claude-text whitespace-pre-wrap break-words font-mono">
                    {formatToolInput(permission.toolInput)}
                  </pre>
                </div>
              </div>

              {/* 危险操作警告 */}
              {isDangerousBash && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
                  <ExclamationTriangleIcon className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-red-700 dark:text-red-400">
                    {i18nService.t('coworkDangerousOperation')}
                  </p>
                </div>
              )}
            </>
          )}
        </div>

        {/* 底部按钮栏 */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t dark:border-claude-darkBorder border-claude-border">
          <button
            onClick={handleDeny}
            className="px-4 py-2 text-sm font-medium rounded-lg dark:text-claude-darkTextSecondary text-claude-textSecondary dark:hover:bg-claude-darkSurfaceHover hover:bg-claude-surfaceHover transition-colors"
          >
            {denyButtonLabel}
          </button>
          <button
            onClick={handleApprove}
            disabled={!isComplete}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-claude-accent hover:bg-claude-accentHover text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {approveButtonLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export default CoworkPermissionModal;
