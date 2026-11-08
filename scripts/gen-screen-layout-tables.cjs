// 一次性生成 core/src/recognition/screen_layout_tables.ts(16:10、3:2、4:3、5:4 的上游初值表)。
// 用法(仓库根):node scripts/gen-screen-layout-tables.cjs layout_coordinates.json core/tests/recognition/fixtures/layout_1080p_before.json core/src/recognition/screen_layout_tables.ts
// 第二个参数是我们 1080p 四组位置(改动前四个函数在 1920×1080 下的输出),用来定格子顺序和「我们相对上游 1080p 的固定差」。
const fs = require("fs");
const [upPath, beforePath, outPath] = process.argv.slice(2);
const UP = JSON.parse(fs.readFileSync(upPath, "utf8")).resolutions;
const OURS = JSON.parse(fs.readFileSync(beforePath, "utf8"))["1920x1080"];

function upGroups(res) {
  const u = UP[res];
  const pool = OURS.poolSlots.map((s) => {
    const c = s.zone === "ultimate"
      ? u.ultimate_slots_coords.find((c) => c.hero_order === s.hero)
      : u.standard_slots_coords.find((c) => c.hero_order === s.hero && c.ability_order === s.slot);
    return { x: c.x, y: c.y, w: c.width, h: c.height, zone: s.zone, hero: s.hero, slot: s.slot };
  });
  const heroes = OURS.heroCellRects.map((h) => {
    const c = u.models_coords.find((m) => m.hero_order === h.order);
    return { x: c.x, y: c.y, w: c.width, h: c.height, order: h.order, side: h.side };
  });
  const cards = OURS.playerCards.map((p) => {
    const c = u.heroes_coords.find((m) => m.hero_order === p.row);
    return { x: c.x, y: c.y, w: u.heroes_params.width, h: u.heroes_params.height, row: p.row };
  });
  const cardSlots = [];
  for (let row = 0; row < 10; row++) {
    const mine = u.selected_abilities_coords.filter((c) => c.hero_order === row);
    const ordered = [...mine.filter((c) => !c.is_ultimate), ...mine.filter((c) => c.is_ultimate)];
    if (ordered.length !== 4) throw new Error(res + " row " + row);
    for (const c of ordered) cardSlots.push({ x: c.x, y: c.y, w: u.selected_abilities_params.width, h: u.selected_abilities_params.height, row, ultimate: !!c.is_ultimate });
  }
  return { pool, heroes, cards, cardSlots };
}

const up1080 = upGroups("1920x1080");
const offsets = {};
for (const g of ["pool", "heroes", "cards", "cardSlots"]) {
  const ours = { pool: OURS.poolSlots, heroes: OURS.heroCellRects, cards: OURS.playerCards, cardSlots: OURS.cardSlots }[g];
  // 校验对应关系:非位置字段必须一致
  ours.forEach((o, i) => { for (const k of Object.keys(o)) if (!["x", "y", "w", "h"].includes(k) && o[k] !== up1080[g][i][k]) throw new Error(g + i + k); });
  const n = ours.length;
  offsets[g] = {
    dx: ours.reduce((a, o, i) => a + o.x - up1080[g][i].x, 0) / n,
    dy: ours.reduce((a, o, i) => a + o.y - up1080[g][i].y, 0) / n,
  };
}
console.error("1080p 偏移(我们 − 上游):", JSON.stringify(offsets));

const targets = [["16:10", "LAYOUT_16_10", 1920, 1200], ["3:2", "LAYOUT_3_2", 1440, 960], ["4:3", "LAYOUT_4_3", 1440, 1080], ["5:4", "LAYOUT_5_4", 1280, 1024]];
const fmt = (o) => "    " + JSON.stringify(o).replace(/"(\w+)":/g, "$1: ").replace(/,/g, ", ").replace(/^\{/, "{ ").replace(/\}$/, " }");
let out = `// core/src/recognition/screen_layout_tables.ts
// 16:10、3:2、4:3、5:4 四类比例的位置表(初值,未用真机截图验证:verified=false)。
// 由 scripts/gen-screen-layout-tables.cjs 一次性生成,不要手改:取仓库根 layout_coordinates.json(源自 Tiarin-Hino/ability-draft-plus,ISC)
// 对应分辨率(1920×1200、1440×960、1440×1080、1280×1024)的数据,按我们的格子顺序重排,
// 再给每组加上「我们的 1080p 表相对上游 1080p 的固定差」×(基准高/1080)。
// 目前只有英雄格有这个差(真机修正 dy=-4),技能池、玩家卡、已选格与上游 1080p 相同,差为 0。
// 等用户截了这几种比例的真实图再按识别结果标定。
import type { LayoutTable } from "./screen_layout";

`;
for (const [cls, name, bw, bh] of targets) {
  const g = upGroups(`${bw}x${bh}`);
  const k = bh / 1080;
  const shift = (arr, off) => arr.map((r) => ({ ...r, x: r.x + Math.round(off.dx * k), y: r.y + Math.round(off.dy * k) }));
  const t = { pool: shift(g.pool, offsets.pool), heroes: shift(g.heroes, offsets.heroes), cards: shift(g.cards, offsets.cards), cardSlots: shift(g.cardSlots, offsets.cardSlots) };
  out += `/** ${cls}:基准 ${bw}×${bh}。 */\nexport const ${name}: LayoutTable = {\n  baseWidth: ${bw},\n  baseHeight: ${bh},\n  verified: false,\n`;
  for (const grp of ["pool", "heroes", "cards", "cardSlots"]) out += `  ${grp}: [\n${t[grp].map(fmt).join(",\n")},\n  ],\n`;
  out += `};\n\n`;
}
fs.writeFileSync(outPath, out.replace(/\n\n$/, "\n"));
