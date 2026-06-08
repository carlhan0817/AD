// core/src/scoring/score.ts
// 动态加权合成(细则 §1)+ 排序。对维度无知:新增维度不改本文件。
import type {
  Candidate, ScoredCandidate, ScoringConfig, ScoringContext, SignalId,
} from "@ad/shared/types/scoring";
import { buildSignals } from "./signals/index";
import { resolveWeights } from "./weights";

export function scoreCandidates(
  pool: Candidate[],
  ctx: ScoringContext,
  cfg: ScoringConfig,
): ScoredCandidate[] {
  const signals = buildSignals(cfg);
  const weights = resolveWeights(cfg, ctx.pickIndex); // 本手动态权重
  const activeIds = (Object.keys(weights) as SignalId[]).filter(
    (id) => (weights[id] ?? 0) !== 0 && signals[id] !== undefined,
  );

  const scored = pool.map((candidate): ScoredCandidate => {
    const breakdown: Partial<Record<SignalId, number>> = {};
    let total = 0;
    for (const id of activeIds) {
      const w = weights[id] ?? 0;
      const contrib = w * signals[id]!(ctx, candidate);
      breakdown[id] = contrib;
      total += contrib;
    }
    return { candidate, score: total, breakdown };
  });

  scored.sort((a, b) => b.score - a.score); // 跨类型统一降序
  return scored;
}
