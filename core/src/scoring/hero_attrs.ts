// core/src/scoring/hero_attrs.ts
// 英雄的主属性和近战/远程表(models/heroes/hero_attrs.json,由 main/scripts/build_hero_attrs.ts
// 从本机 Dota 生成)。文件按英雄的 picture 名(reference.db 的 heroes.picture)做键。
import type { HeroAttr } from "@ad/shared/types/scoring";

const ATTRS = new Set(["str", "agi", "int", "uni"]);

/** 解析 JSON,并按「英雄 id → picture 名」换成「英雄 valveId(负数)→ 属性」。认不出的条目跳过。 */
export function buildHeroAttrs(json: string, pictureOf: ReadonlyMap<number, string>): Map<number, HeroAttr> {
  const heroes = (JSON.parse(json) as { heroes?: Record<string, { attr?: unknown; ranged?: unknown }> }).heroes ?? {};
  const out = new Map<number, HeroAttr>();
  for (const [heroId, picture] of pictureOf) {
    const h = heroes[picture];
    if (h === undefined || typeof h.attr !== "string" || !ATTRS.has(h.attr) || typeof h.ranged !== "boolean") continue;
    out.set(-heroId, { attr: h.attr as HeroAttr["attr"], ranged: h.ranged });
  }
  return out;
}
