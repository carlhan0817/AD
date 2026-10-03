// core/tests/recognition/pool_multiframe.test.ts
// 本地标定工具:对 docs/screenshot 下真选取截图(jpg,1920×1080,未入库)用当前 POOL_CELLS_1080P
// 跑 48 格 pHash 最近邻,统计每帧 命中/英雄/重复 + 跨帧脆弱格。验证标定对多帧稳健(非单帧过拟合)。
// 判据=pHash distance + 无英雄(见 memory phash-distance-is-ground-truth)。依赖未入库资产,缺则 skip。
import { describe, it } from "vitest";
import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { cropRaw, type GrayFrame } from "../../src/recognition/grid";
import { resizeGrayTo32 } from "../../src/recognition/resize";
import { phashFromGray } from "../../src/recognition/phash";
import { nearest, loadIndex, type IndexEntry } from "../../src/recognition/index_store";
import { POOL_CELLS_1080P } from "../../src/recognition/pool_layout_1080p";

const SHOTS = join(__dirname, "..", "..", "..", "docs", "screenshot");
const INDEX = join(__dirname, "..", "..", "..", "models", "templates", "phash_index.json");
// 缺截图目录或 index(均未入库)→ skip,避免 CI/他机报错。
const hasAssets = existsSync(SHOTS) && existsSync(INDEX) &&
  readdirSync(SHOTS).some((f) => f.endsWith(".jpg"));

async function jpgToGray(path: string): Promise<GrayFrame> {
  const { data, info } = await sharp(path).grayscale().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8Array(data) };
}

function scoreFrame(frame: GrayFrame, index: IndexEntry[]) {
  const matches = POOL_CELLS_1080P.map((c) =>
    nearest(index, phashFromGray(resizeGrayTo32(cropRaw(frame, c.x, c.y, c.w, c.h))), 1024)!,
  );
  const heroes = matches.filter((m) => m.valveId < 0);
  const ids = matches.map((m) => m.valveId);
  const uniq = new Set(ids.filter((v) => v > 0)).size;
  const hits = matches.filter((m) => m.valveId > 0 && m.distance <= 20).length;
  const dists = matches.map((m) => m.distance).sort((a, b) => a - b);
  return { matches, heroes, uniq, hits, median: dists[Math.floor(dists.length / 2)], max: dists[dists.length - 1] };
}

describe.skipIf(!hasAssets)("pool 多帧交叉验证 — POOL_CELLS_1080P vs docs/screenshot", () => {
  it("每张真选取截图跑 48 格,打印命中/英雄/重复", async () => {
    const index = loadIndex(INDEX);
    const files = readdirSync(SHOTS).filter((f) => f.endsWith(".jpg")).sort();
    // 记录每格在多帧中"未中/英雄"的次数,定位脆弱格
    const fragility = new Array(48).fill(0);

    for (const f of files) {
      const frame = await jpgToGray(join(SHOTS, f));
      if (frame.width !== 1920 || frame.height !== 1080) {
        // eslint-disable-next-line no-console
        console.log(`${f}: 跳过(非1920x1080: ${frame.width}x${frame.height})`);
        continue;
      }
      const r = scoreFrame(frame, index);
      r.matches.forEach((m, i) => { if (m.valveId < 0 || m.distance > 20) fragility[i]++; });
      const heroCells = r.heroes.map((m) => `#${r.matches.indexOf(m)}:${m.shortName}`).join(",");
      // eslint-disable-next-line no-console
      console.log(`${f}: hits=${r.hits}/48 heroes=${r.heroes.length}${heroCells ? `(${heroCells})` : ""} uniq=${r.uniq} d中位=${r.median} max=${r.max}`);
    }

    // eslint-disable-next-line no-console
    console.log("\n=== 跨帧脆弱格(在某些帧未中/误英雄的格号 → 次数) ===");
    const frag = fragility.map((n, i) => ({ i, n })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n);
    // eslint-disable-next-line no-console
    console.log(frag.map((x) => `#${x.i}(${POOL_CELLS_1080P[x.i].zone}):${x.n}帧`).join(" | ") || "无——所有格在所有帧都稳定命中");
  });
});
