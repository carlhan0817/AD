// core/src/recognition/pool_heroes.ts
// 按组定英雄。一组 = 英雄模型旁边的 3 个普通技能格 + 终极区对应的 1 个终极格(见 pool_slots.ts)。
// 不进技能征召的技能,其空位会被别的英雄的技能填上,所以一组里可能有 1–2 格「外人」:
//   少终极(rubick/meepo/ogremagi/arc_warden/invoker)→ 终极格是外人;
//   少 1 个普通技能(obsidian_destroyer/crystalmaiden/...)→ 1 个普通格是外人;
//   两样都少(morphling)→ 1 个普通格 + 终极格都是外人。
// 普通技能格离模型最近,是主要依据;终极格只当佐证。
import type { CellRead } from "./pool_classify";

export type HeroRule =
  | "three_standard"             // 3 个普通技能同英雄 → 直接认定
  | "two_standard_plus_ultimate" // 2 个普通技能 + 终极同英雄 → 认定
  | "needs_image_check"          // 只有 2 格同英雄 → 要拿英雄模型的图核对这个候选
  | "image_verified"             // 上一档经图像核对通过(由 resolvePool 标记)
  | "unknown";                   // 连 2 格都凑不齐

export interface HeroGroup {
  /** 英雄位置编号 0..11。 */
  hero: number;
  /** 认定的英雄 hero_id;未认定为 null。 */
  heroId: number | null;
  /** 待核对的候选(rule=needs_image_check 时有值;已认定时等于 heroId)。 */
  candidate: number | null;
  rule: HeroRule;
  /** 该组的格子:slot 1..3 的普通格在前,终极格在最后。 */
  cells: CellRead[];
}

/** 技能 shortName → 所属英雄 hero_id(查不到返回 null)。 */
export type OwnerOf = (abilityName: string) => number | null;

/** 把 48 格按英雄位置分成 12 组并按三档规则定英雄。只看已采信的格(name 非 null)。 */
export function groupHeroes(cells: CellRead[], ownerOf: OwnerOf): HeroGroup[] {
  const byHero = new Map<number, CellRead[]>();
  for (const c of cells) {
    const g = byHero.get(c.slot.hero) ?? [];
    g.push(c);
    byHero.set(c.slot.hero, g);
  }
  const groups: HeroGroup[] = [];
  for (const hero of [...byHero.keys()].sort((a, b) => a - b)) {
    const group = byHero.get(hero)!;
    const standard = group.filter((c) => c.slot.zone === "standard").sort((a, b) => a.slot.slot - b.slot.slot);
    const ultimate = group.filter((c) => c.slot.zone === "ultimate");
    const owner = (c: CellRead): number | null => (c.name === null ? null : ownerOf(c.name));

    // 普通技能格里出现最多的英雄。
    const votes = new Map<number, number>();
    for (const c of standard) {
      const o = owner(c);
      if (o !== null) votes.set(o, (votes.get(o) ?? 0) + 1);
    }
    let top: number | null = null, topN = 0;
    for (const [o, n] of votes) if (n > topN) { top = o; topN = n; }
    const ultOwner = ultimate.length > 0 ? owner(ultimate[0]) : null;

    let heroId: number | null = null, candidate: number | null = null, rule: HeroRule = "unknown";
    if (top !== null && topN >= 3) {
      heroId = candidate = top; rule = "three_standard";
    } else if (top !== null && topN === 2 && ultOwner === top) {
      heroId = candidate = top; rule = "two_standard_plus_ultimate";
    } else if (top !== null && topN === 2) {
      candidate = top; rule = "needs_image_check";
    } else if (ultOwner !== null && votes.get(ultOwner) === 1) {
      // 1 个普通技能 + 终极同英雄:也是「只有 2 格」,同样要核对。
      candidate = ultOwner; rule = "needs_image_check";
    }
    groups.push({ hero, heroId, candidate, rule, cells: [...standard, ...ultimate] });
  }
  return groups;
}
