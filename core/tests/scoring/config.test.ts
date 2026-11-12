// core/tests/scoring/config.test.ts
import { describe, it, expect } from "vitest";
import { buildSignals } from "../../src/scoring/signals/index";
import { defaultScoringConfig, loadScoringConfig } from "../../src/scoring/config";

describe("signal registry", () => {
  it("builds the five spec signals (base/synergy/pos/aghs/shard)", () => {
    const signals = buildSignals(defaultScoringConfig());
    expect(Object.keys(signals)).toEqual(
      expect.arrayContaining(["base", "synergy", "pos", "aghs", "shard"]),
    );
  });
  it("every built signal is a function", () => {
    const signals = buildSignals(defaultScoringConfig());
    for (const id of Object.keys(signals)) {
      expect(typeof signals[id as keyof typeof signals]).toBe("function");
    }
  });
});

describe("scoring config", () => {
  it("default config: round weights and aghs binding on, pos off", () => {
    const cfg = defaultScoringConfig();
    expect(cfg.baseWeights).toEqual({ base: 1.0, synergy: 1.0, aghs: 0, shard: 0, pos: 0, combo: 1.0 });
    // 单技能与搭配全程同权;按英雄修正、搭配按增益、向前看默认都开。
    expect(cfg.roundWeights!.base).toEqual([1, 1, 1, 1, 1]);
    expect(cfg.roundWeights!.synergy).toEqual([1, 1, 1, 1, 1]);
    expect(cfg.heroFit).toEqual({ range: 0.6, attr: 0.4, shrinkN: 2000 });
    expect(cfg.synergyLift).toEqual({ shrinkN: 300 });
    expect(cfg.comboLookahead).toEqual({ discount: 0.7, sigma: 8 });
    expect(cfg.roundWeights!.aghs!.length).toBe(5);
    expect(cfg.aghsBinding!.aghsBaseline).toBe(0.074);
    expect(cfg.alpha).toBe(0.5);
    expect(cfg.beta).toBe(0.4);
    expect(cfg.sigma).toBe(10);
    expect(cfg.topK).toBe(4);
  });
  it("loadScoringConfig parses JSON, rejects unknown signal ids, fills defaults", () => {
    const ok = loadScoringConfig('{"baseWeights":{"base":2},"alpha":0.7}');
    expect(ok.baseWeights.base).toBe(2);
    expect(ok.alpha).toBe(0.7);
    expect(ok.beta).toBe(0.4);   // 缺省回落默认
    expect(ok.sigma).toBe(10);
    expect(() => loadScoringConfig('{"baseWeights":{"nope":1}}')).toThrow();
  });
});
