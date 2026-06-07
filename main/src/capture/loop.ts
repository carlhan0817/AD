// main/src/capture/loop.ts
// 低 Hz 捕获循环。生命周期 = 进入选取界面 → 全部选完。所有判定委托 core 纯函数。
import { FrameGate } from "@ad/core/recognition/frame_diff";
import { LAYOUT_1080P, diffRois, slotRowCells } from "@ad/core/recognition/roi";
import { isValidLayout } from "@ad/core/recognition/layout_guard";
import { recognizeCell } from "@ad/core/recognition/recognize";
import { type IndexEntry } from "@ad/core/recognition/index_store";
import { ReferenceDb } from "@ad/core/db/reference";
import { DraftMachine } from "@ad/core/statemachine/draft";
import type { FrameObservation, SlotType } from "@ad/shared/types/draft";
import { captureGrayFrame } from "./frame_source";
import type { GrayFrame } from "@ad/core/recognition/grid";

export interface MonitorDeps {
  index: IndexEntry[];
  ref: ReferenceDb;
  onUpdate: (machine: DraftMachine) => void;
}

/** 把一帧识别成 FrameObservation。Active Picker 需 RGB 带 —— 本 MVP 先留 null
 *  (颜色带的彩色采集在阶段 4 接入;此处链路先打通灰度识别部分)。
 *  英雄槽与技能槽已物理解耦:英雄走长方形识别,4 个技能走正方形识别。 */
function recognizeFrame(frame: GrayFrame, deps: MonitorDeps): FrameObservation {
  const slots = slotRowCells(frame, LAYOUT_1080P).map(({ hero: heroCell, abilities }, row) => {
    // 英雄槽:识别长方形头像格。
    const heroId = recognizeCell(heroCell, deps.index, 12)?.valveId ?? null;
    const hero = heroId !== null && deps.ref.slotType(heroId) === "hero" ? heroId : null;
    // 4 个技能格:按 slot_type 分流到 normals / ultimates。
    const abilityIds = abilities
      .map((cell) => recognizeCell(cell, deps.index, 12)?.valveId)
      .filter((v): v is number => v !== undefined && v !== null);
    const normals = abilityIds.filter((v) => deps.ref.slotType(v) === "normal");
    const ultimates = abilityIds.filter((v) => deps.ref.slotType(v) === "ultimate");
    return { row, hero, normals, ultimates };
  });
  return { activePicker: { row: null }, slots };
}

export async function runMonitorLoop(deps: MonitorDeps, intervalMs = 250): Promise<void> {
  const gate = new FrameGate(3); // 连续 3 帧静止才认定动画结束、放行最终稳定帧(防抖)
  const slotTypeOf = (v: number): SlotType | null => deps.ref.slotType(v);
  const machine = new DraftMachine(slotTypeOf, { confirmFrames: 3 });

  const tick = async () => {
    const frame = await captureGrayFrame();
    const rois = diffRois(frame, LAYOUT_1080P);
    if (!gate.shouldProcess(rois)) return;            // 第一层:frame-diff 门控
    if (!isValidLayout([rois[0], rois[2]])) return;   // 第二层:布局/遮挡校验
    const obs = recognizeFrame(frame, deps);
    if (machine.observe(obs)) deps.onUpdate(machine);  // 第三/四层在 machine 内
  };

  // 简单定时轮询;真正的生命周期/停止条件在阶段 4 接 overlay 时细化。
  // eslint-disable-next-line no-constant-condition
  while (true) {
    await tick();
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
