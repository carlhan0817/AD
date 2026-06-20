// core/tests/recognition/pool_recognize.test.ts
import { describe, it, expect } from "vitest";
import { recognizePool } from "../../src/recognition/pool_recognize";
import { poolCellRects, type PoolLayout } from "../../src/recognition/roi";
import type { GrayFrame } from "../../src/recognition/grid";
import type { IndexEntry } from "../../src/recognition/index_store";

// 纯色 v 的 32×32 cell 经 phashFromGray 得全 0 hash(与 recognize.test.ts 同理:
// 块均值 == 全局均值 → 每位 0)。故纯色 sprite 命中 phash 全 0 的模板。
const index: IndexEntry[] = [
  { valveId: 700, shortName: "solid", phash: "0000000000000000" },
  { valveId: 999, shortName: "faraway", phash: "ffffffffffffffff" },
];

function blankFrame(w: number, h: number): GrayFrame {
  return { width: w, height: h, data: new Uint8Array(w * h) }; // 全 0
}

/** 把整块矩形涂成纯色 v(模拟某格里有一个 sprite)。 */
function fillRect(f: GrayFrame, x: number, y: number, w: number, h: number, v: number): void {
  for (let yy = y; yy < y + h; yy++)
    for (let xx = x; xx < x + w; xx++)
      f.data[yy * f.width + xx] = v;
}

const layout: PoolLayout = {
  rows: [
    { startXRatio: 0.1, yRatio: 0.1, cellRatio: 0.05, gapRatio: 0.01, count: 2, zone: "ultimate" },
  ],
};
const rect = { x: 0, y: 0, width: 1920, height: 1080 };

describe("recognizePool", () => {
  it("命中贴进格子像素位的纯色 sprite,返回其 valveId", () => {
    const f = blankFrame(1920, 1080);
    // 全 0 背景本就会命中 valveId=700(纯色 0)。为证明它读的是"格子位置",
    // 只在第 0 格涂中灰 128(纯色 128 的 phash 也是全 0 → 命中 700),
    // 背景 0 也是纯色 → 同样命中 700。两者都应只产出 {700}(去重)。
    const cells = poolCellRects(layout, rect);
    fillRect(f, cells[0].x, cells[0].y, cells[0].w, cells[0].h, 128);
    const ids = recognizePool(f, rect, index, layout, 6);
    expect(ids).toContain(700);
    expect(ids).not.toContain(999); // 纯色 → 距 ffff 远 → 不命中
    // 去重:多格都命中 700,只出现一次
    expect(ids.filter((v) => v === 700).length).toBe(1);
  });

  it("maxDistance 过小且无近邻时返回空池", () => {
    const f = blankFrame(1920, 1080);
    const farIndex: IndexEntry[] = [{ valveId: 999, shortName: "faraway", phash: "ffffffffffffffff" }];
    // 纯色 cell → phash 全 0,距 ffff = 64,阈值 3 → 全部未命中
    const ids = recognizePool(f, rect, farIndex, layout, 3);
    expect(ids).toEqual([]);
  });
});
