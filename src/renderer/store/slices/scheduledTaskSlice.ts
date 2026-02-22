// 从 @reduxjs/toolkit 导入 createSlice 和 PayloadAction，用于创建 Redux slice
import { createSlice, PayloadAction } from '@reduxjs/toolkit';
// 导入定时任务相关的类型定义
import type {
  ScheduledTask,
  ScheduledTaskRun,
  ScheduledTaskRunWithName,
  TaskState,
  ScheduledTaskViewMode,
} from '../../types/scheduledTask';

/**
 * 定时任务状态的 Redux store 接口
 * 用于管理所有与定时任务相关的状态数据
 */
interface ScheduledTaskState {
  tasks: ScheduledTask[];                    // 定时任务列表
  selectedTaskId: string | null;              // 当前选中的任务ID
  viewMode: ScheduledTaskViewMode;            // 视图模式：'list'(列表视图) 或 'detail'(详情视图)
  runs: Record<string, ScheduledTaskRun[]>;   // 按任务ID存储的任务运行记录
  allRuns: ScheduledTaskRunWithName[];        // 所有任务的运行记录（带任务名称）
  loading: boolean;                           // 加载状态标志
  error: string | null;                       // 错误信息
}

// 初始状态定义
const initialState: ScheduledTaskState = {
  tasks: [],               // 初始为空的任务列表
  selectedTaskId: null,    // 初始未选中任何任务
  viewMode: 'list',        // 默认视图模式为列表视图
  runs: {},                // 初始无运行记录
  allRuns: [],             // 初始无所有运行记录
  loading: false,          // 初始未加载
  error: null,             // 初始无错误
};

/**
 * 定时任务 Redux Slice
 * 负责管理定时任务的所有状态和操作
 */
const scheduledTaskSlice = createSlice({
  name: 'scheduledTask',   // Slice 名称，用于 Redux store 中的命名空间
  initialState,            // 初始状态
  reducers: {
    /**
     * 设置加载状态
     * @param state - 当前状态
     * @param action - 布尔值 Payload，表示是否正在加载
     */
    setLoading(state, action: PayloadAction<boolean>) {
      state.loading = action.payload;
    },
    /**
     * 设置错误信息
     * @param state - 当前状态
     * @param action - 错误信息字符串或 null 的 Payload
     */
    setError(state, action: PayloadAction<string | null>) {
      state.error = action.payload;
    },
    /**
     * 设置任务列表
     * 同时自动设置加载状态为 false
     * @param state - 当前状态
     * @param action - 任务数组的 Payload
     */
    setTasks(state, action: PayloadAction<ScheduledTask[]>) {
      state.tasks = action.payload;
      state.loading = false;
    },
    /**
     * 添加新任务到列表顶部
     * @param state - 当前状态
     * @param action - 新任务的 Payload
     */
    addTask(state, action: PayloadAction<ScheduledTask>) {
      state.tasks.unshift(action.payload);
    },
    /**
     * 更新指定任务
     * @param state - 当前状态
     * @param action - 更新后的任务对象的 Payload
     */
    updateTask(state, action: PayloadAction<ScheduledTask>) {
      const index = state.tasks.findIndex((t) => t.id === action.payload.id);
      if (index !== -1) {
        state.tasks[index] = action.payload;
      }
    },
    /**
     * 删除指定任务
     * 如果删除的是当前选中的任务，则重置选中状态和视图模式
     * 同时清理该任务的运行记录
     * @param state - 当前状态
     * @param action - 要删除的任务ID的 Payload
     */
    removeTask(state, action: PayloadAction<string>) {
      state.tasks = state.tasks.filter((t) => t.id !== action.payload);
      if (state.selectedTaskId === action.payload) {
        state.selectedTaskId = null;
        state.viewMode = 'list';   // 切换回列表视图
      }
      delete state.runs[action.payload];
      state.allRuns = state.allRuns.filter((r) => r.taskId !== action.payload);
    },
    /**
     * 更新单个任务的状态
     * @param state - 当前状态
     * @param action - 包含任务ID和新状态的 Payload
     */
    updateTaskState(
      state,
      action: PayloadAction<{ taskId: string; taskState: TaskState }>
    ) {
      const task = state.tasks.find((t) => t.id === action.payload.taskId);
      if (task) {
        task.state = action.payload.taskState;
      }
    },
    /**
     * 选中或取消选中任务
     * 选中时切换到详情视图，取消选中时切换到列表视图
     * @param state - 当前状态
     * @param action - 任务ID或 null 的 Payload
     */
    selectTask(state, action: PayloadAction<string | null>) {
      state.selectedTaskId = action.payload;
      state.viewMode = action.payload ? 'detail' : 'list';   // 详情视图 : 列表视图
    },
    /**
     * 设置视图模式
     * @param state - 当前状态
     * @param action - 视图模式的 Payload
     */
    setViewMode(state, action: PayloadAction<ScheduledTaskViewMode>) {
      state.viewMode = action.payload;
    },
    /**
     * 设置指定任务的运行记录
     * @param state - 当前状态
     * @param action - 包含任务ID和运行记录数组的 Payload
     */
    setRuns(
      state,
      action: PayloadAction<{ taskId: string; runs: ScheduledTaskRun[] }>
    ) {
      state.runs[action.payload.taskId] = action.payload.runs;
    },
    /**
     * 添加或更新单条运行记录
     * 如果记录已存在则更新，否则添加到列表顶部
     * @param state - 当前状态
     * @param action - 运行记录的 Payload
     */
    addOrUpdateRun(state, action: PayloadAction<ScheduledTaskRun>) {
      const { taskId } = action.payload;
      if (!state.runs[taskId]) {
        state.runs[taskId] = [];
      }
      const existingIndex = state.runs[taskId].findIndex(
        (r) => r.id === action.payload.id
      );
      if (existingIndex !== -1) {
        state.runs[taskId][existingIndex] = action.payload;
      } else {
        state.runs[taskId].unshift(action.payload);
      }
    },
    /**
     * 设置所有任务的运行记录
     * 替换现有的所有运行记录
     * @param state - 当前状态
     * @param action - 运行记录数组的 Payload
     */
    setAllRuns(state, action: PayloadAction<ScheduledTaskRunWithName[]>) {
      state.allRuns = action.payload;
    },
    /**
     * 追加新的运行记录到现有列表
     * @param state - 当前状态
     * @param action - 要追加的运行记录数组的 Payload
     */
    appendAllRuns(state, action: PayloadAction<ScheduledTaskRunWithName[]>) {
      state.allRuns = [...state.allRuns, ...action.payload];
    },
  },
});

// 导出所有 action creators，供组件和异步 thunk 使用
export const {
  setLoading,           // 设置加载状态
  setError,             // 设置错误信息
  setTasks,             // 设置任务列表
  addTask,              // 添加新任务
  updateTask,           // 更新任务
  removeTask,           // 删除任务
  updateTaskState,      // 更新任务状态
  selectTask,           // 选中任务
  setViewMode,          // 设置视图模式
  setRuns,              // 设置运行记录
  addOrUpdateRun,       // 添加或更新运行记录
  setAllRuns,           // 设置所有运行记录
  appendAllRuns,        // 追加运行记录
} = scheduledTaskSlice.actions;

// 导出 reducer，用于配置 Redux store
export default scheduledTaskSlice.reducer;
