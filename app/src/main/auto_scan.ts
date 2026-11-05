// app/src/main/auto_scan.ts
// 自动扫描循环:按 AutoScanSchedule 定的节奏取画面流帧,决定要不要跑完整识别。
//   off   不截图,每秒复查一次条件(Dota 开没开、GSI 阶段、托盘开关)。
//   watch 每 3 秒轻量看一眼:找得到我的绿色外框就算像选人界面,交给 schedule 进入 draft。
//   draft 约每秒取一帧,算识别区域的签名(不含倒计时),画面变了且静止(或等满 3 秒)才识别。
// Dota 不在最前面时截到的不是 Dota:这一帧整个跳过,不识别、不计入任何「不是选人界面」。
// 每次取帧前记下当时的模式;结果回来时模式已经变了(比如 Dota 刚关),这次结果作废。
// 依赖全部从外面传进来(index.ts 接线),本文件不碰 Electron,能单独读、单独测。
import { AutoScanSchedule, intervalFor, type AutoInputs, type AutoMode } from "@ad/core/autoscan/schedule";
import { boardChanged, boardSignature, SettleGate, type BoardSignature } from "@ad/core/autoscan/board_change";
import type { TurnReading } from "@ad/core/autoscan/turn_lock";
import { findMyRow } from "@ad/core/recognition/card_reading";
import type { ClientRect } from "@ad/core/recognition/roi";
import type { RgbFrame } from "@ad/core/recognition/rgb";
import type { GrayFrame } from "@ad/core/recognition/grid";
import type { GsiState } from "@ad/core/gsi/gsi";
import type { PoolScanResult } from "@ad/main/capture/scan_pool";

export type Frames = { rgb: RgbFrame; gray: GrayFrame };

/** off 时多久复查一次条件(只查窗口和 GSI,不截图)。 */
export const OFF_POLL_MS = 1000;

export interface AutoScanDeps {
  schedule: AutoScanSchedule;
  /** 托盘「自动扫描」勾选。 */
  enabled: () => boolean;
  /** presence 读到的 GSI 状态(没开或超时为 null)。 */
  gsi: () => GsiState | null;
  /** Dota 窗口在不在(只读查找)。 */
  gameRunning: () => boolean;
  /** Dota 窗口是不是最前面(只读查询)。 */
  gameForeground: () => boolean;
  /** 游戏客户区矩形。 */
  rect: () => ClientRect;
  /** 取一帧(画面流优先);取不到返回 null,这一轮跳过。 */
  grabStreamFrame: (mode: "watch" | "draft") => Promise<Frames | null>;
  /** 跑一次完整识别(index.ts 的 scan("auto", frames));没跑成返回 null。 */
  scan: (frames: Frames) => Promise<PoolScanResult | null>;
  diag: (m: string) => void;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
}

/** 当前模式的原因(写日志用)。 */
export function modeReason(i: AutoInputs, mode: AutoMode): string {
  if (!i.enabled) return "托盘里关了自动扫描";
  if (!i.gameRunning) return "没找到 Dota 窗口";
  if (i.gsi !== null) return `GSI 阶段 ${i.gsi.phase ?? "不在对局里"}`;
  return mode === "draft" ? "没 GSI,看到了选人界面" : "没 GSI,每 3 秒看一眼是不是选人界面";
}

/** 模式变化的日志行;第一次(prev 为 null)只写当前模式。 */
export function modeChangeLine(prev: AutoMode | null, next: AutoMode, reason: string): string {
  return `[auto] 自动扫描 ${prev === null ? next : `${prev}→${next}`}(${reason})`;
}

/** 从一次识别结果算「轮到我」锁要的读数。
 *  完整 = 池里没有没认出的格,且我的卡没有没认出的格(没读到我的卡不算不完整)。 */
export function turnReadingOf(res: PoolScanResult): TurnReading {
  return {
    myRow: res.myRow,
    activeRow: res.activeRow,
    myPickCount: res.me.normals.length + res.me.ultimates.length + (res.me.hero !== null ? 1 : 0),
    complete: res.unknownCells === 0 && (res.myPicks === null || res.myPicks.unknown === 0),
  };
}

/** draft 模式下这一帧为什么要识别;null = 不识别。retry = 上次放行了但没识别成。 */
export function draftTrigger(prev: BoardSignature | null, sig: BoardSignature, gateOpen: boolean, retry: boolean): string | null {
  if (gateOpen) {
    if (prev === null) return "刚进选人,先识别一次";
    return boardChanged(prev, sig) ? "画面 3 秒还没静止,照样识别" : "画面变了且已静止";
  }
  return retry ? "上次没识别成,重试" : null;
}

/** 启动自动扫描循环,返回停止函数。 */
export function startAutoScan(deps: AutoScanDeps): () => void {
  const now = deps.now ?? Date.now;
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>));
  const { schedule, diag } = deps;
  let stopped = false;
  let timer: unknown = null;
  let lastMode: AutoMode | null = null;
  let gate = new SettleGate();
  let prevSig: BoardSignature | null = null;
  let retry = false;
  /** 上一轮是不是因为 Dota 不在最前面跳过的(只在变化时记日志)。 */
  let skippedBackground = false;

  const inputs = (): AutoInputs => ({ enabled: deps.enabled(), gameRunning: deps.gameRunning(), gsi: deps.gsi() });
  /** 结果回来时模式还是不是取帧时那个。 */
  const stillIn = (mode: AutoMode): boolean => schedule.mode(inputs()) === mode;

  const tick = async (): Promise<number> => {
    const i = inputs();
    const mode = schedule.mode(i);
    if (mode !== lastMode) {
      diag(modeChangeLine(lastMode, mode, modeReason(i, mode)));
      if (mode !== "draft") { gate = new SettleGate(); prevSig = null; retry = false; }
      lastMode = mode;
    }
    const interval = intervalFor(mode);
    if (interval === null || mode === "off") return OFF_POLL_MS;

    const fg = deps.gameForeground();
    if (fg === skippedBackground) {
      skippedBackground = !fg;
      diag(fg ? "[auto] Dota 回到最前面,接着看" : "[auto] Dota 不在最前面,先不看(不算不是选人界面)");
    }
    if (!fg) return interval;

    const frames = await deps.grabStreamFrame(mode);
    if (frames === null || stopped) return interval;
    if (!deps.gameForeground()) return interval; // 取帧途中切走了:这一帧不是 Dota
    const rect = deps.rect();

    if (mode === "watch") {
      const looks = findMyRow(frames.rgb, rect) !== null;
      if (!stillIn(mode)) return interval; // 模式已变,结果作废
      if (looks) diag("[auto] 看到了我的绿色外框,像是选人界面");
      schedule.onWatchResult(looks);
      return interval;
    }

    const sig = boardSignature(frames.rgb, rect);
    const why = draftTrigger(prevSig, sig, gate.push(sig, now()), retry);
    prevSig = sig;
    if (why === null) return interval;
    if (!stillIn(mode)) return interval;
    diag(`[auto] 识别:${why}`);
    const res = await deps.scan(frames);
    retry = res === null;
    if (res === null || stopped) return interval;
    if (!stillIn(mode)) { diag("[auto] 识别完时自动扫描已切换模式,这次结果不计"); return interval; }
    schedule.onDraftScan(res.onDraftScreen);
    return interval;
  };

  const loop = (): void => {
    if (stopped) return;
    tick().then(
      (ms) => { if (!stopped) timer = setTimer(loop, ms); },
      (err) => { diag(`[auto] 出错: ${err}`); if (!stopped) timer = setTimer(loop, OFF_POLL_MS); },
    );
  };
  loop();
  return () => { stopped = true; if (timer !== null) clearTimer(timer); };
}
