/**
 * 解析后的快捷键类型定义
 * 包含按键和各个修饰键的状态
 */
type ParsedShortcut = {
  key: string;              // 主键
  alt: boolean;             // Alt键是否按下
  ctrl: boolean;            // Ctrl键是否按下
  shift: boolean;           // Shift键是否按下
  meta: boolean;            // Meta键是否按下（Mac上的Command键，Windows上的Win键）
  commandOrControl: boolean; // CommandOrControl修饰符（跨平台兼容）
};

/**
 * 修饰键类型
 * 定义可用的修饰键名称
 */
type ModifierKey = 'alt' | 'ctrl' | 'shift' | 'meta';

/**
 * 修饰键别名映射表
 * 将各种修饰键的不同写法统一映射到标准修饰键名称
 */
const modifierAliases: Record<string, ModifierKey> = {
  ctrl: 'ctrl',           // Ctrl键
  control: 'ctrl',        // Control键（Ctrl的别名）
  cmd: 'meta',            // Cmd键（Mac上的Command键）
  command: 'meta',        // Command键（Mac专用）
  meta: 'meta',           // Meta键
  win: 'meta',            // Win键（Windows专用）
  super: 'meta',          // Super键（Linux专用）
  alt: 'alt',             // Alt键
  option: 'alt',          // Option键（Mac上的Alt键）
  shift: 'shift',         // Shift键
};

/**
 * CommandOrControl别名集合
 * 用于跨平台快捷键定义，在Mac上表示Command，在其他平台上表示Ctrl
 */
const commandOrControlAliases = new Set([
  'cmdorctrl',            // CmdOrCtrl缩写
  'commandorcontrol',     // CommandOrControl全称
  'cmdorcontrol',         // CmdOrControl混合写法
  'ctrlorcmd',            // CtrlOrCmd缩写
  'ctrlorcommand',        // CtrlOrCommand全称
]);

/**
 * 按键别名映射表
 * 将各种按键的不同写法统一映射到标准按键名称
 */
const keyAliases: Record<string, string> = {
  esc: 'escape',          // ESC键
  escape: 'escape',       // Escape键全称
  return: 'enter',        // Return键（Mac上的回车键）
  enter: 'enter',         // Enter键
  space: ' ',             // 空格键
  spacebar: ' ',          // Spacebar（空格键别名）
  comma: ',',             // 逗号键
  period: '.',            // 句号键
  dot: '.',               // 点号键
  minus: '-',             // 减号键
  dash: '-',              // 破折号键
  backspace: 'backspace', // 退格键
  delete: 'delete',       // 删除键
  del: 'delete',          // Del键（Delete的缩写）
  tab: 'tab',             // Tab键
  up: 'arrowup',          // 上箭头键
  down: 'arrowdown',      // 下箭头键
  left: 'arrowleft',      // 左箭头键
  right: 'arrowright',    // 右箭头键
  arrowup: 'arrowup',     // ArrowUp标准名称
  arrowdown: 'arrowdown', // ArrowDown标准名称
  arrowleft: 'arrowleft', // ArrowLeft标准名称
  arrowright: 'arrowright', // ArrowRight标准名称
  pageup: 'pageup',       // PageUp键
  pagedown: 'pagedown',   // PageDown键
  home: 'home',           // Home键
  end: 'end',             // End键
  insert: 'insert',       // Insert键
};

/**
 * 规范化标记
 * 去除首尾空格并转换为小写
 * @param token - 需要规范化的标记字符串
 * @returns 规范化后的标记字符串
 */
const normalizeToken = (token: string) => token.trim().toLowerCase();

/**
 * 规范化按键名称
 * 将按键名称转换为统一的标准格式
 * @param key - 需要规范化的按键名称
 * @returns 规范化后的按键名称
 */
const normalizeKey = (key: string) => {
  if (key === ' ') return ' ';  // 空格键特殊处理
  const normalized = normalizeToken(key);
  return keyAliases[normalized] ?? normalized;  // 查找别名映射，未找到则返回原值
};

/**
 * 解析快捷键字符串
 * 将快捷键字符串（如 "Ctrl+Shift+A"）解析为结构化对象
 * @param shortcut - 快捷键字符串，格式为 "修饰键+主键"
 * @returns 解析后的快捷键对象，如果解析失败则返回null
 * 
 * @example
 * parseShortcut("Ctrl+Shift+A") // 返回 { key: 'a', ctrl: true, shift: true, ... }
 * parseShortcut("CmdOrCtrl+S")  // 返回 { key: 's', commandOrControl: true, ... }
 */
export const parseShortcut = (shortcut?: string): ParsedShortcut | null => {
  if (!shortcut) return null;  // 空值检查
  
  // 按"+"分割快捷键字符串，去除空格并过滤空值
  const tokens = shortcut
    .split('+')
    .map(token => token.trim())
    .filter(Boolean);

  if (tokens.length === 0) return null;  // 无有效标记则返回null

  // 初始化解析结果对象
  const parsed: ParsedShortcut = {
    key: '',
    alt: false,
    ctrl: false,
    shift: false,
    meta: false,
    commandOrControl: false,
  };

  // 遍历所有标记进行解析
  for (const token of tokens) {
    const normalized = normalizeToken(token);
    
    // 检查是否为CommandOrControl修饰符
    if (commandOrControlAliases.has(normalized)) {
      parsed.commandOrControl = true;
      continue;
    }
    
    // 检查是否为修饰键
    const modifier = modifierAliases[normalized];
    if (modifier) {
      parsed[modifier] = true;
      continue;
    }
    
    // 否则视为主键
    parsed.key = normalizeKey(token);
  }

  // 如果没有主键则返回null
  if (!parsed.key) return null;
  return parsed;
};

/**
 * 匹配键盘事件与快捷键
 * 检查键盘事件是否匹配指定的快捷键
 * @param event - 键盘事件对象
 * @param shortcut - 快捷键字符串
 * @returns 如果匹配则返回true，否则返回false
 * 
 * @example
 * // 在键盘事件处理函数中使用
 * if (matchesShortcut(event, "Ctrl+S")) {
 *   // 执行保存操作
 * }
 */
export const matchesShortcut = (event: KeyboardEvent, shortcut?: string): boolean => {
  const parsed = parseShortcut(shortcut);
  if (!parsed) return false;  // 无法解析则不匹配

  // 检查主键是否匹配
  const key = normalizeKey(event.key);
  if (key !== parsed.key) return false;

  // 检查Alt键状态
  if (event.altKey !== parsed.alt) return false;
  // 检查Shift键状态
  if (event.shiftKey !== parsed.shift) return false;

  // 处理CommandOrControl跨平台修饰符
  if (parsed.commandOrControl) {
    // 在Mac上检查metaKey，在其他平台上检查ctrlKey
    if (!event.ctrlKey && !event.metaKey) return false;
  } else {
    // 分别检查Ctrl和Meta键状态
    if (event.ctrlKey !== parsed.ctrl) return false;
    if (event.metaKey !== parsed.meta) return false;
  }

  return true;  // 所有条件都匹配
};
