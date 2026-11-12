// core/src/scoring/signals/synergy.ts
// 信号②:与我已选件的搭配(细则 §2②)。两种算法:
//
// 【按增益,配了 synergyLift 时】每件已选 m 的分 = 组合增益(组合胜率 − 两个单件应有的胜率,
//  按样本量打折,见 strength.ts)。取最配的 synergyTopN 件**相加**:增益本身已经去掉了单件强度,
//  一个强组合就该拿到它的全部增益,不被别的已选件摊薄。
//  没有这个组合的数据时,用「同类技能与 m 的增益」按 pairFallback.similar 打折估;同类也没有就是 0
//  (不知道就不加分,不再用单技能强度去猜——那只会把强的单技能再算一遍)。
//
// 【原始算法,没配 synergyLift 时】S = 平均(WR(c,m) − 0.5),缺数据按 pairFallback 估。保留给旧配置。
import type { ScoringContext, Signal } from "@ad/shared/types/scoring";
import { pairKey } from "../pair_key";
import { pairLift } from "../strength";

export { pairKey };

/** 缺 (c,m) 搭配数据时的估分(原始算法);比例里某一项没有数据就只用另一项。 */
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

/** 缺 (c,m) 搭配数据时的增益估计:同类技能与 m 的增益的平均,再打折。 */
function estimateLift(ctx: ScoringContext, c: number, m: number): number {
  const weight = ctx.pairFallback?.similar ?? 0;
  if (weight === 0) return 0;
  const known = (ctx.similar?.get(c) ?? [])
    .map((s) => pairLift(ctx, s, m))
    .filter((v): v is number => v !== null);
  return known.length === 0 ? 0 : (weight * known.reduce((a, b) => a + b, 0)) / known.length;
}

/** 候选 c 与我每件已选的搭配分(和 mine 一一对应)。 */
export function synergyParts(ctx: ScoringContext, c: number): { owned: number; value: number }[] {
  const mine = [
    ...(ctx.me.hero === null ? [] : [ctx.me.hero]),
    ...ctx.me.normals,
    ...ctx.me.ultimates,
  ].filter((id) => id !== c);
  if (ctx.synergyLift !== undefined) {
    return mine.map((owned) => ({ owned, value: pairLift(ctx, c, owned) ?? estimateLift(ctx, c, owned) }));
  }
  return mine.map((owned) => {
    const wr = ctx.pairWinrate.get(pairKey(c, owned));
    return { owned, value: wr !== undefined ? wr - 0.5 : estimatePair(ctx, c, owned) };
  });
}

export const synergy: Signal = (ctx, candidate) => {
  const each = synergyParts(ctx, candidate.valveId).map((p) => p.value);
  if (each.length === 0) return 0;
  // 配了 synergyTopN 时只算最配的几件:配得差的已选件不再稀释配得好的。
  const used = ctx.synergyTopN === undefined ? each : [...each].sort((a, b) => b - a).slice(0, ctx.synergyTopN);
  const sum = used.reduce((a, b) => a + b, 0);
  return ctx.synergyLift !== undefined ? sum : sum / used.length;
};
