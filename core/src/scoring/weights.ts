// core/src/scoring/weights.ts
// 动态权重(细则 §3):权重随顺位 P_curr 变化。把基础 w⁰ 解析成本手实际权重。
import type { ScoringConfig, SignalId } from "@ad/shared/types/scoring";

/** 前置位倾向(衰减):第1手=1,第 firstRoundSize 手→0。 */
export function fFront(pCurr: number, firstRoundSize: number): number {
  return Math.max(0, (firstRoundSize - pCurr) / (firstRoundSize - 1));
}

/** 后置位倾向(增益):第1手=0,第 firstRoundSize 手→1。 */
export function fBack(pCurr: number, firstRoundSize: number): number {
  return Math.max(0, (pCurr - 1) / (firstRoundSize - 1));
}

/** 第几轮(1..5)。10 人 zigzag 选取,每轮 10 手;未知按第 1 轮。 */
export function roundOf(pickIndex: number | null): number {
  if (pickIndex === null) return 1;
  return Math.min(5, Math.max(1, Math.ceil(pickIndex / 10)));
}

/** 解析本手各信号实际权重。pickIndex=null → f_front=f_back=0(无前后置倾向)。
 *  配了 roundWeights 时,base/synergy 按轮次查表(单技能递减、搭配上升),其余维度用基础权重。 */
export function resolveWeights(
  cfg: ScoringConfig,
  pickIndex: number | null,
  seat: number | null = null,
): Partial<Record<SignalId, number>> {
  if (cfg.roundWeights !== undefined) {
    const r = roundOf(pickIndex) - 1;
    const seatFactor = seat === null ? 1 : 1 + (cfg.seatBaseBonus ?? 0) * ((10 - seat) / 9);
    const out: Partial<Record<SignalId, number>> = {};
    for (const id of Object.keys(cfg.baseWeights) as SignalId[]) {
      if (cfg.baseWeights[id]) out[id] = cfg.baseWeights[id];
    }
    out.base = (cfg.roundWeights.base[r] ?? 0) * seatFactor;
    out.synergy = cfg.roundWeights.synergy[r] ?? 0;
    if (cfg.categoryNeed !== undefined) out.need = 1;
    if (cfg.roundWeights.aghs !== undefined) out.aghs = cfg.roundWeights.aghs[r] ?? 0;
    if (cfg.roundWeights.shard !== undefined) out.shard = cfg.roundWeights.shard[r] ?? 0;
    return out;
  }
  const ff = pickIndex === null ? 0 : fFront(pickIndex, cfg.firstRoundSize);
  const fb = pickIndex === null ? 0 : fBack(pickIndex, cfg.firstRoundSize);
  const b = cfg.baseWeights;
  const out: Partial<Record<SignalId, number>> = {};
  // 仅解析基础权重存在且非 0 的维度(关闭的维度不出现)。
  if (b.base)    out.base = b.base * (1 + cfg.alpha * ff);
  if (b.synergy) out.synergy = b.synergy * fb;
  if (b.aghs)    out.aghs = b.aghs * (1 + cfg.beta * fb);
  if (b.shard)   out.shard = b.shard;
  if (b.pos)     out.pos = b.pos;
  // 扩展位维度(snipe/teammate_protect 等):无动态规则时按恒定基础权重透传。
  for (const id of Object.keys(b) as SignalId[]) {
    if (out[id] === undefined && b[id]) out[id] = b[id];
  }
  return out;
}
