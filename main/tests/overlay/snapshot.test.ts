// main/tests/overlay/snapshot.test.ts
import { describe, it, expect } from "vitest";
import { buildSnapshot } from "../../src/overlay/snapshot";
import type { DraftState } from "@ad/shared/types/draft";
import type { ScoredCandidate } from "@ad/shared/types/scoring";

const state: DraftState = {
  activeRow: 0,
  players: [
    { row: 0, hero: -9, normals: [5051], ultimates: [] },
    { row: 1, hero: null, normals: [], ultimates: [] },
  ],
};
const recs: ScoredCandidate[] = [
  { candidate: { valveId: 5052, slotType: "normal" }, score: 0.2, breakdown: { base: 0.1 } },
];

describe("buildSnapshot", () => {
  it("packs state + recs + remaining for the active player", () => {
    const snap = buildSnapshot(state, 0, recs, 7);
    expect(snap.version).toBe(7);
    expect(snap.recommendations[0].candidate.valveId).toBe(5052);
    // 行0:hero 已选 → hero 剩 0;normal 选 1 → 剩 2;ult 剩 1
    expect(snap.remaining).toEqual({ hero: 0, normal: 2, ultimate: 1 });
  });

  it("is JSON-serializable (survives IPC)", () => {
    const snap = buildSnapshot(state, 0, recs, 1);
    expect(JSON.parse(JSON.stringify(snap))).toEqual(snap);
  });
});
