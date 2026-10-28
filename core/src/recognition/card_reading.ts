// core/src/recognition/card_reading.ts
// 读玩家卡:哪张是「我」(绿色外框)、现在轮到谁(金色底)、每张卡上已经选了哪些技能。
// 判据都在 2026-10-27 真机 15 帧(5 局)上量过,见各常量注释。
import { CLASSIFIER_INPUT_SIZE, type Classifier } from "./classifier";
import { CLASS_NAME_FIXES, ML_CONFIDENCE } from "./pool_classify";
import { cropResizeRgb, isEmptyCell, type RgbFrame } from "./rgb";
import { cardSlots, playerCards, type PlayerCard } from "./player_cards";
import type { ClientRect } from "./roi";

/** 卡上标题那一行(英雄名 /「无英雄」)与其下方底色带的位置,避开头像(左卡头像在左、右卡在右)。 */
function bands(card: PlayerCard): { x0: number; x1: number; titleY0: number; titleY1: number; bgY0: number; bgY1: number } {
  const sx = card.w / 320, sy = card.h / 146;
  const left = card.row < 5;
  const x0 = card.x + Math.round((left ? 85 : 20) * sx);
  const x1 = card.x + Math.round((left ? 300 : 235) * sx);
  return {
    x0, x1,
    titleY0: card.y + Math.round(8 * sy), titleY1: card.y + Math.round(40 * sy),
    bgY0: card.y + Math.round(60 * sy), bgY1: card.y + Math.round(85 * sy),
  };
}

function eachPixel(frame: RgbFrame, x0: number, x1: number, y0: number, y1: number, fn: (r: number, g: number, b: number) => void): number {
  let n = 0;
  for (let y = Math.max(0, y0); y < Math.min(frame.height, y1); y++) {
    for (let x = Math.max(0, x0); x < Math.min(frame.width, x1); x++) {
      const i = (y * frame.width + x) * 3;
      fn(frame.data[i], frame.data[i + 1], frame.data[i + 2]);
      n++;
    }
  }
  return n;
}

/** 卡朝外那条边上「饱和的绿色」像素占比。本人的卡有一圈绿色外框(坐左列时在卡的左边缘,
 *  坐右列时在右边缘),别人的卡没有。2026-10-28 发现:原先用「标题是白字」只在坐左列时成立,
 *  坐右列时本人标题和队友一样是绿字,认不出。 */
export function myOutlineFraction(frame: RgbFrame, card: PlayerCard): number {
  const sx = card.w / 320, sy = card.h / 146;
  const left = card.row < 5;
  // 外框落在卡的外边缘往里约 10px 以内(实测左列在 x+0..x+4,右列在 x+308..x+316)。
  const x0 = left ? card.x - Math.round(4 * sx) : card.x + card.w - Math.round(10 * sx);
  const x1 = left ? card.x + Math.round(10 * sx) : card.x + card.w + Math.round(4 * sx);
  let green = 0;
  const n = eachPixel(frame, x0, x1, card.y + Math.round(20 * sy), card.y + Math.round(126 * sy), (r, g, b) => {
    if (g > 90 && g > 2.5 * r && b < 40) green++;
  });
  return n === 0 ? 0 : green / n;
}

// 真机 19 帧(两个座位:左1、右4)实测:本人卡外框占比 7–43%(坐左列时外框亮绿 ≈(86,253,0),
// 坐右列时暗绿 ≈(20,114,0);轮到自己时金色底会压低到 7%),其他卡全部 0%
// (队友卡边缘是 ≈(4,44,2) 的暗底色,不够绿)。要求最高的那张够绿、且明显高于第二名。
export const MY_OUTLINE_MIN = 0.03;

/** 哪一行是「我」;认不出(没有一张有外框,或有两张差不多)返回 null。 */
export function findMyRow(frame: RgbFrame, rect: ClientRect): number | null {
  const scored = playerCards(rect).map((c) => ({ row: c.row, v: myOutlineFraction(frame, c) }))
    .sort((a, b) => b.v - a.v);
  const [first, second] = scored;
  if (first.v < MY_OUTLINE_MIN || second.v > first.v / 2) return null;
  return first.row;
}

/** 卡的底色是否为「轮到这个人选」的金色。真机:金色底约 (105,95,55),其他卡 R、G 都在 35 以下。 */
export function isGoldCard(frame: RgbFrame, card: PlayerCard): boolean {
  const b = bands(card);
  let r = 0, g = 0, bl = 0;
  const n = eachPixel(frame, b.x0, b.x1, b.bgY0, b.bgY1, (pr, pg, pb) => { r += pr; g += pg; bl += pb; });
  if (n === 0) return false;
  r /= n; g /= n; bl /= n;
  return r > 90 && g > 80 && bl < r * 0.8;
}

/** 现在轮到哪一行选;没有或不止一张金卡时返回 null。 */
export function findActiveRow(frame: RgbFrame, rect: ClientRect): number | null {
  const gold = playerCards(rect).filter((c) => isGoldCard(frame, c));
  return gold.length === 1 ? gold[0].row : null;
}

export interface CardPicks {
  row: number;
  normals: string[];
  ultimate: string | null;
  /** 有图标但没认出来的格数。 */
  unknown: number;
}

/** 读 10 张卡上已选的技能。卡上的图标是平面的,用认池子的同一个分类器认(真机 5 帧对答案全对;
 *  拿官方图标比对反而有两格因美术不同认错)。allowed 给了的话,只采信本局池子里出现过的技能。 */
export async function readCardPicks(
  frame: RgbFrame, rect: ClientRect, clf: Classifier, allowed?: ReadonlySet<string>,
): Promise<CardPicks[]> {
  const slots = cardSlots(rect);
  const crops = slots.map((s) => cropResizeRgb(frame, s.x, s.y, s.w, s.h, CLASSIFIER_INPUT_SIZE));
  const live = crops.map((c, i) => (isEmptyCell(c) ? -1 : i)).filter((i) => i >= 0);
  const bytes = CLASSIFIER_INPUT_SIZE * CLASSIFIER_INPUT_SIZE * 3;
  const batch = new Uint8Array(live.length * bytes);
  live.forEach((i, k) => batch.set(crops[i], k * bytes));
  const preds = await clf.classify(batch);

  const out: CardPicks[] = Array.from({ length: 10 }, (_v, row) => ({ row, normals: [], ultimate: null, unknown: 0 }));
  live.forEach((i, k) => {
    const s = slots[i];
    const p = preds[k];
    const name = CLASS_NAME_FIXES[p.name] ?? p.name;
    const ok = p.confidence >= ML_CONFIDENCE && (allowed === undefined || allowed.size === 0 || allowed.has(name));
    const card = out[s.row];
    if (!ok) { card.unknown++; return; }
    if (s.ultimate) card.ultimate = name;
    else card.normals.push(name);
  });
  return out;
}
