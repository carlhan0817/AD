// core/tests/scoring/score.test.ts
import { describe, it, expect } from "vitest";
import { scoreCandidates } from "../../src/scoring/score";
import { defaultScoringConfig } from "../../src/scoring/config";
import type { Candidate, ScoringContext, ScoringConfig } from "@ad/shared/types/scoring";

function ctx(pickIndex: number | null): ScoringContext {
  return {
    me: { row: 0, hero: -9, normals: [5051], ultimates: [] },
    pickIndex,
    winrate: new Map([
      [5052, { winrate: 0.58, avgPickPosition: 4 }],
      [5053, { winrate: 0.50, avgPickPosition: 25 }],
      [-7, { winrate: 0.55, avgPickPosition: null }],
    ]),
    pairWinrate: new Map([["-9|5052", 0.57], ["5051|5052", 0.56]]),
    aghs: new Map([[5052, { scepterGain: 0.06, shardGain: 0.02 }]]),
  };
}
const POOL: Candidate[] = [
  { valveId: 5052, slotType: "normal" },
  { valveId: 5053, slotType: "normal" },
  { valveId: -7, slotType: "hero" },
];

describe("scoreCandidates (dynamic weighting)", () => {
  it("ranks the synergistic + high-winrate candidate first (mid pick)", () => {
    const ranked = scoreCandidates(POOL, ctx(5), defaultScoringConfig());
    expect(ranked[0].candidate.valveId).toBe(5052);
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score);
  });

  it("compares heroes and abilities on one unified score (cross-type)", () => {
    // 只开 base:5052(.58) > -7(.55) > 5053(.50)
    const onlyBase: ScoringConfig = { ...defaultScoringConfig(), baseWeights: { base: 1 } };
    const ranked = scoreCandidates(POOL, ctx(5), onlyBase);
    expect(ranked.map((r) => r.candidate.valveId)).toEqual([5052, -7, 5053]);
  });

  it("front pick zeroes synergy contribution (dynamic weight)", () => {
    // P=1 → w_synergy=0 → 5052 的 breakdown 不含 synergy 贡献(或为 0)
    const ranked = scoreCandidates(POOL, ctx(1), defaultScoringConfig());
    const top = ranked.find((r) => r.candidate.valveId === 5052)!;
    expect(top.breakdown.synergy ?? 0).toBe(0);
  });

  it("back pick gives synergy a positive contribution", () => {
    const ranked = scoreCandidates(POOL, ctx(10), defaultScoringConfig());
    const top = ranked.find((r) => r.candidate.valveId === 5052)!;
    expect(top.breakdown.synergy ?? 0).toBeGreaterThan(0);
  });

  it("reweighting changes ranking (mechanism is modifiable)", () => {
    const synergyHeavy: ScoringConfig = {
      ...defaultScoringConfig(), baseWeights: { base: 0.1, synergy: 10 },
    };
    const ranked = scoreCandidates(POOL, ctx(10), synergyHeavy);
    expect(ranked[0].candidate.valveId).toBe(5052);
  });
});
