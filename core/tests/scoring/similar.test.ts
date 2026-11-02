// core/tests/scoring/similar.test.ts
import { describe, it, expect } from "vitest";
import { buildSimilarMap } from "../../src/scoring/similar";
import { synergy, pairKey } from "../../src/scoring/signals/synergy";
import { resolveWeights, roundOf } from "../../src/scoring/weights";
import { defaultScoringConfig, loadScoringConfig } from "../../src/scoring/config";
import type { ScoringContext } from "@ad/shared/types/scoring";

const lookup = new Map([
  ["stun_a", { valveId: 1, slotType: "normal" }],
  ["stun_b", { valveId: 2, slotType: "normal" }],
  ["heal_c", { valveId: 3, slotType: "normal" }],
  ["stun_ult", { valveId: 4, slotType: "ultimate" }],
]);

describe("buildSimilarMap", () => {
  it("作用标签重合才算同类;通用标签不算;普通与终极不互为同类", () => {
    const m = buildSimilarMap({
      stun_a: ["hard_cc", "nuke", "aoe"], stun_b: ["hard_cc", "nuke", "mana_hungry"],
      heal_c: ["sustain_self", "aoe"], stun_ult: ["hard_cc", "nuke"],
    }, lookup);
    expect(m.get(1)).toEqual([2]);
    expect(m.get(3)).toEqual([]);
  });
});

function ctx(over: Partial<ScoringContext>): ScoringContext {
  return {
    me: { row: 0, hero: null, normals: [9], ultimates: [] }, pickIndex: 20,
    winrate: new Map([[1, { winrate: 0.56, avgPickPosition: null }]]),
    pairWinrate: new Map(), aghs: new Map(), ...over,
  };
}
const c = { valveId: 1, slotType: "normal" as const };

describe("synergy 缺搭配数据时的估分", () => {
  it("有搭配数据时用真实数据,不估分", () => {
    const pairWinrate = new Map([[pairKey(1, 9), 0.6]]);
    expect(synergy(ctx({ pairWinrate, pairFallback: { single: 1, similar: 1 } }), c)).toBeCloseTo(0.1, 6);
  });
  it("没配 pairFallback:缺数据按 0", () => {
    expect(synergy(ctx({}), c)).toBe(0);
  });
  it("单技能强度 + 同类技能的搭配,按比例混合", () => {
    const pairWinrate = new Map([[pairKey(2, 9), 0.54]]);
    const v = synergy(ctx({ pairWinrate, similar: new Map([[1, [2]]]), pairFallback: { single: 0.5, similar: 0.5 } }), c);
    expect(v).toBeCloseTo((0.06 + 0.04) / 2, 6);
  });
  it("没有同类数据时只用单技能强度", () => {
    expect(synergy(ctx({ pairFallback: { single: 0.5, similar: 0.5 } }), c)).toBeCloseTo(0.06, 6);
  });
});

describe("按轮次的权重", () => {
  const cfg = defaultScoringConfig();
  it("每轮 10 手,共 5 轮", () => {
    expect([1, 10, 11, 20, 21, 41, 50].map(roundOf)).toEqual([1, 1, 2, 2, 3, 5, 5]);
    expect(roundOf(null)).toBe(1);
  });
  it("单技能逐轮递减,搭配逐轮上升", () => {
    const w = [5, 15, 25, 35, 45].map((p) => resolveWeights(cfg, p));
    for (let i = 1; i < 5; i++) {
      expect(w[i].base!).toBeLessThan(w[i - 1].base!);
      expect(w[i].synergy!).toBeGreaterThan(w[i - 1].synergy!);
    }
  });
  it("默认关闭的维度不出现", () => {
    expect(resolveWeights(cfg, 5).pos).toBeUndefined();
    expect(resolveWeights(cfg, 5).aghs).toBeUndefined();
  });
  it("选位修正(预留):第一个选加满,第十个不加,默认 0 不影响", () => {
    const c2 = { ...cfg, seatBaseBonus: 0.5 };
    expect(resolveWeights(c2, 5, 1).base).toBeCloseTo(1.5, 6);
    expect(resolveWeights(c2, 5, 10).base).toBeCloseTo(1.0, 6);
    expect(resolveWeights(c2, 5, null).base).toBeCloseTo(1.0, 6);
    expect(resolveWeights(cfg, 5, 1).base).toBeCloseTo(1.0, 6);
  });
  it("loadScoringConfig 读新字段,缺的用默认", () => {
    const c3 = loadScoringConfig('{"roundWeights":{"base":[5,4,3,2,1],"synergy":[1,2,3,4,5]},"seatBaseBonus":0.2}');
    expect(c3.roundWeights!.base[0]).toBe(5);
    expect(c3.seatBaseBonus).toBe(0.2);
    expect(c3.pairFallback).toEqual({ single: 0.5, similar: 0.5 });
  });
});
