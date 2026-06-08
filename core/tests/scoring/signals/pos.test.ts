// core/tests/scoring/signals/pos.test.ts
import { describe, it, expect } from "vitest";
import { makePosSignal } from "../../../src/scoring/signals/pos";
import type { ScoringContext } from "@ad/shared/types/scoring";

function ctx(pickIndex: number | null, app: number | null): ScoringContext {
  return {
    me: { row: 0, hero: null, normals: [], ultimates: [] },
    pickIndex,
    winrate: new Map([[5051, { winrate: 0.5, avgPickPosition: app }]]),
    pairWinrate: new Map(), aghs: new Map(),
  };
}

const pos = makePosSignal(10); // σ=10

describe("pos signal (tanh scarcity)", () => {
  it("matches tanh((P_curr - P_avg)/sigma)", () => {
    // P_curr=18, P_avg=8 → tanh(10/10)=tanh(1)≈0.7616
    expect(pos(ctx(18, 8), { valveId: 5051, slotType: "normal" })).toBeCloseTo(Math.tanh(1), 6);
  });
  it("is positive when item usually taken earlier than now (scarce)", () => {
    expect(pos(ctx(20, 5), { valveId: 5051, slotType: "normal" })).toBeGreaterThan(0);
  });
  it("is negative when item usually picked much later", () => {
    expect(pos(ctx(3, 20), { valveId: 5051, slotType: "normal" })).toBeLessThan(0);
  });
  it("is strictly bounded in [-1, 1]", () => {
    expect(Math.abs(pos(ctx(40, 1), { valveId: 5051, slotType: "normal" }))).toBeLessThanOrEqual(1);
  });
  it("returns 0 when pickIndex unknown or no position data", () => {
    expect(pos(ctx(null, 5), { valveId: 5051, slotType: "normal" })).toBe(0);
    expect(pos(ctx(8, null), { valveId: 5051, slotType: "normal" })).toBe(0);
  });
});
