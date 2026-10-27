// main/src/capture/loop.ts
// 低 Hz 捕获循环。生命周期 = 进入选取界面 → 全部选完。所有判定委托 core 纯函数。
import { FrameGate } from "@ad/core/recognition/frame_diff";
import { LAYOUT_1080P, diffRois, slotRowCells } from "@ad/core/recognition/roi";
import { recognizePool } from "@ad/core/recognition/pool_recognize";
import { isValidLayout } from "@ad/core/recognition/layout_guard";
import { recognizeCell } from "@ad/core/recognition/recognize";
import { type IndexEntry } from "@ad/core/recognition/index_store";
import { ReferenceDb } from "@ad/core/db/reference";
import { DraftMachine } from "@ad/core/statemachine/draft";
import { recommend } from "@ad/core/scoring/recommend";
import type { DraftState, FrameObservation, SlotType } from "@ad/shared/types/draft";
import type { Candidate, ScoredCandidate, ScoringConfig } from "@ad/shared/types/scoring";
import { captureScreenGrayFrame } from "./screen_source";
import type { GrayFrame } from "@ad/core/recognition/grid";
import type { WindowRect } from "../ffi/geometry";

export interface MonitorDeps {
  index: IndexEntry[];
  ref: ReferenceDb;
  pool: Candidate[];
  cfg: ScoringConfig;
  /** 游戏客户区矩形(启动时由 app 经 gameClientRect 读入,供比例池布局推导像素)。 */
  rect: WindowRect;
  onUpdate: (state: DraftState, activeRow: number, recs: ScoredCandidate[]) => void;
  /** 可选诊断日志(由 app 注入,落 .live.log)。节流打印每帧卡在哪道门。 */
  log?: (msg: string) => void;
}

// 识别命中阈值(64 位 pHash 的 Hamming 距离上限)。真机 .frame_dump_0.pgm + offset=0 后逐格实测:
// 该帧 48 格全是真技能(无空格,各格平均亮度 95–220),distance 多 ≤12,少数退化的(截图压缩/
// 抗锯齿/轻微遮挡)到 14–18,但最近邻仍命中【正确】模板(如 furion_teleportation d=18、
// abyssal_underlord_atrophy_aura d=18,名字都对)。随机噪声底 ≈32。取 20:把这些退化但正确的命中
// 全部收下(thr=20 → 48/48;thr=16 会丢 furion/underlord 这 2 格),仍低于噪声底,18→32 有间隙。
// TODO:此帧无空格样本,无法证明 20 在【有空格/被预览头像遮挡】的局里不会把空格噪声误收。
// 后续 dump 到带空格的真帧后,回归确认空格 distance 仍 >20;若误收再下调。
const RECOGNIZE_MAX_DISTANCE = 20;

/** 把一帧识别成 FrameObservation。Active Picker 需 RGB 带 —— 本 MVP 先留 null
 *  (颜色带的彩色采集在阶段 4 接入;此处链路先打通灰度识别部分)。
 *  英雄槽与技能槽已物理解耦:英雄走长方形识别,4 个技能走正方形识别。 */
function recognizeFrame(frame: GrayFrame, deps: MonitorDeps): FrameObservation {
  const slots = slotRowCells(frame, LAYOUT_1080P).map(({ hero: heroCell, abilities }, row) => {
    // 英雄槽:识别长方形头像格。
    const heroId = recognizeCell(heroCell, deps.index, RECOGNIZE_MAX_DISTANCE)?.valveId ?? null;
    const hero = heroId !== null && deps.ref.slotType(heroId) === "hero" ? heroId : null;
    // 4 个技能格:按 slot_type 分流到 normals / ultimates。
    const abilityIds = abilities
      .map((cell) => recognizeCell(cell, deps.index, RECOGNIZE_MAX_DISTANCE)?.valveId)
      .filter((v): v is number => v !== undefined && v !== null);
    const normals = abilityIds.filter((v) => deps.ref.slotType(v) === "normal");
    const ultimates = abilityIds.filter((v) => deps.ref.slotType(v) === "ultimate");
    return { row, hero, normals, ultimates };
  });
  return { activePicker: { row: null }, slots };
}

/** 帧 → 本局候选池(用 deps.rect 把比例池布局推导成像素再识别)。抽成纯函数以便单测。 */
export function poolFromFrame(frame: GrayFrame, deps: MonitorDeps): number[] {
  return recognizePool(frame, deps.rect, deps.index, undefined, RECOGNIZE_MAX_DISTANCE);
}

export async function runMonitorLoop(deps: MonitorDeps, intervalMs = 250): Promise<void> {
  const gate = new FrameGate(3); // 连续 3 帧静止才认定动画结束、放行最终稳定帧(防抖)
  const slotTypeOf = (v: number): SlotType | null => deps.ref.slotType(v);
  const machine = new DraftMachine(slotTypeOf, { confirmFrames: 3 });

  // 诊断:节流打印每帧卡在哪道门(每 ticks 计数,约每 ~5s 打一次状态),定位真机识别链路。
  let ticks = 0;
  const log = deps.log ?? (() => {});
  const tick = async () => {
    ticks++;
    const report = ticks % 20 === 1; // 约每 20 帧(~5s)报一次
    const frame = await captureScreenGrayFrame();
    if (report) log(`[loop] tick#${ticks} frame=${frame.width}x${frame.height}`);
    const rois = diffRois(frame, LAYOUT_1080P, deps.rect);
    // FrameGate 每段静止只放行一帧;那一帧才真正跑识别。诊断都跟着放行帧打,避免节流错位漏读。
    const passed = gate.shouldProcess(rois.diff);
    if (!passed) { if (report) log("[loop] 卡在①frame-diff门控(画面未稳定/未变化)"); return; }
    if (!isValidLayout(rois.anchors)) { log("[loop] 卡在②布局校验(锚点区方差不足,坐标可能对不上)"); return; }
    const candidatePool = poolFromFrame(frame, deps);
    log(`[loop] ✅过② 识别到 ${candidatePool.length} 个技能(候选池) valveIds=[${candidatePool.slice(0, 20).join(",")}${candidatePool.length > 20 ? ",..." : ""}]`);
    const obs = recognizeFrame(frame, deps);
    const recog = obs.slots.filter((s) => s.hero !== null || s.normals.length || s.ultimates.length).length;
    if (report) log(`[loop] 过①②,十行槽识别到 ${recog}/${obs.slots.length} 行有内容`);
    if (!machine.observe(obs)) { if (report) log("[loop] 卡在③状态机observe(未达确认帧/无变化)"); return; }
    const state = machine.state();
    const activeRow = state.activeRow;
    if (activeRow === null) { if (report) log("[loop] 卡在④activeRow=null(无活动玩家)"); return; }
    const me = state.players[activeRow];
    const recs = recommend(deps.pool, me, activeRow, deps.ref, deps.cfg);
    deps.onUpdate(state, activeRow, recs);
  };

  // 简单定时轮询;真正的生命周期/停止条件在阶段 4 接 overlay 时细化。
  // eslint-disable-next-line no-constant-condition
  while (true) {
    await tick();
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
