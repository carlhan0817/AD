// core/tests/recognition/layout_derive.test.ts
import { describe, it, expect } from "vitest";
import { deriveLayout } from "../../src/recognition/layout_derive";
import { LAYOUT_1080P } from "../../src/recognition/roi";

describe("deriveLayout", () => {
  it("returns the calibrated 1080p layout at 1920x1080 (regression)", () => {
    const got = deriveLayout({ x: 0, y: 0, width: 1920, height: 1080 });
    expect(got.pool).toEqual(LAYOUT_1080P.pool);
    expect(got.timer).toEqual(LAYOUT_1080P.timer);
    expect(got.rowPitch).toBe(LAYOUT_1080P.rowPitch);
  });

  it("scales coordinates proportionally at 2560x1440 (1.333x)", () => {
    const got = deriveLayout({ x: 0, y: 0, width: 2560, height: 1440 });
    expect(got.pool.x).toBe(Math.round(LAYOUT_1080P.pool.x * (2560 / 1920)));
    expect(got.pool.cellW).toBe(Math.round(LAYOUT_1080P.pool.cellW * (1440 / 1080)));
  });

  it("offsets by window origin (non-zero x/y)", () => {
    const got = deriveLayout({ x: 100, y: 50, width: 1920, height: 1080 });
    expect(got.pool.x).toBe(LAYOUT_1080P.pool.x + 100);
    expect(got.pool.y).toBe(LAYOUT_1080P.pool.y + 50);
  });
});
