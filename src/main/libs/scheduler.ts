import { BrowserWindow } from 'electron';
import { ScheduledTaskStore, ScheduledTask, ScheduledTaskRun, Schedule, NotifyPlatform } from '../scheduledTaskStore';
import type { CoworkStore } from '../coworkStore';
import type { CoworkRunner } from './coworkRunner';
import type { IMGatewayManager } from '../im/imGatewayManager';

interface SchedulerDeps {
  scheduledTaskStore: ScheduledTaskStore;
  coworkStore: CoworkStore;
  getCoworkRunner: () => CoworkRunner;
  getIMGatewayManager?: () => IMGatewayManager | null;
  getSkillsPrompt?: () => Promise<string | null>;
}

export class Scheduler {
  private store: ScheduledTaskStore;
  private coworkStore: CoworkStore;
  private getCoworkRunner: () => CoworkRunner;
  private getIMGatewayManager: (() => IMGatewayManager | null) | null;
  private getSkillsPrompt: (() => Promise<string | null>) | null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private activeTasks: Map<string, AbortController> = new Map();
  // 跟踪正在运行任务的协同会话ID，以便我们可以停止它们
  private taskSessionIds: Map<string, string> = new Map();

  private static readonly MAX_TIMER_INTERVAL_MS = 60_000;
  private static readonly MAX_CONSECUTIVE_ERRORS = 5;

  constructor(deps: SchedulerDeps) {
    this.store = deps.scheduledTaskStore;
    this.coworkStore = deps.coworkStore;
    this.getCoworkRunner = deps.getCoworkRunner;
    this.getIMGatewayManager = deps.getIMGatewayManager ?? null;
    this.getSkillsPrompt = deps.getSkillsPrompt ?? null;
  }

  // --- 生命周期 ---

  start(): void {
    if (this.running) return;
    this.running = true;
    console.log('[调度器] 已启动');
    this.scheduleNext();
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    for (const [, controller] of this.activeTasks) {
      controller.abort();
    }
    this.activeTasks.clear();
    console.log('[调度器] 已停止');
  }

  reschedule(): void {
    if (!this.running) return;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.scheduleNext();
  }

  // --- 核心调度 ---

  private scheduleNext(): void {
    if (!this.running) return;

    const nextDueMs = this.store.getNextDueTimeMs();
    const now = Date.now();

    let delayMs: number;
    if (nextDueMs === null) {
      delayMs = Scheduler.MAX_TIMER_INTERVAL_MS;
    } else {
      delayMs = Math.min(
        Math.max(nextDueMs - now, 0),
        Scheduler.MAX_TIMER_INTERVAL_MS
      );
    }

    this.timer = setTimeout(() => {
      this.timer = null;
      this.tick();
    }, delayMs);
  }

  private async tick(): Promise<void> {
    if (!this.running) return;

    const now = Date.now();
    const dueTasks = this.store.getDueTasks(now);

    const executions = dueTasks.map((task) => this.executeTask(task, 'scheduled'));
    await Promise.allSettled(executions);

    this.scheduleNext();
  }

  // --- 任务执行 ---

  async executeTask(
    task: ScheduledTask,
    trigger: 'scheduled' | 'manual'
  ): Promise<void> {
    if (this.activeTasks.has(task.id)) {
      console.log(`[调度器] 任务 ${task.id} 已在运行中，跳过`);
      return;
    }

    // 检查任务是否已过期（手动触发时跳过）
    if (trigger === 'scheduled' && task.expiresAt) {
      const todayStr = new Date().toISOString().slice(0, 10);
      if (task.expiresAt <= todayStr) {
        console.log(`[调度器] 任务 ${task.id} 已过期（${task.expiresAt}），跳过`);
        return;
      }
    }

    const startTime = Date.now();
    const run = this.store.createRun(task.id, trigger);

    this.store.markTaskRunning(task.id, startTime);
    this.emitTaskStatusUpdate(task.id);
    this.emitRunUpdate(run);

    const abortController = new AbortController();
    this.activeTasks.set(task.id, abortController);

    let sessionId: string | null = null;
    let success = false;
    let error: string | null = null;

    try {
      sessionId = await this.startCoworkSession(task);
      success = true;
    } catch (err: unknown) {
      error = err instanceof Error ? err.message : String(err);
      console.error(`[调度器] 任务 ${task.id} 失败:`, error);
    } finally {
      const durationMs = Date.now() - startTime;
      this.activeTasks.delete(task.id);
      this.taskSessionIds.delete(task.id);

      // 检查任务是否仍然存在（可能在运行时已被删除）
      const taskStillExists = this.store.getTask(task.id) !== null;

      if (taskStillExists) {
        // 更新运行记录
        this.store.completeRun(
          run.id,
          success ? 'success' : 'error',
          sessionId,
          durationMs,
          error
        );

        // 更新任务状态
        this.store.markTaskCompleted(
          task.id,
          success,
          durationMs,
          error,
          task.schedule
        );

        // 连续错误过多时自动禁用
        const updatedTask = this.store.getTask(task.id);
        if (updatedTask && updatedTask.state.consecutiveErrors >= Scheduler.MAX_CONSECUTIVE_ERRORS) {
          this.store.toggleTask(task.id, false);
          console.warn(
            `[调度器] 任务 ${task.id} 在连续 ${Scheduler.MAX_CONSECUTIVE_ERRORS} 次错误后自动禁用`
          );
        }

        // 执行后禁用一次性 'at' 任务
        if (task.schedule.type === 'at') {
          this.store.toggleTask(task.id, false);
        }

        // 清理旧的运行历史
        this.store.pruneRuns(task.id, 100);

        // 发送IM通知
        if (task.notifyPlatforms && task.notifyPlatforms.length > 0) {
          await this.sendNotifications(task, success, durationMs, error);
        }

        // 发送最终更新
        this.emitTaskStatusUpdate(task.id);
        const updatedRun = this.store.getRun(run.id);
        if (updatedRun) {
          this.emitRunUpdate(updatedRun);
        }
      } else {
        console.log(`[调度器] 任务 ${task.id} 在执行期间被删除，跳过运行后更新`);
      }

      this.reschedule();
    }
  }

  private async startCoworkSession(task: ScheduledTask): Promise<string> {
    const config = this.coworkStore.getConfig();
    const cwd = task.workingDirectory || config.workingDirectory;
    const baseSystemPrompt = task.systemPrompt || config.systemPrompt;
    let skillsPrompt: string | null = null;
    if (this.getSkillsPrompt) {
      try {
        skillsPrompt = await this.getSkillsPrompt();
      } catch (error) {
        console.warn('[调度器] 为定时任务构建技能提示失败:', error);
      }
    }
    const systemPrompt = [skillsPrompt, baseSystemPrompt]
      .filter((prompt): prompt is string => Boolean(prompt?.trim()))
      .join('\n\n');
    const executionMode = task.executionMode || config.executionMode || 'auto';

    // 创建协同会话
    const session = this.coworkStore.createSession(
      `[定时] ${task.name}`,
      cwd,
      systemPrompt,
      executionMode,
      []
    );

    // 更新会话状态为运行中
    this.coworkStore.updateSession(session.id, { status: 'running' });

    // 添加初始用户消息
    this.coworkStore.addMessage(session.id, {
      type: 'user',
      content: task.prompt,
    });

    // 使用正常权限流程启动会话（无自动批准）
    this.taskSessionIds.set(task.id, session.id);
    const runner = this.getCoworkRunner();
    await runner.startSession(session.id, task.prompt, {
      skipInitialUserMessage: true,
      confirmationMode: 'text',
    });

    return session.id;
  }

  // --- IM通知 ---

  private async sendNotifications(
    task: ScheduledTask,
    success: boolean,
    durationMs: number,
    error: string | null
  ): Promise<void> {
    const imManager = this.getIMGatewayManager?.();
    if (!imManager) return;

    const status = success ? '✅ 成功' : '❌ 失败';
    const durationStr = durationMs < 1000
      ? `${durationMs}ms`
      : `${(durationMs / 1000).toFixed(1)}s`;

    let message = `📋 定时任务通知\n\n任务: ${task.name}\n状态: ${status}\n耗时: ${durationStr}`;
    if (error) {
      message += `\n错误: ${error}`;
    }

    for (const platform of task.notifyPlatforms) {
      try {
        await imManager.sendNotification(platform, message);
        console.log(`[调度器] 已通过 ${platform} 为任务 ${task.id} 发送通知`);
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.warn(`[调度器] 通过 ${platform} 发送通知失败: ${errMsg}`);
      }
    }
  }

  // --- 手动执行 ---

  async runManually(taskId: string): Promise<void> {
    const task = this.store.getTask(taskId);
    if (!task) throw new Error(`未找到任务: ${taskId}`);
    await this.executeTask(task, 'manual');
  }

  stopTask(taskId: string): boolean {
    const controller = this.activeTasks.get(taskId);
    if (controller) {
      // 如果有正在运行的协同会话，也停止它
      const sessionId = this.taskSessionIds.get(taskId);
      if (sessionId) {
        try {
          this.getCoworkRunner().stopSession(sessionId);
        } catch (err) {
          console.warn(`[调度器] 停止任务 ${taskId} 的协同会话失败:`, err);
        }
      }
      controller.abort();
      return true;
    }
    return false;
  }

  // --- 事件发送 ---

  private emitTaskStatusUpdate(taskId: string): void {
    const task = this.store.getTask(taskId);
    if (!task) return;

    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed()) {
        win.webContents.send('scheduledTask:statusUpdate', {
          taskId: task.id,
          state: task.state,
        });
      }
    });
  }

  private emitRunUpdate(run: ScheduledTaskRun): void {
    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed()) {
        win.webContents.send('scheduledTask:runUpdate', { run });
      }
    });
  }
}
