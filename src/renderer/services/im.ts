/**
 * IM 服务
 * IM 网关操作的 IPC 封装器
 */

import { store } from '../store';
import {
  setConfig,
  setStatus,
  setLoading,
  setError,
} from '../store/slices/imSlice';
import type {
  IMGatewayConfig,
  IMGatewayStatus,
  IMPlatform,
  IMConfigResult,
  IMStatusResult,
  IMGatewayResult,
  IMConnectivityTestResult,
  IMConnectivityTestResponse,
} from '../types/im';

class IMService {
  private statusUnsubscribe: (() => void) | null = null;
  private messageUnsubscribe: (() => void) | null = null;

  /**
   * 初始化 IM 服务
   */
  async init(): Promise<void> {
    // 设置状态变更监听器
    this.statusUnsubscribe = window.electron.im.onStatusChange((status: IMGatewayStatus) => {
      store.dispatch(setStatus(status));
    });

    // 设置消息监听器（用于日志记录/监控）
    this.messageUnsubscribe = window.electron.im.onMessageReceived((message) => {
      console.log('[IM 服务] 收到消息:', message);
    });

    // 加载初始配置和状态
    await this.loadConfig();
    await this.loadStatus();
  }

  /**
   * 清理监听器
   */
  destroy(): void {
    if (this.statusUnsubscribe) {
      this.statusUnsubscribe();
      this.statusUnsubscribe = null;
    }
    if (this.messageUnsubscribe) {
      this.messageUnsubscribe();
      this.messageUnsubscribe = null;
    }
  }

  /**
   * 从主进程加载配置
   */
  async loadConfig(): Promise<IMGatewayConfig | null> {
    try {
      store.dispatch(setLoading(true));
      const result: IMConfigResult = await window.electron.im.getConfig();
      if (result.success && result.config) {
        store.dispatch(setConfig(result.config));
        return result.config;
      } else {
        store.dispatch(setError(result.error || '加载 IM 配置失败'));
        return null;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '加载 IM 配置失败';
      store.dispatch(setError(message));
      return null;
    } finally {
      store.dispatch(setLoading(false));
    }
  }

  /**
   * 从主进程加载状态
   */
  async loadStatus(): Promise<IMGatewayStatus | null> {
    try {
      const result: IMStatusResult = await window.electron.im.getStatus();
      if (result.success && result.status) {
        store.dispatch(setStatus(result.status));
        return result.status;
      }
      return null;
    } catch (error) {
      console.error('[IM 服务] 加载状态失败:', error);
      return null;
    }
  }

  /**
   * 更新配置
   */
  async updateConfig(config: Partial<IMGatewayConfig>): Promise<boolean> {
    try {
      store.dispatch(setLoading(true));
      const result: IMGatewayResult = await window.electron.im.setConfig(config);
      if (result.success) {
        // 重新加载配置以获取合并后的值
        await this.loadConfig();
        return true;
      } else {
        store.dispatch(setError(result.error || '更新 IM 配置失败'));
        return false;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '更新 IM 配置失败';
      store.dispatch(setError(message));
      return false;
    } finally {
      store.dispatch(setLoading(false));
    }
  }

  /**
   * 启动网关
   */
  async startGateway(platform: IMPlatform): Promise<boolean> {
    try {
      store.dispatch(setLoading(true));
      store.dispatch(setError(null));
      const result: IMGatewayResult = await window.electron.im.startGateway(platform);
      if (result.success) {
        await this.loadStatus();
        return true;
      } else {
        store.dispatch(setError(result.error || `启动 ${platform} 网关失败`));
        return false;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : `启动 ${platform} 网关失败`;
      store.dispatch(setError(message));
      return false;
    } finally {
      store.dispatch(setLoading(false));
    }
  }

  /**
   * 停止网关
   */
  async stopGateway(platform: IMPlatform): Promise<boolean> {
    try {
      store.dispatch(setLoading(true));
      const result: IMGatewayResult = await window.electron.im.stopGateway(platform);
      if (result.success) {
        await this.loadStatus();
        return true;
      } else {
        store.dispatch(setError(result.error || `停止 ${platform} 网关失败`));
        return false;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : `停止 ${platform} 网关失败`;
      store.dispatch(setError(message));
      return false;
    } finally {
      store.dispatch(setLoading(false));
    }
  }

  /**
   * 测试网关连接性和会话就绪状态
   */
  async testGateway(
    platform: IMPlatform,
    configOverride?: Partial<IMGatewayConfig>
  ): Promise<IMConnectivityTestResult | null> {
    try {
      store.dispatch(setLoading(true));
      const result: IMConnectivityTestResponse = await window.electron.im.testGateway(platform, configOverride);
      if (result.success && result.result) {
        return result.result;
      }
      store.dispatch(setError(result.error || `测试 ${platform} 连接性失败`));
      return null;
    } catch (error) {
      const message = error instanceof Error ? error.message : `测试 ${platform} 连接性失败`;
      store.dispatch(setError(message));
      return null;
    } finally {
      store.dispatch(setLoading(false));
    }
  }

  /**
   * 从 store 获取当前配置
   */
  getConfig(): IMGatewayConfig {
    return store.getState().im.config;
  }

  /**
   * 从 store 获取当前状态
   */
  getStatus(): IMGatewayStatus {
    return store.getState().im.status;
  }

  /**
   * 检查是否有任何网关已连接
   */
  isAnyConnected(): boolean {
    const status = this.getStatus();
    return status.dingtalk.connected || status.feishu.connected || status.telegram.connected || status.discord.connected;
  }
}

export const imService = new IMService();
