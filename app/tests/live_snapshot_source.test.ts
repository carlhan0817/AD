// app/tests/live_snapshot_source.test.ts
import { describe, it, expect } from "vitest";
import { machineToSnapshot } from "../src/main/live_snapshot_source";

describe("machineToSnapshot", () => {
  it("builds an OverlaySnapshot from machine state + recommendations", () => {
    const state = { activeRow: 0, players: [{ row: 0, hero: null, normals: [], ultimates: [] }] };
    const recs = [{ candidate: { valveId: 5051, slotType: "normal" as const }, score: 0.4, breakdown: { base: 0.4 } }];
    const snap = machineToSnapshot(state, 0, recs, 7);
    expect(snap.version).toBe(7);
    expect(snap.recommendations).toEqual(recs);
    expect(snap.state).toBe(state);
    expect(snap.remaining).toBeDefined();
  });
});
