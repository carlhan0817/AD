// core/src/recognition/highlight.ts
// 把推荐标到技能池上:算出每条推荐对应的格子,在格子外面画一圈框。
// 悬浮窗会被扫描截屏一起拍进去,所以框必须画在所有识别区域之外(见 HIGHLIGHT_OUTSET):
// 框压到格子里的话,被选走的暗格会因为这圈亮边显得「不空」,导致判空出错。
import { heroCellRects } from "./hero_layout";
import { poolSlots } from "./pool_slots";
import type { ClientRect, Rect } from "./roi";
import { screenLayoutFor } from "./screen_layout";
import type { Highlight } from "@ad/shared/types/ipc";

/** 框离格子的距离和线宽(1080p 像素)。标准区上下两行的间隙只有 23px,外扩 + 线宽要小于它的一半。 */
export const HIGHLIGHT_OUTSET = 5;
export const HIGHLIGHT_THICKNESS = 3;

/** 给定格子,算出框的外边界(像素)。 */
export function highlightOuter(cell: Rect, rect: ClientRect): Rect {
  // 按高度缩放:各比例表的位置都是 rect.height / baseHeight;不支持的比例退回 height/1080。
  const s = rect.height / (screenLayoutFor(rect)?.table.baseHeight ?? 1080);
  const out = Math.round((HIGHLIGHT_OUTSET + HIGHLIGHT_THICKNESS) * s);
  return { x: cell.x - out, y: cell.y - out, w: cell.w + out * 2, h: cell.h + out * 2 };
}

/** 推荐(按顺序的 valveId)→ 高亮框。正 id 在技能池里找格,负 id 在英雄模型格里找;找不到就跳过。 */
export function highlightsFor(
  valveIds: number[],
  rect: ClientRect,
  cellOfAbility: (valveId: number) => number | null,
  posOfHero: (valveId: number) => number | null,
): Highlight[] {
  const slots = poolSlots(rect);
  const heroes = heroCellRects(rect);
  const out: Highlight[] = [];
  valveIds.forEach((id, rank) => {
    let cell: Rect | undefined;
    if (id > 0) {
      const i = cellOfAbility(id);
      if (i !== null) cell = slots[i];
    } else {
      const pos = posOfHero(id);
      if (pos !== null) cell = heroes.find((h) => h.order === pos);
    }
    if (cell === undefined) return;
    const o = highlightOuter(cell, rect);
    out.push({
      left: (o.x - rect.x) / rect.width, top: (o.y - rect.y) / rect.height,
      width: o.w / rect.width, height: o.h / rect.height, rank,
    });
  });
  return out;
}
