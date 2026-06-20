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

  it("anchors.length>=2 不变量:正常 rect 与退化 rect(width:0,height:0)均成立,全黑画面绝不空数组真值通过", () => {
    // 防御性护栏:anchorCells 若 < 2(未来误删某个 zone、或 rect 退化导致取不到代表格),
    // diffRois 必须回退到旧 [pool, timer] 锚点,而不是返回 0/1 个锚点——
    // isValidLayout 对空数组 .every(...) 会「真值通过」,在全黑/被遮挡画面上误判②门槛通过。
    //
    // 注:当前标定的 POOL_LAYOUT_RATIO 下,即使 rect 退化为 width:0/height:0,
    // poolCellRects 仍会按 zone 行数铺平产出对应数量的(零尺寸)Rect,findIndex 仍能命中
    // ultimate/standard 两行,故此场景下 anchorCells 本身仍是 2 个——尚未触发 <2 分支。
    // 该护栏是面向未来误删 zone(findIndex 返回 -1 → filter 丢弃)的兜底,这里改为
    // 钉住「无论何种 rect,anchors.length 永不少于 2」这一可观察不变量,作为护栏生效的证据。
    const blank = { width: 1920, height: 1080, data: new Uint8Array(1920 * 1080) }; // 全 0,无结构
    const normalRect = { x: 0, y: 0, width: 1920, height: 1080 };
    const degenerateRect = { x: 0, y: 0, width: 0, height: 0 };

    const normalRois = diffRois(blank, LAYOUT_1080P, normalRect);
    const degenerateRois = diffRois(blank, LAYOUT_1080P, degenerateRect);

    // 关键断言:两种 rect 下 anchors 永远不少于 2 个(护栏保证的不变量)。
    expect(normalRois.anchors.length).toBeGreaterThanOrEqual(2);
    expect(degenerateRois.anchors.length).toBeGreaterThanOrEqual(2);
    // 全黑画面绝不应「空数组真值通过」isValidLayout——必须判不通过。
    expect(isValidLayout(normalRois.anchors)).toBe(false);
    expect(isValidLayout(degenerateRois.anchors)).toBe(false);
  });
});
