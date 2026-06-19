// core/src/scoring/data.ts
// 从 reference.db 只读构建 ScoringContext。signal 不碰 DB —— 数据在此一次性备齐。
// 不再自开连接:接收调用方已开的 Queryable(通常是 app 主进程长期持有的 ReferenceDb),
// 避免每次调用都 new Database 再 close —— node-sqlite3-wasm 对同文件多连接并存的锁语义
// 严格,长连接(ReferenceDb)+ 短连接(这里曾经的临时连接)并存会报 "database is locked"。
import type { Queryable } from "@ad/shared/types/db";
import type { ScoringContext, WinrateRow, AghsRow } from "@ad/shared/types/scoring";
import type { PlayerState } from "@ad/shared/types/draft";
import { pairKey } from "./signals/synergy";

export function buildScoringContext(
  q: Queryable,
  me: PlayerState,
  pickIndex: number | null,
): ScoringContext {
  // q.all() 内部用一次性 prepared statement 并自动 finalize,无需手动管理;
  // 连接生命周期由调用方/ReferenceDb 拥有,这里不 close。
  const winrate = new Map<number, WinrateRow>();
  for (const r of q.all(
    "SELECT ability_id, winrate, avg_pick_position FROM ability_winrate",
  ) as unknown as Array<{ ability_id: number; winrate: number | null; avg_pick_position: number | null }>) {
    winrate.set(r.ability_id, { winrate: r.winrate, avgPickPosition: r.avg_pick_position });
  }
  for (const r of q.all(
    "SELECT hero_id, winrate FROM hero_winrate",
  ) as unknown as Array<{ hero_id: number; winrate: number | null }>) {
    winrate.set(-r.hero_id, { winrate: r.winrate, avgPickPosition: null });
  }

  const pairWinrate = new Map<string, number>();
  for (const r of q.all(
    "SELECT ability_id_one, ability_id_two, winrate FROM ability_pairs",
  ) as unknown as Array<{ ability_id_one: number; ability_id_two: number; winrate: number | null }>) {
    if (r.winrate !== null) pairWinrate.set(pairKey(r.ability_id_one, r.ability_id_two), r.winrate);
  }

  const aghs = new Map<number, AghsRow>();
  for (const r of q.all(
    "SELECT ability_id, scepter_gain, shard_gain FROM ability_aghs",
  ) as unknown as Array<{ ability_id: number; scepter_gain: number | null; shard_gain: number | null }>) {
    aghs.set(r.ability_id, { scepterGain: r.scepter_gain, shardGain: r.shard_gain });
  }

  return { me, pickIndex, winrate, pairWinrate, aghs };
}
