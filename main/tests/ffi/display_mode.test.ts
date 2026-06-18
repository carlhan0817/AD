import { describe, it, expect } from "vitest";
import { classifyDisplayMode } from "../../src/ffi/display_mode";

const WS_POPUP = 0x80000000, WS_CAPTION = 0x00C00000;

describe("classifyDisplayMode", () => {
  it("borderless = popup (no caption) AND covering full monitor", () => {
    expect(classifyDisplayMode(WS_POPUP, 0, true)).toBe("borderless");
  });
  it("exclusive-fullscreen = covers monitor but lacks normal window chrome and is not a borderless popup", () => {
    // exclusive: no popup style bit, no caption, full monitor
    expect(classifyDisplayMode(0, 0, true)).toBe("exclusive-fullscreen");
  });
  it("windowed = has caption / not full monitor", () => {
    expect(classifyDisplayMode(WS_CAPTION, 0, false)).toBe("windowed");
  });
});
