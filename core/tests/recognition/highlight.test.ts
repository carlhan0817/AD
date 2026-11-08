// core/tests/recognition/highlight.test.ts
import { describe, it, expect } from "vitest";
import { highlightOuter, highlightsFor, HIGHLIGHT_OUTSET, HIGHLIGHT_THICKNESS } from "../../src/recognition/highlight";
import { POOL_SLOTS_1080P, poolSlots } from "../../src/recognition/pool_slots";
import { heroCellRects } from "../../src/recognition/hero_layout";
import { cardSlots, playerCards } from "../../src/recognition/player_cards";
import { POOL_CELLS_1080P } from "../../src/recognition/pool_layout_1080p";
import type { Rect } from "../../src/recognition/roi";

const RECT = { x: 0, y: 0, width: 1920, height: 1080 };
const hit = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** 框的四条边(细长矩形)。 */
function ring(c: Rect): Rect[] {
  const o = highlightOuter(c, RECT), t = HIGHLIGHT_THICKNESS;
  return [
    { x: o.x, y: o.y, w: o.w, h: t }, { x: o.x, y: o.y + o.h - t, w: o.w, h: t },
    { x: o.x, y: o.y, w: t, h: o.h }, { x: o.x + o.w - t, y: o.y, w: t, h: o.h },
  ];
}

describe("高亮框不能碰到任何识别区域", () => {
  const boxes: Rect[] = [...poolSlots(RECT), ...heroCellRects(RECT)];
  const zones: [string, Rect[]][] = [
    ["技能池(分类器)", poolSlots(RECT)],
    ["技能池(第二意见)", POOL_CELLS_1080P],
    ["英雄模型格", heroCellRects(RECT)],
    ["卡上已选技能格", cardSlots(RECT)],
    ["玩家卡", playerCards(RECT)],
  ];
  for (const [name, list] of zones) {
    it(name, () => {
      const bad: string[] = [];
      for (const b of boxes) for (const e of ring(b)) for (const z of list) {
        if (hit(e, z)) bad.push(`框(${b.x},${b.y}) 碰到 (${z.x},${z.y})`);
      }
      expect([...new Set(bad)]).toEqual([]);
    });
  }
});

describe("highlightOuter 按高度缩放", () => {
  const cell = { x: 100, y: 100, w: 50, h: 50 };
  it("1920x1080 外扩 8", () => {
    expect(highlightOuter(cell, RECT).x).toBe(92);
  });
  it("3440x1440(21:9)外扩 round(8*1440/1080)=11,不按宽度", () => {
    const o = highlightOuter(cell, { x: 0, y: 0, width: 3440, height: 1440 });
    expect(o.x).toBe(100 - 11);
    expect(o.w).toBe(50 + 22);
  });
  it("不支持的比例按高度/1080", () => {
    const o = highlightOuter(cell, { x: 0, y: 0, width: 1600, height: 1024 });
    expect(o.x).toBe(100 - Math.round(8 * 1024 / 1080));
  });
});

describe("highlightsFor", () => {
  it("技能找技能格,英雄找模型格,第一条 rank=0,坐标是比例", () => {
    const hs = highlightsFor([7, -3], RECT, (id) => (id === 7 ? 12 : null), (id) => (id === -3 ? 4 : null));
    expect(hs.map((h) => h.rank)).toEqual([0, 1]);
    const out = HIGHLIGHT_OUTSET + HIGHLIGHT_THICKNESS;
    expect(hs[0].left).toBeCloseTo((POOL_SLOTS_1080P[12].x - out) / 1920, 6);
    expect(hs[0].width).toBeCloseTo((POOL_SLOTS_1080P[12].w + 2 * out) / 1920, 6);
  });
  it("找不到格子的推荐跳过,但名次不变", () => {
    const hs = highlightsFor([7, 8], RECT, (id) => (id === 8 ? 0 : null), () => null);
    expect(hs.map((h) => h.rank)).toEqual([1]);
  });
  it("游戏窗口不在屏幕原点时,比例仍相对窗口", () => {
    const r = { x: 100, y: 50, width: 1920, height: 1080 };
    const [a] = highlightsFor([7], r, () => 0, () => null);
    const [b] = highlightsFor([7], RECT, () => 0, () => null);
    expect(a.left).toBeCloseTo(b.left, 6);
  });
});
