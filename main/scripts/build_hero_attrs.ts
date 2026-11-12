// main/scripts/build_hero_attrs.ts
// 生成 models/heroes/hero_attrs.json:每个英雄的主属性和近战/远程。
// 数据来自本机 Dota 资源包里的英雄定义(scripts/npc/heroes/npc_dota_hero_*.txt),只读。
// 游戏更新出了新英雄后重跑一次:
//   npx tsx main/scripts/build_hero_attrs.ts ["<dota 2 beta 文件夹>"]
import { closeSync, mkdirSync, openSync, readFileSync, readSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findDotaDir } from "../src/gsi/dota_path";
import { vpkArchiveName, vpkEntriesIn } from "../src/assets/vpk";

const ATTR: Record<string, string> = {
  DOTA_ATTRIBUTE_STRENGTH: "str", DOTA_ATTRIBUTE_AGILITY: "agi",
  DOTA_ATTRIBUTE_INTELLECT: "int", DOTA_ATTRIBUTE_ALL: "uni",
};

const dotaDir = process.argv[2] ?? await findDotaDir();
if (dotaDir === null || dotaDir === undefined) throw new Error("没找到 Dota 2,请把 dota 2 beta 文件夹作为参数传进来");
const pak = join(dotaDir, "game", "dota");
const entries = vpkEntriesIn(readFileSync(join(pak, "pak01_dir.vpk")), "txt", "scripts/npc/heroes");

const out: Record<string, { attr: string; ranged: boolean }> = {};
const skipped: string[] = [];
for (const [name, e] of [...entries].sort((a, b) => a[0].localeCompare(b[0]))) {
  if (!name.startsWith("npc_dota_hero_") || name === "npc_dota_hero_base") continue;
  const fd = openSync(join(pak, vpkArchiveName(e.archive)), "r");
  const buf = Buffer.alloc(e.length);
  readSync(fd, buf, 0, e.length, e.offset);
  closeSync(fd);
  const text = buf.toString("utf8");
  const attr = ATTR[/"AttributePrimary"\s+"([^"]+)"/.exec(text)?.[1] ?? ""];
  const attack = /"AttackCapabilities"\s+"([^"]+)"/.exec(text)?.[1];
  if (attr === undefined || attack === undefined) { skipped.push(name); continue; }
  out[name.slice("npc_dota_hero_".length)] = { attr, ranged: attack.includes("RANGED") };
}

const file = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "models", "heroes", "hero_attrs.json");
mkdirSync(dirname(file), { recursive: true });
writeFileSync(file, JSON.stringify({ source: "Dota 2 scripts/npc/heroes (本机资源包)", heroes: out }, null, 1) + "\n");
console.log(`写了 ${Object.keys(out).length} 个英雄到 ${file}${skipped.length ? `;跳过(没有属性字段):${skipped.join(", ")}` : ""}`);
