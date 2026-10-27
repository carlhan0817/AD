import sharp from "sharp";
import type { GrayFrame } from "@ad/core/recognition/grid";
import { rgbToGray601 } from "@ad/core/recognition/gray";
import { rgbFrameToGray, type RgbFrame } from "@ad/core/recognition/rgb";

/**
 * 解码 PNG → GrayFrame(灰度用共享 601 契约,与建索引侧一致)。
 * 不用 sharp.greyscale()(Rec.709)——见 core/src/recognition/gray.ts。
 */
export async function toGrayFrame(pngBuffer: Buffer): Promise<GrayFrame> {
  const { data, info } = await sharp(pngBuffer).removeAlpha().raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const gray = new Uint8Array(width * height);
  for (let p = 0; p < width * height; p++) {
    const i = p * channels;
    gray[p] = rgbToGray601(data[i], data[i + 1], data[i + 2]);
  }
  return { width, height, data: gray };
}

/** 解码 PNG → 彩色帧(RGB 交错,丢 alpha)。分类器用彩色。 */
export async function toRgbFrame(pngBuffer: Buffer): Promise<RgbFrame> {
  const { data, info } = await sharp(pngBuffer).removeAlpha().toColourspace("srgb").raw()
    .toBuffer({ resolveWithObject: true });
  if (info.channels !== 3) throw new Error(`toRgbFrame: 期望 3 通道,得到 ${info.channels}`);
  return { width: info.width, height: info.height, data: new Uint8Array(data) };
}

/** 同一张图同时给出彩色与灰度两份(灰度由彩色派生,尺寸与内容一致)。 */
export async function toFrames(pngBuffer: Buffer): Promise<{ rgb: RgbFrame; gray: GrayFrame }> {
  const rgb = await toRgbFrame(pngBuffer);
  return { rgb, gray: rgbFrameToGray(rgb) };
}

/** 4 通道原始像素(截屏位图)→ 彩色 + 灰度两帧,不经过 PNG 编解码(省 ~80ms,像素完全一样)。
 *  order:"bgra" 是 Electron NativeImage.toBitmap() 的排列,"rgba" 是 canvas getImageData 的排列。 */
export function rawToFrames(
  px: Uint8Array | Buffer, width: number, height: number, order: "bgra" | "rgba",
): { rgb: RgbFrame; gray: GrayFrame } {
  const n = width * height;
  if (px.length < n * 4) throw new Error(`rawToFrames: 像素数据长度 ${px.length} 不足 ${width}x${height}x4`);
  const rgb = new Uint8Array(n * 3);
  const [ri, bi] = order === "bgra" ? [2, 0] : [0, 2];
  for (let p = 0, q = 0; p < n * 4; p += 4, q += 3) {
    rgb[q] = px[p + ri]; rgb[q + 1] = px[p + 1]; rgb[q + 2] = px[p + bi];
  }
  const frame: RgbFrame = { width, height, data: rgb };
  return { rgb: frame, gray: rgbFrameToGray(frame) };
}
