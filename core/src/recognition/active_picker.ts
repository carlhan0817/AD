// core/src/recognition/active_picker.ts
// Active Picker 高亮行探头(颜色匹配,无 NN)。顺位的权威真相(计划书 §四)。
// 通道步长由 strip.channels 决定,并断言为 3(纯 RGB)——杜绝 RGBA 偏移。
import type { ActivePicker } from "@ad/shared/types/draft";

export interface RgbStrip {
  width: number;
  height: number;
  rows: number;          // 行数(通常 10)
  channels: number;      // 每像素字节数;本探头要求 === 3(纯 RGB)
  data: Uint8Array;      // length = width*height*channels
}

/** Dota 2 Active Picker 高亮色近似值(实测可微调)。 */
export const HIGHLIGHT = { r: 240, g: 200, b: 90 };

/** 颜色距离阈值(曼哈顿距离)。 */
const COLOR_TOL = 90;
/** 一行被判为「高亮」所需的高亮像素占比下限。 */
const MIN_RATIO = 0.25;

function isHighlight(r: number, g: number, b: number): boolean {
  return (
    Math.abs(r - HIGHLIGHT.r) + Math.abs(g - HIGHLIGHT.g) + Math.abs(b - HIGHLIGHT.b) <=
    COLOR_TOL
  );
}

export function detectActivePicker(strip: RgbStrip): ActivePicker {
  if (strip.channels !== 3) {
    throw new Error(
      `active_picker expects pure RGB (channels=3), got channels=${strip.channels}. ` +
      `Call sharp(...).removeAlpha() before building the strip.`,
    );
  }
  const stride = strip.channels;
  const rowH = Math.floor(strip.height / strip.rows);
  let bestRow = -1;
  let bestRatio = 0;
  for (let r = 0; r < strip.rows; r++) {
    let hit = 0;
    let total = 0;
    for (let y = r * rowH; y < (r + 1) * rowH; y++) {
      for (let x = 0; x < strip.width; x++) {
        const i = (y * strip.width + x) * stride;
        if (isHighlight(strip.data[i], strip.data[i + 1], strip.data[i + 2])) hit += 1;
        total += 1;
      }
    }
    const ratio = total === 0 ? 0 : hit / total;
    if (ratio > bestRatio) {
      bestRatio = ratio;
      bestRow = r;
    }
  }
  return { row: bestRatio >= MIN_RATIO ? bestRow : null };
}
