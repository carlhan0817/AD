// core/tests/recognition/active_picker.test.ts
import { describe, it, expect } from "vitest";
import { detectActivePicker, type RgbStrip, HIGHLIGHT } from "../../src/recognition/active_picker";

// 构造一个 10 行的彩色扫描带(纯 RGB,3 通道),只有第 row 行充满高亮色。
function strip(rowWithHighlight: number, rows = 10): RgbStrip {
  const rowH = 4, w = 3, channels = 3;
  const h = rows * rowH;
  const data = new Uint8Array(w * h * channels);
  for (let y = 0; y < h; y++) {
    const r = Math.floor(y / rowH);
    const c = r === rowWithHighlight ? HIGHLIGHT : { r: 20, g: 20, b: 20 };
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * channels;
      data[i] = c.r; data[i + 1] = c.g; data[i + 2] = c.b;
    }
  }
  return { width: w, height: h, rows, channels, data };
}

describe("detectActivePicker", () => {
  it("returns the highlighted row", () => {
    expect(detectActivePicker(strip(3)).row).toBe(3);
  });
  it("returns null when no row is highlighted", () => {
    expect(detectActivePicker(strip(-1)).row).toBeNull();
  });
  it("throws on a 4-channel (RGBA) strip instead of silently mis-offsetting", () => {
    const bad = { ...strip(3), channels: 4 };
    expect(() => detectActivePicker(bad)).toThrow(/RGB/i);
  });
});
