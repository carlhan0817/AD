// core/src/recognition/rgb.ts
// 彩色帧与彩色裁格。分类器吃 RGB(技能图标主要靠颜色区分);pHash 旧链路仍吃灰度,
// 两者由同一帧派生(rgbFrameToGray),保证尺寸与内容一致。
import type { GrayFrame } from "./grid";
import { rgbToGray601 } from "./gray";

/** RGB 交错(每像素 3 字节)的整帧。 */
export interface RgbFrame { width: number; height: number; data: Uint8Array; }

/** 彩色帧 → 灰度帧(601 契约,与建索引侧一致)。 */
export function rgbFrameToGray(frame: RgbFrame): GrayFrame {
  const n = frame.width * frame.height;
  const gray = new Uint8Array(n);
  for (let p = 0; p < n; p++) {
    const i = p * 3;
    gray[p] = rgbToGray601(frame.data[i], frame.data[i + 1], frame.data[i + 2]);
  }
  return { width: frame.width, height: frame.height, data: gray };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** 裁出一格并双线性缩放到 size×size,返回 RGB 交错字节(size*size*3)。
 *  半像素中心对齐 + 越界 clamp 到帧边缘,与 resizeGrayTo32 同核(训练侧也是双线性)。 */
export function cropResizeRgb(
  frame: RgbFrame, sx: number, sy: number, sw: number, sh: number, size: number,
): Uint8Array {
  const out = new Uint8Array(size * size * 3);
  const { width, height, data } = frame;
  for (let ry = 0; ry < size; ry++) {
    const fy0 = ((ry + 0.5) * sh) / size - 0.5;
    const y0 = Math.floor(fy0);
    const fy = fy0 - y0;
    const y0c = clamp(sy + clamp(y0, 0, sh - 1), 0, height - 1);
    const y1c = clamp(sy + clamp(y0 + 1, 0, sh - 1), 0, height - 1);
    for (let rx = 0; rx < size; rx++) {
      const fx0 = ((rx + 0.5) * sw) / size - 0.5;
      const x0 = Math.floor(fx0);
      const fx = fx0 - x0;
      const x0c = clamp(sx + clamp(x0, 0, sw - 1), 0, width - 1);
      const x1c = clamp(sx + clamp(x0 + 1, 0, sw - 1), 0, width - 1);
      const i00 = (y0c * width + x0c) * 3, i01 = (y0c * width + x1c) * 3;
      const i10 = (y1c * width + x0c) * 3, i11 = (y1c * width + x1c) * 3;
      const o = (ry * size + rx) * 3;
      for (let ch = 0; ch < 3; ch++) {
        const top = data[i00 + ch] * (1 - fx) + data[i01 + ch] * fx;
        const bot = data[i10 + ch] * (1 - fx) + data[i11 + ch] * fx;
        out[o + ch] = Math.floor(top * (1 - fy) + bot * fy + 0.5);
      }
    }
  }
  return out;
}

/** 一格像素的标准差(三通道字节一起算)——「画面有多花」。
 *  已被选走/变暗的格接近纯暗色,标准差很低;有图标的格高。 */
export function pixelStd(bytes: Uint8Array): number {
  if (bytes.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < bytes.length; i++) sum += bytes[i];
  const mean = sum / bytes.length;
  let v = 0;
  for (let i = 0; i < bytes.length; i++) v += (bytes[i] - mean) ** 2;
  return Math.sqrt(v / bytes.length);
}

// 空格分界线。14 张真帧实测:空格(已选走/变暗)最高 27.4,有图标的格最低 36.6
// (night_stalker_darkness 这类本身偏暗的图标),取间隙中间。间隙不宽、样本只约 7 局,
// 后续真帧若出现落在 28–36 之间的格,回来调这个数。
export const EMPTY_CELL_STD = 32;

/** 该格是否为空(已被选走/变暗),空格不送分类器。 */
export function isEmptyCell(cellRgb: Uint8Array): boolean {
  return pixelStd(cellRgb) < EMPTY_CELL_STD;
}

/** 一格的平均饱和度:每个像素 max(R,G,B)−min(R,G,B) 的平均。灰色≈0,彩色高。 */
export function meanChroma(rgb: Uint8Array): number {
  const n = Math.floor(rgb.length / 3);
  if (n === 0) return 0;
  let sum = 0;
  for (let p = 0; p < n; p++) {
    const r = rgb[p * 3], g = rgb[p * 3 + 1], b = rgb[p * 3 + 2];
    sum += Math.max(r, g, b) - Math.min(r, g, b);
  }
  return sum / n;
}
