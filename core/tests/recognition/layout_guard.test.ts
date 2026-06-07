// core/tests/recognition/layout_guard.test.ts
import { describe, it, expect } from "vitest";
import { isValidLayout, anchorVariance } from "../../src/recognition/layout_guard";

function structured(): number[][] {
  // 高方差:棋盘
  return Array.from({ length: 16 }, (_, y) =>
    Array.from({ length: 16 }, (_, x) => ((x + y) % 2 ? 220 : 30)));
}
function flat(v: number): number[][] {
  return Array.from({ length: 16 }, () => Array(16).fill(v));
}

describe("layout_guard", () => {
  it("anchorVariance is high for structured anchors, ~0 for flat overlays", () => {
    expect(anchorVariance(structured())).toBeGreaterThan(1000);
    expect(anchorVariance(flat(128))).toBeLessThan(1);
  });

  it("valid layout: all anchors structured", () => {
    expect(isValidLayout([structured(), structured()])).toBe(true);
  });

  it("invalid layout: an anchor is occluded by a flat panel", () => {
    expect(isValidLayout([structured(), flat(120)])).toBe(false);
  });
});
