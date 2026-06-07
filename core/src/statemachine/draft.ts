// core/src/statemachine/draft.ts
// 草稿状态机:时序一致性 + 双重条件提交 + 整帧对账。计划书 §四。
import type { DraftState, FrameObservation, SlotType } from "@ad/shared/types/draft";
import { reconcile } from "./reconcile";

export interface DraftMachineOptions {
  /** 同一观察连续多少帧一致才提交。 */
  confirmFrames: number;
}

/** 把一帧观察压成可比较的指纹(用于时序一致性)。 */
function fingerprint(obs: FrameObservation): string {
  const slots = obs.slots
    .map((s) => `${s.row}:${s.hero ?? ""}|${[...s.normals].sort().join(",")}|${[...s.ultimates].sort().join(",")}`)
    .join(";");
  return `${obs.activePicker.row ?? "x"}#${slots}`;
}

/** 与上一已提交状态比,统计本观察相对各行的「新增技能」落在哪些行。 */
function changedRows(prev: DraftState, next: DraftState): Set<number> {
  const rows = new Set<number>();
  for (let i = 0; i < next.players.length; i++) {
    const a = prev.players[i];
    const b = next.players[i];
    if (!a) { rows.add(i); continue; }
    const grew =
      (a.hero === null && b.hero !== null) ||
      b.normals.length > a.normals.length ||
      b.ultimates.length > a.ultimates.length;
    if (grew) rows.add(i);
  }
  return rows;
}

export class DraftMachine {
  private committed: DraftState = { players: [], activeRow: null };
  private pendingFp: string | null = null;
  private pendingCount = 0;

  constructor(
    private readonly slotTypeOf: (valveId: number) => SlotType | null,
    private readonly opts: DraftMachineOptions,
  ) {}

  state(): DraftState {
    return this.committed;
  }

  /** 喂一个有效帧。返回是否提交了状态更新。 */
  observe(obs: FrameObservation): boolean {
    const fp = fingerprint(obs);
    if (fp === this.pendingFp) {
      this.pendingCount += 1;
    } else {
      this.pendingFp = fp;
      this.pendingCount = 1;
    }
    if (this.pendingCount < this.opts.confirmFrames) return false;

    const candidate = reconcile(obs, this.slotTypeOf);

    // 双重条件:任何「新增技能行」必须与 Active Picker 指向的行一致。
    // 首次提交(committed 为空)或纯重建(无新增行)直接接受 —— 这是自愈路径。
    if (this.committed.players.length === candidate.players.length) {
      const grown = changedRows(this.committed, candidate);
      if (grown.size > 0) {
        const picker = candidate.activeRow;
        const allMatchPicker = [...grown].every((r) => r === picker);
        if (!allMatchPicker) return false; // 冲突,不提交,保持上次有效状态
      }
    }

    this.committed = candidate;
    return true;
  }
}
