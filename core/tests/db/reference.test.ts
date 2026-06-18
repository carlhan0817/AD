import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pkg from "node-sqlite3-wasm";
const { Database } = pkg;
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";
import { ReferenceDb } from "../../src/db/reference";

let dbPath: string;
beforeAll(() => {
  dbPath = join(tmpdir(), `ref-${Date.now()}.db`);
  const db = new Database(dbPath);
  db.exec(`CREATE TABLE abilities (valve_id INTEGER PRIMARY KEY, short_name TEXT,
    english_name TEXT, slot_type TEXT, is_ultimate INTEGER, has_scepter INTEGER,
    has_shard INTEGER, owner_hero_id INTEGER, needs_review INTEGER)`);
  db.run(`INSERT INTO abilities VALUES (5048,'mirana_arrow','Sacred Arrow','ultimate',1,1,0,9,0)`);
  db.run(`INSERT INTO abilities VALUES (-9,'mirana','Hero: Mirana','hero',null,null,null,null,0)`);
  db.close();
});
afterAll(() => rmSync(dbPath, { force: true }));

describe("ReferenceDb", () => {
  it("looks up slot_type by valveId", () => {
    const ref = new ReferenceDb(dbPath);
    expect(ref.slotType(5048)).toBe("ultimate");
    expect(ref.slotType(-9)).toBe("hero");
    expect(ref.slotType(99999)).toBeNull();
    ref.close();
  });
});
