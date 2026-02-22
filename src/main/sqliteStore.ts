import { app } from 'electron';
import { EventEmitter } from 'events';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import initSqlJs, { Database, SqlJsStatic } from 'sql.js';
import { DB_FILENAME } from './appConstants';

type ChangePayload<T = unknown> = {
  key: string;
  newValue: T | undefined;
  oldValue: T | undefined;
};

const USER_MEMORIES_MIGRATION_KEY = 'userMemories.migration.v1.completed';

// 获取 sql.js WASM 文件的路径
function getWasmPath(): string {
  if (app.isPackaged) {
    // 在生产环境中，wasm 文件位于解压的资源目录中
    return path.join(
      process.resourcesPath,
      'app.asar.unpacked/node_modules/sql.js/dist/sql-wasm.wasm'
    );
  }
  // 在开发环境中，直接使用 node_modules 目录
  return path.join(app.getAppPath(), 'node_modules/sql.js/dist/sql-wasm.wasm');
}

export class SqliteStore {
  private db: Database;
  private dbPath: string;
  private emitter = new EventEmitter();
  private static sqlPromise: Promise<SqlJsStatic> | null = null;

  private constructor(db: Database, dbPath: string) {
    this.db = db;
    this.dbPath = dbPath;
  }

  static async create(userDataPath?: string): Promise<SqliteStore> {
    const basePath = userDataPath ?? app.getPath('userData');
    const dbPath = path.join(basePath, DB_FILENAME);

    // 使用 WASM 文件路径初始化 SQL.js（缓存 Promise 以便复用）
    if (!SqliteStore.sqlPromise) {
      const wasmPath = getWasmPath();
      SqliteStore.sqlPromise = initSqlJs({
        locateFile: () => wasmPath,
      });
    }
    const SQL = await SqliteStore.sqlPromise;

    // 加载现有数据库或创建新数据库
    let db: Database;
    if (fs.existsSync(dbPath)) {
      const buffer = fs.readFileSync(dbPath);
      db = new SQL.Database(buffer);
    } else {
      db = new SQL.Database();
    }

    const store = new SqliteStore(db, dbPath);
    store.initializeTables(basePath);
    return store;
  }

  private initializeTables(basePath: string) {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS kv (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);

    // 创建协作工作表
    this.db.run(`
      CREATE TABLE IF NOT EXISTS cowork_sessions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        claude_session_id TEXT,
        status TEXT NOT NULL DEFAULT 'idle',
        pinned INTEGER NOT NULL DEFAULT 0,
        cwd TEXT NOT NULL,
        system_prompt TEXT NOT NULL DEFAULT '',
        execution_mode TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS cowork_messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        type TEXT NOT NULL,
        content TEXT NOT NULL,
        metadata TEXT,
        created_at INTEGER NOT NULL,
        sequence INTEGER,
        FOREIGN KEY (session_id) REFERENCES cowork_sessions(id) ON DELETE CASCADE
      );
    `);

    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_cowork_messages_session_id ON cowork_messages(session_id);
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS cowork_config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS user_memories (
        id TEXT PRIMARY KEY,
        text TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        confidence REAL NOT NULL DEFAULT 0.75,
        is_explicit INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'created',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_used_at INTEGER
      );
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS user_memory_sources (
        id TEXT PRIMARY KEY,
        memory_id TEXT NOT NULL,
        session_id TEXT,
        message_id TEXT,
        role TEXT NOT NULL DEFAULT 'system',
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (memory_id) REFERENCES user_memories(id) ON DELETE CASCADE
      );
    `);

    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_user_memories_status_updated_at
      ON user_memories(status, updated_at DESC);
    `);
    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_user_memories_fingerprint
      ON user_memories(fingerprint);
    `);
    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_user_memory_sources_session_id
      ON user_memory_sources(session_id, is_active);
    `);
    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_user_memory_sources_memory_id
      ON user_memory_sources(memory_id, is_active);
    `);

    // 创建计划任务表
    this.db.run(`
      CREATE TABLE IF NOT EXISTS scheduled_tasks (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        enabled INTEGER NOT NULL DEFAULT 1,
        schedule_json TEXT NOT NULL,
        prompt TEXT NOT NULL,
        working_directory TEXT NOT NULL DEFAULT '',
        system_prompt TEXT NOT NULL DEFAULT '',
        execution_mode TEXT NOT NULL DEFAULT 'auto',
        expires_at TEXT,
        notify_platforms_json TEXT NOT NULL DEFAULT '[]',
        next_run_at_ms INTEGER,
        last_run_at_ms INTEGER,
        last_status TEXT,
        last_error TEXT,
        last_duration_ms INTEGER,
        running_at_ms INTEGER,
        consecutive_errors INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);

    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_next_run
        ON scheduled_tasks(enabled, next_run_at_ms);
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS scheduled_task_runs (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        session_id TEXT,
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        duration_ms INTEGER,
        error TEXT,
        trigger_type TEXT NOT NULL DEFAULT 'scheduled',
        FOREIGN KEY (task_id) REFERENCES scheduled_tasks(id) ON DELETE CASCADE
      );
    `);

    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_task_runs_task_id
        ON scheduled_task_runs(task_id, started_at DESC);
    `);

    // 数据库迁移 - 安全地添加不存在的列
    try {
      // 检查 execution_mode 列是否存在
      const colsResult = this.db.exec("PRAGMA table_info(cowork_sessions);");
      const columns = colsResult[0]?.values.map((row) => row[1]) || [];

      if (!columns.includes('execution_mode')) {
        this.db.run('ALTER TABLE cowork_sessions ADD COLUMN execution_mode TEXT;');
        this.save();
      }

      if (!columns.includes('pinned')) {
        this.db.run('ALTER TABLE cowork_sessions ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;');
        this.save();
      }

      if (!columns.includes('active_skill_ids')) {
        this.db.run('ALTER TABLE cowork_sessions ADD COLUMN active_skill_ids TEXT;');
        this.save();
      }

      // 迁移：为 cowork_messages 表添加 sequence 列
      const msgColsResult = this.db.exec("PRAGMA table_info(cowork_messages);");
      const msgColumns = msgColsResult[0]?.values.map((row) => row[1]) || [];

      if (!msgColumns.includes('sequence')) {
        this.db.run('ALTER TABLE cowork_messages ADD COLUMN sequence INTEGER');

        // 为现有消息按 created_at 和 ROWID 分配序列号
        this.db.run(`
          WITH numbered AS (
            SELECT id, ROW_NUMBER() OVER (
              PARTITION BY session_id
              ORDER BY created_at ASC, ROWID ASC
            ) as seq
            FROM cowork_messages
          )
          UPDATE cowork_messages
          SET sequence = (SELECT seq FROM numbered WHERE numbered.id = cowork_messages.id)
        `);

        this.save();
      }
    } catch {
      // 列已存在或无需迁移
    }

    try {
      this.db.run('UPDATE cowork_sessions SET pinned = 0 WHERE pinned IS NULL;');
    } catch {
      // 列可能尚不存在
    }

    try {
      this.db.run(`UPDATE cowork_sessions SET execution_mode = 'sandbox' WHERE execution_mode = 'container';`);
      this.db.run(`
        UPDATE cowork_config
        SET value = 'sandbox'
        WHERE key = 'executionMode' AND value = 'container';
      `);
    } catch (error) {
      console.warn('迁移协作执行模式失败:', error);
    }

    // 迁移：为 scheduled_tasks 表添加 expires_at 和 notify_platforms_json 列
    try {
      const stColsResult = this.db.exec("PRAGMA table_info(scheduled_tasks);");
      if (stColsResult[0]) {
        const stColumns = stColsResult[0].values.map((row) => row[1]) || [];

        if (!stColumns.includes('expires_at')) {
          this.db.run('ALTER TABLE scheduled_tasks ADD COLUMN expires_at TEXT');
          this.save();
        }

        if (!stColumns.includes('notify_platforms_json')) {
          this.db.run("ALTER TABLE scheduled_tasks ADD COLUMN notify_platforms_json TEXT NOT NULL DEFAULT '[]'");
          this.save();
        }
      }
    } catch {
      // 无需迁移或表尚不存在
    }

    this.migrateLegacyMemoryFileToUserMemories();
    this.migrateFromElectronStore(basePath);
    this.save();
  }

  save() {
    const data = this.db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(this.dbPath, buffer);
  }

  onDidChange<T = unknown>(key: string, callback: (newValue: T | undefined, oldValue: T | undefined) => void) {
    const handler = (payload: ChangePayload<T>) => {
      if (payload.key !== key) return;
      callback(payload.newValue, payload.oldValue);
    };
    this.emitter.on('change', handler);
    return () => this.emitter.off('change', handler);
  }

  get<T = unknown>(key: string): T | undefined {
    const result = this.db.exec('SELECT value FROM kv WHERE key = ?', [key]);
    if (!result[0]?.values[0]) return undefined;
    const value = result[0].values[0][0] as string;
    try {
      return JSON.parse(value) as T;
    } catch (error) {
      console.warn(`解析 ${key} 的存储值失败`, error);
      return undefined;
    }
  }

  set<T = unknown>(key: string, value: T): void {
    const oldValue = this.get<T>(key);
    const now = Date.now();
    this.db.run(`
      INSERT INTO kv (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `, [key, JSON.stringify(value), now]);
    this.save();
    this.emitter.emit('change', { key, newValue: value, oldValue } as ChangePayload<T>);
  }

  delete(key: string): void {
    const oldValue = this.get(key);
    this.db.run('DELETE FROM kv WHERE key = ?', [key]);
    this.save();
    this.emitter.emit('change', { key, newValue: undefined, oldValue } as ChangePayload);
  }

  // 暴露数据库供协作操作使用
  getDatabase(): Database {
    return this.db;
  }

  // 暴露保存方法供外部使用（例如 CoworkStore）
  getSaveFunction(): () => void {
    return () => this.save();
  }

  private tryReadLegacyMemoryText(): string {
    const candidates = [
      path.join(process.cwd(), 'MEMORY.md'),
      path.join(app.getAppPath(), 'MEMORY.md'),
      path.join(process.cwd(), 'memory.md'),
      path.join(app.getAppPath(), 'memory.md'),
    ];

    for (const candidate of candidates) {
      try {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
          return fs.readFileSync(candidate, 'utf8');
        }
      } catch {
        // 跳过无法读取的候选文件
      }
    }
    return '';
  }

  private parseLegacyMemoryEntries(raw: string): string[] {
    const normalized = raw.replace(/```[\s\S]*?```/g, ' ');
    const lines = normalized.split(/\r?\n/);
    const entries: string[] = [];
    const seen = new Set<string>();

    for (const line of lines) {
      const match = line.trim().match(/^-+\s*(?:\[[^\]]+\]\s*)?(.+)$/);
      if (!match?.[1]) continue;
      const text = match[1].replace(/\s+/g, ' ').trim();
      if (!text || text.length < 6) continue;
      if (/^\(empty\)$/i.test(text)) continue;
      const key = text.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push(text.length > 360 ? `${text.slice(0, 359)}…` : text);
    }

    return entries.slice(0, 200);
  }

  private memoryFingerprint(text: string): string {
    const normalized = text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return crypto.createHash('sha1').update(normalized).digest('hex');
  }

  private migrateLegacyMemoryFileToUserMemories(): void {
    if (this.get<string>(USER_MEMORIES_MIGRATION_KEY) === '1') {
      return;
    }

    const content = this.tryReadLegacyMemoryText();
    if (!content.trim()) {
      this.set(USER_MEMORIES_MIGRATION_KEY, '1');
      return;
    }

    const entries = this.parseLegacyMemoryEntries(content);
    if (entries.length === 0) {
      this.set(USER_MEMORIES_MIGRATION_KEY, '1');
      return;
    }

    const now = Date.now();
    this.db.run('BEGIN TRANSACTION;');
    try {
      for (const text of entries) {
        const fingerprint = this.memoryFingerprint(text);
        const existing = this.db.exec(
          `SELECT id FROM user_memories WHERE fingerprint = ? AND status != 'deleted' LIMIT 1`,
          [fingerprint]
        );
        if (existing[0]?.values?.[0]?.[0]) {
          continue;
        }

        const memoryId = crypto.randomUUID();
        this.db.run(`
          INSERT INTO user_memories (
            id, text, fingerprint, confidence, is_explicit, status, created_at, updated_at, last_used_at
          ) VALUES (?, ?, ?, ?, 1, 'created', ?, ?, NULL)
        `, [memoryId, text, fingerprint, 0.9, now, now]);

        this.db.run(`
          INSERT INTO user_memory_sources (id, memory_id, session_id, message_id, role, is_active, created_at)
          VALUES (?, ?, NULL, NULL, 'system', 1, ?)
        `, [crypto.randomUUID(), memoryId, now]);
      }

      this.db.run('COMMIT;');
    } catch (error) {
      this.db.run('ROLLBACK;');
      console.warn('迁移旧版 MEMORY.md 条目失败:', error);
    }

    this.set(USER_MEMORIES_MIGRATION_KEY, '1');
  }

  private migrateFromElectronStore(userDataPath: string) {
    const result = this.db.exec('SELECT COUNT(*) as count FROM kv');
    const count = result[0]?.values[0]?.[0] as number;
    if (count > 0) return;

    const legacyPath = path.join(userDataPath, 'config.json');
    if (!fs.existsSync(legacyPath)) return;

    try {
      const raw = fs.readFileSync(legacyPath, 'utf8');
      const data = JSON.parse(raw) as Record<string, unknown>;
      if (!data || typeof data !== 'object') return;

      const entries = Object.entries(data);
      if (!entries.length) return;

      const now = Date.now();
      this.db.run('BEGIN TRANSACTION;');
      try {
        entries.forEach(([key, value]) => {
          this.db.run(`
            INSERT INTO kv (key, value, updated_at)
            VALUES (?, ?, ?)
          `, [key, JSON.stringify(value), now]);
        });
        this.db.run('COMMIT;');
        this.save();
        console.info(`已从 electron-store 迁移 ${entries.length} 个条目`);
      } catch (error) {
        this.db.run('ROLLBACK;');
        throw error;
      }
    } catch (error) {
      console.warn('迁移 electron-store 数据失败:', error);
    }
  }
}
