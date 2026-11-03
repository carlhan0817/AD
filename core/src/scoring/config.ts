// core/src/scoring/config.ts
// 可配置打分:默认参数(细则 §3)+ 从 JSON 加载(回测改参数不重编译)。
import type { ScoringConfig, SignalId } from "@ad/shared/types/scoring";
import { KNOWN_SIGNALS } from "./signals/index";

export function defaultScoringConfig(): ScoringConfig {
  return {
    // 当前打分机制:单技能/英雄强度逐轮递减,搭配逐轮上升,神杖/魔晶按绑定程度与叠加加分。pos 暂时关闭(0)。
    // 数值是占位的起点,直接改仓库根的 scoring_config.json 就行,不用改代码。
    baseWeights: { base: 1.0, synergy: 1.0, aghs: 0, shard: 0, pos: 0 },
    alpha: 0.5, beta: 0.4, sigma: 10, firstRoundSize: 10, topK: 4,
    roundWeights: {
      base: [1.0, 0.8, 0.6, 0.4, 0.2], synergy: [0.2, 0.4, 0.6, 0.8, 1.0],
      aghs: [0.3, 0.35, 0.4, 0.45, 0.5], shard: [0.2, 0.225, 0.25, 0.275, 0.3],
    },
    aghsBinding: {
      aghsBaseline: 0.074, shardBaseline: 0.05, bindMin: 0.02,
      aghsStackBonus: 0.5, shardStackBonus: 0.5, stackCap: 2,
    },
    seatBaseBonus: 0,
    pairFallback: { single: 0.5, similar: 0.5 },
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
    roundWeights: { ...d.roundWeights!, ...parsed.roundWeights },
    aghsBinding: { ...d.aghsBinding!, ...parsed.aghsBinding },
    seatBaseBonus: parsed.seatBaseBonus ?? d.seatBaseBonus,
    pairFallback: parsed.pairFallback ?? d.pairFallback,
  };
}
