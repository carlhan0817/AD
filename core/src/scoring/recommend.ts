// core/src/scoring/recommend.ts
// 端到端(细则 §4):硬过滤 → 上下文 → 动态打分 → Top-K。
import type { Queryable } from "@ad/shared/types/db";
import type { Candidate, HeroAttr, ScoredCandidate, ScoringConfig } from "@ad/shared/types/scoring";
import type { PlayerState } from "@ad/shared/types/draft";
import { hardFilter } from "./filter";
import { buildScoringContext } from "./data";
import { scoreCandidates } from "./score";

export function recommend(
  pool: Candidate[],
  me: PlayerState,
  pickIndex: number | null,
  q: Queryable,
  cfg: ScoringConfig,
  extras: {
    seat?: number | null;
    similar?: ReadonlyMap<number, readonly number[]>;
    /** 英雄(负 valveId)→ 主属性和近战/远程;给了才能按我的英雄修正单技能强度。 */
    heroAttrs?: ReadonlyMap<number, HeroAttr>;
    /** 池里还在的全部候选(pool 只传了英雄或只传了技能时,向前看要看全部);不给就用 pool。 */
    fullPool?: readonly Candidate[];
  } = {},
): ScoredCandidate[] {
  const legal = hardFilter(pool, me);             // 第 0 步:先于一切打分
  if (legal.length === 0) return [];
  const ctx = buildScoringContext(q, me, pickIndex, {
    seat: extras.seat, similar: extras.similar, heroAttrs: extras.heroAttrs, pool: extras.fullPool ?? pool,
    pairFallback: cfg.pairFallback, synergyTopN: cfg.synergyTopN,
    heroFit: cfg.heroFit, synergyLift: cfg.synergyLift, comboLookahead: cfg.comboLookahead,
  });
  const ranked = scoreCandidates(legal, ctx, cfg);
  return ranked.slice(0, cfg.topK);                // Top 3~4
}
