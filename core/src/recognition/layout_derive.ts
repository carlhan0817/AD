// core/src/recognition/layout_derive.ts
// 由游戏窗口矩形推导 DraftLayout。替代硬编码 1080p(阶段 4)。
// 缩放基准 = 1920x1080;1080p 全屏(origin 0,0)时与 LAYOUT_1080P 逐字段相等。
import { LAYOUT_1080P, type DraftLayout } from "./roi";

export interface WindowRect { x: number; y: number; width: number; height: number; }

const BASE_W = 1920;
const BASE_H = 1080;

export function deriveLayout(rect: WindowRect): DraftLayout {
  const sx = rect.width / BASE_W;
  const sy = rect.height / BASE_H;
  const X = (v: number) => Math.round(v * sx) + rect.x;
  const Y = (v: number) => Math.round(v * sy) + rect.y;
  const W = (v: number) => Math.round(v * sx);
  const H = (v: number) => Math.round(v * sy);
  const b = LAYOUT_1080P;
  return {
    pool: { x: X(b.pool.x), y: Y(b.pool.y), cellW: W(b.pool.cellW), cellH: H(b.pool.cellH),
            gapX: W(b.pool.gapX), gapY: H(b.pool.gapY), rows: b.pool.rows, cols: b.pool.cols },
    // 英雄槽(长方形)与技能槽(正方形)分别等比推导,保持各自纵横比。
    heroSlot: { x: X(b.heroSlot.x), y: Y(b.heroSlot.y), w: W(b.heroSlot.w), h: H(b.heroSlot.h) },
    abilitySlots: { x: X(b.abilitySlots.x), y: Y(b.abilitySlots.y),
                    cellW: W(b.abilitySlots.cellW), cellH: H(b.abilitySlots.cellH),
                    gapX: W(b.abilitySlots.gapX), gapY: H(b.abilitySlots.gapY),
                    rows: b.abilitySlots.rows, cols: b.abilitySlots.cols },
    rowPitch: H(b.rowPitch),
    timer: { x: X(b.timer.x), y: Y(b.timer.y), w: W(b.timer.w), h: H(b.timer.h) },
    pickerStrip: { x: X(b.pickerStrip.x), y: Y(b.pickerStrip.y), w: W(b.pickerStrip.w), h: H(b.pickerStrip.h) },
  };
}
