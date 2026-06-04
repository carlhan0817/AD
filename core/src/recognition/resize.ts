// 权威双线性缩放到 32x32。必须与 pipeline/src/ad_pipeline/resize.py 逐位一致。
// 半像素中心对齐 + clamp 边界 + Math.floor(v + 0.5) 舍入(不用 Math.round,避免 .5 方向分歧)。

const N = 32;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function resizeGrayTo32(src: number[][]): number[][] {
  const h = src.length;
  const w = src[0].length;
  const out: number[][] = [];
  for (let ry = 0; ry < N; ry++) {
    const sy = ((ry + 0.5) * h) / N - 0.5;
    const y0 = Math.floor(sy);
    const fy = sy - y0;
    const y0c = clamp(y0, 0, h - 1);
    const y1c = clamp(y0 + 1, 0, h - 1);
    const row: number[] = [];
    for (let rx = 0; rx < N; rx++) {
      const sx = ((rx + 0.5) * w) / N - 0.5;
      const x0 = Math.floor(sx);
      const fx = sx - x0;
      const x0c = clamp(x0, 0, w - 1);
      const x1c = clamp(x0 + 1, 0, w - 1);
      const top = src[y0c][x0c] * (1 - fx) + src[y0c][x1c] * fx;
      const bot = src[y1c][x0c] * (1 - fx) + src[y1c][x1c] * fx;
      const val = top * (1 - fy) + bot * fy;
      row.push(Math.floor(val + 0.5));
    }
    out.push(row);
  }
  return out;
}
