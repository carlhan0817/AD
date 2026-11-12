// core/src/scoring/strength.ts
// 两个基础量,几个信号共用:
//   - 单件强度:胜率 − 0.5;技能在知道我的英雄时,按英雄类型修正。
//   - 组合增益:组合胜率 − 两个单件应有的胜率。两件本来就强时组合胜率自然高,
//     那不是「配」;减掉以后剩下的才是 1+1>2 的部分。
import type { ScoringContext } from "@ad/shared/types/scoring";
import { pairKey } from "./pair_key";

/** 单件强度(胜率 − 0.5),不做修正;没有数据为 null。 */
export function plainStrength(ctx: ScoringContext, id: number): number | null {
  const wr = ctx.winrate.get(id)?.winrate;
  return wr === null || wr === undefined ? null : wr - 0.5;
}

/** 技能在这个英雄上的强度修正量(可正可负);不修正时为 0。 */
export function heroFitDelta(ctx: ScoringContext, abilityId: number, hero: number | null): number {
  const fit = ctx.heroFit;
  if (fit === undefined || hero === null || abilityId < 0) return 0;
  const attrs = ctx.heroAttrs?.get(hero);
  const rows = ctx.attrWinrate?.get(abilityId);
  const overall = ctx.winrate.get(abilityId)?.winrate;
  if (attrs === undefined || rows === undefined || overall === null || overall === undefined) return 0;
  const part = (key: string, weight: number): number => {
    const r = rows[key];
    return r === undefined ? 0 : weight * (r.winrate - overall) * (r.picks / (r.picks + fit.shrinkN));
  };
  return part(attrs.ranged ? "ranged" : "melee", fit.range) + part(attrs.attr, fit.attr);
}

/** 单件强度;技能按 hero(我的英雄,负 valveId)修正。没有数据按 0。 */
export function strength(ctx: ScoringContext, id: number, hero: number | null): number {
  const s = plainStrength(ctx, id);
  return s === null ? 0 : s + heroFitDelta(ctx, id, hero);
}

/** 组合 (a,b) 的增益,按样本量打折;没有这个组合的数据为 null。
 *  英雄 × 技能的组合,技能那一半用「在这个英雄上修正后的强度」,
 *  免得「远程英雄都适合它」这类已经算进单技能强度的东西再算一遍。 */
export function pairLift(ctx: ScoringContext, a: number, b: number): number | null {
  const key = pairKey(a, b);
  const wr = ctx.pairWinrate.get(key);
  if (wr === undefined) return null;
  const hero = a < 0 && b > 0 ? a : b < 0 && a > 0 ? b : null;
  const expected = 0.5 + strength(ctx, a, hero) + strength(ctx, b, hero);
  const n = ctx.pairPicks?.get(key);
  const shrinkN = ctx.synergyLift?.shrinkN ?? 0;
  const trust = n === undefined || shrinkN <= 0 ? 1 : n / (n + shrinkN);
  return (wr - expected) * trust;
}
