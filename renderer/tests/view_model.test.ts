// renderer/tests/view_model.test.ts
import { describe, it, expect } from "vitest";
import { toViewModel } from "../src/view_model";
import type { OverlaySnapshot } from "@ad/shared/types/ipc";

const snap: OverlaySnapshot = {
  version: 1,
  state: { activeRow: 0, players: [{ row: 0, hero: -9, normals: [], ultimates: [] }] },
  remaining: { hero: 0, normal: 3, ultimate: 1 },
  recommendations: [
    { candidate: { valveId: 5052, slotType: "normal" }, score: 0.30, breakdown: { base: 0.1, synergy: 0.2 } },
    { candidate: { valveId: 6001, slotType: "ultimate" }, score: 0.12, breakdown: { base: 0.12 } },
  ],
};

describe("toViewModel", () => {
  it("marks the top recommendation as highlighted", () => {
    const vm = toViewModel(snap);
    expect(vm.rows[0].highlighted).toBe(true);
    expect(vm.rows[1].highlighted).toBe(false);
  });
  it("formats score and surfaces top contributing signal", () => {
    const vm = toViewModel(snap);
    expect(vm.rows[0].topSignal).toBe("synergy"); // 最大 breakdown 项
    expect(vm.rows[0].scoreText).toBe("0.30");
  });
  it("passes remaining quota through for the quota bar", () => {
    expect(toViewModel(snap).remaining).toEqual({ hero: 0, normal: 3, ultimate: 1 });
  });
});
