/**
 * 搜索结果类型
 */

export interface SearchResult {
  /** 结果标题 */
  title: string;
  /** 结果URL */
  url: string;
  /** 文本摘要/描述 */
  snippet: string;
  /** 来源搜索引擎 */
  source: 'bing' | 'google';
  /** 在结果中的位置（从1开始） */
  position: number;
}

export interface SearchResponse {
  /** 搜索查询 */
  query: string;
  /** 用于此响应的搜索引擎 */
  engine: 'bing' | 'google';
  /** 搜索结果 */
  results: SearchResult[];
  /** 找到的结果总数 */
  totalResults: number;
  /** 搜索时间戳 */
  timestamp: number;
  /** 耗时（毫秒） */
  duration: number;
}
