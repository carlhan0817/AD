// main/tests/capture/scan_pool.test.ts
import { describe, it, expect } from "vitest";
import { scanPool, type PoolScanDeps } from "../../src/capture/scan_pool";
import { PoolMemory } from "@ad/core/recognition/pool_memory";
import { POOL_SLOTS_1080P } from "@ad/core/recognition/pool_slots";
import { heroCellRects } from "@ad/core/recognition/hero_layout";
import { playerCards } from "@ad/core/recognition/player_cards";
import { rgbFrameToGray, type RgbFrame } from "@ad/core/recognition/rgb";
import type { Classifier, Prediction } from "@ad/core/recognition/classifier";
import type { AbilityInfo } from "@ad/core/db/ability_lookup";
import type { Queryable } from "@ad/shared/types/db";
import type { ScoringConfig } from "@ad/shared/types/scoring";

const RECT = { x: 0, y: 0, width: 1920, height: 1080 };

/** 黑底帧;在指定的格子里画上高对比的棋盘格(= 有图标),其余格保持纯黑(= 空格)。
 *  12 个英雄模型格画成彩色(= 还没被选走),takenHeroes 里的位置画成灰暗(= 已被选走)。 */
function frameWithLiveCells(live: (i: number) => boolean, takenHeroes: number[] = [], outline = true): RgbFrame {
  const data = new Uint8Array(1920 * 1080 * 3);
  // 我的绿色外框(左1 的左边缘):选人界面判定要用。
  if (outline) {
    const c = playerCards(RECT)[0];
    for (let y = c.y + 10; y < c.y + 136; y++) for (let x = c.x; x < c.x + 4; x++) data.set([86, 253, 0], (y * 1920 + x) * 3);
  }
  for (const c of heroCellRects(RECT)) {
    const grey = takenHeroes.includes(c.order);
    for (let y = c.y - 2; y < c.y + c.h + 2; y++) for (let x = c.x - 2; x < c.x + c.w + 2; x++) {
      const on = (x + y) % 2 === 0;
      data.set(grey ? (on ? [30, 30, 30] : [50, 50, 50]) : (on ? [220, 40, 40] : [30, 30, 200]), (y * 1920 + x) * 3);
    }
  }
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
    // 技能部分按分数从高到低(英雄单独排在最后,不参与比较)。
    const scores = res.recommendations.filter((r) => r.candidate.slotType !== "hero").map((r) => r.score);
    for (let i = 1; i < scores.length; i++) expect(scores[i]).toBeLessThanOrEqual(scores[i - 1]);
  });

  it("空格不送分类器,也不进候选池", async () => {
    const live = ALL.filter((i) => i % 8 !== 0);
    const res = await scanPool(
      frames(frameWithLiveCells((i) => i % 8 !== 0)), deps(fakeClassifier(live)));
    expect(res.pool).toEqual(live.map((i) => 1000 + i));
  });

  it("某格变空:卡上没这个技能时第一次不算(可能是说明框),连续两次才算被选走,名字和英雄还记得", async () => {
    const memory = new PoolMemory();
    await scanPool(frames(frameWithLiveCells(() => true)), deps(fakeClassifier(ALL), memory));
    // 第 20 格变空。
    const live = ALL.filter((i) => i !== 20);
    const scan = () => scanPool(
      frames(frameWithLiveCells((i) => i !== 20)), deps(fakeClassifier(live), memory));
    expect((await scan()).pool).toContain(1020);
    const res = await scan();
    expect(res.pool).not.toContain(1020);
    expect(res.pool.length).toBe(47);
    expect(res.snapshot.names[20]).toBe(nameOf(20));
    expect(res.heroes.length).toBe(12);
  });

  it("技能与英雄分开取:技能 topK−1 个 + 英雄 1 个,合起来按分数排", async () => {
    const res = await scanPool(frames(frameWithLiveCells(() => true)), deps(fakeClassifier(ALL)));
    const types = res.recommendations.map((r) => r.candidate.slotType);
    expect(types.length).toBe(cfg.topK);
    expect(types.filter((t) => t === "hero").length).toBe(1);
    const scores = res.recommendations.map((r) => r.score);
    for (let i = 1; i < scores.length; i++) expect(scores[i]).toBeLessThanOrEqual(scores[i - 1]);
  });

  it("已被选走(变灰)的英雄模型不再推荐,也不算可选英雄", async () => {
    const res = await scanPool(frames(frameWithLiveCells(() => true, [3, 7])), deps(fakeClassifier(ALL)));
    expect(res.takenHeroes).toEqual([3, 7]);
    expect(res.heroes).not.toContain(-(100 + 3));
    expect(res.heroes).not.toContain(-(100 + 7));
    expect(res.heroes.length).toBe(10);
    expect(res.recommendations.map((r) => r.candidate.valveId)).not.toContain(-(100 + 7));
  });

  it("大部分格认不出 → 不是选人界面:什么都不记,不推荐", async () => {
    const memory = new PoolMemory();
    const res = await scanPool(frames(frameWithLiveCells(() => true)), deps(fakeClassifier(ALL, 0.5), memory));
    expect(res.onDraftScreen).toBe(false);
    expect(res.recommendations).toEqual([]);
    expect(memory.myRow).toBeNull();
  });

  it("空格很多但卡上没有技能(主菜单那种)→ 不是选人界面", async () => {
    const live = ALL.filter((i) => i % 2 === 0);
    const res = await scanPool(frames(frameWithLiveCells((i) => i % 2 === 0)), deps(fakeClassifier(live)));
    expect(res.onDraftScreen).toBe(false);
  });

  it("找不到我的绿框,这局也没认出过我 → 不是选人界面;认出过就放行", async () => {
    const memory = new PoolMemory();
    const off = frames(frameWithLiveCells(() => true, [], false));
    expect((await scanPool(off, deps(fakeClassifier(ALL), memory))).onDraftScreen).toBe(false);
    await scanPool(frames(frameWithLiveCells(() => true)), deps(fakeClassifier(ALL), memory));
    expect((await scanPool(off, deps(fakeClassifier(ALL), memory))).onDraftScreen).toBe(true);
  });
});

describe("scanPool 不支持的屏幕比例", () => {
  const boom: Classifier = { classNames: [], classify: async () => { throw new Error("不支持的比例不该碰分类器"); } };

  it("1500×920(1.63)不支持:不扫、不碰分类器、不写记忆,带上实际宽高", async () => {
    const memory = new PoolMemory();
    await scanPool(frames(frameWithLiveCells(() => true)), deps(fakeClassifier(ALL), memory));
    const before = JSON.stringify([memory.myRow, memory.mySeat, memory.myHeroId, memory.clone()]);
    const res = await scanPool(frames(frameWithLiveCells(() => true)),
      { ...deps(boom, memory), rect: { x: 0, y: 0, width: 1500, height: 920 } });
    expect(res.onDraftScreen).toBe(false);
    expect(res.unsupportedRatio).toEqual({ width: 1500, height: 920 });
    expect(res.recommendations).toEqual([]);
    expect(JSON.stringify([memory.myRow, memory.mySeat, memory.myHeroId, memory.clone()])).toBe(before);
  });

  it("同一个记忆换回 1920×1080 照常扫描,且没有 unsupportedRatio", async () => {
    const memory = new PoolMemory();
    await scanPool(frames(frameWithLiveCells(() => true)),
      { ...deps(boom, memory), rect: { x: 0, y: 0, width: 1500, height: 920 } });
    const res = await scanPool(frames(frameWithLiveCells(() => true)), deps(fakeClassifier(ALL), memory));
    expect(res.onDraftScreen).toBe(true);
    expect(res.unsupportedRatio).toBeUndefined();
    expect(res.pool.length).toBe(48);
  });
});
