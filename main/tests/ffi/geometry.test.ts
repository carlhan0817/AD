import { describe, it, expect } from "vitest";
import { rectToOverlayBounds, type WindowRect } from "../../src/ffi/geometry";

describe("rectToOverlayBounds", () => {
  it("covers the game client area exactly", () => {
    const rect: WindowRect = { x: 100, y: 50, width: 1920, height: 1080 };
    expect(rectToOverlayBounds(rect)).toEqual({ x: 100, y: 50, width: 1920, height: 1080 });
  });
  it("handles a non-origin multi-monitor offset", () => {
    const rect: WindowRect = { x: -1920, y: 0, width: 1280, height: 720 };
    expect(rectToOverlayBounds(rect)).toEqual({ x: -1920, y: 0, width: 1280, height: 720 });
  });
});
