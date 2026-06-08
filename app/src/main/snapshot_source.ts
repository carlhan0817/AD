// app/src/main/snapshot_source.ts
// 数据源抽象。本阶段:MockSnapshotSource(纯产出 + 注入式 timer)。
// 真实接入预留:LiveSnapshotSource 包装 main 包的 runMonitorLoop,把 DraftMachine
// 接 buildSnapshot + recommend 后经同一 emit 回调推送——切换不改窗口/IPC/renderer。
import type { OverlaySnapshot } from "@ad/shared/types/ipc";
import type { DraftState } from "@ad/shared/types/draft";
import type { ScoredCandidate } from "@ad/shared/types/scoring";

export type SnapshotEmit = (snap: OverlaySnapshot) => void;

export interface SnapshotSource {
  start(intervalMs: number): void;
  stop(): void;
}

// 两帧 fixture:模拟"先英雄候选、再技能候选"的推荐变化,让 overlay 真正动起来。
const STATE_A: DraftState = {
  activeRow: 0,
  players: [{ row: 0, hero: null, normals: [], ultimates: [] }],
};
const STATE_B: DraftState = {
  activeRow: 0,
  players: [{ row: 0, hero: -9, normals: [5051], ultimates: [] }],
};
const RECS_A: ScoredCandidate[] = [
  { candidate: { valveId: -9, slotType: "hero" }, score: 0.42, breakdown: { base: 0.42 } },
  { candidate: { valveId: 5052, slotType: "normal" }, score: 0.30, breakdown: { base: 0.1, synergy: 0.2 } },
];
const RECS_B: ScoredCandidate[] = [
  { candidate: { valveId: 5052, slotType: "normal" }, score: 0.35, breakdown: { base: 0.15, synergy: 0.2 } },
  { candidate: { valveId: 6001, slotType: "ultimate" }, score: 0.18, breakdown: { base: 0.12, aghs: 0.06 } },
];

/** 帧模板(不含 version,version 由源在 emit 时单调赋值)。 */
export const MOCK_FRAMES: Omit<OverlaySnapshot, "version">[] = [
  { state: STATE_A, recommendations: RECS_A, remaining: { hero: 1, normal: 3, ultimate: 1 } },
  { state: STATE_B, recommendations: RECS_B, remaining: { hero: 0, normal: 2, ultimate: 1 } },
];

export class MockSnapshotSource implements SnapshotSource {
  private version = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  constructor(private readonly emit: SnapshotEmit) {}

  /** 产出并推送下一帧(纯递增 + 循环 fixture)。 */
  tick(): void {
    const frame = MOCK_FRAMES[this.version % MOCK_FRAMES.length];
    this.emit({ ...frame, version: ++this.version });
  }

  start(intervalMs: number): void {
    this.stop();
    this.timer = setInterval(() => this.tick(), intervalMs);
  }

  stop(): void {
    if (this.timer !== null) { clearInterval(this.timer); this.timer = null; }
  }
}
