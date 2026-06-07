// core/src/recognition/frame_diff.ts
// ROI 内像素 hash + 真正的防抖(第一层无效帧防护,计划书 §四)。
// 防抖语义:画面变 → 重置稳定计数、丢帧;静止 → 计数 +1;连续 stabilityFrames 帧静止
// 才放行「最终稳定帧」,且每段静止只放行一次。绝不放行动画中的半截废帧。

/** 轻量 FNV-1a over 像素,够区分「画面是否变了」,不需密码学强度。 */
export function roiHash(roi: number[][]): string {
  let h = 0x811c9dc5;
  for (const row of roi) {
    for (const v of row) {
      h ^= v & 0xff;
      h = Math.imul(h, 0x01000193) >>> 0;
    }
  }
  return h.toString(16).padStart(8, "0");
}

export class FrameGate {
  private last: string[] | null = null;
  private stableCount = 0;   // 当前画面已连续静止多少帧
  private released = false;   // 本段静止是否已放行过(防重复)

  /** stabilityFrames: 需连续静止多少帧才认定动画结束、放行最终稳定帧(≥1)。 */
  constructor(private readonly stabilityFrames = 3) {}

  /** rois: 本帧各 ROI 的灰度块。任一 ROI 的 hash 变化即「画面在动」。
   *  返回 true 仅当:画面已连续静止达 stabilityFrames 帧,且本段尚未放行过。 */
  shouldProcess(rois: number[][][]): boolean {
    const hashes = rois.map(roiHash);
    const changed =
      this.last === null ||
      hashes.length !== this.last.length ||
      hashes.some((h, i) => h !== this.last![i]);
    this.last = hashes;

    if (changed) {
      // 画面在动:重置稳定计数 + 放行标记,丢弃本帧。
      this.stableCount = 1; // 本帧本身算这段静止的第 1 帧
      this.released = false;
      // stabilityFrames=1 时:出现即满足「1 帧静止」,可立即放行。
      if (this.stableCount >= this.stabilityFrames && !this.released) {
        this.released = true;
        return true;
      }
      return false;
    }

    // 画面静止:累计。
    this.stableCount += 1;
    if (!this.released && this.stableCount >= this.stabilityFrames) {
      this.released = true; // 放行最终稳定帧,本段不再重复
      return true;
    }
    return false;
  }
}
