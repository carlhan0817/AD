// renderer/tests/store.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { useOverlayStore } from "../src/store";
import type { OverlaySnapshot } from "@ad/shared/types/ipc";

function snap(version: number): OverlaySnapshot {
  return {
    version,
    state: { activeRow: 0, players: [{ row: 0, hero: -9, normals: [], ultimates: [] }] },
    recommendations: [{ candidate: { valveId: 5052, slotType: "normal" }, score: 0.3, breakdown: {} }],
    remaining: { hero: 0, normal: 3, ultimate: 1 },
  };
}

describe("overlay store", () => {
  beforeEach(() => useOverlayStore.getState().reset());

  it("applies a newer snapshot", () => {
    useOverlayStore.getState().applySnapshot(snap(1));
    expect(useOverlayStore.getState().snapshot?.version).toBe(1);
  });

  it("ignores an older/duplicate snapshot (stale frame)", () => {
    useOverlayStore.getState().applySnapshot(snap(5));
    useOverlayStore.getState().applySnapshot(snap(3)); // 旧帧
    expect(useOverlayStore.getState().snapshot?.version).toBe(5);
  });

  it("reset clears state for a new game", () => {
    useOverlayStore.getState().applySnapshot(snap(2));
    useOverlayStore.getState().reset();
    expect(useOverlayStore.getState().snapshot).toBeNull();
  });
});
