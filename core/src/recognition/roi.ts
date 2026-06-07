// core/src/recognition/roi.ts
// 多 ROI 规格 + 裁剪。坐标对 1920x1080 手填;阶段 4 升级为按窗口尺寸推导。
// 英雄槽(长方形)与技能槽(正方形)物理解耦,避免对长方形头像做正方形裁切→形变→雪崩。
import { cropRaw, cropGrid, type GrayFrame, type GridSpec } from "./grid";
import { resizeGrayTo32 } from "./resize"; // 共享双线性缩放(阶段 1),与建索引侧同核

/** 矩形 ROI。 */
export interface Rect { x: number; y: number; w: number; h: number; }

export interface DraftLayout {
  /** 英雄+技能混合选取池网格(正方形格)。 */
  pool: GridSpec;
  /** 单行第 0 槽:英雄头像(**长方形**,独立宽高)。 */
  heroSlot: Rect;
  /** 单行第 1..4 槽:4 个技能(**正方形** 1×4 网格)。 */
  abilitySlots: GridSpec;
  /** 行间纵向步距(从第 r 行到第 r+1 行)。 */
  rowPitch: number;
  /** 回合计时 ROI(矩形)。 */
  timer: Rect;
  /** Active Picker 高亮边框扫描带(覆盖十行行首,用于颜色匹配)。 */
  pickerStrip: Rect;
}

// 占位标定值(阶段 2 手填,阶段 4 由窗口尺寸推导覆盖)。
// heroSlot 长方形(85×48);abilitySlots 正方形(48×48,cols=4)。
export const LAYOUT_1080P: DraftLayout = {
  pool: { x: 480, y: 200, cellW: 64, cellH: 64, gapX: 8, gapY: 8, rows: 4, cols: 12 },
  heroSlot: { x: 1300, y: 180, w: 85, h: 48 },
  abilitySlots: { x: 1392, y: 180, cellW: 48, cellH: 48, gapX: 4, gapY: 0, rows: 1, cols: 4 },
  rowPitch: 60,
  timer: { x: 900, y: 60, w: 120, h: 48 },
  pickerStrip: { x: 1260, y: 180, w: 30, h: 600 },
};

/** 单行的已选槽识别格:英雄(长方形裁切→32×32)+ 4 个技能(正方形→32×32)。 */
export interface SlotRowCells {
  hero: number[][];          // 32×32
  abilities: number[][][];   // 4 个 32×32
}

/** 选取池每格(已缩放到 32x32),供识别。 */
export function poolCells(frame: GrayFrame, layout: DraftLayout): number[][][] {
  return cropGrid(frame, layout.pool);
}

/** 十行已选槽。每行:英雄长方形单独裁切缩放,技能走 1×4 正方形网格。 */
export function slotRowCells(frame: GrayFrame, layout: DraftLayout): SlotRowCells[] {
  const out: SlotRowCells[] = [];
  for (let r = 0; r < 10; r++) {
    const dy = r * layout.rowPitch;
    // 英雄:裁完整长方形子矩形(不切边),再共享双线性缩放到 32×32。
    const heroRaw = cropRaw(frame, layout.heroSlot.x, layout.heroSlot.y + dy,
                            layout.heroSlot.w, layout.heroSlot.h);
    const hero = resizeGrayTo32(heroRaw);
    // 技能:1×4 正方形网格(cropGrid 内部已 resize 32×32)。
    const abilities = cropGrid(frame, { ...layout.abilitySlots, y: layout.abilitySlots.y + dy });
    out.push({ hero, abilities });
  }
  return out;
}

/** 门控用的原始(不缩放)ROI 块:池左上、十行槽带、计时器。 */
export function diffRois(frame: GrayFrame, layout: DraftLayout): number[][][] {
  const pool = cropRaw(frame, layout.pool.x, layout.pool.y, 64, 64);
  // 槽带覆盖英雄槽起点到 4 个技能槽末端,纵向覆盖十行。
  const slotsW = layout.abilitySlots.x + layout.abilitySlots.cols *
    (layout.abilitySlots.cellW + layout.abilitySlots.gapX) - layout.heroSlot.x;
  const slots = cropRaw(frame, layout.heroSlot.x, layout.heroSlot.y, slotsW, 10 * layout.rowPitch);
  const timer = cropRaw(frame, layout.timer.x, layout.timer.y, layout.timer.w, layout.timer.h);
  return [pool, slots, timer];
}
