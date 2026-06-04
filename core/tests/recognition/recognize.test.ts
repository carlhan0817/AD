import { describe, it, expect } from "vitest";
import { recognizeCell } from "../../src/recognition/recognize";
import type { IndexEntry } from "../../src/recognition/index_store";

const index: IndexEntry[] = [
  { valveId: -9, shortName: "mirana", phash: "0000000000000000" },
  { valveId: 5048, shortName: "mirana_arrow", phash: "ffffffffffffffff" },
];

function solid(v: number): number[][] {
  return Array.from({ length: 32 }, () => Array(32).fill(v));
}

describe("recognizeCell", () => {
  it("returns matched valveId for a known sprite", () => {
    // 纯色 128 → phash 8000... → 与 0000(d=1) 比 ffff(d=15) 近 → 命中 -9
    const r = recognizeCell(solid(128), index, 6);
    expect(r?.valveId).toBe(-9);
  });
  it("returns null when nothing within maxDistance", () => {
    const sparse: IndexEntry[] = [{ valveId: 1, shortName: "x", phash: "ffffffffffffffff" }];
    const r = recognizeCell(solid(128), sparse, 3);
    expect(r).toBeNull();
  });
});
