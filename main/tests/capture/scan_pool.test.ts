// main/tests/capture/scan_pool.test.ts
import { describe, it, expect } from "vitest";
import { scanPool, type PoolScanDeps } from "../../src/capture/scan_pool";
import { PoolMemory } from "@ad/core/recognition/pool_memory";
import { POOL_SLOTS_1080P } from "@ad/core/recognition/pool_slots";
import { rgbFrameToGray, type RgbFrame } from "@ad/core/recognition/rgb";
import type { Classifier, Prediction } from "@ad/core/recognition/classifier";
import type { AbilityInfo } from "@ad/core/db/ability_lookup";
import type { Queryable } from "@ad/shared/types/db";
import type { ScoringConfig } from "@ad/shared/types/scoring";

const RECT = { x: 0, y: 0, width: 1920, height: 1080 };

/** 黑底帧;在指定的格子里画上高对比的棋盘格(= 有图标),其余格保持纯黑(= 空格)。 */
function frameWithLiveCells(live: (i: number) => boolean): RgbFrame {
  const data = new Uint8Array(1920 * 1080 * 3);
  POOL_SLOTS_1080P.forEach((s, i) => {
    if (!live(i)) return;
    for (let y = s.y; y < s.y + s.h; y++) for (let x = s.x; x < s.x + s.w; x++) {
      const v = ((x >> 2) + (y >> 2)) % 2 === 0 ? 255 : 0;
      const p = (y * 1920 + x) * 3;
      data[p] = v; data[p + 1] = v; data[p + 2] = v;
    }
  });
  return { width: 1920, height: 1080, data };
}

// 假数据:第 i 格的技能叫 h<英雄位置>_s<槽位>,属于 hero_id = 100 + 英雄位置。
const nameOf = (i: number) => `h${POOL_SLOTS_1080P[i].hero}_s${POOL_SLOTS_1080P[i].slot}`;
const lookup = new Map<string, AbilityInfo>(POOL_SLOTS_1080P.map((s, i) => [nameOf(i), {
  valveId: 1000 + i, slotType: s.zone === "ultimate" ? "ultimate" : "normal", heroId: 100 + s.hero,
}]));

/** 假分类器:按「送进来的是第几个有图标的格」依次给出该格的名字。 */
function fakeClassifier(liveOrder: number[], confidence = 0.99): Classifier {
  return {
    classNames: [],
    classify: async (rgb96) => {
      const n = rgb96.length / (96 * 96 * 3);
      const out: Prediction[] = [];
      for (let k = 0; k < n; k++) {
        out.push({ name: nameOf(liveOrder[k]), confidence, runnerUp: "x", runnerUpConfidence: 0 });
      }
      return out;
    },
  };
}

// 只开 base 维度;给每个候选一行胜率,让打分非零、可排序。
const cfg: ScoringConfig = { baseWeights: { base: 1.0 }, alpha: 0.5, beta: 0.4, sigma: 10, firstRoundSize: 10, topK: 4 };
const ref: Queryable = {
  all: (sql: string) => {
    if (sql.includes("ability_winrate")) {
      return POOL_SLOTS_1080P.map((_s, i) => ({ ability_id: 1000 + i, winrate: 0.4 + i / 1000, avg_pick_position: 10 }));
    }
    return [];
  },
};

function deps(clf: Classifier, memory = new PoolMemory()): PoolScanDeps {
  return { clf, lookup, ref, cfg, rect: RECT, memory };
}
const ALL = POOL_SLOTS_1080P.map((_s, i) => i);
const frames = (rgb: RgbFrame) => ({ rgb, gray: rgbFrameToGray(rgb) });

describe("scanPool", () => {
  it("满池:48 个技能进候选池,12 个英雄全部认定,有打分推荐", async () => {
    const res = await scanPool(frames(frameWithLiveCells(() => true)), deps(fakeClassifier(ALL)));
    expect(res.pool.length).toBe(48);
    expect(res.unknownCells).toBe(0);
    expect([...res.heroes].sort((a, b) => b - a)).toEqual(
      Array.from({ length: 12 }, (_v, k) => -(100 + k)));
    expect(res.recommendations.length).toBe(cfg.topK);
    const scores = res.recommendations.map((r) => r.score);
    for (let i = 1; i < scores.length; i++) expect(scores[i]).toBeLessThanOrEqual(scores[i - 1]);
  });

  it("空格不送分类器,也不进候选池", async () => {
    const live = ALL.filter((i) => i % 2 === 0);
    const res = await scanPool(
      frames(frameWithLiveCells((i) => i % 2 === 0)), deps(fakeClassifier(live)));
    expect(res.pool).toEqual(live.map((i) => 1000 + i));
  });

  it("同一局第二次扫描:被选走的技能从候选池消失,但名字和英雄还记得", async () => {
    const memory = new PoolMemory();
    await scanPool(frames(frameWithLiveCells(() => true)), deps(fakeClassifier(ALL), memory));
    // 第 20 格被选走(变空)。
    const live = ALL.filter((i) => i !== 20);
    const res = await scanPool(
      frames(frameWithLiveCells((i) => i !== 20)), deps(fakeClassifier(live), memory));
    expect(res.pool).not.toContain(1020);
    expect(res.pool.length).toBe(47);
    expect(res.snapshot.names[20]).toBe(nameOf(20));
    expect(res.heroes.length).toBe(12);
  });

  it("所有格把握都不够:没有已采信的格可供分组,救不回,候选池为空", async () => {
    const res = await scanPool(frames(frameWithLiveCells(() => true)), deps(fakeClassifier(ALL, 0.5)));
    expect(res.pool).toEqual([]);
    expect(res.unknownCells).toBe(48);
    expect(res.recommendations).toEqual([]);
  });
});
