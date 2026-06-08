// core/tests/recognition/frame_gate_perf.test.ts
import { describe, it, expect } from "vitest";
import { FrameGate } from "../../src/recognition/frame_diff";

function block(v: number): number[][] {
  return Array.from({ length: 16 }, () => Array(16).fill(v));
}

describe("frame gate perf budget", () => {
  it("a static screen releases the settled frame exactly once (then gates the rest)", () => {
    const gate = new FrameGate(2);
    let passes = 0;
    const still = [block(50), block(60), block(70)];
    for (let i = 0; i < 100; i++) if (gate.shouldProcess(still)) passes += 1;
    expect(passes).toBe(1); // 连续静止 → 第 2 帧放行最终稳定帧,之后不再重复
  });

  it("under continuous change (animation), debounce releases NOTHING", () => {
    const gate = new FrameGate(2);
    let passes = 0;
    for (let i = 0; i < 99; i++) if (gate.shouldProcess([block(i)])) passes += 1;
    // 每帧都在变 → 稳定计数永远到不了 2 → 一帧都不放行(绝不喂半截动画帧)
    expect(passes).toBe(0);
  });
});
