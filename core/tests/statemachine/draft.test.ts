// core/tests/statemachine/draft.test.ts
import { describe, it, expect } from "vitest";
import { DraftMachine } from "../../src/statemachine/draft";
import type { FrameObservation, SlotType } from "@ad/shared/types/draft";

function slotTypeOf(valveId: number): SlotType | null {
  if (valveId < 0) return "hero";
  if (valveId === 5048) return "ultimate";
  return "normal";
}

function obs(rows: Array<{ hero: number | null; normals: number[]; ultimates: number[] }>, active: number | null): FrameObservation {
  return { activePicker: { row: active }, slots: rows.map((r, i) => ({ row: i, ...r })) };
}

const TWO_EMPTY = obs([{ hero: null, normals: [], ultimates: [] }, { hero: null, normals: [], ultimates: [] }], 0);

describe("DraftMachine", () => {
  it("commits only after N consistent frames (temporal consistency)", () => {
    const m = new DraftMachine(slotTypeOf, { confirmFrames: 2 });
    const pick = obs([{ hero: -9, normals: [], ultimates: [] }, { hero: null, normals: [], ultimates: [] }], 0);
    expect(m.observe(pick)).toBe(false); // 第 1 帧:未达确认数
    expect(m.observe(pick)).toBe(true);  // 第 2 帧:确认,提交
    expect(m.state().players[0].hero).toBe(-9);
  });

  it("rejects a conflicting frame (new ability in row B but picker says row A)", () => {
    const m = new DraftMachine(slotTypeOf, { confirmFrames: 1 });
    m.observe(TWO_EMPTY); // 基线
    // picker 指向行 0,但新技能出现在行 1 → 冲突,不提交
    const conflict = obs([{ hero: null, normals: [], ultimates: [] }, { hero: -7, normals: [], ultimates: [] }], 0);
    expect(m.observe(conflict)).toBe(false);
    expect(m.state().players[1].hero).toBeNull(); // 未污染
  });

  it("self-heals from a single clean frame after dropped frames", () => {
    const m = new DraftMachine(slotTypeOf, { confirmFrames: 1 });
    // 直接喂一个「已经进行到一半」的干净帧(模拟丢了中间所有帧)
    const midgame = obs(
      [
        { hero: -9, normals: [5051, 5052], ultimates: [5048] },
        { hero: -7, normals: [5100], ultimates: [] },
      ],
      1,
    );
    expect(m.observe(midgame)).toBe(true);
    expect(m.observe(midgame)).toBe(true); // 幂等再确认
    expect(m.state().players[0].normals).toEqual([5051, 5052]);
    expect(m.state().players[0].ultimates).toEqual([5048]);
    expect(m.state().activeRow).toBe(1);
  });

  it("holds last valid state when given no observation update", () => {
    const m = new DraftMachine(slotTypeOf, { confirmFrames: 1 });
    const pick = obs([{ hero: -9, normals: [], ultimates: [] }, { hero: null, normals: [], ultimates: [] }], 0);
    m.observe(pick);
    const before = m.state();
    // 不喂新帧,直接读 —— 保持
    expect(m.state()).toEqual(before);
  });
});
