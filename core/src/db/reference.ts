import { Database } from "node-sqlite3-wasm";

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
