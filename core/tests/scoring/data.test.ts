// core/tests/scoring/data.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Database from "better-sqlite3";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";
import { buildScoringContext } from "../../src/scoring/data";
import { pairKey } from "../../src/scoring/signals/synergy";
import type { PlayerState } from "@ad/shared/types/draft";

let dbPath: string;
beforeAll(() => {
  dbPath = join(tmpdir(), `score-${Date.now()}.db`);
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE ability_winrate (ability_id INTEGER PRIMARY KEY, patch TEXT,
      num_picks INTEGER, wins INTEGER, winrate REAL, avg_pick_position REAL, pick_rate REAL);
    CREATE TABLE hero_winrate (hero_id INTEGER PRIMARY KEY, patch TEXT,
      wins INTEGER, num_games INTEGER, winrate REAL);
    CREATE TABLE ability_pairs (ability_id_one INTEGER, ability_id_two INTEGER,
      num_picks INTEGER, wins INTEGER, winrate REAL, PRIMARY KEY (ability_id_one, ability_id_two));
    CREATE TABLE ability_aghs (ability_id INTEGER PRIMARY KEY, scepter_gain REAL, shard_gain REAL);
  `);
  db.prepare("INSERT INTO ability_winrate VALUES (5051,'p',10,5,0.55,8.4,0.9)").run();
  db.prepare("INSERT INTO hero_winrate VALUES (9,'p',1,2,0.52)").run();
  db.prepare("INSERT INTO ability_pairs VALUES (-9,5051,10,6,0.57)").run();
  db.prepare("INSERT INTO ability_aghs VALUES (5051,0.078,0.047)").run();
  db.close();
});
afterAll(() => rmSync(dbPath, { force: true }));

describe("buildScoringContext", () => {
  const me: PlayerState = { row: 0, hero: -9, normals: [], ultimates: [] };

  it("merges ability + hero winrates into one map keyed by valveId", () => {
    const ctx = buildScoringContext(dbPath, me, 5);
    expect(ctx.winrate.get(5051)?.winrate).toBe(0.55);
    expect(ctx.winrate.get(5051)?.avgPickPosition).toBe(8.4);
    expect(ctx.winrate.get(-9)?.winrate).toBe(0.52); // hero 9 → -9
  });

  it("loads ability pairs under order-independent pairKey", () => {
    expect(buildScoringContext(dbPath, me, 5).pairWinrate.get(pairKey(-9, 5051))).toBe(0.57);
  });

  it("loads aghs scepter/shard gains", () => {
    const ctx = buildScoringContext(dbPath, me, 5);
    expect(ctx.aghs.get(5051)?.scepterGain).toBeCloseTo(0.078, 6);
    expect(ctx.aghs.get(5051)?.shardGain).toBeCloseTo(0.047, 6);
  });

  it("carries me + pickIndex through", () => {
    const ctx = buildScoringContext(dbPath, me, 7);
    expect(ctx.me.hero).toBe(-9);
    expect(ctx.pickIndex).toBe(7);
  });
});
