// shared/types/ipc.ts
// main → renderer 单向推送载荷。必须 JSON 可序列化(过 IPC)。
import type { DraftState } from "./draft";
import type { ScoredCandidate } from "./scoring";

export interface OverlaySnapshot {
  /** 当前完整草稿状态。 */
  state: DraftState;
  /** 本人这一手的排序候选(已硬过滤 + 打分),top 优先。 */
  recommendations: ScoredCandidate[];
  /** 本人当前剩余配额,供 UI 显示。 */
  remaining: { hero: number; normal: number; ultimate: number };
  /** 单调递增版本号,renderer 用于丢弃过期帧。 */
  version: number;
}

/** IPC channel 名(main/renderer 共用,避免字符串漂移)。 */
export const OVERLAY_CHANNEL = "overlay:snapshot" as const;
