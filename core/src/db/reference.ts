// node-sqlite3-wasm 是 CommonJS 模块,只有 default 导出;具名导入 { Database } 在
// Electron 的严格 ESM 加载下会抛 "Named export 'Database' not found"(虽然 Node 单测
// 的 CJS 互操作宽松、能过)。故统一 default 导入后解构,值与类型两用。
import pkg from "node-sqlite3-wasm";
const { Database } = pkg;
type Database = InstanceType<typeof Database>;
import type { Queryable } from "@ad/shared/types/db";
import { rmSync, existsSync } from "node:fs";

export type SlotType = "hero" | "normal" | "ultimate";

// ReferenceDb 是进程内对 reference.db 的唯一长连接(app 主进程 startLiveLoop 持有至退出)。
// 它同时实现 Queryable,让打分上下文(buildScoringContext/recommend)复用这同一个连接,
// 而不是每帧/每次再开一个新连接 —— node-sqlite3-wasm 对同文件多连接并存的锁语义严格,
// 长连接 + 短连接并存会报 "database is locked"(真机复现,8 秒左右首次 recommend 即触发)。
export class ReferenceDb implements Queryable {
  private db: Database;
  constructor(path: string) {
    this.db = ReferenceDb.openWithStaleLockRecovery(path);
  }

  /** node-sqlite3-wasm 用文件系统上的一个锁目录 `<path>.lock` 做互斥(mkdir 加锁 /
   *  rmdir 解锁,见其 VFS 实现 _nodejsLock/_nodejsUnlock)。若上一个持有连接的进程
   *  异常退出(被 locked 崩掉、被强杀等),这个锁目录不会被 rmdir,残留在磁盘上 ——
   *  下次启动时,哪怕只有这一个(只读)连接,首次访问(prepare/get/all,不是
   *  构造函数本身)也会因为 mkdir EEXIST 而抛 `SQLite3Error: database is locked`。
   *  这是陈旧锁(stale lock),不是真实并发冲突。
   *
   *  韧性策略:构造后立刻用一次轻量探测查询(对 sqlite_master 的 SELECT,任何合法
   *  sqlite 文件都有这张表,空库也不例外)强制触发首次加锁路径。若探测命中
   *  "database is locked",就认为撞上了陈旧锁:关闭当前连接、删除锁目录、重新开库
   *  再探测一次。最多重试一次 —— 仍失败就把错误抛出去,交给上层 startLiveLoop 的
   *  try/catch 诊断并降级。
   *
   *  安全边界:盲删锁目录在"多个进程合法并发持有同一把锁"的场景下是危险的——会
   *  误删别的活进程正持有的锁,导致该进程后续写入语义被破坏。但本应用对 reference.db
   *  是单进程只读消费(计划书 §三),不存在合法的多进程并发写者;且这里只在已经
   *  实际撞上 "database is locked" 之后才清理,不是无条件清理。若未来出现合法的
   *  多进程并发(例如多个 app 实例或独立的写者),这个清理策略需要重新评估
   *  (例如改为基于锁文件 mtime 的陈旧判定,而不是"撞锁就删")。 */
  private static openWithStaleLockRecovery(path: string): Database {
    const probe = (db: Database): void => {
      db.all("SELECT name FROM sqlite_master LIMIT 1");
    };

    let db = new Database(path, { readOnly: true });
    try {
      probe(db);
      return db;
    } catch (err) {
      if (!ReferenceDb.isDatabaseLockedError(err)) throw err;

      try { db.close(); } catch { /* close 本身也可能抛,忽略 */ }

      const lockPath = `${path}.lock`;
      if (existsSync(lockPath)) {
        console.warn(`[ReferenceDb] 检测到陈旧锁目录,清理后重试一次: ${lockPath}`);
        rmSync(lockPath, { recursive: true, force: true });
      }

      db = new Database(path, { readOnly: true });
      probe(db); // 仍然 locked 则在此抛出,不再重试(最多重试一次)
      return db;
    }
  }

  private static isDatabaseLockedError(err: unknown): boolean {
    return err instanceof Error && err.message.includes("database is locked");
  }

  slotType(valveId: number): SlotType | null {
    const stmt = this.db.prepare("SELECT slot_type FROM abilities WHERE valve_id = ?");
    try {
      const row = stmt.get(valveId) as { slot_type: SlotType } | null;
      return row ? row.slot_type : null;
    } finally {
      stmt.finalize();  // node-sqlite3-wasm 要求手动 finalize,db.close() 不会自动处理
    }
  }
  /** Queryable 实现:供 buildScoringContext 复用本连接跑无参 SELECT。
   *  db.all() 内部用一次性 prepared statement 并自动 finalize,无需手动管理。 */
  all(sql: string): unknown[] {
    return this.db.all(sql);
  }
  close(): void { this.db.close(); }
}
