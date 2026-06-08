// core/src/scoring/signals/synergy.ts
// 信号②:平均协同(细则 §2②)。S_synergy = (1/|M|)·Σ(WR(c,m)-0.5);|M|=0→0。
// |M| = 本人全部已选件数(含英雄);缺 pair 数据的项按 0 偏移计入分子,分母仍是 |M|。
import type { Signal } from "@ad/shared/types/scoring";

/** 顺序无关的 pair 键:两 valveId 升序拼接。 */
export function pairKey(a: number, b: number): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
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
    if (wr !== undefined) sum += wr - 0.5; // 缺数据 → 贡献 0,但仍计入 |M| 分母
  }
  return sum / mine.length;
};
