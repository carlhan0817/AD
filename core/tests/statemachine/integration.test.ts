// core/tests/statemachine/integration.test.ts
import { describe, it, expect } from "vitest";
import { DraftMachine } from "../../src/statemachine/draft";
import type { FrameObservation, SlotType } from "@ad/shared/types/draft";

function slotTypeOf(v: number): SlotType | null {
  if (v < 0) return "hero";
  if (v >= 6000) return "ultimate";
  return "normal";
}

function obs(rows: Array<{ hero: number | null; normals: number[]; ultimates: number[] }>, active: number | null): FrameObservation {
  return { activePicker: { row: active }, slots: rows.map((r, i) => ({ row: i, ...r })) };
}

function empty(n: number) {
  return Array.from({ length: n }, () => ({ hero: null as number | null, normals: [] as number[], ultimates: [] as number[] }));
}

describe("draft integration", () => {
  it("converges over a sequence of legal picks", () => {
    const m = new DraftMachine(slotTypeOf, { confirmFrames: 1 });
    const rows = empty(3);
    // 行0 拿英雄 -9
    rows[0].hero = -9; m.observe(obs(rows, 0));
    // 行1 拿英雄 -7
    rows[1].hero = -7; m.observe(obs(rows, 1));
    // 行0 拿普通技能 5051
    rows[0].normals.push(5051); m.observe(obs(rows, 0));
    const s = m.state();
    expect(s.players[0].hero).toBe(-9);
    expect(s.players[0].normals).toEqual([5051]);
    expect(s.players[1].hero).toBe(-7);
  });

  it("recovers correct order from a single good frame after a gap", () => {
    const m = new DraftMachine(slotTypeOf, { confirmFrames: 1 });
    // 喂一个领先若干步的干净帧(模拟丢帧)
    const ahead = [
      { hero: -9, normals: [5051, 5052, 5053], ultimates: [6001] },
      { hero: -7, normals: [5100], ultimates: [] },
      { hero: -3, normals: [], ultimates: [] },
    ];
    m.observe(obs(ahead, 2));
    const s = m.state();
    expect(s.players[0].normals.length).toBe(3);
    expect(s.players[0].ultimates).toEqual([6001]);
    expect(s.activeRow).toBe(2); // 顺位正确,不反
  });

  it("does not get polluted by a detail-panel conflict frame", () => {
    const m = new DraftMachine(slotTypeOf, { confirmFrames: 1 });
    const base = empty(3);
    base[0].hero = -9;
    m.observe(obs(base, 0));
    // 模拟:用户点开行2的英雄详情,识别误把 -3 读进行2,但 picker 仍指 0 → 冲突
    const polluted = empty(3);
    polluted[0].hero = -9;
    polluted[2].hero = -3;
    expect(m.observe(obs(polluted, 0))).toBe(false);
    expect(m.state().players[2].hero).toBeNull();
  });
});
