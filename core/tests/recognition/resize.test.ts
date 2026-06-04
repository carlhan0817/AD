import { describe, it, expect } from "vitest";
import { resizeGrayTo32 } from "../../src/recognition/resize";

describe("resizeGrayTo32", () => {
  it("outputs 32x32 ints", () => {
    const src = Array.from({ length: 10 }, () => Array(10).fill(100));
    const out = resizeGrayTo32(src);
    expect(out.length).toBe(32);
    expect(out.every((r) => r.length === 32)).toBe(true);
    expect(Number.isInteger(out[0][0])).toBe(true);
  });

  it("preserves a solid image", () => {
    const src = Array.from({ length: 64 }, () => Array(64).fill(128));
    expect(resizeGrayTo32(src).every((r) => r.every((v) => v === 128))).toBe(true);
  });

  it("matches Python corner alignment for 2x2 upscale", () => {
    // 与 test_resize.py::test_known_2x2_upscale_center_alignment 同输入同期望
    const out = resizeGrayTo32([[0, 255], [255, 0]]);
    expect(out[0][0]).toBe(0);
    expect(out[0][31]).toBe(255);
    expect(out[31][0]).toBe(255);
    expect(out[31][31]).toBe(0);
  });
});
