/**
 * 图片附件接口
 * 用于描述聊天消息中包含的图片附件信息
 */
export interface ImageAttachment {
  /** 附件唯一标识符 */
  id: string;
  /** 文件名称 */
  name: string;
  /** 文件 MIME 类型 */
  type: string;
  /** 文件大小（字节） */
  size: number;
  /** Base64 编码的图片数据 URL */
  dataUrl: string;
}

/**
 * 聊天消息载荷接口
 * 用于描述一条完整的聊天消息
 */
export interface ChatMessagePayload {
  /** 消息角色：system-系统消息, user-用户消息, assistant-助手消息 */
  role: 'system' | 'user' | 'assistant';
  /** 消息文本内容 */
  content: string;
  /** 消息中包含的图片附件列表（可选） */
  images?: ImageAttachment[];
}

/**
 * 用户消息输入接口
 * 用于用户发送消息时的输入数据结构
 */
export interface ChatUserMessageInput {
  /** 消息文本内容 */
  content: string;
  /** 要发送的图片附件列表（可选） */
  images?: ImageAttachment[];
}
