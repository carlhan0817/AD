// core/tests/scoring/weights.test.ts
import { describe, it, expect } from "vitest";
import { fFront, fBack, resolveWeights } from "../../src/scoring/weights";
import type { ScoringConfig } from "@ad/shared/types/scoring";

const CFG: ScoringConfig = {
  baseWeights: { base: 1.0, synergy: 1.5, aghs: 0.8, shard: 0.5, pos: 0.6 },
  alpha: 0.5, beta: 0.4, sigma: 10, firstRoundSize: 10, topK: 4,
};

describe("f_front / f_back", () => {
  it("f_front: 1 at P=1, 0 at P=10 (decay)", () => {
    expect(fFront(1, 10)).toBeCloseTo(1, 6);
    expect(fFront(10, 10)).toBeCloseTo(0, 6);
  });
  it("f_back: 0 at P=1, 1 at P=10 (growth)", () => {
    expect(fBack(1, 10)).toBeCloseTo(0, 6);
    expect(fBack(10, 10)).toBeCloseTo(1, 6);
  });
  it("f_front clamps at 0 past the first round; f_back is uncapped (细则原文只 max(0,·) 防负,不封顶)", () => {
    expect(fFront(15, 10)).toBe(0);
    // 细则 §3 / Task 7 实现说明:f_back = max(0,(P-1)/9),P>firstRoundSize 时 >1,设计容忍不封顶。
    expect(fBack(15, 10)).toBeCloseTo((15 - 1) / 9, 6); // ≈1.556
  });
});

describe("resolveWeights (dynamic per pick position)", () => {
  it("front pick (P=1): base maximized, synergy zeroed, aghs normal", () => {
    const w = resolveWeights(CFG, 1);
    expect(w.base).toBeCloseTo(1.0 * (1 + 0.5 * 1), 6); // w_base⁰·(1+α)
    expect(w.synergy).toBeCloseTo(0, 6);                // w_synergy⁰·f_back(=0)
    expect(w.aghs).toBeCloseTo(0.8 * (1 + 0.4 * 0), 6); // 正常化
    expect(w.shard).toBeCloseTo(0.5, 6);                // 恒定
    expect(w.pos).toBeCloseTo(0.6, 6);                  // 恒定
  });

  it("back pick (P=10): synergy maximized, aghs boosted, base normal", () => {
    const w = resolveWeights(CFG, 10);
    expect(w.base).toBeCloseTo(1.0, 6);                 // w_base⁰·(1+α·0)
    expect(w.synergy).toBeCloseTo(1.5, 6);              // w_synergy⁰·f_back(=1)
    expect(w.aghs).toBeCloseTo(0.8 * (1 + 0.4 * 1), 6); // 提权
  });

  it("unknown pickIndex degrades to no front/back tendency", () => {
    const w = resolveWeights(CFG, null);
    expect(w.base).toBeCloseTo(1.0, 6);   // f_front=0
    expect(w.synergy).toBeCloseTo(0, 6);  // f_back=0
    expect(w.aghs).toBeCloseTo(0.8, 6);
  });

  it("omits a signal whose base weight is 0/absent", () => {
    const w = resolveWeights({ ...CFG, baseWeights: { base: 1 } }, 5);
    expect(w.base).toBeGreaterThan(0);
    expect(w.synergy).toBeUndefined();
  });
});
