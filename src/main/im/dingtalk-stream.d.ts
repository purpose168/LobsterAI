/**
 * dingtalk-stream 的类型声明
 */

declare module 'dingtalk-stream' {
  // 机器人主题标识
  export const TOPIC_ROBOT: string;

  /**
   * DWClient 客户端配置选项接口
   */
  export interface DWClientOptions {
    // 客户端ID，用于身份认证
    clientId: string;
    // 客户端密钥，用于身份认证
    clientSecret: string;
    // 是否启用调试模式（可选）
    debug?: boolean;
    // 是否保持连接活跃状态（可选）
    keepAlive?: boolean;
  }

  /**
   * 回调响应数据接口
   */
  export interface CallbackResponse {
    // 响应头信息（可选）
    headers?: {
      // 消息ID，用于唯一标识一条消息
      messageId?: string;
    };
    // 响应数据内容
    data: string;
  }

  /**
   * 钉钉 WebSocket 客户端类
   * 用于建立与钉钉服务器的长连接通信
   */
  export class DWClient {
    /**
     * 构造函数
     * @param options - 客户端配置选项
     */
    constructor(options: DWClientOptions);

    /**
     * 注册回调监听器
     * @param topic - 订阅的主题名称
     * @param callback - 回调函数，接收响应数据
     */
    registerCallbackListener(
      topic: string,
      callback: (res: CallbackResponse) => void | Promise<void>
    ): void;

    /**
     * Socket 回调响应处理
     * @param messageId - 消息ID
     * @param response - 响应对象，包含成功标志
     */
    socketCallBackResponse(messageId: string, response: { success: boolean }): void;

    /**
     * 建立连接
     * 异步方法，用于初始化与服务器的连接
     */
    connect(): Promise<void>;
  }
}
