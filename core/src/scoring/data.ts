// core/src/scoring/data.ts
// 从 reference.db 只读构建 ScoringContext。signal 不碰 DB —— 数据在此一次性备齐。
// 不再自开连接:接收调用方已开的 Queryable(通常是 app 主进程长期持有的 ReferenceDb),
// 避免每次调用都 new Database 再 close —— node-sqlite3-wasm 对同文件多连接并存的锁语义
// 严格,长连接(ReferenceDb)+ 短连接(这里曾经的临时连接)并存会报 "database is locked"。
import type { Queryable } from "@ad/shared/types/db";
import type { ScoringContext, WinrateRow, AghsRow, AttrWinrate } from "@ad/shared/types/scoring";
import type { PlayerState } from "@ad/shared/types/draft";
import { pairKey } from "./signals/synergy";

export function buildScoringContext(
  q: Queryable,
  me: PlayerState,
  pickIndex: number | null,
  extras: Pick<ScoringContext, "seat" | "similar" | "pairFallback" | "synergyTopN"
    | "heroAttrs" | "heroFit" | "synergyLift" | "comboLookahead" | "pool"> = {},
): ScoringContext {
  // q.all() 内部用一次性 prepared statement 并自动 finalize,无需手动管理;
  // 连接生命周期由调用方/ReferenceDb 拥有,这里不 close。
  const winrate = new Map<number, WinrateRow>();
  for (const r of q.all(
    "SELECT ability_id, winrate, avg_pick_position, pick_rate FROM ability_winrate",
  ) as unknown as Array<{ ability_id: number; winrate: number | null; avg_pick_position: number | null; pick_rate: number | null }>) {
    winrate.set(r.ability_id, { winrate: r.winrate, avgPickPosition: r.avg_pick_position, pickRate: r.pick_rate });
  }
  for (const r of q.all(
    "SELECT hero_id, winrate FROM hero_winrate",
  ) as unknown as Array<{ hero_id: number; winrate: number | null }>) {
    // 英雄的胜率以 hero_winrate 为准;ability_winrate 里如果也有英雄这一行(负 id),
    // 保留它的平均顺位和被选比例(向前看时估「它还能留多久」要用)。
    const had = winrate.get(-r.hero_id);
    winrate.set(-r.hero_id, { winrate: r.winrate, avgPickPosition: had?.avgPickPosition ?? null, pickRate: had?.pickRate ?? null });
  }

  const pairWinrate = new Map<string, number>();
  const pairPicks = new Map<string, number>();
  for (const r of q.all(
    "SELECT ability_id_one, ability_id_two, winrate, num_picks FROM ability_pairs",
  ) as unknown as Array<{ ability_id_one: number; ability_id_two: number; winrate: number | null; num_picks: number | null }>) {
    if (r.winrate === null) continue;
    const key = pairKey(r.ability_id_one, r.ability_id_two);
    pairWinrate.set(key, r.winrate);
    if (r.num_picks !== null) pairPicks.set(key, r.num_picks);
  }

  // 技能在各类英雄上的胜率。旧的数据库可能没有这张表,没有就不按英雄修正。
  const attrWinrate = new Map<number, Record<string, AttrWinrate>>();
  if (extras.heroFit !== undefined) {
    try {
      for (const r of q.all(
        "SELECT ability_id, attr, winrate, num_picks FROM ability_hero_attr",
      ) as unknown as Array<{ ability_id: number; attr: string; winrate: number | null; num_picks: number | null }>) {
        if (r.winrate === null || r.num_picks === null) continue;
        let row = attrWinrate.get(r.ability_id);
        if (row === undefined) attrWinrate.set(r.ability_id, row = {});
        row[r.attr] = { winrate: r.winrate, picks: r.num_picks };
      }
    } catch { /* 没有这张表 */ }
  }

  const aghs = new Map<number, AghsRow>();
  for (const r of q.all(
    "SELECT ability_id, scepter_gain, shard_gain FROM ability_aghs",
  ) as unknown as Array<{ ability_id: number; scepter_gain: number | null; shard_gain: number | null }>) {
    aghs.set(r.ability_id, { scepterGain: r.scepter_gain, shardGain: r.shard_gain });
  }

  for (const r of q.all(
    "SELECT valve_id, has_scepter, has_shard FROM abilities WHERE slot_type IN ('normal','ultimate')",
  ) as unknown as Array<{ valve_id: number; has_scepter: number | null; has_shard: number | null }>) {
    const row = aghs.get(r.valve_id);
    if (row === undefined) continue;
    if (r.has_scepter !== null) row.hasScepter = !!r.has_scepter;
    if (r.has_shard !== null) row.hasShard = !!r.has_shard;
  }

  return { me, pickIndex, winrate, pairWinrate, pairPicks, attrWinrate, aghs, ...extras };
}
