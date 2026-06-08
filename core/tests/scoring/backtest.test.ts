// core/tests/scoring/backtest.test.ts
import { describe, it, expect } from "vitest";
import { hitRateAtK, type BacktestCase } from "../../src/scoring/backtest";
import type { ScoredCandidate } from "@ad/shared/types/scoring";

function ranked(ids: number[]): ScoredCandidate[] {
  return ids.map((valveId, i) => ({
    candidate: { valveId, slotType: "normal" as const },
    score: ids.length - i, breakdown: {},
  }));
}

describe("hitRateAtK", () => {
  it("counts a case as hit when actual pick is within top-K", () => {
    const cases: BacktestCase[] = [
      { actualPick: 5052, ranked: ranked([5052, 6001]) },
      { actualPick: 6001, ranked: ranked([5052, 6001]) },
    ];
    expect(hitRateAtK(cases, 1)).toBeCloseTo(0.5, 6);
    expect(hitRateAtK(cases, 2)).toBeCloseTo(1.0, 6);
  });
});
