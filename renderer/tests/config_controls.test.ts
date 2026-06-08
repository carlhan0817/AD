// renderer/tests/config_controls.test.ts
import { describe, it, expect } from "vitest";
import { configToControls, controlsToConfig } from "../src/config_controls";
import { defaultScoringConfig } from "@ad/core/scoring/config";

describe("config controls", () => {
  it("round-trips the default config through controls (weights + coefficients)", () => {
    const cfg = defaultScoringConfig();
    expect(controlsToConfig(configToControls(cfg))).toEqual(cfg);
  });
  it("clamps negative base weights to 0 (no negative weighting via UI)", () => {
    const ctrls = configToControls(defaultScoringConfig());
    ctrls.weights = ctrls.weights.map((w) => (w.id === "base" ? { ...w, weight: -3 } : w));
    expect(controlsToConfig(ctrls).baseWeights.base).toBe(0);
  });
  it("carries alpha/beta/sigma/topK through", () => {
    const ctrls = configToControls(defaultScoringConfig());
    ctrls.alpha = 0.9;
    expect(controlsToConfig(ctrls).alpha).toBe(0.9);
  });
});
