// core/src/recognition/pool_resolve.ts
// 把「每格读到了什么」(readPool)收成一局的结论:
//   1. 按组定英雄(groupHeroes);
//   2. 救回「不确定」的格:最像的答案属于本组英雄,或与第二意见(pHash)一致,就采信;
//   3. 只有 2 格同英雄的组(morphling 这类),拿英雄模型的图核对那一个候选。
// 第二意见与图像核对都由调用方注入(可不给),本模块保持纯逻辑、可单测。
import type { CellRead } from "./pool_classify";
import { groupHeroes, type HeroGroup, type OwnerOf } from "./pool_heroes";

export interface ResolveOptions {
  ownerOf: OwnerOf;
  /** 第二意见:第 i 格(readPool 的下标)用另一种办法认出的技能名,认不出给 null。 */
  secondOpinion?: (cellIndex: number) => string | null;
  /** 英雄模型图像核对:位置 heroPos 上的模型是不是 heroId 这个英雄。 */
  verifyHero?: (heroPos: number, heroId: number) => boolean;
}

export interface PoolReading {
  /** 48 格,顺序同 readPool;救回的格 name 已填上。 */
  cells: CellRead[];
  /** 12 组,按英雄位置编号升序。 */
  groups: HeroGroup[];
}

export function resolvePool(cells: CellRead[], opts: ResolveOptions): PoolReading {
  let groups = groupHeroes(cells, opts.ownerOf);
  const heroOfPos = new Map(groups.map((g) => [g.hero, g.heroId]));

  // 救回不确定的格。
  let rescued = false;
  const out = cells.map((c, i) => {
    if (c.empty || c.name !== null || c.guess === null) return c;
    const groupHero = heroOfPos.get(c.slot.hero) ?? null;
    const sameHero = groupHero !== null && opts.ownerOf(c.guess) === groupHero;
    const agreed = opts.secondOpinion?.(i) === c.guess;
    if (!sameHero && !agreed) return c;
    rescued = true;
    return { ...c, name: c.guess };
  });
  // 救回的格可能让某组凑够票数,重新分一次组。
  if (rescued) groups = groupHeroes(out, opts.ownerOf);

  // 只有 2 格同英雄的组:图像核对通过才认定。
  if (opts.verifyHero) {
    groups = groups.map((g) =>
      g.rule === "needs_image_check" && g.candidate !== null && opts.verifyHero!(g.hero, g.candidate)
        ? { ...g, heroId: g.candidate, rule: "image_verified" as const }
        : g);
  }
  return { cells: out, groups };
}
