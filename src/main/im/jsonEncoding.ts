/**
 * IM网关的JSON编码辅助工具。
 * 保持请求负载为纯ASCII格式（`\uXXXX`）以避免平台相关的字符集问题。
 */

// JSON UTF-8内容类型常量
export const JSON_UTF8_CONTENT_TYPE = 'application/json; charset=utf-8';

/**
 * 将JSON序列化并将每个非ASCII码单元转义为`\uXXXX`格式。
 * @param value - 需要序列化的值
 * @returns 转义后的ASCII JSON字符串
 */
export function stringifyAsciiJson(value: unknown): string {
  // 将值序列化为JSON字符串，然后替换所有非ASCII字符
  return JSON.stringify(value).replace(/[^\x00-\x7F]/g, (char) => {
    // 将非ASCII字符转换为\uXXXX格式的转义序列
    return `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`;
  });
}

/**
 * 构建包含纯ASCII内容的UTF-8 JSON请求体。
 * @param value - 需要转换为请求体的值
 * @returns UTF-8编码的Buffer对象
 */
export function createUtf8JsonBody(value: unknown): Buffer {
  // 使用ASCII JSON字符串创建UTF-8编码的Buffer
  return Buffer.from(stringifyAsciiJson(value), 'utf8');
}
