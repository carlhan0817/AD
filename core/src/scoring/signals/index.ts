// core/src/scoring/signals/index.ts
// 信号注册表:按 config 构建(pos 需 config.sigma)。新增维度 = 在此注册一个 signal。
import type { ScoringConfig, Signal, SignalId } from "@ad/shared/types/scoring";
import { base } from "./base";
import { synergy } from "./synergy";
import { makePosSignal } from "./pos";
import { aghs, makeBoundSignal, shard } from "./aghs";
import { roundOf } from "../weights";

/** 已知 SignalId 全集(用于 config 校验)。 */
export const KNOWN_SIGNALS: SignalId[] = [
  "base", "synergy", "pos", "aghs", "shard", "need", "snipe", "teammate_protect",
];

/** 用 config 构建 signal 集(pos 注入 σ)。扩展位实现后在此加。 */
export function buildSignals(cfg: ScoringConfig): Partial<Record<SignalId, Signal>> {
  return {
    base,
    synergy,
    pos: makePosSignal(cfg.sigma),
    aghs: cfg.aghsBinding ? makeBoundSignal("aghs", cfg.aghsBinding) : aghs,
    shard: cfg.aghsBinding ? makeBoundSignal("shard", cfg.aghsBinding) : shard,
    // 配额满的类型已被硬过滤剔除,所以这里拿到的都是「还缺」的类型。
    need: (ctx, c) => cfg.categoryNeed?.[c.slotType]?.[roundOf(ctx.pickIndex) - 1] ?? 0,
    // snipe / teammate_protect:实现后在此注册 + 给基础权重即可生效。
  };
}
