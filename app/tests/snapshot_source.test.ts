// app/tests/snapshot_source.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { MockSnapshotSource, MOCK_FRAMES } from "../src/main/snapshot_source";

describe("MockSnapshotSource", () => {
  afterEach(() => { vi.useRealTimers(); });

  it("emits frames with monotonically increasing version", () => {
    const got: number[] = [];
    const src = new MockSnapshotSource((snap) => got.push(snap.version));
    // 手动驱动 3 拍(不依赖真实 timer)
    src.tick(); src.tick(); src.tick();
    expect(got).toEqual([1, 2, 3]);
  });

  it("cycles through the fixture frames by content (incl. wrap-around)", () => {
    const seen: number[][] = [];
    const src = new MockSnapshotSource((snap) =>
      seen.push(snap.recommendations.map((r) => r.candidate.valveId)));
    // 多跑一拍越过 fixture 边界,验证 modulo 循环回到第 0 帧
    for (let i = 0; i < MOCK_FRAMES.length + 1; i++) src.tick();
    MOCK_FRAMES.forEach((f, i) => {
      expect(seen[i]).toEqual(f.recommendations.map((r) => r.candidate.valveId));
    });
    // 第 MOCK_FRAMES.length 拍(越界)应回到第 0 帧的内容
    expect(seen[MOCK_FRAMES.length]).toEqual(
      MOCK_FRAMES[0].recommendations.map((r) => r.candidate.valveId),
    );
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
  });
});
