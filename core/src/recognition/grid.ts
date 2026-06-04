import { resizeGrayTo32 } from "./resize";

export interface GrayFrame { width: number; height: number; data: Uint8Array; }
export interface GridSpec {
  x: number; y: number;          // 网格左上角(像素)
  cellW: number; cellH: number;  // 单格尺寸
  gapX: number; gapY: number;    // 格间距
  rows: number; cols: number;
}

/** 切出原始像素子矩形(不缩放),越界 clamp 到边缘。 */
export function cropRaw(
  frame: GrayFrame, sx: number, sy: number, sw: number, sh: number,
): number[][] {
  const out: number[][] = [];
  for (let dy = 0; dy < sh; dy++) {
    const py = Math.min(frame.height - 1, Math.max(0, sy + dy));
    const row: number[] = [];
    for (let dx = 0; dx < sw; dx++) {
      const px = Math.min(frame.width - 1, Math.max(0, sx + dx));
      row.push(frame.data[py * frame.width + px]);
    }
    out.push(row);
  }
  return out;
}

export function cropGrid(frame: GrayFrame, spec: GridSpec): number[][][] {
  const cells: number[][][] = [];
  for (let r = 0; r < spec.rows; r++) {
    for (let c = 0; c < spec.cols; c++) {
      const sx = spec.x + c * (spec.cellW + spec.gapX);
      const sy = spec.y + r * (spec.cellH + spec.gapY);
      const raw = cropRaw(frame, sx, sy, spec.cellW, spec.cellH);
      cells.push(resizeGrayTo32(raw)); // 共享双线性核,与建索引侧一致
    }
  }
  return cells;
}
