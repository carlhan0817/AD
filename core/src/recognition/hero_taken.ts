// core/src/recognition/hero_taken.ts
// 判断 12 个英雄模型格里哪些已经被选走。被选走的模型格会变灰、变暗(和被选走的技能格一样),
// 所以不用认是谁,只看「颜色有多灰」和「画面有多花」。
import { heroCellRects } from "./hero_layout";
import { cropResizeRgb, meanChroma, pixelStd, type RgbFrame } from "./rgb";
import type { ClientRect } from "./roi";

// 真机实测(768 个模型格,裁成 96×96):
//   已选走:饱和度 ≤8、标准差 ≤30(变成灰的,Hoodwink 这种还看得出轮廓的能到 30);
//   没选走:饱和度 ≥14(最灰的是 Broodmother:饱和度 14、标准差 36)。
// 两个条件都满足才判为已选走——宁可漏判(推荐里多一个已选英雄),也不错把能选的英雄藏掉。
export const HERO_TAKEN_MAX_CHROMA = 11;
export const HERO_TAKEN_MAX_STD = 35;
// 明显是彩色的格一定没被选走(选走的不会变回彩色),用来撤销之前的误判。
// 说明框盖住时饱和度约 13,低于这个数,所以不会把真选走的英雄错误恢复。
export const HERO_COLORED_MIN_CHROMA = 14;

const TILE_SIZE = 96;

/** 单个模型格(96×96 RGB)是否已被选走。 */
export function isHeroTileTaken(tileRgb: Uint8Array): boolean {
  return meanChroma(tileRgb) < HERO_TAKEN_MAX_CHROMA && pixelStd(tileRgb) < HERO_TAKEN_MAX_STD;
}

export interface HeroTiles {
  /** 这一帧看起来已被选走的位置(0..11)。 */
  taken: Set<number>;
  /** 这一帧明显是彩色、一定没被选走的位置。 */
  colored: Set<number>;
  /** 每格的饱和度/标准差,写日志用:见到更灰的英雄时好回头调界线。 */
  stats: { pos: number; chroma: number; std: number }[];
}

export function readHeroTiles(frame: RgbFrame, rect: ClientRect): HeroTiles {
  const out: HeroTiles = { taken: new Set(), colored: new Set(), stats: [] };
  for (const c of heroCellRects(rect)) {
    const tile = cropResizeRgb(frame, c.x, c.y, c.w, c.h, TILE_SIZE);
    const chroma = meanChroma(tile);
    out.stats.push({ pos: c.order, chroma, std: pixelStd(tile) });
    if (isHeroTileTaken(tile)) out.taken.add(c.order);
    if (chroma >= HERO_COLORED_MIN_CHROMA) out.colored.add(c.order);
  }
  return out;
}

/** 返回已被选走的英雄位置编号(0..11)。 */
export function takenHeroPositions(frame: RgbFrame, rect: ClientRect): Set<number> {
  return readHeroTiles(frame, rect).taken;
}
