import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pkg from "node-sqlite3-wasm";
const { Database } = pkg;
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync, mkdirSync, existsSync } from "node:fs";
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

  it("all() runs a real SELECT over the held connection (Queryable)", () => {
    const ref = new ReferenceDb(dbPath);
    const rows = ref.all("SELECT valve_id, slot_type FROM abilities ORDER BY valve_id") as Array<{
      valve_id: number;
      slot_type: string;
    }>;
    expect(rows).toEqual([
      { valve_id: -9, slot_type: "hero" },
      { valve_id: 5048, slot_type: "ultimate" },
    ]);
    ref.close();
  });

  // 核心证据:崩溃/强杀进程会在文件系统留下 <dbpath>.lock 目录(node-sqlite3-wasm 的
  // mkdir 互斥锁),下次启动时哪怕只有一个只读连接也会在首次查询时撞上这个陈旧锁目录
  // 而抛 "database is locked"。这里人为模拟该残留场景:先手工 mkdir 出锁目录(模拟
  // 上次进程异常退出未 rmdir),再构造 ReferenceDb —— 期望它能自动清理陈旧锁并重试,
  // 而不是把 SQLite3Error 甩给调用方。
  it("recovers from a stale lock directory left by a crashed process", () => {
    const lockPath = `${dbPath}.lock`;
    mkdirSync(lockPath);
    expect(existsSync(lockPath)).toBe(true);

    let ref!: ReferenceDb;
    expect(() => {
      ref = new ReferenceDb(dbPath);
    }).not.toThrow();

    // 恢复后应能正常查询(证明清理 + 重试真的生效,不是静默吞掉错误)。
    expect(ref.slotType(5048)).toBe("ultimate");
    expect(ref.all("SELECT valve_id FROM abilities ORDER BY valve_id")).toEqual([
      { valve_id: -9 },
      { valve_id: 5048 },
    ]);

    ref.close();
  });
});
