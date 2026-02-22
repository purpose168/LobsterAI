/**
 * 获取路径的最后一段
 * @param rawPath - 原始路径字符串
 * @returns 路径的最后一段（文件夹名或文件名）
 */
export const getLastPathSegment = (rawPath: string): string => {
  const trimmed = rawPath.trim();
  if (!trimmed) return '';

  // 移除末尾的路径分隔符
  const withoutTrailingSeparators = trimmed.replace(/[\\/]+$/, '');
  const normalized = withoutTrailingSeparators || trimmed;
  // 按路径分隔符分割并过滤空字符串
  const parts = normalized.split(/[\\/]+/).filter(Boolean);

  if (parts.length === 0) {
    return normalized;
  }

  return parts[parts.length - 1];
};

/**
 * 获取压缩后的文件夹名称
 * 如果文件夹名称超过最大长度，则截取末尾部分
 * @param rawPath - 原始路径字符串
 * @param maxLength - 最大长度（可选）
 * @returns 压缩后的文件夹名称
 */
export const getCompactFolderName = (rawPath: string, maxLength?: number): string => {
  const folderName = getLastPathSegment(rawPath);
  if (!folderName) return '';

  // 如果指定了最大长度且文件夹名称超长，则截取末尾部分
  if (typeof maxLength === 'number' && maxLength > 0 && folderName.length > maxLength) {
    return folderName.slice(-maxLength);
  }

  return folderName;
};
