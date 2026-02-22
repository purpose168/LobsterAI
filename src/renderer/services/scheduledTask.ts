/**
 * 定时任务服务模块
 * 负责管理与主进程的定时任务通信和状态同步
 */
import { store } from '../store';
import {
  setLoading,
  setError,
  setTasks,
  addTask,
  updateTask,
  removeTask,
  updateTaskState,
  setRuns,
  addOrUpdateRun,
  setAllRuns,
  appendAllRuns,
} from '../store/slices/scheduledTaskSlice';
import type {
  ScheduledTaskInput,
  ScheduledTaskStatusEvent,
  ScheduledTaskRunEvent,
} from '../types/scheduledTask';

/**
 * 定时任务服务类
 * 提供定时任务的增删改查、手动执行、停止等功能
 */
class ScheduledTaskService {
  /** 清理函数数组，用于在销毁时取消所有事件监听器 */
  private cleanupFns: (() => void)[] = [];
  /** 服务初始化状态标志 */
  private initialized = false;

  /**
   * 初始化服务
   * 设置事件监听器并加载任务列表
   */
  async init(): Promise<void> {
    // 防止重复初始化
    if (this.initialized) return;
    this.initialized = true;

    // 设置事件监听器
    this.setupListeners();
    // 加载任务列表
    await this.loadTasks();
  }

  /**
   * 销毁服务
   * 清理所有事件监听器并重置初始化状态
   */
  destroy(): void {
    // 执行所有清理函数，取消事件监听
    this.cleanupFns.forEach((fn) => fn());
    this.cleanupFns = [];
    this.initialized = false;
  }

  /**
   * 设置事件监听器
   * 监听任务状态更新和执行记录更新事件
   */
  private setupListeners(): void {
    const api = window.electron?.scheduledTasks;
    if (!api) return;

    // 监听任务状态更新事件
    const cleanupStatus = api.onStatusUpdate(
      (event: ScheduledTaskStatusEvent) => {
        store.dispatch(
          updateTaskState({
            taskId: event.taskId,
            taskState: event.state,
          })
        );
      }
    );
    this.cleanupFns.push(cleanupStatus);

    // 监听任务执行记录更新事件
    const cleanupRun = api.onRunUpdate(
      (event: ScheduledTaskRunEvent) => {
        store.dispatch(addOrUpdateRun(event.run));
      }
    );
    this.cleanupFns.push(cleanupRun);
  }

  /**
   * 加载所有定时任务
   * 从主进程获取任务列表并更新到 Redux store
   */
  async loadTasks(): Promise<void> {
    const api = window.electron?.scheduledTasks;
    if (!api) return;

    // 设置加载状态
    store.dispatch(setLoading(true));
    try {
      const result = await api.list();
      if (result.success && result.tasks) {
        // 成功获取任务列表，更新到 store
        store.dispatch(setTasks(result.tasks));
      }
    } catch (err: unknown) {
      // 发生错误时设置错误信息
      store.dispatch(setError(err instanceof Error ? err.message : String(err)));
    }
  }

  /**
   * 创建新的定时任务
   * @param input 任务输入参数
   */
  async createTask(input: ScheduledTaskInput): Promise<void> {
    const api = window.electron?.scheduledTasks;
    if (!api) return;

    try {
      const result = await api.create(input);
      if (result.success && result.task) {
        // 创建成功，将新任务添加到 store
        store.dispatch(addTask(result.task));
      } else {
        // 创建失败，抛出错误
        throw new Error(result.error || '创建任务失败');
      }
    } catch (err: unknown) {
      // 设置错误信息并重新抛出异常
      store.dispatch(setError(err instanceof Error ? err.message : String(err)));
      throw err;
    }
  }

  /**
   * 根据ID更新定时任务
   * @param id 任务ID
   * @param input 需要更新的任务字段
   */
  async updateTaskById(
    id: string,
    input: Partial<ScheduledTaskInput>
  ): Promise<void> {
    const api = window.electron?.scheduledTasks;
    if (!api) return;

    try {
      const result = await api.update(id, input);
      if (result.success && result.task) {
        // 更新成功，同步到 store
        store.dispatch(updateTask(result.task));
      }
    } catch (err: unknown) {
      // 设置错误信息并重新抛出异常
      store.dispatch(setError(err instanceof Error ? err.message : String(err)));
      throw err;
    }
  }

  /**
   * 删除定时任务
   * @param id 任务ID
   */
  async deleteTask(id: string): Promise<void> {
    const api = window.electron?.scheduledTasks;
    if (!api) return;

    try {
      const result = await api.delete(id);
      if (result.success) {
        // 删除成功，从 store 中移除任务
        store.dispatch(removeTask(id));
      }
    } catch (err: unknown) {
      // 设置错误信息并重新抛出异常
      store.dispatch(setError(err instanceof Error ? err.message : String(err)));
      throw err;
    }
  }

  /**
   * 切换定时任务的启用状态
   * @param id 任务ID
   * @param enabled 是否启用
   * @returns 返回警告信息（如果有），否则返回 null
   */
  async toggleTask(id: string, enabled: boolean): Promise<string | null> {
    const api = window.electron?.scheduledTasks;
    if (!api) return null;

    try {
      const result = await api.toggle(id, enabled);
      if (result.success && result.task) {
        // 切换成功，更新 store 中的任务状态
        store.dispatch(updateTask(result.task));
      }
      // 返回可能的警告信息
      return result.warning ?? null;
    } catch (err: unknown) {
      // 设置错误信息并重新抛出异常
      store.dispatch(setError(err instanceof Error ? err.message : String(err)));
      throw err;
    }
  }

  /**
   * 手动执行定时任务
   * @param id 任务ID
   */
  async runManually(id: string): Promise<void> {
    const api = window.electron?.scheduledTasks;
    if (!api) return;

    try {
      await api.runManually(id);
    } catch (err: unknown) {
      // 设置错误信息并重新抛出异常
      store.dispatch(setError(err instanceof Error ? err.message : String(err)));
      throw err;
    }
  }

  /**
   * 停止正在执行的定时任务
   * @param id 任务ID
   */
  async stopTask(id: string): Promise<void> {
    const api = window.electron?.scheduledTasks;
    if (!api) return;

    try {
      await api.stop(id);
    } catch (err: unknown) {
      // 设置错误信息并重新抛出异常
      store.dispatch(setError(err instanceof Error ? err.message : String(err)));
      throw err;
    }
  }

  /**
   * 加载指定任务的执行记录
   * @param taskId 任务ID
   * @param limit 返回记录数量限制
   * @param offset 偏移量，用于分页
   */
  async loadRuns(taskId: string, limit?: number, offset?: number): Promise<void> {
    const api = window.electron?.scheduledTasks;
    if (!api) return;

    try {
      const result = await api.listRuns(taskId, limit, offset);
      if (result.success && result.runs) {
        // 成功获取执行记录，更新到 store
        store.dispatch(setRuns({ taskId, runs: result.runs }));
      }
    } catch (err: unknown) {
      // 设置错误信息
      store.dispatch(setError(err instanceof Error ? err.message : String(err)));
    }
  }

  /**
   * 加载所有任务的执行记录
   * @param limit 返回记录数量限制
   * @param offset 偏移量，用于分页
   */
  async loadAllRuns(limit?: number, offset?: number): Promise<void> {
    const api = window.electron?.scheduledTasks;
    if (!api) return;

    try {
      const result = await api.listAllRuns(limit, offset);
      if (result.success && result.runs) {
        if (offset && offset > 0) {
          // 分页加载，追加到现有记录
          store.dispatch(appendAllRuns(result.runs));
        } else {
          // 首次加载，替换现有记录
          store.dispatch(setAllRuns(result.runs));
        }
      }
    } catch (err: unknown) {
      // 设置错误信息
      store.dispatch(setError(err instanceof Error ? err.message : String(err)));
    }
  }
}

// 导出定时任务服务单例实例
export const scheduledTaskService = new ScheduledTaskService();
