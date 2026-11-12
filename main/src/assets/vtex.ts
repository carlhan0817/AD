// main/src/assets/vtex.ts
// 解 Dota 的贴图文件(.vtex_c)。英雄选取立绘有两种存法(2026-11 实测本机 Dota):
//   - 里面直接放一张 PNG(大多数英雄);
//   - DXT5 压缩块(较新的英雄,如 hoodwink / marci / muerta)。
// 两种都只有一层、没有再压缩,像素数据紧跟在文件头后面。其他存法不认,返回 null。
// 纯函数,不碰磁盘。
import type { RgbFrame } from "@ad/core/recognition/rgb";

export type VtexImage = { kind: "png"; png: Uint8Array } | { kind: "rgb"; frame: RgbFrame };

const FORMAT_DXT5 = 2;
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function startsWithPng(buf: Buffer, at: number): boolean {
  if (at + PNG_MAGIC.length > buf.length) return false;
  for (let i = 0; i < PNG_MAGIC.length; i++) if (buf[at + i] !== PNG_MAGIC[i]) return false;
  return true;
}

/** RGB565 → 8 位三通道。 */
function rgb565(c: number): [number, number, number] {
  const r = (c >> 11) & 31, g = (c >> 5) & 63, b = c & 31;
  return [(r << 3) | (r >> 2), (g << 2) | (g >> 4), (b << 3) | (b >> 2)];
}

/** 一个 DXT5 块里的 16 个透明度值(前 8 个字节:两个端点 + 16 个 3 位下标)。 */
function dxt5Alpha(data: Uint8Array, o: number, out: Uint8Array): void {
  const a0 = data[o], a1 = data[o + 1];
  const levels = [a0, a1, 0, 0, 0, 0, 0, 255];
  if (a0 > a1) for (let i = 1; i < 7; i++) levels[i + 1] = Math.round(((7 - i) * a0 + i * a1) / 7);
  else for (let i = 1; i < 5; i++) levels[i + 1] = Math.round(((5 - i) * a0 + i * a1) / 5);
  // 48 位下标分成两个 24 位来取,避免超出 32 位整数。
  for (let half = 0; half < 2; half++) {
    const q = o + 2 + half * 3;
    const bits = data[q] | (data[q + 1] << 8) | (data[q + 2] << 16);
    for (let i = 0; i < 8; i++) out[half * 8 + i] = levels[(bits >> (i * 3)) & 7];
  }
}

const clamp8 = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));

/** DXT5 压缩块 → RGB。Dota 的这类贴图存的不是直接的红绿蓝,而是「亮度 + 两个色差」(YCoCg):
 *  亮度放在透明度通道,色差放在红、绿通道,蓝通道是色差的放大倍数。这里换算回红绿蓝
 *  (2026-11 拿本机 9 个这样存的英雄和流水线下载的原图比过)。数据不够时返回 null。 */
export function decodeDxt5Rgb(data: Uint8Array, width: number, height: number): RgbFrame | null {
  const bw = Math.ceil(width / 4), bh = Math.ceil(height / 4);
  if (width <= 0 || height <= 0 || data.length < bw * bh * 16) return null;
  const out = new Uint8Array(width * height * 3);
  const luma = new Uint8Array(16);
  for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
    const blk = (by * bw + bx) * 16, o = blk + 8;
    dxt5Alpha(data, blk, luma);
    const c0 = rgb565(data[o] | (data[o + 1] << 8)), c1 = rgb565(data[o + 2] | (data[o + 3] << 8));
    const palette = [
      c0, c1,
      c0.map((v, i) => Math.round((2 * v + c1[i]) / 3)),
      c0.map((v, i) => Math.round((v + 2 * c1[i]) / 3)),
    ];
    for (let py = 0; py < 4; py++) {
      const y = by * 4 + py;
      if (y >= height) break;
      const bits = data[o + 4 + py];
      for (let px = 0; px < 4; px++) {
        const x = bx * 4 + px;
        if (x >= width) break;
        const c = palette[(bits >> (px * 2)) & 3];
        const scale = (c[2] >> 3) + 1;
        const co = (c[0] - 128) / scale, cg = (c[1] - 128) / scale, lum = luma[py * 4 + px];
        const d = (y * width + x) * 3;
        out[d] = clamp8(lum + co - cg); out[d + 1] = clamp8(lum + cg); out[d + 2] = clamp8(lum - co - cg);
      }
    }
  }
  return { width, height, data: out };
}

/** 解一个 .vtex_c 文件。认不出来返回 null(调用方当作没有这张图)。 */
export function decodeVtex(file: Buffer): VtexImage | null {
  try {
    if (file.length < 16) return null;
    const headerSize = file.readUInt32LE(0); // 文件头的总长度,像素数据从这里开始
    const blockOffset = 8 + file.readUInt32LE(8);
    const blockCount = file.readUInt32LE(12);
    if (headerSize > file.length) return null;
    for (let b = 0; b < blockCount; b++) {
      const q = blockOffset + b * 12;
      if (file.toString("ascii", q, q + 4) !== "DATA") continue;
      const data = q + 4 + file.readUInt32LE(q + 4);
      const width = file.readUInt16LE(data + 20), height = file.readUInt16LE(data + 22);
      const format = file.readUInt8(data + 26);
      if (startsWithPng(file, headerSize)) return { kind: "png", png: file.subarray(headerSize) };
      if (format !== FORMAT_DXT5) return null;
      const frame = decodeDxt5Rgb(file.subarray(headerSize), width, height);
      return frame === null ? null : { kind: "rgb", frame };
    }
    return null;
  } catch {
    return null; // 读越界 = 文件不是我们认识的样子
  }
}
