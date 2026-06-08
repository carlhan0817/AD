// renderer/src/config_controls.ts
// ScoringConfig ↔ UI 控件。编辑 baseWeights 各项 + 动态系数 alpha/beta/sigma + topK。
import type { ScoringConfig, SignalId } from "@ad/shared/types/scoring";

export interface WeightControl { id: SignalId; weight: number; }
export interface ConfigControls {
  weights: WeightControl[];
  alpha: number;
  beta: number;
  sigma: number;
  firstRoundSize: number;
  topK: number;
}

export function configToControls(cfg: ScoringConfig): ConfigControls {
  return {
    weights: (Object.entries(cfg.baseWeights) as [SignalId, number][]).map(([id, weight]) => ({ id, weight })),
    alpha: cfg.alpha, beta: cfg.beta, sigma: cfg.sigma,
    firstRoundSize: cfg.firstRoundSize, topK: cfg.topK,
  };
}

export function controlsToConfig(c: ConfigControls): ScoringConfig {
  const baseWeights: Partial<Record<SignalId, number>> = {};
  for (const w of c.weights) baseWeights[w.id] = Math.max(0, w.weight); // UI 不允许负权重
  return {
    baseWeights,
    alpha: c.alpha, beta: c.beta, sigma: c.sigma,
    firstRoundSize: c.firstRoundSize, topK: c.topK,
  };
}
