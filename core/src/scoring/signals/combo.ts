// core/src/scoring/signals/combo.ts
// 信号「向前看」:候选 c 和池里还在的另一件 p 有强组合时,现在拿 c、下一手拿 p 就能凑成。
// 分数 = 最好的那个 p 的「组合增益 × p 能留到我下一手的概率」× 折扣。
// 这样组合的两半都还在池里、我一件都没拿时,组合也会被算进来;
// 而且抢手的那一半得分更高(另一半留得住),不抢手的那一半得分低(另一半多半留不住)——先拿抢手的。
import type { Candidate, ScoringContext, Signal } from "@ad/shared/types/scoring";
import { remainingQuota } from "../../statemachine/quota";
import { myPickNumber } from "../../autoscan/turn_lock";
import { pairLift } from "../strength";

const PICKS_PER_PLAYER = 5;
const PLAYERS = 10;

/** 标准正态分布的累积概率(Abramowitz–Stegun 近似,误差 < 1e-7)。 */
function normalCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804014327 * Math.exp((-z * z) / 2);
  const p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return z >= 0 ? 1 - p : p;
}

/** 我接下来的两手是全局第几手:[拿 c 的那一手, 再下一手]。没有再下一手(最后一手了)返回 null。
 *  不知道选位时,按「再下一手在 10 手之后」估。 */
export function myNextTwoPicks(ctx: ScoringContext): [number, number] | null {
  const now = ctx.pickIndex;
  if (now === null) return null;
  const seat = ctx.seat ?? null;
  if (seat === null) {
    const next = now + PLAYERS;
    return next > PLAYERS * PICKS_PER_PLAYER ? null : [now, next];
  }
  const mine = Array.from({ length: PICKS_PER_PLAYER }, (_, k) => myPickNumber(seat, k + 1));
  const i = mine.findIndex((p) => p >= now);
  return i < 0 || i + 1 >= mine.length ? null : [mine[i], mine[i + 1]];
}

/** 现在还在池里的一件,到全局第 until 手之前还没被别人选走的概率。
 *  把「它在第几手被选走」看成以平均顺位为中心的钟形分布;没有顺位数据按一半算。 */
export function surviveProb(ctx: ScoringContext, id: number, until: number, sigma: number): number {
  const now = ctx.pickIndex;
  const row = ctx.winrate.get(id);
  if (now === null || row === undefined || row.avgPickPosition === null) return 0.5;
  const rate = row.pickRate ?? 1;
  const gone = (t: number): number => rate * normalCdf((t - row.avgPickPosition!) / sigma);
  const stillHere = 1 - gone(now - 0.5);
  if (stillHere <= 1e-6) return 0; // 按数据它早该被选走了,现在还在只是侥幸,别指望
  return Math.max(0, Math.min(1, (1 - gone(until - 0.5)) / stillHere));
}

/** 候选 c 的最好的「下一手搭档」及其得分;没有则 null。 */
export function bestPartner(ctx: ScoringContext, c: Candidate): { partner: number; lift: number; survive: number; value: number } | null {
  const la = ctx.comboLookahead;
  if (la === undefined || ctx.pool === undefined) return null;
  const picks = myNextTwoPicks(ctx);
  if (picks === null) return null;
  // 拿了 c 之后还有配额的类型,搭档才拿得了。
  const quota = remainingQuota(ctx.me);
  quota[c.slotType] -= 1;
  let best: { partner: number; lift: number; survive: number; value: number } | null = null;
  for (const p of ctx.pool) {
    if (p.valveId === c.valveId || quota[p.slotType] <= 0) continue;
    const lift = pairLift(ctx, c.valveId, p.valveId);
    if (lift === null || lift <= 0) continue;
    const survive = surviveProb(ctx, p.valveId, picks[1], la.sigma);
    const value = lift * survive * la.discount;
    if (best === null || value > best.value) best = { partner: p.valveId, lift, survive, value };
  }
  return best;
}

export const combo: Signal = (ctx, candidate) => bestPartner(ctx, candidate)?.value ?? 0;
