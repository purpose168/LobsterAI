import { app } from 'electron';
import fs from 'fs';
import path from 'path';

// 最大日志文件大小：5MB
const MAX_LOG_SIZE = 5 * 1024 * 1024;

// 日志文件路径缓存
let logFilePath: string | null = null;

/**
 * 获取日志文件路径
 * 如果路径不存在，则创建日志目录并设置日志文件路径
 * @returns 日志文件的完整路径
 */
function getLogFilePath(): string {
  if (!logFilePath) {
    const logDir = path.join(app.getPath('userData'), 'logs');
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    logFilePath = path.join(logDir, 'cowork.log');
  }
  return logFilePath;
}

/**
 * 日志文件轮转（如果需要）
 * 当日志文件大小超过最大限制时，将当前日志文件重命名为备份文件
 */
function rotateIfNeeded(): void {
  try {
    const filePath = getLogFilePath();
    if (!fs.existsSync(filePath)) return;
    const stat = fs.statSync(filePath);
    if (stat.size > MAX_LOG_SIZE) {
      const backupPath = filePath + '.old';
      if (fs.existsSync(backupPath)) {
        fs.unlinkSync(backupPath);
      }
      fs.renameSync(filePath, backupPath);
    }
  } catch {
    // 忽略日志轮转错误
  }
}

/**
 * 格式化时间戳
 * @returns ISO格式的时间戳字符串
 */
function formatTimestamp(): string {
  return new Date().toISOString();
}

/**
 * 记录协工作日志
 * @param level - 日志级别（INFO、WARN、ERROR）
 * @param tag - 日志标签，用于标识日志来源
 * @param message - 日志消息内容
 * @param extra - 额外的日志信息（可选）
 */
export function coworkLog(level: 'INFO' | 'WARN' | 'ERROR', tag: string, message: string, extra?: Record<string, unknown>): void {
  try {
    rotateIfNeeded();
    const parts = [`[${formatTimestamp()}] [${level}] [${tag}] ${message}`];
    if (extra) {
      for (const [key, value] of Object.entries(extra)) {
        const serialized = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
        parts.push(`  ${key}: ${serialized}`);
      }
    }
    parts.push('');
    fs.appendFileSync(getLogFilePath(), parts.join('\n'), 'utf-8');
  } catch {
    // 日志记录不应抛出异常
  }
}

/**
 * 获取协工作日志文件路径
 * @returns 日志文件的完整路径
 */
export function getCoworkLogPath(): string {
  return getLogFilePath();
}
