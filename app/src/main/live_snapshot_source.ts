// app/src/main/live_snapshot_source.ts
// 真实数据源:包 runMonitorLoop,把每次提交的 DraftMachine 经 recommend + buildSnapshot
// 推送。machineToSnapshot 抽成纯函数以便测试;start/stop 是平台绑定的薄壳。
import type { SnapshotSource, SnapshotEmit } from "./snapshot_source";
import type { OverlaySnapshot } from "@ad/shared/types/ipc";
import type { DraftState } from "@ad/shared/types/draft";
import type { ScoredCandidate } from "@ad/shared/types/scoring";
import { buildSnapshot } from "@ad/main/overlay/snapshot";

/** 纯映射:状态 + 推荐 → OverlaySnapshot(复用 buildSnapshot 的配额计算)。 */
export function machineToSnapshot(
  state: DraftState, activeRow: number, recs: ScoredCandidate[], version: number,
): OverlaySnapshot {
  return buildSnapshot(state, activeRow, recs, version);
}

export interface LiveDeps {
  /** 启动监控循环;每次提交调 onUpdate(state, activeRow, recommendations)。返回停止函数。 */
  runLoop: (onUpdate: (state: DraftState, activeRow: number, recs: ScoredCandidate[]) => void) => () => void;
}

export class LiveSnapshotSource implements SnapshotSource {
  private version = 0;
  private stopFn: (() => void) | null = null;
  constructor(private readonly emit: SnapshotEmit, private readonly deps: LiveDeps) {}

  start(_intervalMs: number): void {
    this.stop();
    this.stopFn = this.deps.runLoop((state, activeRow, recs) => {
      this.emit(machineToSnapshot(state, activeRow, recs, ++this.version));
    });
  }
  stop(): void { if (this.stopFn) { this.stopFn(); this.stopFn = null; } }
}
