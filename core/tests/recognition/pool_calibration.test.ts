// core/tests/recognition/pool_calibration.test.ts
// 一次性标定判据(systematic-debugging Phase 4 失败判据 → 迭代到 48/48)。
// 以真 Dota 帧(fixtures/dota_pool_real.pgm,亮度46.6,已确认是选取界面)为基准,
// 跑当前 POOL_CELLS_1080P 的 48 格 pHash 最近邻,统计:命中数/英雄误收/重复/distance 分布。
// 判据是 pHash distance,不是目视画框(见 memory phash-distance-is-ground-truth)。
// 标定完成后此文件连同 fixture 一起删除。
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { cropRaw, type GrayFrame } from "../../src/recognition/grid";
import { resizeGrayTo32 } from "../../src/recognition/resize";
import { phashFromGray } from "../../src/recognition/phash";
import { nearest, loadIndex, type IndexEntry } from "../../src/recognition/index_store";
import { POOL_CELLS_1080P } from "../../src/recognition/pool_layout_1080p";

/** 解析 PGM P5 → GrayFrame。 */
function readPgm(path: string): GrayFrame {
  const buf = readFileSync(path);
  let p = 0;
  const tok = (): string => {
    while ([32, 10, 9].includes(buf[p])) p++;
    const s = p;
    while (![32, 10, 9].includes(buf[p])) p++;
    return buf.slice(s, p).toString();
  };
  const magic = tok();
  if (magic !== "P5") throw new Error(`not P5: ${magic}`);
  const w = +tok(), h = +tok();
  tok(); // maxval
  p++; // single whitespace after maxval
  return { width: w, height: h, data: new Uint8Array(buf.slice(p, p + w * h)) };
}

/** 一格 → 最近邻 Match(大阈值,读真实距离)。 */
function matchCell(frame: GrayFrame, c: { x: number; y: number; w: number; h: number }, index: IndexEntry[]) {
  const gray32 = resizeGrayTo32(cropRaw(frame, c.x, c.y, c.w, c.h));
  return nearest(index, phashFromGray(gray32), 1024)!;
}

const FRAME = join(__dirname, "fixtures", "dota_pool_real.pgm");
const INDEX = join(__dirname, "..", "..", "..", "models", "templates", "phash_index.json");

// 本地标定工具:依赖未入库的真帧 fixture(.pgm,gitignore)+ phash_index.json(亦 gitignore)。
// CI/他机缺文件 → 整个 suite skip,不报错(本地有文件才跑标定验证)。
const hasAssets = existsSync(FRAME) && existsSync(INDEX);

describe.skipIf(!hasAssets)("pool calibration — 当前坐标基线", () => {
  it("打印 48 格命中统计(失败判据基线)", () => {
    const frame = readPgm(FRAME);
    const index = loadIndex(INDEX);
    expect(frame.width).toBe(1920);
    expect(POOL_CELLS_1080P.length).toBe(48);

    const matches = POOL_CELLS_1080P.map((c) => ({ cell: c, m: matchCell(frame, c, index) }));
    const heroes = matches.filter((x) => x.m.valveId < 0);
    const ids = matches.map((x) => x.m.valveId);
    const uniq = new Set(ids);
    const dups = ids.filter((v, i) => ids.indexOf(v) !== i);
    const dists = matches.map((x) => x.m.distance).sort((a, b) => a - b);
    const median = dists[Math.floor(dists.length / 2)];
    const hitsThr20 = matches.filter((x) => x.m.distance <= 20 && x.m.valveId > 0).length;

    // 逐格(供定位)
    matches.forEach((x, i) => {
      const flag = x.m.valveId < 0 ? " ⟵英雄" : "";
      // eslint-disable-next-line no-console
      console.log(`#${String(i).padStart(2)} ${x.cell.zone.padEnd(8)} @(${x.cell.x},${x.cell.y},${x.cell.w}x${x.cell.h}) → ${x.m.shortName}(${x.m.valveId}) d=${x.m.distance}${flag}`);
    });
    // eslint-disable-next-line no-console
    console.log(`\n=== 基线汇总 ===`);
    // eslint-disable-next-line no-console
    console.log(`命中真技能(正id,d≤20): ${hitsThr20}/48`);
    // eslint-disable-next-line no-console
    console.log(`英雄误收(负id): ${heroes.length} → ${heroes.map((x) => `#${POOL_CELLS_1080P.indexOf(x.cell)}:${x.m.shortName}`).join(", ")}`);
    // eslint-disable-next-line no-console
    console.log(`唯一技能数(去重后): ${uniq.size}/48; 重复 ${dups.length} 个`);
    // eslint-disable-next-line no-console
    console.log(`distance: min=${dists[0]} median=${median} max=${dists[dists.length - 1]}`);

    // 硬不变量(v6 定稿后必须成立):48 格全部命中真技能、0 英雄误收。
    // 注:dota_pool_real.pgm 是 draft 中期帧(部分技能已被选走 → 空格),空格 pHash 会最近邻到
    // 已出现的技能造成"重复"→ uniq<48 属正常,不作硬断言(满池帧才会 uniq=48)。
    expect(hitsThr20).toBe(48);
    expect(heroes.length).toBe(0);
  });
});
