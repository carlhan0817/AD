// core/tests/recognition/rgb.test.ts
import { describe, it, expect } from "vitest";
import {
  rgbFrameToGray, cropResizeRgb, pixelStd, isEmptyCell, EMPTY_CELL_STD, meanChroma, type RgbFrame,
} from "../../src/recognition/rgb";
import { rgbToGray601 } from "../../src/recognition/gray";

function solid(width: number, height: number, r: number, g: number, b: number): RgbFrame {
  const data = new Uint8Array(width * height * 3);
  for (let p = 0; p < width * height; p++) { data[p * 3] = r; data[p * 3 + 1] = g; data[p * 3 + 2] = b; }
  return { width, height, data };
}

describe("rgbFrameToGray", () => {
  it("同尺寸,按 601 公式转灰度", () => {
    const g = rgbFrameToGray(solid(8, 4, 200, 100, 50));
    expect(g.width).toBe(8);
    expect(g.height).toBe(4);
    expect(g.data.length).toBe(32);
    expect(g.data[0]).toBe(rgbToGray601(200, 100, 50));
  });
});

describe("cropResizeRgb", () => {
  it("纯色区缩放后仍是该颜色,长度 = size*size*3", () => {
    const out = cropResizeRgb(solid(100, 80, 10, 20, 30), 5, 5, 53, 47, 96);
    expect(out.length).toBe(96 * 96 * 3);
    expect([out[0], out[1], out[2]]).toEqual([10, 20, 30]);
    expect([out[out.length - 3], out[out.length - 2], out[out.length - 1]]).toEqual([10, 20, 30]);
  });

  it("只取裁剪框内的像素:左红右蓝的帧,裁左半得纯红", () => {
    const f = solid(20, 10, 0, 0, 255);
    for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) {
      const i = (y * 20 + x) * 3; f.data[i] = 255; f.data[i + 2] = 0;
    }
    const out = cropResizeRgb(f, 0, 0, 10, 10, 8);
    for (let p = 0; p < 64; p++) expect([out[p * 3], out[p * 3 + 2]]).toEqual([255, 0]);
  });

  it("同尺寸缩放是恒等", () => {
    const f: RgbFrame = { width: 2, height: 2, data: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) };
    expect(Array.from(cropResizeRgb(f, 0, 0, 2, 2, 2))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it("越界裁剪 clamp 到帧边缘,不抛错", () => {
    const out = cropResizeRgb(solid(10, 10, 7, 8, 9), 8, 8, 6, 6, 4);
    expect([out[0], out[1], out[2]]).toEqual([7, 8, 9]);
  });
});

describe("pixelStd / isEmptyCell", () => {
  it("纯色标准差为 0 → 空格", () => {
    const flat = new Uint8Array(300).fill(20);
    expect(pixelStd(flat)).toBe(0);
    expect(isEmptyCell(flat)).toBe(true);
  });

  it("黑白各半标准差 127.5 → 非空", () => {
    const half = new Uint8Array(300);
    half.fill(255, 150);
    expect(pixelStd(half)).toBeCloseTo(127.5, 5);
    expect(isEmptyCell(half)).toBe(false);
  });

  it("分界线两侧", () => {
    // 两个值 m±d 各半 → 标准差恰为 d
    const mk = (d: number) => { const a = new Uint8Array(200).fill(100 - d); a.fill(100 + d, 100); return a; };
    expect(isEmptyCell(mk(EMPTY_CELL_STD - 1))).toBe(true);
    expect(isEmptyCell(mk(EMPTY_CELL_STD))).toBe(false);
  });
});

describe("meanChroma", () => {
  it("灰色为 0,纯红为 255", () => {
    expect(meanChroma(new Uint8Array([90, 90, 90, 10, 10, 10]))).toBe(0);
    expect(meanChroma(new Uint8Array([255, 0, 0]))).toBe(255);
  });
});
