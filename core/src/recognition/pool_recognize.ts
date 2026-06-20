// core/src/recognition/pool_recognize.ts
// 单一职责:按比例池布局裁格 → 复用 recognizeCell 识别 → 收集去重候选池 valveId[]。
// 不喂打分、不做状态机映射(本阶段范围)。空格/未命中跳过。
import { cropRaw, type GrayFrame } from "./grid";
import { resizeGrayTo32 } from "./resize";
import { poolCellRects, POOL_LAYOUT_RATIO, type PoolLayout, type ClientRect } from "./roi";
import { recognizeCell } from "./recognize";
import type { IndexEntry } from "./index_store";

/** 识别中央技能池,产出本局候选池(去重 valveId[],按格子铺平顺序,首次出现保留)。 */
export function recognizePool(
  frame: GrayFrame,
  rect: ClientRect,
  index: IndexEntry[],
  layout: PoolLayout = POOL_LAYOUT_RATIO,
  maxDistance = 12,
): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const cell of poolCellRects(layout, rect)) {
    const raw = cropRaw(frame, cell.x, cell.y, cell.w, cell.h); // 越界 clamp 已在 cropRaw 内
    const gray32 = resizeGrayTo32(raw);                          // 与建索引侧同核
    const match = recognizeCell(gray32, index, maxDistance);
    if (match === null) continue;                                // 空格/未命中跳过
    if (seen.has(match.valveId)) continue;
    seen.add(match.valveId);
    out.push(match.valveId);
  }
  return out;
}
