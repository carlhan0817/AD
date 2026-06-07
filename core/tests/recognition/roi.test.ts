// core/tests/recognition/roi.test.ts
import { describe, it, expect } from "vitest";
import { LAYOUT_1080P, poolCells, slotRowCells, diffRois } from "../../src/recognition/roi";
import type { GrayFrame } from "../../src/recognition/grid";

function frame(w: number, h: number): GrayFrame {
  return { width: w, height: h, data: new Uint8Array(w * h) };
}

describe("roi layout", () => {
  it("pool grid yields rows*cols 32x32 cells", () => {
    const cells = poolCells(frame(1920, 1080), LAYOUT_1080P);
    const spec = LAYOUT_1080P.pool;
    expect(cells.length).toBe(spec.rows * spec.cols);
    expect(cells[0].length).toBe(32);
  });

  it("hero slot is rectangular, ability slots are square (decoupled)", () => {
    // 英雄槽长方形(宽≠高);技能槽正方形(宽=高)
    expect(LAYOUT_1080P.heroSlot.w).not.toBe(LAYOUT_1080P.heroSlot.h);
    expect(LAYOUT_1080P.abilitySlots.cellW).toBe(LAYOUT_1080P.abilitySlots.cellH);
    expect(LAYOUT_1080P.abilitySlots.cols).toBe(4); // 4 个技能槽
  });

  it("slotRowCells returns 10 rows, each with a hero cell + 4 ability cells, all 32x32", () => {
    const rows = slotRowCells(frame(1920, 1080), LAYOUT_1080P);
    expect(rows.length).toBe(10);
    expect(rows[0].hero.length).toBe(32);        // 英雄长方形 → resize 32x32
    expect(rows[0].hero[0].length).toBe(32);
    expect(rows[0].abilities.length).toBe(4);    // 4 个技能格
    expect(rows[0].abilities[0].length).toBe(32);
  });

  it("diffRois returns the gate-watched sub-blocks (pool + slots + timer)", () => {
    const rois = diffRois(frame(1920, 1080), LAYOUT_1080P);
    expect(rois.length).toBeGreaterThanOrEqual(3);
    expect(Array.isArray(rois[0])).toBe(true);
  });
});
