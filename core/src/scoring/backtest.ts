// core/src/scoring/backtest.ts
// 回测:给定「局面 + 实际选取」,某 config 下排序的 top-K 命中率。
import type { ScoredCandidate } from "@ad/shared/types/scoring";

export interface BacktestCase {
  actualPick: number;
  ranked: ScoredCandidate[];
}

export function hitRateAtK(cases: BacktestCase[], k: number): number {
  if (cases.length === 0) return 0;
  let hits = 0;
  for (const c of cases) {
    if (c.ranked.slice(0, k).some((r) => r.candidate.valveId === c.actualPick)) hits += 1;
  }
  return hits / cases.length;
}
