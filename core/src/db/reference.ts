// node-sqlite3-wasm 是 CommonJS 模块,只有 default 导出;具名导入 { Database } 在
// Electron 的严格 ESM 加载下会抛 "Named export 'Database' not found"(虽然 Node 单测
// 的 CJS 互操作宽松、能过)。故统一 default 导入后解构,值与类型两用。
import pkg from "node-sqlite3-wasm";
const { Database } = pkg;
type Database = InstanceType<typeof Database>;
import type { Queryable } from "@ad/shared/types/db";

export type SlotType = "hero" | "normal" | "ultimate";

// ReferenceDb 是进程内对 reference.db 的唯一长连接(app 主进程 startLiveLoop 持有至退出)。
// 它同时实现 Queryable,让打分上下文(buildScoringContext/recommend)复用这同一个连接,
// 而不是每帧/每次再开一个新连接 —— node-sqlite3-wasm 对同文件多连接并存的锁语义严格,
// 长连接 + 短连接并存会报 "database is locked"(真机复现,8 秒左右首次 recommend 即触发)。
export class ReferenceDb implements Queryable {
  private db: Database;
  constructor(path: string) {
    this.db = new Database(path, { readOnly: true });  // 只读消费(计划书 §三)
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
