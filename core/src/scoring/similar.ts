// core/src/scoring/similar.ts
// 同类技能:按技能标签(models/tags/ability_tags.json,源自 Tiarin-Hino/ability-draft-plus)判断。
// 只看描述「这技能是干什么的」的标签,且同为普通或同为终极,标签重合度够高才算同类。
import { readFileSync } from "node:fs";

// 通用/机制类标签(aoe、能否驱散、耗蓝等)不说明技能的作用,不参与比较。
const ROLE_TAGS = new Set([
  "hard_cc", "soft_cc", "setup_cc", "nuke", "waveclear", "steroid", "sustain_self", "mobility",
  "initiation", "passive_value", "farm_tool", "save_ally", "teamfight_ult", "reposition_enemy",
  "reposition_ally", "channeled", "amp_physical", "amp_magical", "amp_all", "spell_steroid",
  "summon", "team_aura", "purge_enemy", "dispel_ally", "dispel_self", "knockback",
]);

/** 标签重合度(交集/并集)达到这个数才算同类。 */
export const SIMILAR_MIN_OVERLAP = 0.5;

export type AbilityTags = Record<string, string[]>;

export function loadAbilityTags(path: string): AbilityTags {
  const raw = JSON.parse(readFileSync(path, "utf-8")) as { abilities: Record<string, { tags?: string[] }> };
  const out: AbilityTags = {};
  for (const [name, v] of Object.entries(raw.abilities)) out[name] = v.tags ?? [];
  return out;
}

/** 建「技能 valveId → 同类技能 valveId[]」表。 */
export function buildSimilarMap(
  tags: AbilityTags,
  lookup: ReadonlyMap<string, { valveId: number; slotType: string }>,
): Map<number, number[]> {
  const items = Object.entries(tags).flatMap(([name, t]) => {
    const info = lookup.get(name);
    const role = new Set(t.filter((x) => ROLE_TAGS.has(x)));
    return info === undefined || role.size === 0 ? [] : [{ id: info.valveId, slot: info.slotType, role }];
  });
  const out = new Map<number, number[]>();
  for (const a of items) {
    const similar: number[] = [];
    for (const b of items) {
      if (a.id === b.id || a.slot !== b.slot) continue;
      let both = 0;
      for (const t of a.role) if (b.role.has(t)) both++;
      if (both / (a.role.size + b.role.size - both) >= SIMILAR_MIN_OVERLAP) similar.push(b.id);
    }
    out.set(a.id, similar);
  }
  return out;
}
