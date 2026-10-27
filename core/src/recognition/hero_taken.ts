// core/src/recognition/hero_taken.ts
// 判断 12 个英雄模型格里哪些已经被选走。被选走的模型格会变灰、变暗(和被选走的技能格一样),
// 所以不用认是谁,只看「颜色有多灰」和「画面有多花」。
import { heroCellRects } from "./hero_layout";
import { cropResizeRgb, meanChroma, pixelStd, type RgbFrame } from "./rgb";
import type { ClientRect } from "./roi";

// 2026-10-27 真机 13 帧(4 局)实测,模型格裁成 96×96 后:
//   已选走:饱和度 3–8、标准差 12–24(变成灰的,即使像 Dawnbreaker 那样还看得出轮廓);
//   没选走:饱和度 ≥14、标准差 ≥30(包括 Spectre/OD 这种本身偏暗的模型)。
// 两个条件都满足才判为已选走——宁可漏判(推荐里多一个已选英雄),也不错把能选的英雄藏掉。
export const HERO_TAKEN_MAX_CHROMA = 11;
export const HERO_TAKEN_MAX_STD = 27;

const TILE_SIZE = 96;

/** 单个模型格(96×96 RGB)是否已被选走。 */
export function isHeroTileTaken(tileRgb: Uint8Array): boolean {
  return meanChroma(tileRgb) < HERO_TAKEN_MAX_CHROMA && pixelStd(tileRgb) < HERO_TAKEN_MAX_STD;
}

/** 返回已被选走的英雄位置编号(0..11)。 */
export function takenHeroPositions(frame: RgbFrame, rect: ClientRect): Set<number> {
  const taken = new Set<number>();
  for (const c of heroCellRects(rect)) {
    if (isHeroTileTaken(cropResizeRgb(frame, c.x, c.y, c.w, c.h, TILE_SIZE))) taken.add(c.order);
  }
  return taken;
}
