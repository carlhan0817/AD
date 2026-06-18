// core/src/scoring/data.ts
// 从 reference.db 只读构建 ScoringContext。signal 不碰 DB —— 数据在此一次性备齐。
// node-sqlite3-wasm 是 CJS,只有 default 导出;具名导入在 Electron 严格 ESM 下会失败。
import pkg from "node-sqlite3-wasm";
const { Database } = pkg;
import type { ScoringContext, WinrateRow, AghsRow } from "@ad/shared/types/scoring";
import type { PlayerState } from "@ad/shared/types/draft";
import { pairKey } from "./signals/synergy";

export function buildScoringContext(
  dbPath: string,
  me: PlayerState,
  pickIndex: number | null,
): ScoringContext {
  const db = new Database(dbPath, { readOnly: true });
  try {
    // db.all() 内部用一次性 prepared statement 并自动 finalize,无需手动管理
    const winrate = new Map<number, WinrateRow>();
    for (const r of db.all(
      "SELECT ability_id, winrate, avg_pick_position FROM ability_winrate",
    ) as unknown as Array<{ ability_id: number; winrate: number | null; avg_pick_position: number | null }>) {
      winrate.set(r.ability_id, { winrate: r.winrate, avgPickPosition: r.avg_pick_position });
    }
    for (const r of db.all(
      "SELECT hero_id, winrate FROM hero_winrate",
    ) as unknown as Array<{ hero_id: number; winrate: number | null }>) {
      winrate.set(-r.hero_id, { winrate: r.winrate, avgPickPosition: null });
    }

    const pairWinrate = new Map<string, number>();
    for (const r of db.all(
      "SELECT ability_id_one, ability_id_two, winrate FROM ability_pairs",
    ) as unknown as Array<{ ability_id_one: number; ability_id_two: number; winrate: number | null }>) {
      if (r.winrate !== null) pairWinrate.set(pairKey(r.ability_id_one, r.ability_id_two), r.winrate);
    }

    const aghs = new Map<number, AghsRow>();
    for (const r of db.all(
      "SELECT ability_id, scepter_gain, shard_gain FROM ability_aghs",
    ) as unknown as Array<{ ability_id: number; scepter_gain: number | null; shard_gain: number | null }>) {
      aghs.set(r.ability_id, { scepterGain: r.scepter_gain, shardGain: r.shard_gain });
    }

    return { me, pickIndex, winrate, pairWinrate, aghs };
  } finally {
    db.close();
  }
}
