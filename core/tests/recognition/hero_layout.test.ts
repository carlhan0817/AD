// core/tests/recognition/hero_layout.test.ts
import { describe, it, expect } from "vitest";
import { heroCellRects, HERO_OFFSET_1080P } from "../../src/recognition/hero_layout";

describe("heroCellRects", () => {
  it("1920×1080 下返回 12 个 HeroCell,按 order 0..11 升序,含正确 side", () => {
    const rect = { x: 0, y: 0, width: 1920, height: 1080 };
    const cells = heroCellRects(rect);
    expect(cells.length).toBe(12);
    expect(cells.map((c) => c.order)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    for (const c of cells) {
      expect(c.side).toBe(c.order < 6 ? "left" : "right");
    }
  });

  it("HERO_OFFSET_1080P.dy=-4 已叠加到 y 坐标(models_coords 原始 y 减 4)", () => {
    const rect = { x: 0, y: 0, width: 1920, height: 1080 };
    const cells = heroCellRects(rect);
    // models_coords[hero_order=0] 原始 y=343(仓库根 layout_coordinates.json 实测值);
    // 叠加 dy=-4 后应为 339。
    const c0 = cells.find((c) => c.order === 0)!;
    expect(c0.y).toBe(343 + HERO_OFFSET_1080P.dy);
    expect(c0.x).toBe(627); // models_coords[order=0].x,dx=0 无位移
    expect(c0.w).toBe(49);
    expect(c0.h).toBe(46);
  });

  it("含窗口原点偏移(rect.x/rect.y 不为 0 时叠加)", () => {
    const rect = { x: 100, y: 50, width: 1920, height: 1080 };
    const cells = heroCellRects(rect);
    const c0 = cells.find((c) => c.order === 0)!;
    expect(c0.x).toBe(100 + 627);
    expect(c0.y).toBe(50 + 343 - 4);
  });

  it("非 1920×1080 时按宽高等比缩放(如 1280×720,缩放系数 2/3)", () => {
    const rect = { x: 0, y: 0, width: 1280, height: 720 };
    const cells = heroCellRects(rect);
    const c0 = cells.find((c) => c.order === 0)!;
    const sx = 1280 / 1920;
    const sy = 720 / 1080;
    expect(c0.x).toBe(Math.round(627 * sx));
    expect(c0.y).toBe(Math.round((343 - 4) * sy));
    expect(c0.w).toBe(Math.round(49 * sx));
    expect(c0.h).toBe(Math.round(46 * sy));
  });

  it("近 1080p 实拍尺寸(1918×1078,容差 ±10px 内)不应引入缩放漂移,坐标与精确 1920×1080 一致", () => {
    // 回归测试:真机截屏因 capture-crop/DPI 伪影常为 1918x1078 而非精确 1920x1080,
    // 曾按真实比例缩放(sx≈0.999,sy≈0.998),1-2px 漂移足以让逐格 pHash 识别收敛到错误英雄。
    const exactRect = { x: 0, y: 0, width: 1920, height: 1080 };
    const nearRect = { x: 0, y: 0, width: 1918, height: 1078 };
    const exactCells = heroCellRects(exactRect);
    const nearCells = heroCellRects(nearRect);
    expect(nearCells).toEqual(exactCells);
  });
});
