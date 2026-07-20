// core/src/recognition/hero_recognize.ts
// 标准技能池两端 12 英雄格识别:每格 refine(小范围搜索抵消 models_coords 的点击检测级
// 容差)+ pHash 最近邻 → 汇总去重 valveId[]。models_coords 直接用只有 16-36/48 命中率
// (见 hero_layout.ts 注释),refine 是达到可用精度的必需步骤,不是可选优化。
// 见 docs/superpowers/specs/2026-07-07-hero-cell-recognition-design.md。
import { cropRaw, type GrayFrame } from "./grid";
import { resizeGrayTo32 } from "./resize";
import { phashFromGray } from "./phash";
import { nearest, type IndexEntry, type Match } from "./index_store";
import { heroCellRects, type HeroCell } from "./hero_layout";
import type { ClientRect } from "./roi";

/** 英雄档识别阈值。比技能档(20)略宽——真机英雄 pHash 距离实测集中在 6-16,
 *  留余量到 26 覆盖光照/裁切边界抖动。 */
export const HERO_MAX_DISTANCE = 26;

/** 单格 refine:以 cell 为中心,±6px(dx/dy,step 2)× 3 种 pad(-3/0/3 像素收缩/扩张)
 *  共 7×7×3=147 个候选窗口,取 pHash 最近邻距离最小的匹配。
 *  为何需要:models_coords 是上游项目为"点击命中检测"标定的坐标,容差达 35-48px,
 *  直接用于像素识别只有 16-36/48 命中率;每格在小范围内搜索能收敛到 40+/48。 */
export function refineHeroCell(
  frame: GrayFrame, cell: HeroCell, index: IndexEntry[], maxDistance: number = HERO_MAX_DISTANCE,
): Match | null {
  let best: Match | null = null;
  for (const pad of [0, -3, 3]) {
    const sw = cell.w + pad * 2;
    const sh = cell.h + pad * 2;
    if (sw < 10 || sh < 10) continue; // 过小窗口跳过,避免 resize 到 32x32 时信息不足
    for (let dx = -6; dx <= 6; dx += 2) {
      for (let dy = -6; dy <= 6; dy += 2) {
        const raw = cropRaw(frame, cell.x - pad + dx, cell.y - pad + dy, sw, sh);
        const gray32 = resizeGrayTo32(raw);
        const m = nearest(index, phashFromGray(gray32), 1024); // 大阈值内部搜索,外部统一把关
        if (m && (best === null || m.distance < best.distance)) best = m;
      }
    }
  }
  if (best === null || best.distance > maxDistance) return null;
  return best;
}

/** 识别标准池两端 12 英雄格,产出本局候选英雄集合(去重 valveId[],按 order 0..11
 *  铺平顺序,首次出现保留)。空格/未命中(refine 后仍超阈值)跳过。
 *  index 由调用方传入——不在此处过滤 valveId<0,与 recognizePool 的"调用方决定索引范围"
 *  惯例一致(调用方若只想匹配英雄,自行传英雄子集索引)。 */
export function recognizeHeroes(
  frame: GrayFrame, rect: ClientRect, index: IndexEntry[], maxDistance: number = HERO_MAX_DISTANCE,
): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const cell of heroCellRects(rect)) {
    const match = refineHeroCell(frame, cell, index, maxDistance);
    if (match === null) continue;
    if (seen.has(match.valveId)) continue;
    seen.add(match.valveId);
    out.push(match.valveId);
  }
  return out;
}
