// core/tests/recognition/hero_recognize.test.ts
import { describe, it, expect } from "vitest";
import { recognizeHeroes, refineHeroCell } from "../../src/recognition/hero_recognize";
import { heroCellRects } from "../../src/recognition/hero_layout";
import type { GrayFrame } from "../../src/recognition/grid";
import type { IndexEntry } from "../../src/recognition/index_store";

// 纯色 v 的 32×32 cell 经 phashFromGray 得全 0 hash(块均值==全局均值→每位0)。
// 与 pool_recognize.test.ts 同理:纯色 sprite 命中 phash 全 0 的模板。
const index: IndexEntry[] = [
  { valveId: -700, shortName: "solid_hero", phash: "0000000000000000" },
  { valveId: -999, shortName: "faraway_hero", phash: "ffffffffffffffff" },
];

function blankFrame(w: number, h: number): GrayFrame {
  return { width: w, height: h, data: new Uint8Array(w * h) };
}

function fillRect(f: GrayFrame, x: number, y: number, w: number, h: number, v: number): void {
  for (let yy = y; yy < y + h; yy++)
    for (let xx = x; xx < x + w; xx++)
      f.data[yy * f.width + xx] = v;
}

describe("recognizeHeroes", () => {
  it("命中贴进英雄格像素位的纯色 sprite,返回其 valveId(负值)", () => {
    const rect = { x: 0, y: 0, width: 1920, height: 1080 };
    const f = blankFrame(1920, 1080);
    const cells = heroCellRects(rect);
    // 只在 order=0 格涂中灰 128(纯色→phash全0→命中 -700);背景全0本身也是纯色,
    // 同样命中 -700——两者应只产出一次(去重),与 pool_recognize.test.ts 同一验证思路。
    const c0 = cells.find((c) => c.order === 0)!;
    fillRect(f, c0.x, c0.y, c0.w, c0.h, 128);

    const ids = recognizeHeroes(f, rect, index, 6);
    expect(ids).toContain(-700);
    expect(ids).not.toContain(-999); // 纯色 → 距 ffff 远 → 不命中
    expect(ids.filter((v) => v === -700).length).toBe(1); // 去重
  });

  it("maxDistance 过小且无近邻时返回空池", () => {
    const rect = { x: 0, y: 0, width: 1920, height: 1080 };
    const f = blankFrame(1920, 1080);
    const farIndex: IndexEntry[] = [{ valveId: -999, shortName: "faraway_hero", phash: "ffffffffffffffff" }];
    const ids = recognizeHeroes(f, rect, farIndex, 3);
    expect(ids).toEqual([]);
  });
});

describe("refineHeroCell", () => {
  it("单格 refine 在纯色背景上返回最近邻匹配(不因偏移 ±6px 而漏检)", () => {
    const rect = { x: 0, y: 0, width: 1920, height: 1080 };
    const f = blankFrame(1920, 1080);
    const cells = heroCellRects(rect);
    const c0 = cells.find((c) => c.order === 0)!;
    fillRect(f, c0.x, c0.y, c0.w, c0.h, 200);
    const m = refineHeroCell(f, c0, index, 12);
    expect(m).not.toBeNull();
    expect(m!.valveId).toBe(-700);
  });
});
