// main/tests/capture/loop_pool.test.ts
import { describe, it, expect } from "vitest";
import { poolFromFrame, type MonitorDeps } from "../../src/capture/loop";
import { poolCellRects, POOL_LAYOUT_RATIO } from "@ad/core/recognition/roi";
import type { GrayFrame } from "@ad/core/recognition/grid";
import type { IndexEntry } from "@ad/core/recognition/index_store";

const index: IndexEntry[] = [{ valveId: 700, shortName: "solid", phash: "0000000000000000" }];

function depsWith(rect: { x: number; y: number; width: number; height: number }): MonitorDeps {
  // 仅填 poolFromFrame 用到的字段;其余用 null as any(本测试不触达)。
  return {
    index,
    rect,
    ref: null as unknown as MonitorDeps["ref"],
    pool: [],
    cfg: null as unknown as MonitorDeps["cfg"],
    onUpdate: () => {},
  };
}

describe("poolFromFrame", () => {
  it("用 deps.rect 推导池布局并识别出候选池 valveId[]", () => {
    const rect = { x: 0, y: 0, width: 1920, height: 1080 };
    const f: GrayFrame = { width: 1920, height: 1080, data: new Uint8Array(1920 * 1080) }; // 全 0 纯色 → 命中 700
    // sanity:布局确实算出了格子
    expect(poolCellRects(POOL_LAYOUT_RATIO, rect).length).toBeGreaterThan(0);
    const ids = poolFromFrame(f, depsWith(rect));
    expect(ids).toContain(700);
  });
});
