// core/tests/recognition/pool_layout.test.ts
import { describe, it, expect } from "vitest";
import { poolCellRects, poolCellZones, POOL_OFFSET_1080P, type PoolLayout } from "../../src/recognition/roi";
import { POOL_LAYOUT_RATIO } from "../../src/recognition/roi";
import { POOL_CELLS_1080P } from "../../src/recognition/pool_layout_1080p";

// poolCellRects 已改用逐格绝对坐标(POOL_CELLS_1080P),不再用比例模型。layout 形参保留兼容签名但被忽略。
const ignoredLayout: PoolLayout = { rows: [] };

describe("poolCellRects 逐格绝对坐标", () => {
  it("返回 48 格(终极 12 + 标准 36),与 POOL_CELLS_1080P 一致", () => {
    const cells = poolCellRects(ignoredLayout, { x: 0, y: 0, width: 1920, height: 1080 });
    expect(cells.length).toBe(48);
    expect(poolCellZones().filter((z) => z === "ultimate").length).toBe(12);
    expect(poolCellZones().filter((z) => z === "standard").length).toBe(36);
  });

  it("1920×1080 下:坐标 == POOL_CELLS_1080P + 全局平移 POOL_OFFSET_1080P", () => {
    const cells = poolCellRects(ignoredLayout, { x: 0, y: 0, width: 1920, height: 1080 });
    // 引用 POOL_CELLS_1080P 而非硬编码数值,使断言随标定更新自动跟随(验证的是平移/缩放逻辑,非具体坐标)。
    const u0 = POOL_CELLS_1080P[0]; // 终极区首格
    expect(cells[0]).toEqual({ x: u0.x + POOL_OFFSET_1080P.dx, y: u0.y + POOL_OFFSET_1080P.dy, w: u0.w, h: u0.h });
    const s0 = POOL_CELLS_1080P[12]; // 标准区首格
    expect(cells[12]).toEqual({ x: s0.x + POOL_OFFSET_1080P.dx, y: s0.y + POOL_OFFSET_1080P.dy, w: s0.w, h: s0.h });
  });

  it("含客户区原点偏移:rect.x/rect.y 加到每格(在全局平移之上)", () => {
    const cells = poolCellRects(ignoredLayout, { x: 100, y: 50, width: 1920, height: 1080 });
    const u0 = POOL_CELLS_1080P[0];
    expect(cells[0]).toEqual({ x: 100 + u0.x + POOL_OFFSET_1080P.dx, y: 50 + u0.y + POOL_OFFSET_1080P.dy, w: u0.w, h: u0.h });
  });

  it("非 1080p 按 rect 等比缩放(宽高各自缩放,平移也缩放)", () => {
    // 缩到一半:坐标、尺寸、全局平移都 ×0.5(四舍五入)。
    const cells = poolCellRects(ignoredLayout, { x: 0, y: 0, width: 960, height: 540 });
    const u0 = POOL_CELLS_1080P[0];
    expect(cells[0]).toEqual({
      x: Math.round(u0.x * 0.5 + POOL_OFFSET_1080P.dx * 0.5),
      y: Math.round(u0.y * 0.5 + POOL_OFFSET_1080P.dy * 0.5),
      w: Math.round(u0.w * 0.5), h: Math.round(u0.h * 0.5),
    });
  });

  it("poolCellZones 与 poolCellRects 顺序一一对应(前 12 终极,后 36 标准)", () => {
    const zones = poolCellZones();
    expect(zones.length).toBe(48);
    expect(zones.slice(0, 12).every((z) => z === "ultimate")).toBe(true);
    expect(zones.slice(12).every((z) => z === "standard")).toBe(true);
  });
});

describe("POOL_CELLS_1080P 标定常量", () => {
  it("48 格,含两区,所有格在 1920×1080 画面内", () => {
    expect(POOL_CELLS_1080P.length).toBe(48);
    const zones = new Set(POOL_CELLS_1080P.map((c) => c.zone));
    expect(zones.has("ultimate")).toBe(true);
    expect(zones.has("standard")).toBe(true);
    for (const c of POOL_CELLS_1080P) {
      expect(c.x).toBeGreaterThanOrEqual(0);
      expect(c.y).toBeGreaterThanOrEqual(0);
      expect(c.x + c.w).toBeLessThanOrEqual(1920);
      expect(c.y + c.h).toBeLessThanOrEqual(1080);
      expect(c.w).toBeGreaterThan(0);
      expect(c.h).toBeGreaterThan(0);
    }
  });
});

// POOL_LAYOUT_RATIO 已不再是池布局来源(保留导出仅为类型/向后兼容),但其结构仍合法。
describe("POOL_LAYOUT_RATIO(遗留,已不驱动池布局)", () => {
  it("结构合法:两区、比例在 0..1、count 为正", () => {
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
});
