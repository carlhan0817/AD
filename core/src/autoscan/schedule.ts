// core/src/autoscan/schedule.ts
// 自动扫描的节奏:什么时候不截图(off)、什么时候轻量查看有没有进选人界面(watch)、
// 什么时候按选人节奏取帧识别(draft)。纯逻辑,由主进程每个 tick 调 mode() 决定下一步。
// 开了 GSI:完全按阶段决定,只在 INIT / 等玩家加载 / 选人三个阶段截图。
// 没开 GSI(或 GSI 超时、inputs.gsi 为 null):靠轻量查看发现选人界面,进入后连续
// LEAVE_DRAFT_AFTER 次不是选人界面才退回 watch。

import { AUTO_SCAN_PHASES, type GsiState } from "../gsi/gsi";

export type AutoMode = "off" | "watch" | "draft";

export interface AutoInputs {
  /** 托盘「自动扫描」勾选。 */
  enabled: boolean;
  /** Dota 进程/窗口是否在。 */
  gameRunning: boolean;
  /** null 表示没开 GSI 或已超时没数据;phase 为 null(主菜单)不算「没 GSI」。 */
  gsi: GsiState | null;
}

export const WATCH_INTERVAL_MS = 3000;
export const DRAFT_INTERVAL_MS = 1000;
/** 没 GSI 时,连续这么多次不是选人界面就退回 watch。 */
export const LEAVE_DRAFT_AFTER = 2;

export function intervalFor(mode: AutoMode): number | null {
  if (mode === "watch") return WATCH_INTERVAL_MS;
  if (mode === "draft") return DRAFT_INTERVAL_MS;
  return null;
}

export class AutoScanSchedule {
  /** 没 GSI 时「已确认在选人」的记号。 */
  private inDraft = false;
  private misses = 0;
  /** 最近一次 mode() 是否有 GSI;有 GSI 时两个回调结果一律忽略。 */
  private gsiPresent = false;

  mode(i: AutoInputs): AutoMode {
    this.gsiPresent = i.gsi !== null;
    if (!i.enabled || !i.gameRunning) {
      this.reset();
      return "off";
    }
    if (i.gsi) {
      // 有 GSI 就清掉记号:之后 GSI 若超时变 null,从 watch 重新开始
      this.reset();
      return i.gsi.phase !== null && AUTO_SCAN_PHASES.has(i.gsi.phase) ? "draft" : "off";
    }
    return this.inDraft ? "draft" : "watch";
  }

  /** watch 轻量查看的结果。 */
  onWatchResult(looksLikeDraft: boolean): void {
    if (this.gsiPresent || !looksLikeDraft) return;
    this.inDraft = true;
    this.misses = 0;
  }

  /** draft 中一次识别后,是否仍在选人界面。 */
  onDraftScan(onDraftScreen: boolean): void {
    if (this.gsiPresent || !this.inDraft) return;
    if (onDraftScreen) {
      this.misses = 0;
      return;
    }
    this.misses++;
    if (this.misses >= LEAVE_DRAFT_AFTER) this.reset();
  }

  private reset(): void {
    this.inDraft = false;
    this.misses = 0;
  }
}
