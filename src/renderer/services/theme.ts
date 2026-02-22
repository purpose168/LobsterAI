import { configService } from './config';

type ThemeType = 'light' | 'dark' | 'system';

// 冷色调现代配色方案
const COLORS = {
  light: {
    bg: '#F8F9FB',
    text: '#1A1D23',
  },
  dark: {
    bg: '#0F1117',
    text: '#E4E5E9',
  },
};

class ThemeService {
  private mediaQuery: MediaQueryList | null = null;
  private currentTheme: ThemeType = 'system';
  private appliedTheme: 'light' | 'dark' | null = null;
  private initialized = false;
  private mediaQueryListener: ((event: MediaQueryListEvent) => void) | null = null;

  constructor() {
    if (typeof window !== 'undefined') {
      this.mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    }
  }

  // 初始化主题
  initialize(): void {
    if (this.initialized) {
      return;
    }
    this.initialized = true;

    try {
      const config = configService.getConfig();
      this.setTheme(config.theme);

      // 监听系统主题变化
      if (this.mediaQuery) {
        this.mediaQueryListener = (e) => {
          if (this.currentTheme === 'system') {
            this.applyTheme(e.matches ? 'dark' : 'light');
          }
        };
        this.mediaQuery.addEventListener('change', this.mediaQueryListener);
      }
    } catch (error) {
      console.error('主题初始化失败:', error);
      // 默认使用系统主题
      this.setTheme('system');
    }
  }

  // 设置主题
  setTheme(theme: ThemeType): void {
    const effectiveTheme = theme === 'system'
      ? (this.mediaQuery?.matches ? 'dark' : 'light')
      : theme;

    if (this.currentTheme === theme && this.appliedTheme === effectiveTheme) {
      return;
    }

    console.log(`设置主题为: ${theme}`);
    this.currentTheme = theme;

    if (theme === 'system') {
      // 如果是系统主题,则根据系统设置应用
      console.log(`检测到系统主题,使用: ${effectiveTheme}`);
    }

    // 直接应用指定主题
    this.applyTheme(effectiveTheme);
  }

  // 获取当前主题
  getTheme(): ThemeType {
    return this.currentTheme;
  }

  // 获取当前有效主题（实际应用的明/暗主题）
  getEffectiveTheme(): 'light' | 'dark' {
    if (this.currentTheme === 'system') {
      return this.mediaQuery?.matches ? 'dark' : 'light';
    }
    return this.currentTheme;
  }

  // 应用主题到DOM
  private applyTheme(theme: 'light' | 'dark'): void {
    // 避免重复应用相同主题
    if (this.appliedTheme === theme) {
      return;
    }

    console.log(`应用主题: ${theme}`);
    this.appliedTheme = theme;
    const root = document.documentElement;
    const colors = COLORS[theme];

    if (theme === 'dark') {
      // 为 HTML 元素应用暗色主题 (用于 Tailwind)
      root.classList.add('dark');
      root.classList.remove('light');

      // 确保主题在整个 DOM 中保持一致
      document.body.classList.add('dark');
      document.body.classList.remove('light');

      // 设置背景和文本颜色
      root.style.backgroundColor = colors.bg;
      document.body.style.backgroundColor = colors.bg;
      document.body.style.color = colors.text;
    } else {
      // 为 HTML 元素应用亮色主题 (用于 Tailwind)
      root.classList.remove('dark');
      root.classList.add('light');

      // 确保主题在整个 DOM 中保持一致
      document.body.classList.remove('dark');
      document.body.classList.add('light');

      // 设置背景和文本颜色
      root.style.backgroundColor = colors.bg;
      document.body.style.backgroundColor = colors.bg;
      document.body.style.color = colors.text;
    }

    // 更新 CSS 变量以实现颜色过渡动画
    root.style.setProperty('--theme-transition', 'background-color 0.3s ease, color 0.3s ease, border-color 0.3s ease');
    document.body.style.transition = 'var(--theme-transition)';

    // 确保 #root 元素也应用主题
    const rootElement = document.getElementById('root');
    if (rootElement) {
      if (theme === 'dark') {
        rootElement.classList.add('dark');
        rootElement.classList.remove('light');
        rootElement.style.backgroundColor = colors.bg;
      } else {
        rootElement.classList.remove('dark');
        rootElement.classList.add('light');
        rootElement.style.backgroundColor = colors.bg;
      }
    }
  }
}

export const themeService = new ThemeService();
