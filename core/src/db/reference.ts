// node-sqlite3-wasm 是 CommonJS 模块,只有 default 导出;具名导入 { Database } 在
// Electron 的严格 ESM 加载下会抛 "Named export 'Database' not found"(虽然 Node 单测
// 的 CJS 互操作宽松、能过)。故统一 default 导入后解构,值与类型两用。
import pkg from "node-sqlite3-wasm";
const { Database } = pkg;
type Database = InstanceType<typeof Database>;

export type SlotType = "hero" | "normal" | "ultimate";

export class ReferenceDb {
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
  close(): void { this.db.close(); }
}
