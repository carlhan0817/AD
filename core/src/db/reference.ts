import Database from "better-sqlite3";

export type SlotType = "hero" | "normal" | "ultimate";

export class ReferenceDb {
  private db: Database.Database;
  constructor(path: string) {
    this.db = new Database(path, { readonly: true });  // 只读消费(计划书 §三)
  }
  slotType(valveId: number): SlotType | null {
    const row = this.db
      .prepare("SELECT slot_type FROM abilities WHERE valve_id = ?")
      .get(valveId) as { slot_type: SlotType } | undefined;
    return row ? row.slot_type : null;
  }
  close(): void { this.db.close(); }
}
