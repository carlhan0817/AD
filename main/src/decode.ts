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
