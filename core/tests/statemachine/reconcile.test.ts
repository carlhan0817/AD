// core/tests/statemachine/reconcile.test.ts
import { describe, it, expect } from "vitest";
import { reconcile } from "../../src/statemachine/reconcile";
import type { FrameObservation, SlotType } from "@ad/shared/types/draft";

// 测试用 slot_type 解析:负=hero,5048=ultimate,其余=normal
function slotTypeOf(valveId: number): SlotType | null {
  if (valveId < 0) return "hero";
  if (valveId === 5048) return "ultimate";
  return "normal";
}

function obs(rows: Array<{ hero: number | null; normals: number[]; ultimates: number[] }>, active: number | null): FrameObservation {
  return {
    activePicker: { row: active },
    slots: rows.map((r, i) => ({ row: i, ...r })),
  };
}

describe("reconcile", () => {
  it("rebuilds DraftState from a full observation, classifying by slot_type", () => {
    const observation = obs(
      [
        { hero: -9, normals: [5051], ultimates: [5048] },
        { hero: null, normals: [], ultimates: [] },
      ],
      0,
    );
    const state = reconcile(observation, slotTypeOf);
    expect(state.activeRow).toBe(0);
    expect(state.players[0]).toEqual({ row: 0, hero: -9, normals: [5051], ultimates: [5048] });
    expect(state.players[1].hero).toBeNull();
  });

  it("a clean frame fully resyncs regardless of prior state (no event sourcing)", () => {
    // 同一帧两次对账得到同一状态(幂等/可重建)
    const observation = obs([{ hero: -9, normals: [1, 2], ultimates: [] }], 0);
    expect(reconcile(observation, slotTypeOf)).toEqual(reconcile(observation, slotTypeOf));
  });

  it("routes a mis-placed ability by its true slot_type, not by which list it arrived in", () => {
    // 观察把 5048(终极)错放进 normals;对账按 slot_type 归位到 ultimates
    const observation = obs([{ hero: null, normals: [5048], ultimates: [] }], null);
    const state = reconcile(observation, slotTypeOf);
    expect(state.players[0].ultimates).toEqual([5048]);
    expect(state.players[0].normals).toEqual([]);
  });
});
