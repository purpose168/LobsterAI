// 删除重复的类型声明，使用全局类型定义

/**
 * 本地存储接口
 * 提供异步的本地存储操作方法
 */
export interface LocalStore {
  /** 获取指定键的值 */
  getItem<T>(key: string): Promise<T | null>;
  /** 设置指定键的值 */
  setItem<T>(key: string, value: T): Promise<void>;
  /** 移除指定键 */
  removeItem(key: string): Promise<void>;
}

/**
 * 本地存储服务类
 * 实现了 LocalStore 接口，通过 Electron 的 IPC 与主进程通信
 */
class LocalStoreService implements LocalStore {
  // 从本地存储中获取指定键的值
  async getItem<T>(key: string): Promise<T | null> {
    try {
      const value = await window.electron.store.get(key);
      return value || null;
    } catch (error) {
      console.error('从存储中获取项目失败：', error);
      return null;
    }
  }

  // 将值存储到指定键中
  async setItem<T>(key: string, value: T): Promise<void> {
    try {
      await window.electron.store.set(key, value);
    } catch (error) {
      console.error('在存储中设置项目失败：', error);
      throw error;
    }
  }

  // 从存储中移除指定键
  async removeItem(key: string): Promise<void> {
    try {
      await window.electron.store.remove(key);
    } catch (error) {
      console.error('从存储中移除项目失败：', error);
      throw error;
    }
  }
}

/** 本地存储服务实例 */
export const localStore = new LocalStoreService(); 