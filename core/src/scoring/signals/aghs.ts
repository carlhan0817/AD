// core/src/scoring/signals/aghs.ts
// 信号④:神杖/魔晶增益(细则 §2④)。阶段 0 已把「有杖减无杖胜率差」存为 scepter_gain/shard_gain。
// makeBoundSignal:绑定算法。S = max(0, 增益 − 基准),没有升级的技能为 0;
// 一件神杖/魔晶能同时升级多个技能,所以再乘 (1 + 叠加系数 × min(已选绑定件数, 上限))。
import type { AghsBinding, AghsRow, ScoringContext, Signal } from "@ad/shared/types/scoring";

export const aghs: Signal = (ctx, candidate) => {
  const row = ctx.aghs.get(candidate.valveId);
  return row?.scepterGain ?? 0;
};

export const shard: Signal = (ctx, candidate) => {
  const row = ctx.aghs.get(candidate.valveId);
  return row?.shardGain ?? 0;
};

type Kind = "aghs" | "shard";

function excess(row: AghsRow | undefined, kind: Kind, b: AghsBinding): number {
  if (row === undefined) return 0;
  const has = kind === "aghs" ? row.hasScepter : row.hasShard;
  if (has === false) return 0;
  const gain = kind === "aghs" ? row.scepterGain : row.shardGain;
  if (gain === null) return 0;
  return Math.max(0, gain - (kind === "aghs" ? b.aghsBaseline : b.shardBaseline));
}

/** 我已选的件(英雄 + 技能)里,有几件绑定这种升级。 */
function ownedBound(ctx: ScoringContext, kind: Kind, b: AghsBinding, candidate: number): number {
  const mine = [...(ctx.me.hero === null ? [] : [ctx.me.hero]), ...ctx.me.normals, ...ctx.me.ultimates];
  return mine.filter((id) => id !== candidate && excess(ctx.aghs.get(id), kind, b) >= b.bindMin).length;
}

export function makeBoundSignal(kind: Kind, b: AghsBinding): Signal {
  const bonus = kind === "aghs" ? b.aghsStackBonus : b.shardStackBonus;
  return (ctx, candidate) => {
    const s = excess(ctx.aghs.get(candidate.valveId), kind, b);
    if (s === 0) return 0;
    return s * (1 + bonus * Math.min(ownedBound(ctx, kind, b, candidate.valveId), b.stackCap));
  };
}
