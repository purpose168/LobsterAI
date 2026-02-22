/**
 * @larksuiteoapi/node-sdk 的类型声明
 * 飞书网关所需的最小类型定义
 */

declare module '@larksuiteoapi/node-sdk' {
  /**
   * 域名配置
   * Feishu: 飞书域名（中国版）
   * Lark: Lark域名（国际版）
   */
  export const Domain: {
    Feishu: symbol;
    Lark: symbol;
  };

  /**
   * 应用类型配置
   * SelfBuild: 自建应用类型
   */
  export const AppType: {
    SelfBuild: symbol;
  };

  /**
   * 日志级别枚举
   * error: 错误级别
   * warn: 警告级别
   * info: 信息级别
   * debug: 调试级别
   */
  export enum LoggerLevel {
    error = 'error',
    warn = 'warn',
    info = 'info',
    debug = 'debug',
  }

  /**
   * 客户端配置选项接口
   * @property appId - 应用的唯一标识ID
   * @property appSecret - 应用的密钥
   * @property appType - 应用类型（可选），默认为自建应用
   * @property domain - 域名配置（可选），可使用Domain.Feishu或Domain.Lark
   */
  export interface ClientOptions {
    appId: string;
    appSecret: string;
    appType?: symbol;
    domain?: symbol | string;
  }

  /**
   * WebSocket客户端配置选项接口
   * @property appId - 应用的唯一标识ID
   * @property appSecret - 应用的密钥
   * @property domain - 域名配置（可选），可使用Domain.Feishu或Domain.Lark
   * @property loggerLevel - 日志级别（可选），用于控制日志输出的详细程度
   */
  export interface WSClientOptions {
    appId: string;
    appSecret: string;
    domain?: symbol | string;
    loggerLevel?: LoggerLevel;
  }

  /**
   * 事件分发器配置选项接口
   * @property encryptKey - 加密密钥（可选），用于消息加密
   * @property verificationToken - 验证令牌（可选），用于请求验证
   */
  export interface EventDispatcherOptions {
    encryptKey?: string;
    verificationToken?: string;
  }

  /**
   * API客户端类
   * 用于调用飞书开放平台的HTTP API接口
   */
  export class Client {
    constructor(options: ClientOptions);
    /**
     * 即时消息模块
     * 包含消息发送和回复相关的方法
     */
    im: {
      /**
       * 消息操作接口
       */
      message: {
        /**
         * 发送消息方法
         * @param params.params - 参数配置，包含接收者ID类型
         * @param params.data - 消息数据，包含接收者ID、消息内容和消息类型
         * @returns 返回Promise，包含响应码、消息和消息ID
         */
        create(params: {
          params: { receive_id_type: string };
          data: { receive_id: string; content: string; msg_type: string };
        }): Promise<{ code: number; msg?: string; data?: { message_id?: string } }>;
        /**
         * 回复消息方法
         * @param params.path - 路径参数，包含要回复的消息ID
         * @param params.data - 消息数据，包含消息内容和消息类型
         * @returns 返回Promise，包含响应码、消息和消息ID
         */
        reply(params: {
          path: { message_id: string };
          data: { content: string; msg_type: string };
        }): Promise<{ code: number; msg?: string; data?: { message_id?: string } }>;
      };
    };
    /**
     * 发送HTTP请求方法
     * @param params.method - HTTP请求方法（GET、POST等）
     * @param params.url - 请求的URL地址
     * @returns 返回Promise，包含响应码、消息和数据
     */
    request(params: {
      method: string;
      url: string;
    }): Promise<{ code: number; msg?: string; data?: any }>;
  }

  /**
   * WebSocket客户端类
   * 用于建立与飞书服务器的长连接，接收实时事件推送
   */
  export class WSClient {
    constructor(options: WSClientOptions);
    /**
     * 启动WebSocket连接
     * @param options.eventDispatcher - 事件分发器实例，用于处理接收到的各类事件
     */
    start(options: { eventDispatcher: EventDispatcher }): void;
  }

  /**
   * 事件分发器类
   * 用于注册和管理各类事件的处理函数
   */
  export class EventDispatcher {
    constructor(options?: EventDispatcherOptions);
    /**
     * 注册事件处理函数
     * @param handlers - 事件处理函数映射表，键为事件类型，值为处理函数
     */
    register(handlers: Record<string, (data: any) => void | Promise<void>>): void;
  }
}
