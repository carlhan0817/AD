import { describe, it, expect } from "vitest";
import { phashFromGray, hamming } from "../../src/recognition/phash";

function solid(v: number): number[][] {
  return Array.from({ length: 32 }, () => Array(32).fill(v));
}

describe("phash", () => {
  it("produces 16 hex chars", () => {
    const h = phashFromGray(solid(128));
    expect(h).toMatch(/^[0-9a-f]{16}$/);
  });

  it("matches Python authoritative hash for solid image", () => {
    // 来自:python -c "from ad_pipeline.phash import phash_from_gray; print(phash_from_gray([[128]*32 for _ in range(32)]))"
    // DC 项(bit0)是最大值,> median+EPS 为真 → 最高位置 1 → 8000...
    expect(phashFromGray(solid(128))).toBe("8000000000000000");
  });

  it("identical images have zero hamming distance", () => {
    expect(hamming(phashFromGray(solid(100)), phashFromGray(solid(100)))).toBe(0);
  });

  it("different images differ", () => {
    const half = Array.from({ length: 32 }, () =>
      [...Array(16).fill(0), ...Array(16).fill(255)]);
    expect(hamming(phashFromGray(half), phashFromGray(solid(128)))).toBeGreaterThan(0);
  });
});
