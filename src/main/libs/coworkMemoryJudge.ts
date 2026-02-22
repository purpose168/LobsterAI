import { resolveCurrentApiConfig } from './claudeSettings';
import type { CoworkMemoryGuardLevel } from './coworkMemoryExtractor';
import { isQuestionLikeMemoryText } from './coworkMemoryExtractor';

// 事实性个人档案信息正则表达式：匹配用户个人信息的陈述（如姓名、住址、职业、偏好等）
const FACTUAL_PROFILE_RE = /(我叫|我是|我的名字|我名字|我来自|我住在|我的职业|我有(?!\s*(?:一个|个)?问题)|我养了|我喜欢|我偏好|我习惯|\bmy\s+name\s+is\b|\bi\s+am\b|\bi['’]?m\b|\bi\s+live\s+in\b|\bi['’]?m\s+from\b|\bi\s+work\s+as\b|\bi\s+have\b|\bi\s+prefer\b|\bi\s+like\b|\bi\s+usually\b)/i;

// 临时性信息正则表达式：匹配时间相关的临时性表述（如今天、昨天、本周等）
const TRANSIENT_RE = /(今天|昨日|昨天|刚刚|刚才|本周|本月|临时|暂时|这次|当前|today|yesterday|this\s+week|this\s+month|temporary|for\s+now)/i;

// 过程性命令正则表达式：匹配命令行指令和脚本相关内容
const PROCEDURAL_RE = /(执行以下命令|run\s+(?:the\s+)?following\s+command|\b(?:cd|npm|pnpm|yarn|node|python|bash|sh|git|curl|wget)\b|\$[A-Z_][A-Z0-9_]*|&&|--[a-z0-9-]+|\/tmp\/|\.sh\b|\.bat\b|\.ps1\b)/i;

// 请求风格正则表达式：匹配以请求或命令开头的文本
const REQUEST_STYLE_RE = /^(?:请|麻烦|帮我|请你|帮忙|请帮我|use|please|can you|could you|would you)/i;

// 助手偏好风格正则表达式：匹配关于助手回复风格、语言、格式等偏好的表述
const ASSISTANT_STYLE_RE = /((请|以后|后续|默认|请始终|不要再|请不要|优先|务必).*(回复|回答|语言|中文|英文|格式|风格|语气|简洁|详细|代码|命名|markdown|respond|reply|language|format|style|tone))/i;

// LLM边界判定容差：当分数与阈值的差距在此范围内时，会调用LLM进行二次判断
const LLM_BORDERLINE_MARGIN = 0.08;

// LLM最低置信度：LLM判断结果必须达到的最低置信度阈值
const LLM_MIN_CONFIDENCE = 0.55;

// LLM超时时间（毫秒）：LLM请求的超时限制
const LLM_TIMEOUT_MS = 5000;

// LLM缓存最大容量：缓存中最多保存的判断结果数量
const LLM_CACHE_MAX_SIZE = 256;

// LLM缓存生存时间（毫秒）：缓存结果的有效期
const LLM_CACHE_TTL_MS = 10 * 60 * 1000;

// LLM输入最大字符数：发送给LLM的文本最大长度限制
const LLM_INPUT_MAX_CHARS = 280;

/**
 * 记忆判断输入接口
 * 定义了判断记忆候选项所需的输入参数
 */
export interface MemoryJudgeInput {
  /** 待判断的文本内容 */
  text: string;
  /** 是否为显式记忆（用户明确要求记忆的内容） */
  isExplicit: boolean;
  /** 记忆保护级别：控制记忆存储的严格程度 */
  guardLevel: CoworkMemoryGuardLevel;
  /** 是否启用LLM辅助判断（可选） */
  llmEnabled?: boolean;
}

/**
 * 记忆判断结果接口
 * 定义了记忆判断的输出结果
 */
export interface MemoryJudgeResult {
  /** 是否接受该记忆（true表示接受，false表示拒绝） */
  accepted: boolean;
  /** 判断分数（0-1之间，分数越高表示越应该被记忆） */
  score: number;
  /** 判断原因说明 */
  reason: string;
  /** 判断来源：'rule'表示基于规则判断，'llm'表示基于LLM判断 */
  source: 'rule' | 'llm';
}

/**
 * 缓存的LLM判断结果类型
 */
type CachedLlmJudgeResult = {
  /** 缓存的判断结果值 */
  value: MemoryJudgeResult;
  /** 缓存创建时间戳 */
  createdAt: number;
};

// LLM判断结果缓存：用于存储LLM的判断结果，避免重复调用
const llmJudgeCache = new Map<string, CachedLlmJudgeResult>();

/**
 * 根据保护级别计算判断阈值
 * @param isExplicit 是否为显式记忆
 * @param guardLevel 保护级别（strict/normal/relaxed）
 * @returns 判断阈值（0-1之间）
 */
function thresholdByGuardLevel(isExplicit: boolean, guardLevel: CoworkMemoryGuardLevel): number {
  // 显式记忆的阈值较低，因为用户明确要求记忆
  if (isExplicit) {
    if (guardLevel === 'strict') return 0.7;      // 严格模式：阈值0.7
    if (guardLevel === 'relaxed') return 0.52;    // 宽松模式：阈值0.52
    return 0.6;                                    // 正常模式：阈值0.6
  }
  // 非显式记忆的阈值较高，需要更严格的判断
  if (guardLevel === 'strict') return 0.8;        // 严格模式：阈值0.8
  if (guardLevel === 'relaxed') return 0.62;      // 宽松模式：阈值0.62
  return 0.72;                                     // 正常模式：阈值0.72
}

/**
 * 规范化文本：将多个空白字符合并为单个空格，并去除首尾空格
 * @param value 待规范化的文本
 * @returns 规范化后的文本
 */
function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * 将数值限制在[0, 1]区间内
 * @param value 待限制的数值
 * @returns 限制后的数值（0-1之间）
 */
function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

/**
 * 判断是否应该为边界情况调用LLM进行二次判断
 * @param score 规则判断分数
 * @param threshold 判断阈值
 * @param reason 判断原因
 * @returns 是否应该调用LLM
 */
function shouldCallLlmForBoundaryCase(score: number, threshold: number, reason: string): boolean {
  // 对于空文本、疑问句或过程性命令，不调用LLM
  if (reason === 'empty' || reason === 'question-like' || reason === 'procedural-like') {
    return false;
  }
  // 当分数与阈值的差距在边界容差范围内时，调用LLM进行二次判断
  return Math.abs(score - threshold) <= LLM_BORDERLINE_MARGIN;
}

/**
 * 构建LLM缓存键
 * @param input 记忆判断输入
 * @returns 缓存键字符串
 */
function buildLlmCacheKey(input: MemoryJudgeInput): string {
  return `${input.guardLevel}|${input.isExplicit ? 1 : 0}|${normalizeText(input.text)}`;
}

/**
 * 从缓存中获取LLM判断结果
 * @param key 缓存键
 * @returns 缓存的判断结果，如果不存在或已过期则返回null
 */
function getCachedLlmResult(key: string): MemoryJudgeResult | null {
  const cached = llmJudgeCache.get(key);
  if (!cached) return null;
  // 检查缓存是否过期
  if (Date.now() - cached.createdAt > LLM_CACHE_TTL_MS) {
    llmJudgeCache.delete(key);
    return null;
  }
  return cached.value;
}

/**
 * 将LLM判断结果存入缓存
 * @param key 缓存键
 * @param value 判断结果
 */
function setCachedLlmResult(key: string, value: MemoryJudgeResult): void {
  llmJudgeCache.set(key, { value, createdAt: Date.now() });
  // 当缓存超过最大容量时，删除最早的条目
  while (llmJudgeCache.size > LLM_CACHE_MAX_SIZE) {
    const oldestKey = llmJudgeCache.keys().next().value;
    if (!oldestKey || typeof oldestKey !== 'string') break;
    llmJudgeCache.delete(oldestKey);
  }
}

/**
 * 对记忆文本进行评分
 * 基于多个规则特征计算文本是否值得被记忆的分数
 * @param text 待评分的文本
 * @returns 包含分数和原因的对象
 */
function scoreMemoryText(text: string): { score: number; reason: string } {
  const normalized = normalizeText(text);
  // 空文本直接返回0分
  if (!normalized) return { score: 0, reason: 'empty' };
  // 疑问句类型的文本给予极低分数
  if (isQuestionLikeMemoryText(normalized)) {
    return { score: 0.05, reason: 'question-like' };
  }

  // 初始分数为0.5（中性）
  let score = 0.5;
  let strongestReason = 'neutral';

  // 检测事实性个人信息：提高分数
  if (FACTUAL_PROFILE_RE.test(normalized)) {
    score += 0.28;
    strongestReason = 'factual-personal';
  }
  // 检测助手偏好设置：适度提高分数
  if (ASSISTANT_STYLE_RE.test(normalized)) {
    score += 0.1;
    strongestReason = strongestReason === 'neutral' ? 'assistant-preference' : strongestReason;
  }
  // 检测请求风格：降低分数（请求通常不是记忆内容）
  if (REQUEST_STYLE_RE.test(normalized)) {
    score -= 0.14;
    if (strongestReason === 'neutral') strongestReason = 'request-like';
  }
  // 检测临时性信息：降低分数（临时信息不应长期记忆）
  if (TRANSIENT_RE.test(normalized)) {
    score -= 0.18;
    if (strongestReason === 'neutral') strongestReason = 'transient-like';
  }
  // 检测过程性命令：大幅降低分数（命令不应作为记忆）
  if (PROCEDURAL_RE.test(normalized)) {
    score -= 0.4;
    strongestReason = 'procedural-like';
  }
  
  // 根据文本长度调整分数
  if (normalized.length < 6) {
    // 过短的文本降低分数
    score -= 0.2;
  } else if (normalized.length <= 120) {
    // 适中长度的文本提高分数
    score += 0.06;
  } else if (normalized.length > 240) {
    // 过长的文本降低分数
    score -= 0.08;
  }

  return { score: clamp01(score), reason: strongestReason };
}

/**
 * 构建Anthropic API消息端点URL
 * @param baseUrl 基础URL
 * @returns 完整的API端点URL
 */
function buildAnthropicMessagesUrl(baseUrl: string): string {
  const normalized = baseUrl.replace(/\/+$/, '');
  if (!normalized) {
    return '/v1/messages';
  }
  if (normalized.endsWith('/v1/messages')) {
    return normalized;
  }
  if (normalized.endsWith('/v1')) {
    return `${normalized}/messages`;
  }
  return `${normalized}/v1/messages`;
}

/**
 * 从Anthropic API响应中提取文本内容
 * @param payload API响应载荷
 * @returns 提取的文本内容
 */
function extractTextFromAnthropicResponse(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const record = payload as Record<string, unknown>;
  const content = record.content;
  // 处理数组形式的内容块
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (!item || typeof item !== 'object') return '';
        const block = item as Record<string, unknown>;
        return typeof block.text === 'string' ? block.text : '';
      })
      .filter(Boolean)
      .join('\n')
      .trim();
  }
  // 处理字符串形式的内容
  if (typeof content === 'string') return content.trim();
  // 处理output_text字段
  if (typeof record.output_text === 'string') return record.output_text.trim();
  return '';
}

/**
 * 解析LLM判断结果的JSON载荷
 * @param text LLM返回的文本
 * @returns 解析后的判断结果对象，解析失败返回null
 */
function parseLlmJudgePayload(text: string): { accepted: boolean; confidence: number; reason: string } | null {
  if (!text.trim()) return null;
  const trimmed = text.trim();
  // 尝试提取代码块中的JSON
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  const candidate = fenced?.[1]?.trim() || trimmed;
  const firstBrace = candidate.indexOf('{');
  const lastBrace = candidate.lastIndexOf('}');
  if (firstBrace < 0 || lastBrace <= firstBrace) return null;

  try {
    const parsed = JSON.parse(candidate.slice(firstBrace, lastBrace + 1)) as Record<string, unknown>;
    const acceptedRaw = parsed.accepted;
    const decisionRaw = parsed.decision;
    const confidenceRaw = parsed.confidence;
    const reasonRaw = parsed.reason;

    // 解析accepted字段，支持布尔值或字符串判断
    const accepted =
      typeof acceptedRaw === 'boolean'
        ? acceptedRaw
        : typeof decisionRaw === 'string'
          ? /(accept|allow|yes|true|pass)/i.test(decisionRaw)
          : false;
    // 解析confidence字段，确保在[0,1]范围内
    const confidence = clamp01(
      typeof confidenceRaw === 'number'
        ? confidenceRaw
        : typeof confidenceRaw === 'string'
          ? Number(confidenceRaw)
          : 0
    );
    const reason = typeof reasonRaw === 'string' ? reasonRaw.trim() : 'llm';
    return { accepted, confidence, reason };
  } catch {
    return null;
  }
}

/**
 * 使用LLM对记忆候选项进行判断
 * 当规则判断处于边界情况时，调用LLM进行更精确的判断
 * @param input 记忆判断输入
 * @param ruleScore 规则判断分数
 * @param threshold 判断阈值
 * @param ruleReason 规则判断原因
 * @returns LLM判断结果，失败返回null
 */
async function judgeWithLlm(
  input: MemoryJudgeInput,
  ruleScore: number,
  threshold: number,
  ruleReason: string
): Promise<MemoryJudgeResult | null> {
  const { config } = resolveCurrentApiConfig();
  if (!config) return null;

  const url = buildAnthropicMessagesUrl(config.baseURL);
  const normalizedText = normalizeText(input.text).slice(0, LLM_INPUT_MAX_CHARS);
  if (!normalizedText) return null;

  // 设置请求超时控制器
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

  // 系统提示词：指导LLM如何判断记忆内容
  const systemPrompt = [
    '你负责判断一句话是否值得作为长期用户记忆。',
    '仅接受稳定的个人事实或稳定的助手偏好设置。',
    '拒绝疑问句、临时性上下文、一次性任务和过程性命令文本。',
    '仅返回JSON格式：{"accepted":boolean,"confidence":number,"reason":string}',
  ].join(' ');

  // 用户提示词：包含待判断的文本和上下文信息
  const userPrompt = JSON.stringify({
    text: normalizedText,
    is_explicit: input.isExplicit,
    guard_level: input.guardLevel,
    rule_score: Number(ruleScore.toFixed(3)),
    threshold: Number(threshold.toFixed(3)),
    rule_reason: ruleReason,
  });

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: config.model,
        max_tokens: 120,
        temperature: 0,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      return null;
    }
    const payload = await response.json();
    const text = extractTextFromAnthropicResponse(payload);
    const parsed = parseLlmJudgePayload(text);
    // 检查置信度是否达到最低要求
    if (!parsed || parsed.confidence < LLM_MIN_CONFIDENCE) {
      return null;
    }

    return {
      accepted: parsed.accepted,
      score: parsed.confidence,
      reason: `llm:${parsed.reason || 'boundary'}`,
      source: 'llm',
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 判断记忆候选项是否应该被接受
 * 首先使用规则进行判断，对于边界情况会调用LLM进行二次判断
 * @param input 记忆判断输入
 * @returns 记忆判断结果
 */
export async function judgeMemoryCandidate(input: MemoryJudgeInput): Promise<MemoryJudgeResult> {
  // 使用规则对文本进行评分
  const { score, reason } = scoreMemoryText(input.text);
  const threshold = thresholdByGuardLevel(input.isExplicit, input.guardLevel);
  
  // 构建基于规则的判断结果
  const ruleResult: MemoryJudgeResult = {
    accepted: score >= threshold,
    score,
    reason,
    source: 'rule',
  };
  
  // 如果不属于边界情况，直接返回规则结果
  if (!shouldCallLlmForBoundaryCase(score, threshold, reason)) {
    return ruleResult;
  }
  // 如果未启用LLM辅助判断，返回规则结果
  if (!input.llmEnabled) {
    return ruleResult;
  }

  // 检查缓存中是否有LLM判断结果
  const cacheKey = buildLlmCacheKey(input);
  const cached = getCachedLlmResult(cacheKey);
  if (cached) {
    return cached;
  }

  // 调用LLM进行判断
  const llmResult = await judgeWithLlm(input, score, threshold, reason);
  if (!llmResult) {
    return ruleResult;
  }
  
  // 缓存LLM判断结果并返回
  setCachedLlmResult(cacheKey, llmResult);
  return llmResult;
}
