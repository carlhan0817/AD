// core/tests/recognition/pool_layout.test.ts
import { describe, it, expect } from "vitest";
import { poolCellRects, type PoolLayout } from "../../src/recognition/roi";
import { POOL_LAYOUT_RATIO } from "../../src/recognition/roi";

describe("poolCellRects 比例→像素推导", () => {
  it("把单行比例按窗口矩形换算成绝对像素方格(含原点偏移)", () => {
    const layout: PoolLayout = {
      rows: [
        { startXRatio: 0.1, yRatio: 0.2, cellRatio: 0.05, gapRatio: 0.01, count: 3, zone: "standard" },
      ],
    };
    const rect = { x: 100, y: 50, width: 1000, height: 800 };
    const rects = poolCellRects(layout, rect);

    expect(rects.length).toBe(3);
    // 方格边长 = round(0.05 × 1000) = 50,宽=高
    expect(rects[0].w).toBe(50);
    expect(rects[0].h).toBe(50);
    // 第 0 格左上 = 原点偏移 + 比例像素:x = 100 + round(0.1×1000) = 200;y = 50 + round(0.2×800) = 210
    expect(rects[0].x).toBe(200);
    expect(rects[0].y).toBe(210);
    // 格间步距 = (cellRatio + gapRatio) × width = (0.05+0.01)×1000 = 60
    expect(rects[1].x).toBe(200 + 60);
    expect(rects[2].x).toBe(200 + 120);
    // 同一行 y 不变
    expect(rects[1].y).toBe(210);
  });

  it("多行铺平:先第0行所有格,再第1行所有格", () => {
    const layout: PoolLayout = {
      rows: [
        { startXRatio: 0.1, yRatio: 0.2, cellRatio: 0.05, gapRatio: 0.0, count: 2, zone: "ultimate" },
        { startXRatio: 0.1, yRatio: 0.4, cellRatio: 0.05, gapRatio: 0.0, count: 2, zone: "standard" },
      ],
    };
    const rect = { x: 0, y: 0, width: 1000, height: 1000 };
    const rects = poolCellRects(layout, rect);
    expect(rects.length).toBe(4);
    expect(rects[0].y).toBe(200); // 行0
    expect(rects[1].y).toBe(200); // 行0
    expect(rects[2].y).toBe(400); // 行1
    expect(rects[3].y).toBe(400); // 行1
  });
});

describe("POOL_LAYOUT_RATIO 标定常量结构", () => {
  it("含终极与标准两区,所有比例在 0..1,count 为正", () => {
    const zones = new Set(POOL_LAYOUT_RATIO.rows.map((r) => r.zone));
    expect(zones.has("ultimate")).toBe(true);
    expect(zones.has("standard")).toBe(true);
    for (const r of POOL_LAYOUT_RATIO.rows) {
      for (const v of [r.startXRatio, r.yRatio, r.cellRatio, r.gapRatio]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
      expect(r.count).toBeGreaterThan(0);
    }
  });

  it("在 1920×1080 下所有格子像素都落在画面内", () => {
    const rect = { x: 0, y: 0, width: 1920, height: 1080 };
    for (const c of poolCellRects(POOL_LAYOUT_RATIO, rect)) {
      expect(c.x).toBeGreaterThanOrEqual(0);
      expect(c.y).toBeGreaterThanOrEqual(0);
      expect(c.x + c.w).toBeLessThanOrEqual(1920);
      expect(c.y + c.h).toBeLessThanOrEqual(1080);
    }
  });
});
