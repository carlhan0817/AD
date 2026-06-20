// core/tests/recognition/roi.test.ts
import { describe, it, expect } from "vitest";
import { LAYOUT_1080P, poolCells, slotRowCells, diffRois } from "../../src/recognition/roi";
import type { GrayFrame } from "../../src/recognition/grid";
import { poolCellRects, POOL_LAYOUT_RATIO } from "../../src/recognition/roi";
import { isValidLayout } from "../../src/recognition/layout_guard";

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

  it("diffRois returns { diff: [pool, slots], anchors: [pool, timer] }", () => {
    const rois = diffRois(frame(1920, 1080), LAYOUT_1080P);
    expect(rois.diff.length).toBe(2);      // pool + slots(不含 timer)
    expect(rois.anchors.length).toBe(2);   // pool + timer(锚点校验用)
    expect(Array.isArray(rois.diff[0])).toBe(true);
    expect(Array.isArray(rois.anchors[0])).toBe(true);
  });

  it("diff 部分不受 timer 跳动影响:timer 变化时 pool/slots 的 hash 应保持不变", () => {
    // 构造两帧:pool/slots 区域像素完全相同,只有 timer 区域(倒计时数字)变化。
    // 这是核心证据:FrameGate 吃 rois.diff 时,timer 跳动不应打断「连续静止」判定。
    const f1 = frame(1920, 1080);
    const f2 = frame(1920, 1080);
    const t = LAYOUT_1080P.timer;
    // 仅改 f2 的 timer 区域像素(模拟倒计时数字跳动)。
    for (let y = t.y; y < t.y + t.h; y++) {
      for (let x = t.x; x < t.x + t.w; x++) {
        f2.data[y * f2.width + x] = 255;
      }
    }

    const r1 = diffRois(f1, LAYOUT_1080P);
    const r2 = diffRois(f2, LAYOUT_1080P);

    // diff 部分(pool+slots)两帧应逐块相同(timer 不在其中,不受影响)。
    expect(r1.diff).toEqual(r2.diff);
    // anchors 部分(pool+timer)应能体现出 timer 已变化(第二块不同)。
    expect(r1.anchors[1]).not.toEqual(r2.anchors[1]);
  });
});

describe("diffRois anchors 改用池区代表格", () => {
  // 造一帧:把每个池区格子像素位填成高方差棋盘 → 锚点应判"有内容"。
  function poolFilledFrame(): GrayFrame {
    const f = { width: 1920, height: 1080, data: new Uint8Array(1920 * 1080) };
    const rect = { x: 0, y: 0, width: 1920, height: 1080 };
    for (const c of poolCellRects(POOL_LAYOUT_RATIO, rect)) {
      for (let y = c.y; y < c.y + c.h; y++)
        for (let x = c.x; x < c.x + c.w; x++)
          f.data[y * f.width + x] = ((x + y) % 2) * 255; // 棋盘 → 高方差
    }
    return f;
  }

  it("传 rect 时 anchors 取自池区代表格,池有内容 → isValidLayout 通过", () => {
    const rect = { x: 0, y: 0, width: 1920, height: 1080 };
    const rois = diffRois(poolFilledFrame(), LAYOUT_1080P, rect);
    expect(rois.anchors.length).toBeGreaterThanOrEqual(2);
    expect(isValidLayout(rois.anchors)).toBe(true);
  });

  it("传 rect 但池区全空(纯色)→ 锚点方差不足 → isValidLayout 不通过", () => {
    const rect = { x: 0, y: 0, width: 1920, height: 1080 };
    const blank = { width: 1920, height: 1080, data: new Uint8Array(1920 * 1080) }; // 全 0
    const rois = diffRois(blank, LAYOUT_1080P, rect);
    expect(isValidLayout(rois.anchors)).toBe(false);
  });

  it("不传 rect 时回退旧行为:anchors = [pool, timer](向后兼容)", () => {
    const f = { width: 1920, height: 1080, data: new Uint8Array(1920 * 1080) };
    const rois = diffRois(f, LAYOUT_1080P);
    expect(rois.anchors.length).toBe(2);
  });
});
