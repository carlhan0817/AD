// core/src/scoring/signals/base.ts
// 信号①:单技能/英雄基础胜率(细则 §2①)。S_base = WR(c) - 0.5。
import type { Signal } from "@ad/shared/types/scoring";

export const base: Signal = (ctx, candidate) => {
  const row = ctx.winrate.get(candidate.valveId);
  if (!row || row.winrate === null) return 0;
  return row.winrate - 0.5;
};
