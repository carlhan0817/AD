// core/tests/scoring/aghs_binding.test.ts
import { describe, it, expect } from "vitest";
import { makeBoundSignal } from "../../src/scoring/signals/aghs";
import { resolveWeights } from "../../src/scoring/weights";
import { defaultScoringConfig, loadScoringConfig } from "../../src/scoring/config";
import { scoreCandidates } from "../../src/scoring/score";
import type { AghsRow, ScoringContext } from "@ad/shared/types/scoring";

const B = defaultScoringConfig().aghsBinding!;
const row = (g: number, has = true): AghsRow => ({ scepterGain: g, shardGain: g, hasScepter: has, hasShard: has });
const aghsMap = new Map<number, AghsRow>([
  [1, row(0.177)],        // 强绑定(候选)
  [2, row(0.074)],        // 正好等于基准
  [3, row(0.147, false)], // 增益高但没有神杖升级
  [10, row(0.12)], [11, row(0.11)], [12, row(0.13)], // 已选的绑定件
  [13, row(0.08)],        // 超出基准但不够 bindMin
  [-5, { scepterGain: 0.12, shardGain: 0.06 }],      // 英雄:没有升级标记
]);
function ctx(normals: number[], hero: number | null = null): ScoringContext {
  return { me: { row: 0, hero, normals, ultimates: [] }, pickIndex: 25, winrate: new Map(), pairWinrate: new Map(), aghs: aghsMap };
}
const c = (valveId: number) => ({ valveId, slotType: "normal" as const });
const S = makeBoundSignal("aghs", B);

describe("神杖绑定信号", () => {
  it("只算超出基准的部分", () => {
    expect(S(ctx([]), c(1))).toBeCloseTo(0.103, 6);
    expect(S(ctx([]), c(2))).toBe(0);
  });
  it("没有升级的技能为 0,即使增益很高", () => {
    expect(S(ctx([]), c(3))).toBe(0);
  });
  it("已有 1 件绑定:× 1.5(文档例子),再乘第 3 轮权重 0.4 = 0.062", () => {
    const v = S(ctx([10]), c(1));
    expect(v).toBeCloseTo(0.1545, 6);
    expect(v * resolveWeights(defaultScoringConfig(), 25).aghs!).toBeCloseTo(0.0618, 4);
  });
  it("叠加最多算 2 件", () => {
    expect(S(ctx([10, 11, 12]), c(1))).toBeCloseTo(0.103 * 2, 6);
  });
  it("超出不到 bindMin 的已选件不算绑定", () => {
    expect(S(ctx([13]), c(1))).toBeCloseTo(0.103, 6);
  });
  it("已选的英雄也算一件;候选英雄没有升级标记时照常计算", () => {
    expect(S(ctx([], -5), c(1))).toBeCloseTo(0.103 * 1.5, 6);
    expect(S(ctx([]), { valveId: -5, slotType: "hero" })).toBeCloseTo(0.046, 6);
  });
  it("候选本身不绑定时,手上绑定再多也是 0", () => {
    expect(S(ctx([10, 11]), c(2))).toBe(0);
  });
  it("魔晶用自己的基准,和神杖分开算", () => {
    expect(makeBoundSignal("shard", B)(ctx([]), c(1))).toBeCloseTo(0.127, 6);
  });
});

describe("接入总分", () => {
  it("默认配置下神杖、魔晶都进总分,并逐轮按表取权重", () => {
    const cfg = defaultScoringConfig();
    expect([5, 45].map((p) => resolveWeights(cfg, p).aghs)).toEqual([0.3, 0.5]);
    expect([5, 45].map((p) => resolveWeights(cfg, p).shard)).toEqual([0.2, 0.3]);
    const [r] = scoreCandidates([c(1)], ctx([]), cfg);
    expect(r.breakdown.aghs).toBeCloseTo(0.103 * 0.4, 6);
  });
  it("配置文件只写部分参数时,其余用默认值", () => {
    const cfg = loadScoringConfig('{"aghsBinding":{"stackCap":3},"roundWeights":{"aghs":[1,1,1,1,1]}}');
    expect(cfg.aghsBinding!.stackCap).toBe(3);
    expect(cfg.aghsBinding!.aghsBaseline).toBe(0.074);
    expect(cfg.roundWeights!.aghs![0]).toBe(1);
    expect(cfg.roundWeights!.base[0]).toBe(1.0);
  });
});
