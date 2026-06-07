// core/src/recognition/layout_guard.ts
// 第二层无效帧防护:UI 锚点可见性。遮挡层(详情/英雄面板)→ 锚点方差骤降 → 判无效帧。

export function anchorVariance(roi: number[][]): number {
  let sum = 0;
  let n = 0;
  for (const row of roi) for (const v of row) { sum += v; n += 1; }
  const mean = sum / n;
  let varSum = 0;
  for (const row of roi) for (const v of row) varSum += (v - mean) ** 2;
  return varSum / n;
}

/** 锚点被认为「可见」的最小方差(遮挡半透明纯色面板方差远低于此)。 */
const MIN_ANCHOR_VARIANCE = 50;

/** 所有锚点 ROI 都需有结构(方差足够)才算规范选取布局。 */
export function isValidLayout(anchorRois: number[][][]): boolean {
  return anchorRois.every((roi) => anchorVariance(roi) >= MIN_ANCHOR_VARIANCE);
}
