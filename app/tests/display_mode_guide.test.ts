import { describe, it, expect } from "vitest";
import { guideMessageFor } from "../src/main/display_mode_guide";

describe("guideMessageFor", () => {
  it("prompts to switch only on exclusive fullscreen", () => {
    expect(guideMessageFor("exclusive-fullscreen")).toMatch(/无边框/);
  });
  it("stays silent on borderless / windowed / null", () => {
    expect(guideMessageFor("borderless")).toBeNull();
    expect(guideMessageFor("windowed")).toBeNull();
    expect(guideMessageFor(null)).toBeNull();
  });
});
