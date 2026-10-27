// core/src/db/ability_lookup.ts
// 技能 shortName → {valveId, 槽位类型, 所属英雄}。分类器给出的是 shortName,
// 打分要 valveId,按组定英雄要所属英雄,都从 reference.db 一次性读出来建表。
import type { Queryable } from "@ad/shared/types/db";

export interface AbilityInfo {
  valveId: number;
  slotType: "normal" | "ultimate";
  /** 所属英雄的 hero_id;数据源没给且无补丁时为 null。 */
  heroId: number | null;
}

// 数据源(windrun)没给所属英雄的技能,按英雄 short_name 手工补上。
// 这三个是对应英雄在技能征召里的替代技能,不补的话该英雄那组永远凑不齐 3 个普通技能。
export const OWNER_OVERRIDES: Readonly<Record<string, string>> = {
  tinker_deploy_turrets: "tinker",
  venomancer_snakebite: "venomancer",
  dragon_knight_wyrms_wrath: "dragonknight",
};

export function buildAbilityLookup(db: Queryable): Map<string, AbilityInfo> {
  const heroIdByShort = new Map<string, number>();
  for (const r of db.all("SELECT hero_id, short_name FROM heroes") as { hero_id: number; short_name: string }[]) {
    heroIdByShort.set(r.short_name, r.hero_id);
  }
  const out = new Map<string, AbilityInfo>();
  const rows = db.all(
    "SELECT short_name, valve_id, slot_type, owner_hero_id FROM abilities WHERE slot_type IN ('normal','ultimate')",
  ) as { short_name: string; valve_id: number; slot_type: "normal" | "ultimate"; owner_hero_id: number | null }[];
  for (const r of rows) {
    const override = OWNER_OVERRIDES[r.short_name];
    const heroId = r.owner_hero_id ?? (override !== undefined ? heroIdByShort.get(override) ?? null : null);
    out.set(r.short_name, { valveId: r.valve_id, slotType: r.slot_type, heroId });
  }
  return out;
}
