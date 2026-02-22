/// <reference types="vite/client" /> // 引用 Vite 客户端类型定义

/**
 * Vite 环境变量接口
 * 定义了应用程序中可用的环境变量类型
 */
interface ImportMetaEnv {
  /**
   * 应用程序标题
   * 对应 .env 文件中的 VITE_APP_TITLE 变量
   */
  readonly VITE_APP_TITLE: string
}

/**
 * ImportMeta 接口扩展
 * 为 Vite 项目扩展标准的 ImportMeta 接口，添加环境变量访问支持
 */
interface ImportMeta {
  /**
   * 环境变量对象
   * 包含所有在 .env 文件中定义的 VITE_ 前缀变量
   */
  readonly env: ImportMetaEnv
} 
