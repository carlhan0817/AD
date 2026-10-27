import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { toGrayFrame, toFrames, rawToFrames } from "../src/decode";

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

describe("toFrames", () => {
  it("同一张图同时给出彩色与灰度,尺寸一致,灰度由彩色按 601 派生", async () => {
    const png = await sharp({
      create: { width: 8, height: 4, channels: 4, background: { r: 200, g: 100, b: 50, alpha: 1 } },
    }).png().toBuffer();
    const { rgb, gray } = await toFrames(png);
    expect([rgb.width, rgb.height]).toEqual([8, 4]);
    expect([gray.width, gray.height]).toEqual([8, 4]);
    expect(rgb.data.length).toBe(8 * 4 * 3);
    expect([rgb.data[0], rgb.data[1], rgb.data[2]]).toEqual([200, 100, 50]);
    expect(gray.data[0]).toBe(Math.round(0.299 * 200 + 0.587 * 100 + 0.114 * 50));
    // 与旧的 toGrayFrame 逐字节一致(旧链路不受影响)
    expect(Array.from(gray.data)).toEqual(Array.from((await toGrayFrame(png)).data));
  });
});

describe("rawToFrames", () => {
  it("BGRA(截屏位图)与 RGBA(canvas)都转成同样的 RGB + 601 灰度", () => {
    const bgra = new Uint8Array([50, 100, 200, 255, 0, 0, 0, 255]);
    const rgba = new Uint8Array([200, 100, 50, 255, 0, 0, 0, 255]);
    const a = rawToFrames(bgra, 2, 1, "bgra"), b = rawToFrames(rgba, 2, 1, "rgba");
    expect(Array.from(a.rgb.data)).toEqual([200, 100, 50, 0, 0, 0]);
    expect(Array.from(b.rgb.data)).toEqual(Array.from(a.rgb.data));
    expect(a.gray.data[0]).toBe(Math.round(0.299 * 200 + 0.587 * 100 + 0.114 * 50));
  });
  it("数据不够长时报错", () => {
    expect(() => rawToFrames(new Uint8Array(4), 2, 1, "bgra")).toThrow();
  });
});
