import sharp from "sharp";
import type { GrayFrame } from "@ad/core/recognition/grid";
import { rgbToGray601 } from "@ad/core/recognition/gray";

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
