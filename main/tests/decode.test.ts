import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { toGrayFrame } from "../src/decode";

describe("toGrayFrame", () => {
  it("decodes png buffer to grayscale frame (601)", async () => {
    const png = await sharp({
      create: { width: 8, height: 4, channels: 3, background: { r: 100, g: 100, b: 100 } },
    }).png().toBuffer();
    const f = await toGrayFrame(png);
    expect(f.width).toBe(8);
    expect(f.height).toBe(4);
    expect(f.data.length).toBe(32);
    expect(f.data[0]).toBeGreaterThan(90);  // 灰度 ~100
  });
});
