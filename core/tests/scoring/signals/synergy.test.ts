// core/tests/scoring/signals/synergy.test.ts
import { describe, it, expect } from "vitest";
import { synergy, pairKey } from "../../../src/scoring/signals/synergy";
import type { ScoringContext } from "@ad/shared/types/scoring";

function ctx(me: { hero: number | null; normals: number[]; ultimates: number[] }, pairs: Map<string, number>): ScoringContext {
  return { me: { row: 0, ...me }, pickIndex: 3, winrate: new Map(), pairWinrate: pairs, aghs: new Map() };
}

describe("pairKey", () => {
  it("is order-independent (sorted)", () => {
    expect(pairKey(5051, -9)).toBe(pairKey(-9, 5051));
    expect(pairKey(5051, -9)).toBe("-9|5051");
  });
});

describe("synergy signal (averaged offset)", () => {
  it("averages pair-winrate offsets over |M| (all my picks incl hero)", () => {
    const pairs = new Map<string, number>([
      [pairKey(-9, 5052), 0.56], // 候选 5052 × 我的英雄 -9
      [pairKey(5051, 5052), 0.54], // 候选 5052 × 我的已选普通 5051
    ]);
    // M = {-9, 5051},|M|=2;Σ(0.06 + 0.04)=0.10;平均 = 0.05
    const c = ctx({ hero: -9, normals: [5051], ultimates: [] }, pairs);
    expect(synergy(c, { valveId: 5052, slotType: "normal" })).toBeCloseTo(0.05, 6);
  });

  it("divides by |M| even when some pairs have no data (missing => 0 offset)", () => {
    // M = {-9, 5051},|M|=2;只有一个 pair 有数据(0.56→+0.06),另一项缺数据计 0
    const pairs = new Map<string, number>([[pairKey(-9, 5052), 0.56]]);
    const c = ctx({ hero: -9, normals: [5051], ultimates: [] }, pairs);
    expect(synergy(c, { valveId: 5052, slotType: "normal" })).toBeCloseTo(0.03, 6); // 0.06/2
  });

  it("returns 0 when I have no picks yet (|M|=0)", () => {
    const c = ctx({ hero: null, normals: [], ultimates: [] }, new Map());
    expect(synergy(c, { valveId: 5052, slotType: "normal" })).toBe(0);
  });
});
