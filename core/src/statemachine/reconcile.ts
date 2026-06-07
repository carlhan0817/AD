// core/src/statemachine/reconcile.ts
// 整帧对账:由 FrameObservation 重建 DraftState。不依赖历史 → 任意好帧可自愈(计划书 §四)。
import type { DraftState, FrameObservation, PlayerState, SlotType } from "@ad/shared/types/draft";
import { emptyPlayer } from "./quota";

/** 按真实 slot_type 重新归位每行的占用。识别可能把技能塞错列,这里以身份为准。 */
export function reconcile(
  obs: FrameObservation,
  slotTypeOf: (valveId: number) => SlotType | null,
): DraftState {
  const players: PlayerState[] = obs.slots.map((s) => {
    const p = emptyPlayer(s.row);
    const ids = [
      ...(s.hero === null ? [] : [s.hero]),
      ...s.normals,
      ...s.ultimates,
    ];
    for (const id of ids) {
      const t = slotTypeOf(id);
      if (t === "hero") p.hero = id;
      else if (t === "ultimate") p.ultimates.push(id);
      else if (t === "normal") p.normals.push(id);
      // t === null:未知身份,丢弃(由上层时序一致性兜底,不污染状态)
    }
    return p;
  });
  return { players, activeRow: obs.activePicker.row };
}
