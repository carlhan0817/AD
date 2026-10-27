// core/tests/recognition/hero_taken.test.ts
import { describe, it, expect } from "vitest";
import { isHeroTileTaken, takenHeroPositions } from "../../src/recognition/hero_taken";
import { heroCellRects } from "../../src/recognition/hero_layout";
import type { RgbFrame } from "../../src/recognition/rgb";

/** 96×96 的格:棋盘格两种颜色交替(控制对比度与饱和度)。 */
function tile(a: [number, number, number], b: [number, number, number]): Uint8Array {
  const out = new Uint8Array(96 * 96 * 3);
  for (let p = 0; p < 96 * 96; p++) out.set(((p % 96) + Math.floor(p / 96)) % 2 ? a : b, p * 3);
  return out;
}

describe("isHeroTileTaken", () => {
  it("灰暗、低对比(被选走的样子)→ 已选走", () => {
    expect(isHeroTileTaken(tile([20, 20, 20], [60, 60, 60]))).toBe(true);
  });
  it("灰但对比强 → 不算(宁可漏判)", () => {
    expect(isHeroTileTaken(tile([10, 10, 10], [200, 200, 200]))).toBe(false);
  });
  it("偏暗但有颜色(本身就暗的英雄)→ 不算", () => {
    expect(isHeroTileTaken(tile([40, 10, 60], [60, 20, 90]))).toBe(false);
  });
});

describe("takenHeroPositions", () => {
  it("只把画成灰暗的那几个模型格报为已选走", () => {
    const rect = { x: 0, y: 0, width: 1920, height: 1080 };
    const frame: RgbFrame = { width: 1920, height: 1080, data: new Uint8Array(1920 * 1080 * 3) };
    // 所有格先画成鲜艳的彩色棋盘,再把位置 3、7 改成灰暗。
    for (const c of heroCellRects(rect)) {
      const grey = c.order === 3 || c.order === 7;
      for (let y = c.y - 2; y < c.y + c.h + 2; y++) for (let x = c.x - 2; x < c.x + c.w + 2; x++) {
        const on = (x + y) % 2 === 0;
        const px = grey ? (on ? [30, 30, 30] : [50, 50, 50]) : (on ? [220, 40, 40] : [30, 30, 200]);
        frame.data.set(px, (y * 1920 + x) * 3);
      }
    }
    expect([...takenHeroPositions(frame, rect)].sort((a, b) => a - b)).toEqual([3, 7]);
  });
});
