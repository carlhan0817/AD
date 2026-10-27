// core/src/recognition/pool_second_opinion.ts
// 第二意见:用旧办法(灰度 pHash 比官方图标)再认一遍某一格。
// 只在分类器对某格没把握时拿来对答案——两种办法各自独立认出同一个技能,基本不会错。
// pHash 用的是为它逐格微调过的 POOL_CELLS_1080P,和分类器用的 POOL_SLOTS_1080P 是两套坐标,
// 这里按格子中心最近把两套对上。
import { cropRaw, type GrayFrame } from "./grid";
import { resizeGrayTo32 } from "./resize";
import { phashFromGray } from "./phash";
import { nearest, type IndexEntry } from "./index_store";
import { poolCellRects, POOL_LAYOUT_RATIO, type ClientRect } from "./roi";
import { POOL_CELLS_1080P } from "./pool_layout_1080p";
import { POOL_SLOTS_1080P } from "./pool_slots";

/** 与 loop.ts / scan_once.ts 的 RECOGNIZE_MAX_DISTANCE 同值(真机标定)。 */
export const SECOND_OPINION_MAX_DISTANCE = 20;

// POOL_SLOTS_1080P 的第 i 格 → POOL_CELLS_1080P 里中心最近的那格的下标。
const PHASH_CELL_OF_SLOT: number[] = POOL_SLOTS_1080P.map((s) => {
  let best = 0, bestD = Infinity;
  POOL_CELLS_1080P.forEach((c, k) => {
    const d = Math.hypot(c.x + c.w / 2 - (s.x + s.w / 2), c.y + c.h / 2 - (s.y + s.h / 2));
    if (d < bestD) { bestD = d; best = k; }
  });
  return best;
});

/** 返回「第 i 格的第二意见」函数。index 里的英雄条目(负 valveId)会被排除,只比技能。 */
export function phashSecondOpinion(
  frame: GrayFrame, rect: ClientRect, index: IndexEntry[],
): (cellIndex: number) => string | null {
  const abilities = index.filter((e) => e.valveId > 0);
  const rects = poolCellRects(POOL_LAYOUT_RATIO, rect);
  return (cellIndex) => {
    const c = rects[PHASH_CELL_OF_SLOT[cellIndex]];
    if (c === undefined) return null;
    const gray32 = resizeGrayTo32(cropRaw(frame, c.x, c.y, c.w, c.h));
    return nearest(abilities, phashFromGray(gray32), SECOND_OPINION_MAX_DISTANCE)?.shortName ?? null;
  };
}
