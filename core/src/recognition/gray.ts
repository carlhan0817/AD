// 灰度公式契约:ITU-R 601,与 Pillow convert("L") 一致。
// L = round(0.299R + 0.587G + 0.114B)。
// **不可改用 Rec.709 / sharp.greyscale()**——否则与建索引侧(Python)不一致,识别必偏。
// 任何把 RGB 转灰度的地方(测试、main/ 截屏解码)都必须走这里。

export function rgbToGray601(r: number, g: number, b: number): number {
  return Math.round(0.299 * r + 0.587 * g + 0.114 * b);
}

/** 把交错的 RGB(A) 原始像素缓冲转成 H×W 灰度二维数组(601)。 */
export function rawRgbToGray(
  data: Uint8Array | Buffer,
  width: number,
  height: number,
  channels: number,
): number[][] {
  const out: number[][] = [];
  for (let y = 0; y < height; y++) {
    const row: number[] = [];
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels;
      row.push(rgbToGray601(data[i], data[i + 1], data[i + 2]));
    }
    out.push(row);
  }
  return out;
}
