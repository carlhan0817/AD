import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resizeGrayTo32 } from "../../src/recognition/resize";
import { phashFromGray, hamming } from "../../src/recognition/phash";
import { rawRgbToGray } from "../../src/recognition/gray";

const png = fileURLToPath(new URL("../fixtures/xval_sprite.png", import.meta.url));
const expected = JSON.parse(
  readFileSync(fileURLToPath(new URL("../fixtures/xval_expected.json", import.meta.url)), "utf-8"),
) as { phash: string };

async function decodeGray(path: string): Promise<number[][]> {
  // 取原始 RGB,按共享的 601 契约转灰度(与 Pillow convert("L") 一致)。
  const { data, info } = await sharp(path).removeAlpha().raw()
    .toBuffer({ resolveWithObject: true });
  return rawRgbToGray(data, info.width, info.height, info.channels);
}

describe("cross-language phash (real PNG, full pipeline)", () => {
  it("TS pipeline matches Python authoritative hash", async () => {
    const gray = await decodeGray(png);
    const ts = phashFromGray(resizeGrayTo32(gray));
    // 目标 0;容忍 <=4 应对极少数浮点临界 bit
    expect(hamming(ts, expected.phash)).toBeLessThanOrEqual(4);
  });
});
