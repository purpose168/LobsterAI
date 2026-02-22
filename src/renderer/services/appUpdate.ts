/**
 * 应用更新检查服务
 * 负责检查应用是否有新版本可用
 */

// 更新检查API的URL地址
const UPDATE_CHECK_URL = 'https://api-overmind.youdao.com/openapi/get/luna/hardware/lobsterai/prod/update';

// 备用下载URL地址（当API未返回下载链接时使用）
const FALLBACK_DOWNLOAD_URL = 'https://lobsterai.youdao.com';

// 更新轮询间隔时间（毫秒）：12小时
export const UPDATE_POLL_INTERVAL_MS = 12 * 60 * 60 * 1000;

/**
 * 更新API响应数据结构
 */
type UpdateApiResponse = {
  code?: number;  // 响应状态码，0表示成功
  data?: {
    value?: {
      version?: string;  // 最新版本号
      url?: string;      // 下载链接
    };
  };
};

/**
 * 应用更新信息接口
 */
export interface AppUpdateInfo {
  latestVersion: string;  // 最新版本号
  url: string;            // 下载链接
}

/**
 * 将版本号字符串转换为数字数组
 * @param version - 版本号字符串（如 "1.2.3"）
 * @returns 版本号各部分组成的数字数组
 */
const toVersionParts = (version: string): number[] => (
  version
    .split('.')  // 按点号分割版本号
    .map((part) => {
      // 提取每部分开头的数字
      const match = part.trim().match(/^\d+/);
      return match ? Number.parseInt(match[0], 10) : 0;
    })
);

/**
 * 比较两个版本号的大小
 * @param a - 版本号a
 * @param b - 版本号b
 * @returns 返回1表示a>b，返回-1表示a<b，返回0表示a=b
 */
const compareVersions = (a: string, b: string): number => {
  const aParts = toVersionParts(a);  // 将版本号a转换为数字数组
  const bParts = toVersionParts(b);  // 将版本号b转换为数字数组
  const maxLength = Math.max(aParts.length, bParts.length);  // 获取最大长度

  // 逐段比较版本号
  for (let i = 0; i < maxLength; i += 1) {
    const left = aParts[i] ?? 0;   // 如果该段不存在，默认为0
    const right = bParts[i] ?? 0;  // 如果该段不存在，默认为0
    if (left > right) return 1;    // a版本号大于b版本号
    if (left < right) return -1;   // a版本号小于b版本号
  }

  return 0;  // 版本号相等
};

/**
 * 判断是否为更新版本
 * @param latestVersion - 最新版本号
 * @param currentVersion - 当前版本号
 * @returns 如果最新版本号大于当前版本号，返回true；否则返回false
 */
const isNewerVersion = (latestVersion: string, currentVersion: string): boolean => (
  compareVersions(latestVersion, currentVersion) > 0
);

/**
 * 检查应用更新
 * 向服务器请求最新版本信息，并与当前版本进行比较
 * @param currentVersion - 当前应用版本号
 * @returns 如果有新版本可用，返回更新信息；否则返回null
 */
export const checkForAppUpdate = async (currentVersion: string): Promise<AppUpdateInfo | null> => {
  // 发送HTTP GET请求检查更新
  const response = await window.electron.api.fetch({
    url: UPDATE_CHECK_URL,
    method: 'GET',
    headers: {
      Accept: 'application/json',  // 指定接受JSON格式响应
    },
  });

  // 检查响应是否有效
  if (!response.ok || typeof response.data !== 'object' || response.data === null) {
    return null;
  }

  // 解析响应数据
  const payload = response.data as UpdateApiResponse;
  
  // 检查API返回的状态码，非0表示失败
  if (payload.code !== 0) {
    return null;
  }

  // 获取最新版本号
  const latestVersion = payload.data?.value?.version?.trim();
  
  // 如果没有最新版本号，或者最新版本不比当前版本新，则返回null
  if (!latestVersion || !isNewerVersion(latestVersion, currentVersion)) {
    return null;
  }

  // 获取下载链接，如果API未提供则使用备用链接
  const url = payload.data?.value?.url?.trim() || FALLBACK_DOWNLOAD_URL;
  
  // 返回更新信息
  return {
    latestVersion,
    url,
  };
};
