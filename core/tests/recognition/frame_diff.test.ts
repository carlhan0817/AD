// core/tests/recognition/frame_diff.test.ts
import { describe, it, expect } from "vitest";
import { roiHash, FrameGate } from "../../src/recognition/frame_diff";

function block(v: number, n = 16): number[][] {
  return Array.from({ length: n }, () => Array(n).fill(v));
}

describe("roiHash", () => {
  it("is stable for identical blocks", () => {
    expect(roiHash(block(100))).toBe(roiHash(block(100)));
  });
  it("differs for different blocks", () => {
    expect(roiHash(block(100))).not.toBe(roiHash(block(200)));
  });
});

describe("FrameGate (true debounce)", () => {
  it("does NOT pass a freshly-changed frame; waits for stability", () => {
    const gate = new FrameGate(2); // 需连续 2 帧静止才放行
    expect(gate.shouldProcess([block(50)])).toBe(false); // 首帧:才刚出现,未达稳定数
    expect(gate.shouldProcess([block(50)])).toBe(true);  // 连续第 2 帧静止 → 放行最终稳定帧
  });

  it("passes a settled frame only once, then stays quiet until next change", () => {
    const gate = new FrameGate(2);
    gate.shouldProcess([block(50)]);                      // false(稳定计数 1)
    expect(gate.shouldProcess([block(50)])).toBe(true);  // true(稳定计数 2,放行)
    expect(gate.shouldProcess([block(50)])).toBe(false); // 仍静止,但已放行过 → 不重复
    expect(gate.shouldProcess([block(50)])).toBe(false);
  });

  it("drops mid-animation frames and only releases the final stable frame", () => {
    const gate = new FrameGate(2);
    // 动画中:每帧都在变(50→51→52),全部丢弃(每变一次稳定计数重置为 1)
    expect(gate.shouldProcess([block(50)])).toBe(false); // 变(初始),计数 1
    expect(gate.shouldProcess([block(51)])).toBe(false); // 变,重置计数 1
    expect(gate.shouldProcess([block(52)])).toBe(false); // 变,重置计数 1(=本内容第 1 帧)
    // 动画结束,画面稳定在 52:再来 1 帧相同即达连续 2 帧 → 放行最终稳定帧 52
    expect(gate.shouldProcess([block(52)])).toBe(true);  // 计数 2 → 放行
    expect(gate.shouldProcess([block(52)])).toBe(false); // 已放行,不重复
  });

  it("treats any ROI change as motion (resets stability)", () => {
    const gate = new FrameGate(2);
    gate.shouldProcess([block(50), block(10)]);          // false(变,计数 1)
    // 第二个 ROI 变了 → 视为运动,重置计数为本内容第 1 帧
    expect(gate.shouldProcess([block(50), block(11)])).toBe(false); // 变,计数 1
    expect(gate.shouldProcess([block(50), block(11)])).toBe(true);  // 相同,计数 2 → 放行
  });

  it("stabilityFrames=1 passes on the first still frame after a change", () => {
    const gate = new FrameGate(1);
    expect(gate.shouldProcess([block(5)])).toBe(true);   // 出现即视为「1 帧静止」→ 放行
    expect(gate.shouldProcess([block(5)])).toBe(false);  // 已放行,不重复
    expect(gate.shouldProcess([block(9)])).toBe(true);   // 新画面,再 1 帧静止 → 放行
  });
});
