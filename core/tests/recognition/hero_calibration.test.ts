// core/tests/recognition/hero_calibration.test.ts
// 标定判据:4 帧真机截图 × 12 英雄格,对比 hero_ground_truth.json。
// 判据 = pHash 最近邻能否命中 ground truth 的 valveId(distance ≤ HERO_MAX_DISTANCE),
// 而不是目视画框对齐(见 memory phash-distance-is-ground-truth)。
// 依赖未入库资产(docs/screenshot PNG 已入库,但 phash_index.json 是 gitignore 的构建产物,
// 由 pipeline 的 build-index 命令生成)——缺 phash_index.json 时整个 suite skip,不报错。
// 这是一个本地标定判据,不是 CI 门禁:CI 环境目前不产出 phash_index.json,故此 suite 在 CI
// 上恒为 skip,不参与 CI 通过/失败判定。本地有该文件时才会真正跑,此时单个用例计算量较大
// (45 格 × 每格 147 个 refine 候选窗口 + 4 张 PNG 解码),已显式放宽超时到 120s。
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { cropRaw, type GrayFrame } from "../../src/recognition/grid";
import { resizeGrayTo32 } from "../../src/recognition/resize";
import { phashFromGray } from "../../src/recognition/phash";
import { nearest, loadIndex, type IndexEntry } from "../../src/recognition/index_store";
import { heroCellRects } from "../../src/recognition/hero_layout";

const SHOTS = join(__dirname, "..", "..", "..", "docs", "screenshot");
const INDEX = join(__dirname, "..", "..", "..", "models", "templates", "phash_index.json");
const GT = join(__dirname, "fixtures", "hero_ground_truth.json");
const HERO_MAX_DISTANCE = 26;

const hasAssets = existsSync(SHOTS) && existsSync(INDEX) && existsSync(GT);

interface GtCell { order: number; valveId: number | null; shortName: string | null; note?: string; }
interface GtFrame { file: string; width: number; height: number; cells: GtCell[]; }

async function pngToGray(path: string): Promise<GrayFrame> {
  const { data, info } = await sharp(path).grayscale().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8Array(data) };
}

/** 每格 ±6px(step 2)× 3 pad(-3/0/3)refine 搜索,取 pHash 最近邻距离最小的匹配。
 *  与标定脚本(自举 hero_ground_truth.json 时用的算法)一致,是 hero_recognize.ts
 *  的 refineHeroCell 在 Task 3 落地前的判据版本——Task 3 会把这段逻辑迁入正式模块。 */
function refineAndMatch(
  frame: GrayFrame, baseX: number, baseY: number, w: number, h: number, index: IndexEntry[],
) {
  let best: { valveId: number; shortName: string; distance: number } | null = null;
  for (const pad of [0, -3, 3]) {
    const sw = w + pad * 2, sh = h + pad * 2;
    if (sw < 10 || sh < 10) continue;
    for (let dx = -6; dx <= 6; dx += 2) {
      for (let dy = -6; dy <= 6; dy += 2) {
        const raw = cropRaw(frame, baseX - pad + dx, baseY - pad + dy, sw, sh);
        const gray32 = resizeGrayTo32(raw);
        const m = nearest(index, phashFromGray(gray32), 1024);
        if (m && (best === null || m.distance < best.distance)) best = m;
      }
    }
  }
  return best!;
}

describe.skipIf(!hasAssets)("hero calibration — 4 帧 × 12 格 vs ground truth", () => {
  it("已知正确的格(valveId 非 null)标准 refine 命中 ground truth(d≤HERO_MAX_DISTANCE)", async () => {
    const fullIndex = loadIndex(INDEX);
    const heroIndex = fullIndex.filter((e) => e.valveId < 0);
    const gt = JSON.parse(readFileSync(GT, "utf-8")) as Record<string, GtFrame>;

    let checked = 0;
    let hits = 0;
    const misses: string[] = [];

    for (const [frameKey, gf] of Object.entries(gt)) {
      const framePath = join(SHOTS, gf.file);
      if (!existsSync(framePath)) continue; // 允许单帧截图缺失时其余帧仍跑
      const frame = await pngToGray(framePath);
      const rect = { x: 0, y: 0, width: frame.width, height: frame.height };
      const cells = heroCellRects(rect);

      for (const gc of gf.cells) {
        if (gc.valveId === null) continue; // 已知未收敛格,跳过强命中断言(见 fixture note)
        const cell = cells.find((c) => c.order === gc.order)!;
        const m = refineAndMatch(frame, cell.x, cell.y, cell.w, cell.h, heroIndex);
        checked++;
        if (m.valveId === gc.valveId && m.distance <= HERO_MAX_DISTANCE) {
          hits++;
        } else {
          misses.push(`${frameKey}#${gc.order}: expect ${gc.shortName}(${gc.valveId}), got ${m.shortName}(${m.valveId}) d=${m.distance}`);
        }
      }
    }

    // eslint-disable-next-line no-console
    if (misses.length) console.log("未命中:\n" + misses.join("\n"));
    // eslint-disable-next-line no-console
    console.log(`命中 ${hits}/${checked}(已知未收敛的 3 格已排除在外,见 fixture note)`);

    // 硬不变量:45 个已知正确格(48 - 3 个标 null 的未收敛格,见 fixture note)全部命中。
    expect(checked).toBe(45);
    expect(hits).toBe(checked);
  }, 120_000); // 45 格 × 每格 147 个 refine 候选窗口 + 4 张 PNG 解码,默认 5s 超时不够,需显式放宽。

  it("同一帧 12 格中已知格的 valveId 互不重复(除已标注 null 的未收敛格外)", () => {
    const gt = JSON.parse(readFileSync(GT, "utf-8")) as Record<string, GtFrame>;
    for (const [frameKey, gf] of Object.entries(gt)) {
      const ids = gf.cells.filter((c) => c.valveId !== null).map((c) => c.valveId);
      const uniq = new Set(ids);
      expect(uniq.size, `frame ${frameKey} 存在重复 valveId: ${ids.join(",")}`).toBe(ids.length);
    }
  });
});
