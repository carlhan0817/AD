// core/tests/scoring/recommend.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pkg from "node-sqlite3-wasm";
const { Database } = pkg;
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";
import { recommend } from "../../src/scoring/recommend";
import { defaultScoringConfig } from "../../src/scoring/config";
import { ReferenceDb } from "../../src/db/reference";
import type { Candidate } from "@ad/shared/types/scoring";
import type { PlayerState } from "@ad/shared/types/draft";

let dbPath: string;
let ref: ReferenceDb;
beforeAll(() => {
  dbPath = join(tmpdir(), `rec-${Date.now()}.db`);
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE ability_winrate (ability_id INTEGER PRIMARY KEY, patch TEXT,
      num_picks INTEGER, wins INTEGER, winrate REAL, avg_pick_position REAL, pick_rate REAL);
    CREATE TABLE hero_winrate (hero_id INTEGER PRIMARY KEY, patch TEXT, wins INTEGER, num_games INTEGER, winrate REAL);
    CREATE TABLE ability_pairs (ability_id_one INTEGER, ability_id_two INTEGER, num_picks INTEGER, wins INTEGER, winrate REAL, PRIMARY KEY (ability_id_one, ability_id_two));
    CREATE TABLE ability_aghs (ability_id INTEGER PRIMARY KEY, scepter_gain REAL, shard_gain REAL);
  `);
  // 6 个普通候选,胜率递减,确保 Top-K 截断可验
  for (let i = 0; i < 6; i++) {
    db.run("INSERT INTO ability_winrate VALUES (?,?,?,?,?,?,?)", [5050 + i, "p", 10, 5, 0.6 - i * 0.02, 5, 0.9]);
  }
  db.run("INSERT INTO ability_winrate VALUES (6001,'p',10,5,0.59,3,0.9)");
  db.run("INSERT INTO ability_pairs VALUES (-9,5050,10,6,0.57)");
  db.close();
  // recommend 现在收 Queryable,不再自开连接 —— 复用一个 ReferenceDb(与生产代码同款
  // 长连接)贯穿全部用例。
  ref = new ReferenceDb(dbPath);
});
afterAll(() => {
  ref.close();
  rmSync(dbPath, { force: true });
});

describe("recommend (acceptance, 细则 §4)", () => {
  it("never recommends a full slot type (always legal)", () => {
    const pool: Candidate[] = [
      { valveId: 5050, slotType: "normal" }, { valveId: 6001, slotType: "ultimate" },
    ];
    const me: PlayerState = { row: 0, hero: -9, normals: [], ultimates: [99] }; // 终极满
    const out = recommend(pool, me, 5, ref, defaultScoringConfig());
    expect(out.some((r) => r.candidate.slotType === "ultimate")).toBe(false);
  });

  it("truncates to topK (default 4)", () => {
    const pool: Candidate[] = Array.from({ length: 6 }, (_, i) => ({ valveId: 5050 + i, slotType: "normal" as const }));
    const me: PlayerState = { row: 0, hero: -9, normals: [], ultimates: [] };
    const out = recommend(pool, me, 5, ref, defaultScoringConfig());
    expect(out.length).toBe(4);
    expect(out[0].candidate.valveId).toBe(5050); // 最高胜率
  });

  it("respects a custom topK", () => {
    const pool: Candidate[] = Array.from({ length: 6 }, (_, i) => ({ valveId: 5050 + i, slotType: "normal" as const }));
    const me: PlayerState = { row: 0, hero: -9, normals: [], ultimates: [] };
    const out = recommend(pool, me, 5, ref, { ...defaultScoringConfig(), topK: 3 });
    expect(out.length).toBe(3);
  });
});

describe("recommend (regression: shared connection across multiple frames)", () => {
  it("does not throw 'database is locked' when the same ReferenceDb is reused across consecutive recommend() calls", () => {
    // 复现真机 bug 的场景:监控循环每帧调一次 recommend,但只应有一个 DB 连接(ReferenceDb)
    // 全程存活 —— 旧实现是 buildScoringContext 内部每次 new Database(dbPath) 再 close,
    // 与长期持有的 ReferenceDb 连接并存,在 node-sqlite3-wasm 下报 "database is locked"。
    // 这里用同一个 ref 连续调用两次 recommend,模拟循环的第 1 帧和第 2 帧。
    const pool: Candidate[] = Array.from({ length: 6 }, (_, i) => ({ valveId: 5050 + i, slotType: "normal" as const }));
    const me: PlayerState = { row: 0, hero: -9, normals: [], ultimates: [] };

    const first = recommend(pool, me, 5, ref, defaultScoringConfig());
    const second = recommend(pool, me, 6, ref, defaultScoringConfig());

    expect(first.length).toBeGreaterThan(0);
    expect(second.length).toBeGreaterThan(0);
    expect(second[0].candidate.valveId).toBe(5050); // 第二帧仍能正确查到数据,连接未被破坏
  });
});
