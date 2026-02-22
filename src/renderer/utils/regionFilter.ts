// IM 平台分类定义
// 中国区 IM 平台
export const CHINA_IM_PLATFORMS = ['dingtalk', 'feishu'] as const;
// 全球区 IM 平台
export const GLOBAL_IM_PLATFORMS = ['telegram', 'discord'] as const;

/**
 * 根据语言环境获取可见的 IM 平台列表
 * @param language - 语言类型，'zh' 表示中文，'en' 表示英文
 * @returns 对应语言环境下可见的 IM 平台数组
 */
export const getVisibleIMPlatforms = (language: 'zh' | 'en'): readonly string[] => {
  // 开发环境下可显示所有平台进行测试
  // if (import.meta.env.DEV) {
  //   return [...CHINA_IM_PLATFORMS, ...GLOBAL_IM_PLATFORMS];
  // }

  // 语言与平台版本的映射关系：
  // 中文环境(zh) → 仅显示中国区平台
  // 英文环境(en) → 显示中国区和全球区所有平台
  if (language === 'zh') {
    return CHINA_IM_PLATFORMS;
  }
  return [...CHINA_IM_PLATFORMS, ...GLOBAL_IM_PLATFORMS];
};
