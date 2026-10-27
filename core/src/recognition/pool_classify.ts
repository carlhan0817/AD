// core/src/recognition/pool_classify.ts
// 读一帧的技能池 48 格:先判空(已选走/变暗的格不认),有图标的格交给分类器。
// 把握不到 ML_CONFIDENCE 的格先标「不确定」(name=null,但保留 guess 供后续按组/第二意见救回)。
// 只负责「每格是什么」;按组定英雄、救回不确定格在别的模块。
import { CLASSIFIER_INPUT_SIZE, type Classifier } from "./classifier";
import { cropResizeRgb, isEmptyCell, type RgbFrame } from "./rgb";
import { poolSlots, type PoolSlot } from "./pool_slots";
import type { ClientRect } from "./roi";

/** 分类器直接采信的把握下限(与上游一致)。 */
export const ML_CONFIDENCE = 0.9;

// 模型标签与官方图标名对不上的类别,按官方图标名改正。
// chen 这两个:模型把「绿色旋涡」图标标成 holy_persuasion、「蓝色灯杖」标成 divine_favor,
// 而官方 CDN 图标文件(= pHash 索引的来源)正好相反。2026-10-03 目视核对后以官方图标名为准。
export const CLASS_NAME_FIXES: Readonly<Record<string, string>> = {
  chen_holy_persuasion: "chen_divine_favor",
  chen_divine_favor: "chen_holy_persuasion",
};

export interface CellRead {
  slot: PoolSlot;
  /** 该格已被选走/变暗,没有送去识别。 */
  empty: boolean;
  /** 采信的技能 shortName;空格或不确定时为 null。 */
  name: string | null;
  /** 分类器最像的那个(即使把握不够也保留);空格为 null。 */
  guess: string | null;
  confidence: number;
}

/** 读技能池 48 格,顺序同 poolSlots(先 12 终极,后 36 标准)。 */
export async function readPool(
  frame: RgbFrame, rect: ClientRect, clf: Classifier,
): Promise<CellRead[]> {
  const slots = poolSlots(rect);
  const crops = slots.map((s) => cropResizeRgb(frame, s.x, s.y, s.w, s.h, CLASSIFIER_INPUT_SIZE));
  const live: number[] = [];
  crops.forEach((c, i) => { if (!isEmptyCell(c)) live.push(i); });

  const cellBytes = CLASSIFIER_INPUT_SIZE * CLASSIFIER_INPUT_SIZE * 3;
  const batch = new Uint8Array(live.length * cellBytes);
  live.forEach((i, k) => batch.set(crops[i], k * cellBytes));
  const preds = await clf.classify(batch);

  const out: CellRead[] = slots.map((slot) => ({ slot, empty: true, name: null, guess: null, confidence: 0 }));
  live.forEach((i, k) => {
    const p = preds[k];
    const guess = CLASS_NAME_FIXES[p.name] ?? p.name;
    out[i] = {
      slot: slots[i], empty: false, guess, confidence: p.confidence,
      name: p.confidence >= ML_CONFIDENCE ? guess : null,
    };
  });
  return out;
}
