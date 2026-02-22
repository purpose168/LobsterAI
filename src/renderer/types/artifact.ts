export type ArtifactType = 'html' | 'svg' | 'mermaid' | 'react' | 'code';

/**
 * 表示一个产物（例如渲染的 HTML、SVG、Mermaid 图表、React 组件或代码片段）
 */
export interface Artifact {
  id: string;              // 产物的唯一标识符
  messageId: string;       // 关联的消息 ID
  conversationId: string;  // 关联的对话 ID
  type: ArtifactType;      // 产物的类型（html、svg、mermaid、react、code）
  title: string;           // 产物的标题
  content: string;         // 产物的实际内容（HTML、SVG、Mermaid、React 或代码）
  language?: string;       // 可选，代码产物使用的编程语言
  createdAt: number;       // 创建时间戳
}

/**
 * 表示从文本内容中解析出的产物标记，用于在消息中识别和提取产物
 */
export interface ArtifactMarker {
  type: ArtifactType;       // 产物的类型
  title: string;            // 产物的标题
  content: string;         // 产物的实际内容
  language?: string;       // 可选，代码产物使用的编程语言
  fullMatch: string;       // 原始文本中的完整匹配内容
}
