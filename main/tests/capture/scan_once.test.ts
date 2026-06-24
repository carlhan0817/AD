// main/tests/capture/scan_once.test.ts
import { describe, it, expect } from "vitest";
import { scanOnce, type ScanDeps } from "../../src/capture/scan_once";
import { poolCellRects, POOL_LAYOUT_RATIO } from "@ad/core/recognition/roi";
import type { GrayFrame } from "@ad/core/recognition/grid";
import type { IndexEntry } from "@ad/core/recognition/index_store";
import type { ReferenceDb } from "@ad/core/db/reference";
import type { ScoringConfig } from "@ad/shared/types/scoring";
import type { SlotType } from "@ad/shared/types/draft";

// 纯色 cell → phashFromGray 得全 0 hash → 命中 phash="0000..." 的模板(与 pool_recognize.test.ts 同理)。
const index: IndexEntry[] = [{ valveId: 700, shortName: "solid", phash: "0000000000000000" }];

// 假 ReferenceDb:只实现 scanOnce 触达的两个方法。
// - slotType: 700 当作 normal 技能。
// - all: 给 buildScoringContext 喂一行 700 的胜率,其余表空 → 打分非零、可排序。
function fakeRef(): ReferenceDb {
  return {
    slotType: (v: number): SlotType | null => (v === 700 ? "normal" : null),
    all: (sql: string): unknown[] => {
      if (sql.includes("ability_winrate")) {
        return [{ ability_id: 700, winrate: 0.55, avg_pick_position: 10 }];
      }
      return []; // hero_winrate / ability_pairs / ability_aghs 全空
    },
  } as unknown as ReferenceDb;
}

const cfg: ScoringConfig = {
  baseWeights: { base: 1.0 }, // 只开 base 维度(无上下文,synergy/pos 退化)
  alpha: 0.5, beta: 0.4, sigma: 10, firstRoundSize: 10, topK: 4,
};

function depsWith(rect: ScanDeps["rect"]): ScanDeps {
  return { index, rect, ref: fakeRef(), cfg };
}

describe("scanOnce", () => {
  it("识别到候选池并产出打分推荐(无上下文纯池排名)", () => {
    const rect = { x: 0, y: 0, width: 1920, height: 1080 };
    const f: GrayFrame = { width: 1920, height: 1080, data: new Uint8Array(1920 * 1080) }; // 全 0 → 命中 700
    // sanity:池布局确实算出了格子。
    expect(poolCellRects(POOL_LAYOUT_RATIO, rect).length).toBeGreaterThan(0);

    const res = scanOnce(f, depsWith(rect));
    // 识别:池非空,含 700。
    expect(res.pool).toContain(700);
    // 打分:有推荐,且全是已识别候选。
    expect(res.recommendations.length).toBeGreaterThan(0);
    expect(res.recommendations.length).toBeLessThanOrEqual(cfg.topK);
    // 排序:score 降序(非递增)。
    const scores = res.recommendations.map((r) => r.score);
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeLessThanOrEqual(scores[i - 1]);
    }
  });

  it("空池(无命中)时推荐为空", () => {
    const rect = { x: 0, y: 0, width: 1920, height: 1080 };
    const f: GrayFrame = { width: 1920, height: 1080, data: new Uint8Array(1920 * 1080) };
    // index 只有距全 0 极远的模板 → maxDistance 内无命中 → 池空。
    const farIndex: IndexEntry[] = [{ valveId: 999, shortName: "far", phash: "ffffffffffffffff" }];
    const deps: ScanDeps = { index: farIndex, rect, ref: fakeRef(), cfg };
    const res = scanOnce(f, deps);
    expect(res.pool).toEqual([]);
    expect(res.recommendations).toEqual([]);
  });
});
