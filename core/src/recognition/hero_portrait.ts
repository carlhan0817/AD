// core/src/recognition/hero_portrait.ts
// 认「我」那张卡上的英雄头像。卡上头像与英雄选取立绘(selection 图)是同一套美术,
// 只是裁得更近、被名字和技能格挡住一部分。做法:把立绘按几种缩放/位置切成很多小块(变体),
// 与卡上头像不被遮挡的一块逐个比相关系数,取每个英雄最像的变体。
// 只在「本局已被选走的英雄」里找(调用方传候选),把握不够就返回 null——宁可当作还没选英雄。
import type { PlayerCard } from "./player_cards";
import { cropResizeRgb, type RgbFrame } from "./rgb";

const SIZE = 48;

/** 卡上头像里不被名字/技能格挡住的一块(左卡头像在左边,右卡在右边)。 */
export function portraitRegion(card: PlayerCard): { x: number; y: number; w: number; h: number } {
  const sx = card.w / 320, sy = card.h / 146;
  const x = card.row < 5 ? card.x + Math.round(4 * sx) : card.x + Math.round(240 * sx);
  return { x, y: card.y + Math.round(6 * sy), w: Math.round(76 * sx), h: Math.round(76 * sy) };
}

/** 去均值、归一化后的向量;两个这样的向量点积就是相关系数。 */
function normVec(rgb: Uint8Array): Float32Array {
  const v = new Float32Array(rgb.length);
  let mean = 0;
  for (let i = 0; i < rgb.length; i++) mean += rgb[i];
  mean /= rgb.length;
  let norm = 0;
  for (let i = 0; i < rgb.length; i++) { v[i] = rgb[i] - mean; norm += v[i] * v[i]; }
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < v.length; i++) v[i] /= norm;
  return v;
}

function dot(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function mirror(img: RgbFrame): RgbFrame {
  const out = new Uint8Array(img.data.length);
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
    const s = (y * img.width + x) * 3, d = (y * img.width + (img.width - 1 - x)) * 3;
    out[d] = img.data[s]; out[d + 1] = img.data[s + 1]; out[d + 2] = img.data[s + 2];
  }
  return { width: img.width, height: img.height, data: out };
}

/** 一张立绘切出的全部变体:4 种块大小 × 5 个横向位置 × 4 个纵向位置(偏上半身),再加左右镜像。 */
export function portraitVariants(art: RgbFrame): Float32Array[] {
  const out: Float32Array[] = [];
  for (const img of [art, mirror(art)]) {
    for (const side of [0.45, 0.55, 0.65, 0.75]) {
      const sz = Math.round(img.width * side);
      for (let ix = 0; ix < 5; ix++) for (let iy = 0; iy < 4; iy++) {
        const x0 = Math.round(((img.width - sz) * ix) / 4);
        const y0 = Math.round(((img.height - sz) * 0.5 * iy) / 3);
        out.push(normVec(cropResizeRgb(img, x0, y0, sz, sz, SIZE)));
      }
    }
  }
  return out;
}

// 真机实测(2026-10-27,候选为全部 12 个英雄):认对的卡最像分 0.71–0.91、领先第二名 0.15 以上;
// 认错的那张(Dawnbreaker)最像分与第二名相同。只在已被选走的英雄里找时候选更少,领先会更大。
export const PORTRAIT_MIN_SCORE = 0.6;
export const PORTRAIT_MIN_MARGIN = 0.12;

export interface PortraitMatch { heroId: number | null; best: number | null; score: number; margin: number; }

/** 在候选英雄里找卡上的头像;不够把握时 heroId 为 null(best 仍给出最像的那个,供日志)。 */
export function identifyPortrait(
  frame: RgbFrame, card: PlayerCard, candidates: ReadonlyMap<number, Float32Array[]>,
): PortraitMatch {
  const r = portraitRegion(card);
  const v = normVec(cropResizeRgb(frame, r.x, r.y, r.w, r.h, SIZE));
  let best: number | null = null, bestScore = -1, second = -1;
  for (const [heroId, variants] of candidates) {
    let s = -1;
    for (const t of variants) { const d = dot(v, t); if (d > s) s = d; }
    if (s > bestScore) { second = bestScore; bestScore = s; best = heroId; }
    else if (s > second) second = s;
  }
  const margin = second < 0 ? bestScore : bestScore - second;
  const ok = best !== null && bestScore >= PORTRAIT_MIN_SCORE && margin >= PORTRAIT_MIN_MARGIN;
  return { heroId: ok ? best : null, best, score: bestScore, margin };
}
