// core/tests/scoring/signals/base.test.ts
import { describe, it, expect } from "vitest";
import { base } from "../../../src/scoring/signals/base";
import type { ScoringContext } from "@ad/shared/types/scoring";

function ctx(winrate: Map<number, { winrate: number | null; avgPickPosition: number | null }>): ScoringContext {
  return {
    me: { row: 0, hero: null, normals: [], ultimates: [] },
    pickIndex: 1, winrate, pairWinrate: new Map(), aghs: new Map(),
  };
}

describe("base signal (S_base = WR - 0.5)", () => {
  it("returns winrate minus 0.5 baseline", () => {
    const c = ctx(new Map([[5051, { winrate: 0.55, avgPickPosition: null }]]));
    expect(base(c, { valveId: 5051, slotType: "normal" })).toBeCloseTo(0.05, 6);
  });
  it("returns 0 when no data", () => {
    expect(base(ctx(new Map()), { valveId: 9999, slotType: "normal" })).toBe(0);
  });
  it("works for hero pseudo-abilities (negative valveId)", () => {
    const c = ctx(new Map([[-9, { winrate: 0.52, avgPickPosition: null }]]));
    expect(base(c, { valveId: -9, slotType: "hero" })).toBeCloseTo(0.02, 6);
  });
});
