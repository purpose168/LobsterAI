// 显式添加记忆的正则表达式：匹配用户明确要求记住内容的指令
const EXPLICIT_ADD_RE = /(?:^|\n)\s*(?:请)?(?:记住|记下|保存到记忆|保存记忆|写入记忆|remember(?:\s+this|\s+that)?|store\s+(?:this|that)\s+in\s+memory)\s*[:：,，]?\s*(.+)$/gim;
// 显式删除记忆的正则表达式：匹配用户明确要求删除记忆的指令
const EXPLICIT_DELETE_RE = /(?:^|\n)\s*(?:请)?(?:删除记忆|从记忆中删除|忘掉|忘记这条|forget\s+this|remove\s+from\s+memory)\s*[:：,，]?\s*(.+)$/gim;
// 代码块的正则表达式：用于识别和移除代码块内容
const CODE_BLOCK_RE = /```[\s\S]*?```/g;
// 闲聊短语的正则表达式：识别简单的应答和感谢用语
const SMALL_TALK_RE = /^(ok|okay|thanks|thank\s+you|好的|收到|明白|行|嗯|谢谢)[.!? ]*$/i;
// 短事实信号的正则表达式：识别包含个人基本信息的短句
const SHORT_FACT_SIGNAL_RE = /(我叫|我是|我的名字是|我名字是|名字叫|我有(?!\s*(?:一个|个)?问题)|我养了|我家有|\bmy\s+name\s+is\b|\bi\s+am\b|\bi['’]?m\b|\bi\s+have\b|\bi\s+own\b)/i;
// 非持久化主题的正则表达式：识别临时性问题或错误报告
const NON_DURABLE_TOPIC_RE = /(我有\s*(?:一个|个)?问题|有个问题|报错|出现异常|exception|stack\s*trace)/i;
// 个人资料信号的正则表达式：识别个人基本信息（姓名、居住地、职业等）
const PERSONAL_PROFILE_SIGNAL_RE = /(我叫|我是|我的名字是|我名字是|名字叫|我住在|我来自|我是做|我的职业|\bmy\s+name\s+is\b|\bi\s+am\b|\bi['’]?m\b|\bi\s+live\s+in\b|\bi['’]?m\s+from\b|\bi\s+work\s+as\b)/i;
// 个人所有权信号的正则表达式：识别个人拥有的物品或关系
const PERSONAL_OWNERSHIP_SIGNAL_RE = /(我有(?!\s*(?:一个|个)?问题)|我养了|我家有|我女儿|我儿子|我的孩子|我的小狗|我的小猫|\bi\s+have\b|\bi\s+own\b|\bmy\s+(?:daughter|son|child|dog|cat)\b)/i;
// 个人偏好信号的正则表达式：识别个人喜好和习惯
const PERSONAL_PREFERENCE_SIGNAL_RE = /(我喜欢|我偏好|我习惯|我常用|我不喜欢|我讨厌|我更喜欢|\bi\s+prefer\b|\bi\s+like\b|\bi\s+usually\b|\bi\s+often\b|\bi\s+don['’]?\s*t\s+like\b|\bi\s+hate\b)/i;
// 助手偏好信号的正则表达式：识别用户对助手回复方式的偏好设置
const ASSISTANT_PREFERENCE_SIGNAL_RE = /((请|以后|后续|默认|请始终|不要再|请不要|优先|务必).*(回复|回答|语言|中文|英文|格式|风格|语气|简洁|详细|代码|命名|markdown|respond|reply|language|format|style|tone))/i;
// 来源样式行的正则表达式：识别标记来源的行
const SOURCE_STYLE_LINE_RE = /^(?:来源|source)\s*[:：]/i;
// 附件样式行的正则表达式：识别标记输入文件的行
const ATTACHMENT_STYLE_LINE_RE = /^(?:输入文件|input\s*file)\s*[:：]/i;
// 临时性信号的正则表达式：识别包含时间敏感信息的内容
const TRANSIENT_SIGNAL_RE = /(今天|昨日|昨天|刚刚|刚才|本周|本月|news|breaking|快讯|新闻|\b(19|20)\d{2}[./-]\d{1,2}[./-]\d{1,2}\b|\d{4}年\d{1,2}月\d{1,2}日|\d{1,2}月\d{1,2}日)/i;
// 请求尾部分割的正则表达式：识别句子末尾的请求部分
const REQUEST_TAIL_SPLIT_RE = /[,，。]\s*(?:请|麻烦)?你(?:帮我|帮忙|给我|为我|看下|看一下|查下|查一下)|[,，。]\s*帮我|[,，。]\s*请帮我|[,，。]\s*(?:能|可以)不能?\s*帮我|[,，。]\s*你看|[,，。]\s*请你/i;
// 过程性候选的正则表达式：识别命令执行或脚本相关内容
const PROCEDURAL_CANDIDATE_RE = /(执行以下命令|run\s+(?:the\s+)?following\s+command|\b(?:cd|npm|pnpm|yarn|node|python|bash|sh|git|curl|wget)\b|\$[A-Z_][A-Z0-9_]*|&&|--[a-z0-9-]+|\/tmp\/|\.sh\b|\.bat\b|\.ps1\b)/i;
// 助手样式候选的正则表达式：识别使用技能的指令
const ASSISTANT_STYLE_CANDIDATE_RE = /^(?:使用|use)\s+[A-Za-z0-9._-]+\s*(?:技能|skill)/i;
// 中文问题前缀的正则表达式：识别中文疑问句的开头
const CHINESE_QUESTION_PREFIX_RE = /^(?:请问|问下|问一下|是否|能否|可否|为什么|为何|怎么|如何|谁|什么|哪(?:里|儿|个)?|几|多少|要不要|会不会|是不是|能不能|可不可以|行不行|对不对|好不好)/u;
// 英文问题前缀的正则表达式：识别英文疑问句的开头
const ENGLISH_QUESTION_PREFIX_RE = /^(?:what|who|why|how|when|where|which|is|are|am|do|does|did|can|could|would|will|should)\b/i;
// 内联问题的正则表达式：识别句子中的疑问短语
const QUESTION_INLINE_RE = /(是不是|能不能|可不可以|要不要|会不会|有没有|对不对|好不好)/i;
// 问题后缀的正则表达式：识别中文疑问句的结尾助词
const QUESTION_SUFFIX_RE = /(吗|么|呢|嘛)\s*$/u;

// 协作记忆保护级别类型：strict（严格）、standard（标准）、relaxed（宽松）
export type CoworkMemoryGuardLevel = 'strict' | 'standard' | 'relaxed';

// 提取的记忆变更接口：描述单条记忆的变更操作
export interface ExtractedMemoryChange {
  action: 'add' | 'delete';        // 操作类型：添加或删除
  text: string;                     // 记忆文本内容
  confidence: number;               // 置信度（0-1之间）
  isExplicit: boolean;              // 是否为显式操作
  reason: string;                   // 变更原因说明
}

// 提取对话记忆选项接口：配置记忆提取的参数
export interface ExtractTurnMemoryOptions {
  userText: string;                 // 用户输入文本
  assistantText: string;            // 助手回复文本
  guardLevel: CoworkMemoryGuardLevel; // 保护级别
  maxImplicitAdds?: number;         // 最大隐式添加数量（可选）
}

/**
 * 规范化文本：将多个空白字符替换为单个空格并去除首尾空格
 * @param value - 待规范化的文本
 * @returns 规范化后的文本
 */
function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * 判断文本是否为疑问句形式
 * 用于过滤掉不应该作为记忆保存的问题类文本
 * @param text - 待检测的文本
 * @returns 如果是疑问句返回true，否则返回false
 */
export function isQuestionLikeMemoryText(text: string): boolean {
  const normalized = normalizeText(text).replace(/[。！!]+$/g, '').trim();
  if (!normalized) return false;
  // 检查是否以问号结尾
  if (/[？?]\s*$/.test(normalized)) return true;
  // 检查是否包含中文疑问词前缀
  if (CHINESE_QUESTION_PREFIX_RE.test(normalized)) return true;
  // 检查是否包含英文疑问词前缀
  if (ENGLISH_QUESTION_PREFIX_RE.test(normalized)) return true;
  // 检查是否包含内联疑问短语
  if (QUESTION_INLINE_RE.test(normalized)) return true;
  // 检查是否包含中文疑问助词后缀
  if (QUESTION_SUFFIX_RE.test(normalized)) return true;
  return false;
}

/**
 * 判断候选文本是否应该保留
 * 过滤掉闲聊、问题、命令等不适合作为记忆的内容
 * @param text - 候选文本
 * @returns 如果应该保留返回true，否则返回false
 */
function shouldKeepCandidate(text: string): boolean {
  const trimmed = normalizeText(text);
  if (!trimmed) return false;
  // 过滤过短的文本（除非包含短事实信号）
  if (trimmed.length < 6 && !SHORT_FACT_SIGNAL_RE.test(trimmed)) return false;
  // 过滤闲聊短语
  if (SMALL_TALK_RE.test(trimmed)) return false;
  // 过滤疑问句
  if (isQuestionLikeMemoryText(trimmed)) return false;
  // 过滤助手样式指令
  if (ASSISTANT_STYLE_CANDIDATE_RE.test(trimmed)) return false;
  // 过滤过程性命令
  if (PROCEDURAL_CANDIDATE_RE.test(trimmed)) return false;
  return true;
}

/**
 * 清理隐式候选文本
 * 移除文本末尾的请求部分，提取核心事实内容
 * @param text - 待清理的文本
 * @returns 清理后的文本
 */
function sanitizeImplicitCandidate(text: string): string {
  const normalized = normalizeText(text);
  if (!normalized) return '';
  // 查找请求尾部的位置
  const tailMatch = normalized.match(REQUEST_TAIL_SPLIT_RE);
  const clipped = tailMatch?.index && tailMatch.index > 0
    ? normalized.slice(0, tailMatch.index)
    : normalized;
  // 移除末尾的标点符号
  return normalizeText(clipped.replace(/[，,；;:\-]+$/, ''));
}

/**
 * 根据保护级别获取置信度阈值
 * @param level - 保护级别
 * @returns 对应的置信度阈值
 */
function confidenceThreshold(level: CoworkMemoryGuardLevel): number {
  if (level === 'strict') return 0.85;    // 严格模式：高阈值
  if (level === 'relaxed') return 0.5;    // 宽松模式：低阈值
  return 0.65;                             // 标准模式：中等阈值
}

/**
 * 提取显式记忆变更
 * 从用户文本中识别明确的添加或删除记忆指令
 * @param text - 用户输入文本
 * @param action - 操作类型（添加或删除）
 * @param pattern - 匹配模式
 * @param reason - 变更原因
 * @returns 提取的记忆变更数组
 */
function extractExplicit(
  text: string,
  action: 'add' | 'delete',
  pattern: RegExp,
  reason: string
): ExtractedMemoryChange[] {
  const result: ExtractedMemoryChange[] = [];
  const seen = new Set<string>();
  pattern.lastIndex = 0;
  let match: RegExpExecArray | null = null;
  // 遍历所有匹配项
  while ((match = pattern.exec(text)) !== null) {
    const raw = normalizeText(match[1] || '');
    // 过滤不符合条件的候选
    if (!shouldKeepCandidate(raw)) continue;
    // 去重处理
    const key = raw.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    // 添加到结果列表
    result.push({
      action,
      text: raw,
      confidence: 0.99,          // 显式指令置信度极高
      isExplicit: true,
      reason,
    });
  }
  return result;
}

/**
 * 提取隐式记忆变更
 * 从用户文本中自动识别个人资料、偏好等信息
 * @param options - 提取选项
 * @returns 提取的记忆变更数组
 */
function extractImplicit(options: ExtractTurnMemoryOptions): ExtractedMemoryChange[] {
  // 确定最大隐式添加数量（限制在0-2之间）
  const requestedMaxImplicitAdds = Number.isFinite(options.maxImplicitAdds)
    ? Number(options.maxImplicitAdds)
    : 2;
  const maxImplicitAdds = Math.max(0, Math.min(2, Math.floor(requestedMaxImplicitAdds)));
  if (maxImplicitAdds === 0) return [];
  
  // 获取置信度阈值
  const threshold = confidenceThreshold(options.guardLevel);
  
  // 移除代码块，保留纯文本
  const strippedUser = options.userText.replace(CODE_BLOCK_RE, ' ').trim();
  const strippedAssistant = options.assistantText.replace(CODE_BLOCK_RE, ' ').trim();
  if (!strippedUser || !strippedAssistant) return [];

  // 按句子分割用户文本
  const candidates = strippedUser
    .split(/[。！？!?；;\n]/g)
    .map((line) => normalizeText(line))
    .filter(Boolean);

  const result: ExtractedMemoryChange[] = [];
  const seen = new Set<string>();

  for (const rawCandidate of candidates) {
    // 清理候选文本
    const candidate = sanitizeImplicitCandidate(rawCandidate);
    if (!shouldKeepCandidate(candidate)) continue;

    // 去重处理
    const key = candidate.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    
    // 过滤非持久化主题（如临时问题、错误报告）
    if (NON_DURABLE_TOPIC_RE.test(candidate)) continue;

    // 过滤来源和附件标记行
    if (SOURCE_STYLE_LINE_RE.test(candidate) || ATTACHMENT_STYLE_LINE_RE.test(candidate)) {
      continue;
    }
    
    // 过滤临时性信息（除非同时包含个人资料或偏好信号）
    if (TRANSIENT_SIGNAL_RE.test(candidate)
      && !PERSONAL_PROFILE_SIGNAL_RE.test(candidate)
      && !PERSONAL_OWNERSHIP_SIGNAL_RE.test(candidate)
      && !ASSISTANT_PREFERENCE_SIGNAL_RE.test(candidate)) {
      continue;
    }

    // 根据信号类型计算置信度
    let confidence = 0;
    let reason = '';

    if (PERSONAL_PROFILE_SIGNAL_RE.test(candidate)) {
      confidence = 0.93;
      reason = 'implicit:personal-profile';           // 隐式：个人资料
    } else if (PERSONAL_OWNERSHIP_SIGNAL_RE.test(candidate)) {
      confidence = 0.9;
      reason = 'implicit:personal-ownership';         // 隐式：个人所有权
    } else if (PERSONAL_PREFERENCE_SIGNAL_RE.test(candidate)) {
      confidence = 0.88;
      reason = 'implicit:personal-preference';        // 隐式：个人偏好
    } else if (ASSISTANT_PREFERENCE_SIGNAL_RE.test(candidate)) {
      confidence = 0.86;
      reason = 'implicit:assistant-preference';       // 隐式：助手偏好
    }

    // 跳过无置信度的候选
    if (confidence === 0) {
      continue;
    }
    // 过滤低于阈值的候选
    if (confidence < threshold) continue;

    // 添加到结果列表
    result.push({
      action: 'add',
      text: candidate,
      confidence,
      isExplicit: false,
      reason,
    });

    // 达到最大数量后停止
    if (result.length >= maxImplicitAdds) break;
  }

  return result;
}

/**
 * 提取对话记忆变更的主函数
 * 综合处理显式和隐式记忆提取，合并去重后返回结果
 * @param options - 提取选项，包含用户文本、助手文本和保护级别
 * @returns 提取的记忆变更数组
 */
export function extractTurnMemoryChanges(options: ExtractTurnMemoryOptions): ExtractedMemoryChange[] {
  const userText = (options.userText || '').trim();
  const assistantText = (options.assistantText || '').trim();
  if (!userText || !assistantText) return [];

  // 提取显式添加指令
  const explicitAdds = extractExplicit(userText, 'add', EXPLICIT_ADD_RE, 'explicit:add-command');
  // 提取显式删除指令
  const explicitDeletes = extractExplicit(userText, 'delete', EXPLICIT_DELETE_RE, 'explicit:delete-command');
  // 提取隐式添加内容
  const implicitAdds = extractImplicit(options);

  // 合并所有变更并去重
  const merged: ExtractedMemoryChange[] = [];
  const seen = new Set<string>();
  for (const entry of [...explicitDeletes, ...explicitAdds, ...implicitAdds]) {
    const key = `${entry.action}|${entry.text.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(entry);
  }

  return merged;
}
