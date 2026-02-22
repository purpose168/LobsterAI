/**
 * 协作模块组件导出
 * 统一导出协作功能相关的所有组件
 */

/**
 * 协作视图主组件
 * 负责协作会话的整体布局和管理，包括会话创建、消息流式传输、快捷操作等功能
 */
export { default as CoworkView, type CoworkViewProps } from './CoworkView';

/**
 * 协作提示输入组件
 * 提供任务输入界面，支持文本输入、文件附件、技能选择和工作目录配置
 */
export { default as CoworkPromptInput } from './CoworkPromptInput';

/**
 * 协作会话列表组件
 * 显示所有协作会话的列表，支持置顶、排序、选择和删除等操作
 */
export { default as CoworkSessionList } from './CoworkSessionList';

/**
 * 协作会话项组件
 * 显示单个协作会话的信息，包括标题、状态、时间等，支持重命名、置顶和删除操作
 */
export { default as CoworkSessionItem } from './CoworkSessionItem';

/**
 * 协作权限模态框组件
 * 用于显示工具权限请求，让用户批准或拒绝危险操作，支持问题交互
 */
export { default as CoworkPermissionModal } from './CoworkPermissionModal';

/**
 * 文件夹选择器弹出菜单组件
 * 提供工作目录选择功能，支持添加新文件夹和选择最近使用的文件夹
 */
export { default as FolderSelectorPopover } from './FolderSelectorPopover';
