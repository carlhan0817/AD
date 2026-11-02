// core/src/scoring/signals/synergy.ts
// 信号②:平均协同(细则 §2②)。S_synergy = (1/|M|)·Σ(WR(c,m)-0.5);|M|=0→0。
// |M| = 本人全部已选件数(含英雄);缺 pair 数据的项按 0 偏移计入分子,分母仍是 |M|。
// 配了 pairFallback 时,缺数据不再算 0:搭配数据里没有的组合,多半是太强、总被人拆开选走导致
// 样本少,所以改用「单技能强度」和「同类技能与 m 的搭配」按比例估一个分。
import type { ScoringContext, Signal } from "@ad/shared/types/scoring";

/** 顺序无关的 pair 键:两 valveId 升序拼接。 */
export function pairKey(a: number, b: number): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** 缺 (c,m) 搭配数据时的估分;比例里某一项没有数据就只用另一项。 */
function estimatePair(ctx: ScoringContext, c: number, m: number): number {
  const fb = ctx.pairFallback;
  if (fb === undefined) return 0;
  const wr = ctx.winrate.get(c)?.winrate ?? null;
  const single = wr === null ? null : wr - 0.5;
  const known = (ctx.similar?.get(c) ?? [])
    .map((s) => ctx.pairWinrate.get(pairKey(s, m)))
    .filter((v): v is number => v !== undefined);
  const similar = known.length === 0 ? null : known.reduce((a, b) => a + (b - 0.5), 0) / known.length;
  const ws = single === null ? 0 : fb.single, wt = similar === null ? 0 : fb.similar;
  if (ws + wt === 0) return 0;
  return ((single ?? 0) * ws + (similar ?? 0) * wt) / (ws + wt);
}

export const synergy: Signal = (ctx, candidate) => {
  const mine = [
    ...(ctx.me.hero === null ? [] : [ctx.me.hero]),
    ...ctx.me.normals,
    ...ctx.me.ultimates,
  ].filter((id) => id !== candidate.valveId);
  if (mine.length === 0) return 0;
  let sum = 0;
  for (const owned of mine) {
    const wr = ctx.pairWinrate.get(pairKey(candidate.valveId, owned));
    sum += wr !== undefined ? wr - 0.5 : estimatePair(ctx, candidate.valveId, owned);
  }
  return sum / mine.length;
};
