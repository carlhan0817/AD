import { describe, it, expect } from "vitest";
import { cropRaw, cropGrid, type GridSpec, type GrayFrame } from "../../src/recognition/grid";

// 像素值 = 行*10+列,便于断言裁切位置
function frame(w: number, h: number): GrayFrame {
  const data = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = (y * 10 + x) & 0xff;
  return { width: w, height: h, data };
}

describe("cropRaw", () => {
  it("extracts the exact sub-rectangle without scaling", () => {
    const spec: GridSpec = { x: 1, y: 1, cellW: 2, cellH: 2, gapX: 0, gapY: 0, rows: 1, cols: 1 };
    const raw = cropRaw(frame(4, 4), spec.x, spec.y, spec.cellW, spec.cellH);
    // (1,1)=11, (2,1)=12, (1,2)=21, (2,2)=22
    expect(raw).toEqual([[11, 12], [21, 22]]);
  });
});

describe("cropGrid", () => {
  it("yields rows*cols cells, each resized to 32x32", () => {
    const spec: GridSpec = { x: 0, y: 0, cellW: 8, cellH: 8, gapX: 0, gapY: 0, rows: 2, cols: 2 };
    const cells = cropGrid(frame(16, 16), spec);
    expect(cells.length).toBe(4);
    expect(cells[0].length).toBe(32);
    expect(cells[0][0].length).toBe(32);
  });
});
