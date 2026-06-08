// core/tests/scoring/recommend.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Database from "better-sqlite3";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";
import { recommend } from "../../src/scoring/recommend";
import { defaultScoringConfig } from "../../src/scoring/config";
import type { Candidate } from "@ad/shared/types/scoring";
import type { PlayerState } from "@ad/shared/types/draft";

let dbPath: string;
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
    db.prepare("INSERT INTO ability_winrate VALUES (?,?,?,?,?,?,?)").run(5050 + i, "p", 10, 5, 0.6 - i * 0.02, 5, 0.9);
  }
  db.prepare("INSERT INTO ability_winrate VALUES (6001,'p',10,5,0.59,3,0.9)").run();
  db.prepare("INSERT INTO ability_pairs VALUES (-9,5050,10,6,0.57)").run();
  db.close();
});
afterAll(() => rmSync(dbPath, { force: true }));

describe("recommend (acceptance, 细则 §4)", () => {
  it("never recommends a full slot type (always legal)", () => {
    const pool: Candidate[] = [
      { valveId: 5050, slotType: "normal" }, { valveId: 6001, slotType: "ultimate" },
    ];
    const me: PlayerState = { row: 0, hero: -9, normals: [], ultimates: [99] }; // 终极满
    const out = recommend(pool, me, 5, dbPath, defaultScoringConfig());
    expect(out.some((r) => r.candidate.slotType === "ultimate")).toBe(false);
  });

  it("truncates to topK (default 4)", () => {
    const pool: Candidate[] = Array.from({ length: 6 }, (_, i) => ({ valveId: 5050 + i, slotType: "normal" as const }));
    const me: PlayerState = { row: 0, hero: -9, normals: [], ultimates: [] };
    const out = recommend(pool, me, 5, dbPath, defaultScoringConfig());
    expect(out.length).toBe(4);
    expect(out[0].candidate.valveId).toBe(5050); // 最高胜率
  });

  it("respects a custom topK", () => {
    const pool: Candidate[] = Array.from({ length: 6 }, (_, i) => ({ valveId: 5050 + i, slotType: "normal" as const }));
    const me: PlayerState = { row: 0, hero: -9, normals: [], ultimates: [] };
    const out = recommend(pool, me, 5, dbPath, { ...defaultScoringConfig(), topK: 3 });
    expect(out.length).toBe(3);
  });
});
