// 打分的三块新逻辑:单技能强度按我的英雄修正、搭配按增益算、向前看池里的组合。
import { describe, it, expect } from "vitest";
import type { Candidate, ScoringContext, WinrateRow } from "@ad/shared/types/scoring";
import { heroFitDelta, pairLift, strength } from "../../src/scoring/strength";
import { base } from "../../src/scoring/signals/base";
import { synergy } from "../../src/scoring/signals/synergy";
import { pairKey } from "../../src/scoring/pair_key";
import { bestPartner, combo, myNextTwoPicks, surviveProb } from "../../src/scoring/signals/combo";
import { buildHeroAttrs } from "../../src/scoring/hero_attrs";
import { defaultScoringConfig, loadScoringConfig } from "../../src/scoring/config";
import { scoreCandidates } from "../../src/scoring/score";

const wr = (winrate: number, avgPickPosition: number | null = null, pickRate: number | null = null): WinrateRow =>
  ({ winrate, avgPickPosition, pickRate });

function ctx(over: Partial<ScoringContext> = {}): ScoringContext {
  return {
    me: { row: 0, hero: null, normals: [], ultimates: [] }, pickIndex: 1,
    winrate: new Map(), pairWinrate: new Map(), aghs: new Map(), ...over,
  };
}

const HERO_MELEE = -1, HERO_RANGED = -2;
const heroAttrs = new Map([
  [HERO_MELEE, { attr: "str" as const, ranged: false }],
  [HERO_RANGED, { attr: "int" as const, ranged: true }],
]);

describe("单技能强度按我的英雄修正", () => {
  // 技能 10:总体 0.54;近战 0.50、远程 0.58;力量 0.52、智力 0.56。样本都很大。
  const fitCtx = (hero: number | null, shrinkN = 0) => ctx({
    me: { row: 0, hero, normals: [], ultimates: [] },
    winrate: new Map([[10, wr(0.54)], [HERO_MELEE, wr(0.5)], [HERO_RANGED, wr(0.5)]]),
    attrWinrate: new Map([[10, {
      melee: { winrate: 0.50, picks: 2000 }, ranged: { winrate: 0.58, picks: 2000 },
      str: { winrate: 0.52, picks: 2000 }, int: { winrate: 0.56, picks: 2000 },
    }]]),
    heroAttrs, heroFit: { range: 0.6, attr: 0.4, shrinkN },
  });
  const c: Candidate = { valveId: 10, slotType: "normal" };

  it("没选英雄时不修正", () => {
    expect(base(fitCtx(null), c)).toBeCloseTo(0.04, 6);
  });
  it("近战力量英雄:0.6×(−0.04) + 0.4×(−0.02)", () => {
    expect(base(fitCtx(HERO_MELEE), c)).toBeCloseTo(0.04 - 0.024 - 0.008, 6);
  });
  it("远程智力英雄:同一个技能反而加分", () => {
    expect(base(fitCtx(HERO_RANGED), c)).toBeCloseTo(0.04 + 0.024 + 0.008, 6);
  });
  it("样本少的那一类打折:样本数 / (样本数 + shrinkN)", () => {
    expect(heroFitDelta(fitCtx(HERO_MELEE, 2000), 10, HERO_MELEE)).toBeCloseTo((-0.024 - 0.008) / 2, 6);
  });
  it("没配 heroFit、不认识的英雄、没有分类数据、候选是英雄:都不修正", () => {
    expect(heroFitDelta({ ...fitCtx(HERO_MELEE), heroFit: undefined }, 10, HERO_MELEE)).toBe(0);
    expect(heroFitDelta(fitCtx(-99), 10, -99)).toBe(0);
    expect(heroFitDelta({ ...fitCtx(HERO_MELEE), attrWinrate: new Map() }, 10, HERO_MELEE)).toBe(0);
    expect(heroFitDelta(fitCtx(HERO_MELEE), HERO_RANGED, HERO_MELEE)).toBe(0);
  });
  it("没有胜率数据的候选强度按 0", () => {
    expect(strength(fitCtx(HERO_MELEE), 999, HERO_MELEE)).toBe(0);
  });
});

describe("搭配按增益算", () => {
  // 10、11 各 0.55(都强);20、21 各 0.49(都一般)。
  const winrate = new Map([[10, wr(0.55)], [11, wr(0.55)], [20, wr(0.49)], [21, wr(0.49)]]);
  const pairWinrate = new Map([
    [pairKey(10, 11), 0.60], // 两个强技能:0.5+0.05+0.05 = 0.60 → 增益 0,并不「配」
    [pairKey(20, 21), 0.60], // 两个一般技能合起来 0.60:应有 0.48 → 增益 0.12
  ]);
  const liftCtx = (over: Partial<ScoringContext> = {}) => ctx({ winrate, pairWinrate, synergyLift: { shrinkN: 0 }, ...over });

  it("两个本来就强的技能,组合胜率高不算增益;真正 1+1>2 的才算", () => {
    expect(pairLift(liftCtx(), 10, 11)).toBeCloseTo(0, 6);
    expect(pairLift(liftCtx(), 20, 21)).toBeCloseTo(0.12, 6);
  });
  it("没有这个组合的数据返回 null", () => {
    expect(pairLift(liftCtx(), 10, 20)).toBeNull();
  });
  it("按样本量打折", () => {
    const c = liftCtx({ synergyLift: { shrinkN: 300 }, pairPicks: new Map([[pairKey(20, 21), 300]]) });
    expect(pairLift(c, 20, 21)).toBeCloseTo(0.06, 6);
  });
  it("英雄 × 技能:技能那一半用在这个英雄上修正后的强度,不重复算", () => {
    // 技能 10 在远程上 +0.04(权重 1):应有 = 0.5 + 0(英雄) + 0.05 + 0.04 = 0.59;组合 0.62 → 增益 0.03
    const c = liftCtx({
      winrate: new Map([...winrate, [HERO_RANGED, wr(0.5)]]),
      pairWinrate: new Map([[pairKey(HERO_RANGED, 10), 0.62]]),
      heroAttrs, heroFit: { range: 1, attr: 0, shrinkN: 0 },
      attrWinrate: new Map([[10, { ranged: { winrate: 0.59, picks: 5000 } }]]),
    });
    expect(pairLift(c, HERO_RANGED, 10)).toBeCloseTo(0.03, 6);
    expect(pairLift(c, 10, HERO_RANGED)).toBeCloseTo(0.03, 6);
  });

  it("搭配分 = 最配的几件的增益相加(不求平均):一个强组合拿到全部增益", () => {
    const me = { row: 0, hero: null, normals: [20, 10], ultimates: [] };
    // 候选 21:和 20 增益 0.12;和 10 没数据 → 0。top2 相加 = 0.12(旧算法求平均会变成 0.06)
    expect(synergy(liftCtx({ me, synergyTopN: 2 }), { valveId: 21, slotType: "normal" })).toBeCloseTo(0.12, 6);
  });
  it("缺数据时用同类技能的增益打折估;没有同类就是 0,不拿单技能强度去猜", () => {
    const me = { row: 0, hero: null, normals: [20], ultimates: [] };
    const c22: Candidate = { valveId: 22, slotType: "normal" };
    const w = new Map([...winrate, [22, wr(0.58)]]);
    expect(synergy(liftCtx({ me, winrate: w, pairFallback: { single: 0.5, similar: 0.5 } }), c22)).toBe(0);
    const withSimilar = liftCtx({ me, winrate: w, pairFallback: { single: 0.5, similar: 0.5 }, similar: new Map([[22, [21]]]) });
    expect(synergy(withSimilar, c22)).toBeCloseTo(0.06, 6); // 同类 21 与 20 的增益 0.12 × 0.5
  });
  it("没配 synergyLift 时仍是原来的算法(原始搭配胜率求平均)", () => {
    const me = { row: 0, hero: null, normals: [20, 10], ultimates: [] };
    const old = ctx({ me, winrate, pairWinrate, synergyTopN: 2 });
    expect(synergy(old, { valveId: 21, slotType: "normal" })).toBeCloseTo((0.10 + 0) / 2, 6);
  });
});

describe("向前看池里的组合", () => {
  // 池里:A(30) 和 B(31) 是强组合(增益 0.12);C(32) 是个强单技能。
  const winrate = new Map([[30, wr(0.49, 30, 0.9)], [31, wr(0.49, 30, 0.9)], [32, wr(0.56, 30, 0.9)]]);
  const pairWinrate = new Map([[pairKey(30, 31), 0.60]]);
  const pool: Candidate[] = [30, 31, 32].map((valveId) => ({ valveId, slotType: "normal" as const }));
  const la = (over: Partial<ScoringContext> = {}) => ctx({
    winrate, pairWinrate, pool, seat: 1, pickIndex: 1,
    synergyLift: { shrinkN: 0 }, comboLookahead: { discount: 1, sigma: 8 }, ...over,
  });

  it("我接下来的两手:蛇形顺序", () => {
    expect(myNextTwoPicks(la({ seat: 1, pickIndex: 1 }))).toEqual([1, 20]);
    expect(myNextTwoPicks(la({ seat: 1, pickIndex: 5 }))).toEqual([20, 21]);   // 第 1 手已过,下两手连选
    expect(myNextTwoPicks(la({ seat: 3, pickIndex: 3 }))).toEqual([3, 18]);
    expect(myNextTwoPicks(la({ seat: 10, pickIndex: 10 }))).toEqual([10, 11]);
    expect(myNextTwoPicks(la({ seat: 1, pickIndex: 41 }))).toBeNull();          // 最后一手,没有下一手
    expect(myNextTwoPicks(la({ seat: null, pickIndex: 12 }))).toEqual([12, 22]); // 不知道选位:按 10 手后估
    expect(myNextTwoPicks(la({ seat: null, pickIndex: 45 }))).toBeNull();
    expect(myNextTwoPicks(la({ pickIndex: null }))).toBeNull();
  });

  it("留到下一手的概率:越晚被选的越留得住,隔得越久越留不住", () => {
    const c = la({ winrate: new Map([[1, wr(0.5, 8, 0.95)], [2, wr(0.5, 35, 0.95)], [3, wr(0.5, null, null)]]), pickIndex: 3 });
    const early = surviveProb(c, 1, 18, 8), lateOne = surviveProb(c, 2, 18, 8);
    expect(early).toBeLessThan(0.3);
    expect(lateOne).toBeGreaterThan(0.9);
    expect(surviveProb(c, 2, 38, 8)).toBeLessThan(lateOne);
    expect(surviveProb(c, 2, 4, 8)).toBeGreaterThan(lateOne);
    expect(surviveProb(c, 3, 18, 8)).toBe(0.5); // 没有顺位数据
  });

  it("组合的两半都在池里、我一件都没拿:两半都有加分,强单技能没有", () => {
    const c = la();
    const a = combo(c, pool[0]), b = combo(c, pool[1]);
    expect(a).toBeGreaterThan(0.08);
    expect(b).toBeCloseTo(a, 6);
    expect(combo(c, pool[2])).toBe(0);
    expect(bestPartner(c, pool[0])?.partner).toBe(31);
  });

  it("先拿抢手的那一半:另一半留得住的,得分更高", () => {
    // 30 很抢手(平均第 6 手),31 不抢手(平均第 35 手)
    const w = new Map([[30, wr(0.49, 6, 0.95)], [31, wr(0.49, 35, 0.95)], [32, wr(0.56, 30, 0.9)]]);
    const c = la({ winrate: w, seat: 3, pickIndex: 3 });
    expect(combo(c, pool[0])).toBeGreaterThan(combo(c, pool[1]) * 3);
  });

  it("折扣按比例生效", () => {
    const full = combo(la(), pool[0]);
    expect(combo(la({ comboLookahead: { discount: 0.5, sigma: 8 } }), pool[0])).toBeCloseTo(full / 2, 6);
  });

  it("搭档的类型拿了候选后没有配额了,就不算", () => {
    // 池里的搭档是终极技能,而我已经有终极了
    const ultPool: Candidate[] = [{ valveId: 30, slotType: "normal" }, { valveId: 31, slotType: "ultimate" }];
    expect(combo(la({ pool: ultPool, me: { row: 0, hero: null, normals: [], ultimates: [99] } }), ultPool[0])).toBe(0);
    // 候选和搭档都是普通技能,而我只剩一个普通位
    expect(combo(la({ me: { row: 0, hero: null, normals: [1, 2], ultimates: [] } }), pool[0])).toBe(0);
    // 还剩两个普通位就可以
    expect(combo(la({ me: { row: 0, hero: null, normals: [1], ultimates: [] } }), pool[0])).toBeGreaterThan(0);
  });

  it("最后一手、没给池子、没配向前看:都是 0", () => {
    expect(combo(la({ pickIndex: 41 }), pool[0])).toBe(0);
    expect(combo(la({ pool: undefined }), pool[0])).toBe(0);
    expect(combo(la({ comboLookahead: undefined }), pool[0])).toBe(0);
  });

  it("整体打分:开局时组合的一半排到强单技能前面,且 breakdown 里有 combo", () => {
    const cfg = { ...defaultScoringConfig(), comboLookahead: { discount: 1, sigma: 8 } };
    const ranked = scoreCandidates(pool, la(), cfg);
    expect(ranked[2].candidate.valveId).toBe(32);
    expect(ranked[0].breakdown.combo!).toBeGreaterThan(0.08);
  });
});

describe("英雄属性表与配置", () => {
  it("按 picture 名对上英雄,键是负的 valveId;认不出的跳过", () => {
    const json = JSON.stringify({ heroes: {
      axe: { attr: "str", ranged: false }, lina: { attr: "int", ranged: true },
      bad: { attr: "luck", ranged: true }, half: { attr: "agi" },
    } });
    const got = buildHeroAttrs(json, new Map([[2, "axe"], [25, "lina"], [7, "bad"], [8, "half"], [9, "missing"]]));
    expect([...got.keys()].sort((a, b) => a - b)).toEqual([-25, -2]);
    expect(got.get(-2)).toEqual({ attr: "str", ranged: false });
    expect(got.get(-25)).toEqual({ attr: "int", ranged: true });
  });
  it("JSON 里写 null 关掉某一块,不写用默认,写了用写的", () => {
    const off = loadScoringConfig('{"heroFit":null,"synergyLift":null,"comboLookahead":null}');
    expect(off.heroFit).toBeUndefined();
    expect(off.synergyLift).toBeUndefined();
    expect(off.comboLookahead).toBeUndefined();
    const dflt = loadScoringConfig("{}");
    expect(dflt.synergyLift).toEqual({ shrinkN: 300 });
    expect(loadScoringConfig('{"comboLookahead":{"discount":0.5,"sigma":6}}').comboLookahead).toEqual({ discount: 0.5, sigma: 6 });
    expect(loadScoringConfig('{"baseWeights":{"base":1,"combo":0.5}}').baseWeights.combo).toBe(0.5);
  });
});
