// core/src/scoring/recommend.ts
// 端到端(细则 §4):硬过滤 → 上下文 → 动态打分 → Top-K。
import type { Candidate, ScoredCandidate, ScoringConfig } from "@ad/shared/types/scoring";
import type { PlayerState } from "@ad/shared/types/draft";
import { hardFilter } from "./filter";
import { buildScoringContext } from "./data";
import { scoreCandidates } from "./score";

export function recommend(
  pool: Candidate[],
  me: PlayerState,
  pickIndex: number | null,
  dbPath: string,
  cfg: ScoringConfig,
): ScoredCandidate[] {
  const legal = hardFilter(pool, me);             // 第 0 步:先于一切打分
  if (legal.length === 0) return [];
  const ctx = buildScoringContext(dbPath, me, pickIndex);
  const ranked = scoreCandidates(legal, ctx, cfg);
  return ranked.slice(0, cfg.topK);                // Top 3~4
}
