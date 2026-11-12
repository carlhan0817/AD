// core/src/scoring/config.ts
// 可配置打分:默认参数(细则 §3)+ 从 JSON 加载(回测改参数不重编译)。
import type { ScoringConfig, SignalId } from "@ad/shared/types/scoring";
import { KNOWN_SIGNALS } from "./signals/index";

export function defaultScoringConfig(): ScoringConfig {
  return {
    // 当前打分机制:单技能强度(按我的英雄修正)+ 与已选件的组合增益 + 向前看池里的组合,
    // 神杖/魔晶按绑定程度与叠加加分。pos 暂时关闭(0)。
    // 数值是占位的起点,直接改仓库根的 scoring_config.json 就行,不用改代码。
    baseWeights: { base: 1.0, synergy: 1.0, aghs: 0, shard: 0, pos: 0, combo: 1.0 },
    alpha: 0.5, beta: 0.4, sigma: 10, firstRoundSize: 10, topK: 4,
    roundWeights: {
      // 单技能和搭配全程同等看待:搭配按增益算以后已经不含单技能强度,一个强组合在第 1 轮和第 5 轮
      // 值一样多;「前期拿强单技能、后期补组合」由数据自己体现(前期没有已选件,搭配分自然是 0)。
      base: [1, 1, 1, 1, 1], synergy: [1, 1, 1, 1, 1],
      aghs: [0.3, 0.35, 0.4, 0.45, 0.5], shard: [0.2, 0.225, 0.25, 0.275, 0.3],
    },
    categoryNeed: {
      hero: [0, 0, 0.01, 0.02, 0.04],
      ultimate: [0, 0, 0.01, 0.02, 0.04],
      normal: [0, 0, 0, 0, 0],
    },
    aghsBinding: {
      aghsBaseline: 0.074, shardBaseline: 0.05, bindMin: 0.02,
      aghsStackBonus: 0.5, shardStackBonus: 0.5, stackCap: 2,
    },
    seatBaseBonus: 0,
    synergyTopN: 2,
    pairFallback: { single: 0.5, similar: 0.5 },
    // 单技能强度按我的英雄修正:近战/远程占六成,主属性占四成;样本少于 2000 的那一类打对折以上。
    heroFit: { range: 0.6, attr: 0.4, shrinkN: 2000 },
    // 搭配按增益算;样本 300 的组合信一半。
    synergyLift: { shrinkN: 300 },
    // 向前看池里的组合:打七折;一件东西被选走的顺位大约在平均顺位前后 8 手内。
    comboLookahead: { discount: 0.7, sigma: 8 },
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
    categoryNeed: { ...d.categoryNeed!, ...parsed.categoryNeed },
    seatBaseBonus: parsed.seatBaseBonus ?? d.seatBaseBonus,
    synergyTopN: parsed.synergyTopN ?? d.synergyTopN,
    pairFallback: parsed.pairFallback ?? d.pairFallback,
    // 这三项在 JSON 里写 null 就是关掉(回到旧算法);不写用默认。
    heroFit: parsed.heroFit === null ? undefined : parsed.heroFit ?? d.heroFit,
    synergyLift: parsed.synergyLift === null ? undefined : parsed.synergyLift ?? d.synergyLift,
    comboLookahead: parsed.comboLookahead === null ? undefined : parsed.comboLookahead ?? d.comboLookahead,
  };
}
