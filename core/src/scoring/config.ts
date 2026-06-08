// core/src/scoring/config.ts
// 可配置打分:默认参数(细则 §3)+ 从 JSON 加载(回测改参数不重编译)。
import type { ScoringConfig, SignalId } from "@ad/shared/types/scoring";
import { KNOWN_SIGNALS } from "./signals/index";

export function defaultScoringConfig(): ScoringConfig {
  return {
    baseWeights: { base: 1.0, synergy: 1.5, aghs: 0.8, shard: 0.5, pos: 0.6 },
    alpha: 0.5, beta: 0.4, sigma: 10, firstRoundSize: 10, topK: 4,
  };
}

/** 解析 JSON config;校验 baseWeights 的 key 都是已知 SignalId;缺省字段回落默认。 */
export function loadScoringConfig(json: string): ScoringConfig {
  const parsed = JSON.parse(json) as Partial<ScoringConfig>;
  const d = defaultScoringConfig();
  const baseWeights = parsed.baseWeights ?? d.baseWeights;
  for (const id of Object.keys(baseWeights)) {
    if (!KNOWN_SIGNALS.includes(id as SignalId)) {
      throw new Error(`unknown signal id in scoring config: ${id}`);
    }
  }
  return {
    baseWeights,
    alpha: parsed.alpha ?? d.alpha,
    beta: parsed.beta ?? d.beta,
    sigma: parsed.sigma ?? d.sigma,
    firstRoundSize: parsed.firstRoundSize ?? d.firstRoundSize,
    topK: parsed.topK ?? d.topK,
  };
}
