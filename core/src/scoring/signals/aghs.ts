// core/src/scoring/signals/aghs.ts
// 信号④:神杖/魔晶增益(细则 §2④)。阶段 0 已把「有杖减无杖胜率差」存为 scepter_gain/shard_gain。
import type { Signal } from "@ad/shared/types/scoring";

export const aghs: Signal = (ctx, candidate) => {
  const row = ctx.aghs.get(candidate.valveId);
  return row?.scepterGain ?? 0;
};

export const shard: Signal = (ctx, candidate) => {
  const row = ctx.aghs.get(candidate.valveId);
  return row?.shardGain ?? 0;
};
