// core/src/scoring/filter.ts
// 第 0 步槽位硬过滤(计划书 §五 / 细则 §4.1):满员类型整类剔除。候选集是混合的。
import type { Candidate } from "@ad/shared/types/scoring";
import type { PlayerState } from "@ad/shared/types/draft";
import { remainingQuota } from "../statemachine/quota";

export function hardFilter(pool: Candidate[], me: PlayerState): Candidate[] {
  const q = remainingQuota(me);
  const allow = {
    hero: q.hero > 0,
    normal: q.normal > 0,
    ultimate: q.ultimate > 0,
  } as const;
  return pool.filter((c) => allow[c.slotType]);
}
