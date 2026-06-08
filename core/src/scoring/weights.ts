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

/** 解析本手各信号实际权重。pickIndex=null → f_front=f_back=0(无前后置倾向)。 */
export function resolveWeights(
  cfg: ScoringConfig,
  pickIndex: number | null,
): Partial<Record<SignalId, number>> {
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
