/**
 * IM 消息网关状态管理切片
 * 用于管理即时通讯网关状态的 Redux Slice
 */

import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import type {
  IMGatewayConfig,
  IMGatewayStatus,
  DingTalkConfig,
  FeishuConfig,
  TelegramConfig,
  DiscordConfig,
  IMSettings,
} from '../../types/im';
import {
  DEFAULT_IM_CONFIG,
  DEFAULT_IM_STATUS,
} from '../../types/im';

/**
 * IM 状态接口
 * 定义 IM 消息网关的状态结构
 */
export interface IMState {
  config: IMGatewayConfig;      // IM 网关配置
  status: IMGatewayStatus;      // IM 网关状态
  isLoading: boolean;           // 加载状态
  error: string | null;        // 错误信息
}

// 初始状态
const initialState: IMState = {
  config: DEFAULT_IM_CONFIG,
  status: DEFAULT_IM_STATUS,
  isLoading: false,
  error: null,
};

// 创建 IM 状态管理切片
const imSlice = createSlice({
  name: 'im',
  initialState,
  reducers: {
    /**
     * 设置完整的 IM 网关配置
     * @param state 当前状态
     * @param action 新的 IM 网关配置
     */
    setConfig: (state, action: PayloadAction<IMGatewayConfig>) => {
      state.config = action.payload;
    },
    /**
     * 设置钉钉配置
     * @param state 当前状态
     * @param action 新的钉钉配置（部分更新）
     */
    setDingTalkConfig: (state, action: PayloadAction<Partial<DingTalkConfig>>) => {
      state.config.dingtalk = { ...state.config.dingtalk, ...action.payload };
    },
    /**
     * 设置飞书配置
     * @param state 当前状态
     * @param action 新的飞书配置（部分更新）
     */
    setFeishuConfig: (state, action: PayloadAction<Partial<FeishuConfig>>) => {
      state.config.feishu = { ...state.config.feishu, ...action.payload };
    },
    /**
     * 设置 Telegram 配置
     * @param state 当前状态
     * @param action 新的 Telegram 配置（部分更新）
     */
    setTelegramConfig: (state, action: PayloadAction<Partial<TelegramConfig>>) => {
      state.config.telegram = { ...state.config.telegram, ...action.payload };
    },
    /**
     * 设置 Discord 配置
     * @param state 当前状态
     * @param action 新的 Discord 配置（部分更新）
     */
    setDiscordConfig: (state, action: PayloadAction<Partial<DiscordConfig>>) => {
      state.config.discord = { ...state.config.discord, ...action.payload };
    },
    /**
     * 设置 IM 通用设置
     * @param state 当前状态
     * @param action 新的 IM 设置（部分更新）
     */
    setIMSettings: (state, action: PayloadAction<Partial<IMSettings>>) => {
      state.config.settings = { ...state.config.settings, ...action.payload };
    },
    /**
     * 设置 IM 网关状态
     * @param state 当前状态
     * @param action 新的 IM 网关状态
     */
    setStatus: (state, action: PayloadAction<IMGatewayStatus>) => {
      state.status = action.payload;
    },
    /**
     * 设置加载状态
     * @param state 当前状态
     * @param action 是否正在加载
     */
    setLoading: (state, action: PayloadAction<boolean>) => {
      state.isLoading = action.payload;
    },
    /**
     * 设置错误信息
     * @param state 当前状态
     * @param action 错误信息（null 表示清除错误）
     */
    setError: (state, action: PayloadAction<string | null>) => {
      state.error = action.payload;
    },
    /**
     * 清除错误信息
     * @param state 当前状态
     */
    clearError: (state) => {
      state.error = null;
    },
  },
});

// 导出所有 actions 供组件使用
export const {
  setConfig,                // 设置完整配置
  setDingTalkConfig,        // 设置钉钉配置
  setFeishuConfig,          // 设置飞书配置
  setTelegramConfig,        // 设置 Telegram 配置
  setDiscordConfig,         // 设置 Discord 配置
  setIMSettings,            // 设置 IM 通用设置
  setStatus,                // 设置网关状态
  setLoading,               // 设置加载状态
  setError,                 // 设置错误信息
  clearError,               // 清除错误信息
} = imSlice.actions;

// 导出 reducer 供 store 使用
export default imSlice.reducer;
