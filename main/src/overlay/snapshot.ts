// main/src/overlay/snapshot.ts
// 由状态机 + 打分输出构建 IPC 快照(纯函数,JSON 可序列化)。
import type { DraftState } from "@ad/shared/types/draft";
import type { ScoredCandidate } from "@ad/shared/types/scoring";
import type { OverlaySnapshot } from "@ad/shared/types/ipc";
import { remainingQuota, emptyPlayer } from "@ad/core/statemachine/quota";

export function buildSnapshot(
  state: DraftState,
  activeRow: number,
  recommendations: ScoredCandidate[],
  version: number,
): OverlaySnapshot {
  const me = state.players[activeRow] ?? emptyPlayer(activeRow);
  return { state, recommendations, remaining: remainingQuota(me), version };
}
