// core/tests/scoring/signals/aghs.test.ts
import { describe, it, expect } from "vitest";
import { aghs, shard } from "../../../src/scoring/signals/aghs";
import type { ScoringContext } from "@ad/shared/types/scoring";

function ctx(map: Map<number, { scepterGain: number | null; shardGain: number | null }>): ScoringContext {
  return {
    me: { row: 0, hero: null, normals: [], ultimates: [] },
    pickIndex: 5, winrate: new Map(), pairWinrate: new Map(), aghs: map,
  };
}

describe("aghs/shard signals (gain over base)", () => {
  it("aghs returns scepter gain", () => {
    const c = ctx(new Map([[5051, { scepterGain: 0.078, shardGain: 0.047 }]]));
    expect(aghs(c, { valveId: 5051, slotType: "normal" })).toBeCloseTo(0.078, 6);
  });
  it("shard returns shard gain", () => {
    const c = ctx(new Map([[5051, { scepterGain: 0.078, shardGain: 0.047 }]]));
    expect(shard(c, { valveId: 5051, slotType: "normal" })).toBeCloseTo(0.047, 6);
  });
  it("both return 0 when no data", () => {
    const c = ctx(new Map());
    expect(aghs(c, { valveId: 999, slotType: "normal" })).toBe(0);
    expect(shard(c, { valveId: 999, slotType: "normal" })).toBe(0);
  });
  it("null gain treated as 0", () => {
    const c = ctx(new Map([[5051, { scepterGain: null, shardGain: null }]]));
    expect(aghs(c, { valveId: 5051, slotType: "normal" })).toBe(0);
  });
});
