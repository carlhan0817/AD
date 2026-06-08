// renderer/src/view_model.ts
// 把 OverlaySnapshot 映射为可渲染视图模型(纯函数,可测)。JSX 本身靠手动冒烟。
import type { OverlaySnapshot } from "@ad/shared/types/ipc";
import type { SignalId } from "@ad/shared/types/scoring";

export interface RecRow {
  valveId: number;
  slotType: string;
  scoreText: string;
  topSignal: SignalId | null;
  highlighted: boolean;
}
export interface OverlayViewModel {
  rows: RecRow[];
  remaining: { hero: number; normal: number; ultimate: number };
}

function topSignal(breakdown: Partial<Record<SignalId, number>>): SignalId | null {
  let best: SignalId | null = null;
  let bestV = -Infinity;
  for (const [k, v] of Object.entries(breakdown) as [SignalId, number][]) {
    if (v > bestV) { bestV = v; best = k; }
  }
  return best;
}

export function toViewModel(snap: OverlaySnapshot): OverlayViewModel {
  return {
    remaining: snap.remaining,
    rows: snap.recommendations.map((r, i) => ({
      valveId: r.candidate.valveId,
      slotType: r.candidate.slotType,
      scoreText: r.score.toFixed(2),
      topSignal: topSignal(r.breakdown),
      highlighted: i === 0,
    })),
  };
}
