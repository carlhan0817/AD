// core/tests/scoring/types.test.ts
import { describe, it, expect } from "vitest";
import type { ScoringConfig, Candidate } from "@ad/shared/types/scoring";

describe("scoring types", () => {
  it("ScoringConfig carries base weights + dynamic coefficients", () => {
    const cfg: ScoringConfig = {
      baseWeights: { base: 1, synergy: 1.5 },
      alpha: 0.5, beta: 0.4, sigma: 10, firstRoundSize: 10, topK: 4,
    };
    expect(cfg.baseWeights.base).toBe(1);
    expect(cfg.alpha).toBe(0.5);
  });
  it("Candidate carries valveId + slotType", () => {
    const c: Candidate = { valveId: -9, slotType: "hero" };
    expect(c.slotType).toBe("hero");
  });
});
