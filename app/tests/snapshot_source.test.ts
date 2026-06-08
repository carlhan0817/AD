// app/tests/snapshot_source.test.ts
import { describe, it, expect, vi } from "vitest";
import { MockSnapshotSource, MOCK_FRAMES } from "../src/main/snapshot_source";

describe("MockSnapshotSource", () => {
  it("emits frames with monotonically increasing version", () => {
    const got: number[] = [];
    const src = new MockSnapshotSource((snap) => got.push(snap.version));
    // 手动驱动 3 拍(不依赖真实 timer)
    src.tick(); src.tick(); src.tick();
    expect(got).toEqual([1, 2, 3]);
  });

  it("cycles through the fixture frames by content", () => {
    const seen: number[][] = [];
    const src = new MockSnapshotSource((snap) =>
      seen.push(snap.recommendations.map((r) => r.candidate.valveId)));
    for (let i = 0; i < MOCK_FRAMES.length; i++) src.tick();
    // 第 i 拍的推荐内容 = 第 i 个 fixture 帧的推荐内容
    MOCK_FRAMES.forEach((f, i) => {
      expect(seen[i]).toEqual(f.recommendations.map((r) => r.candidate.valveId));
    });
  });

  it("start() drives ticks via injected timer and stop() halts them", () => {
    vi.useFakeTimers();
    const got: number[] = [];
    const src = new MockSnapshotSource((snap) => got.push(snap.version));
    src.start(100);
    vi.advanceTimersByTime(350); // 100/200/300 三次
    src.stop();
    vi.advanceTimersByTime(500); // stop 后不再增加
    expect(got).toEqual([1, 2, 3]);
    vi.useRealTimers();
  });
});
