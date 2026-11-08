// app/src/main/auto_scan.ts
// 自动扫描循环:按 AutoScanSchedule 定的节奏取画面流帧,决定要不要跑完整识别。
//   off   不截图,每秒复查一次条件(Dota 开没开、GSI 阶段、托盘开关)。
//   watch 每 3 秒轻量看一眼:连续 2 次既找得到我的绿色外框、又找得到金色的「轮到谁」卡,
//         才算像选人界面,交给 schedule 进入 draft(游戏里绿色血条/地形单凭绿框会误判)。
//   draft 约每秒取一帧,算识别区域的签名(不含倒计时),画面变了且静止(或等满 3 秒)才识别。
//         只有静止(settled)的读数写进本局记忆;首帧和超时的读数只在记忆副本上试读、推悬浮窗。
// Dota 不在最前面时截到的不是 Dota:这一帧整个跳过,不识别、不计入任何「不是选人界面」。
// 每次取帧前记下当时的模式;结果回来时模式已经变了(比如 Dota 刚关),这次结果作废。
// 依赖全部从外面传进来(index.ts 接线),本文件不碰 Electron,能单独读、单独测。
import { AutoScanSchedule, intervalFor, type AutoInputs, type AutoMode } from "@ad/core/autoscan/schedule";
import { boardSignature, SettleGate, type SettleRelease } from "@ad/core/autoscan/board_change";
import type { TurnReading } from "@ad/core/autoscan/turn_lock";
import { findActiveRow, findMyRow } from "@ad/core/recognition/card_reading";
import type { ClientRect } from "@ad/core/recognition/roi";
import type { RgbFrame } from "@ad/core/recognition/rgb";
import type { GrayFrame } from "@ad/core/recognition/grid";
import type { GsiState } from "@ad/core/gsi/gsi";
import type { PoolScanResult } from "@ad/main/capture/scan_pool";

export type Frames = { rgb: RgbFrame; gray: GrayFrame };

/** off 时多久复查一次条件(只查窗口和 GSI,不截图)。 */
export const OFF_POLL_MS = 1000;
/** 轻量查看连续这么多次像选人界面,才进入 draft。 */
export const WATCH_HITS_NEEDED = 2;
/** 识别连续失败这么多次后放慢重试。 */
export const SCAN_FAILS_BEFORE_BACKOFF = 3;
export const SCAN_RETRY_BACKOFF_MS = 5000;
/** 轻量查看的统计多久记一行。 */
export const WATCH_STATS_EVERY_MS = 60_000;

/** 一次自动识别要怎么做:commit = 读数写进本局记忆;reason = 写日志用的原因。 */
export interface AutoScanRequest { commit: boolean; reason: string }

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
  /** 这个客户区的宽高比是不是不支持(不在六类里)。不给 = 都支持。 */
  unsupportedRatio?: (rect: ClientRect) => boolean;
  /** 比例不支持时通知外面提示用户;同一个宽×高只通知一次,尺寸变回支持后再变回来会再通知。 */
  onUnsupportedRatio?: (rect: ClientRect) => void;
  /** 通知过「比例不支持」之后,客户区又回到支持的比例时调一次(外面据此撤掉提示)。 */
  onRatioSupportedAgain?: (rect: ClientRect) => void;
  /** 取一帧(画面流优先);取不到返回 null,这一轮跳过。
   *  allowFallback:画面流失败时能不能退回普通截图(只有开着 GSI 且在选人相关阶段时才允许)。 */
  grabStreamFrame: (mode: "watch" | "draft", allowFallback: boolean) => Promise<Frames | null>;
  /** 跑一次完整识别(index.ts 的 scan("auto", frames, req));没跑成返回 null。 */
  scan: (frames: Frames, req: AutoScanRequest) => Promise<PoolScanResult | null>;
  diag: (m: string) => void;
  /** 离开选人(draft → 别的模式)时调一次。正式版用它删掉这一局的截图。 */
  onLeaveDraft?: () => void;
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
    seat: res.seat,
  };
}

/** 闸门放行原因 → 这次识别怎么做;null = 不识别。retry:上次放行了但没识别成(带着那次的请求重试)。 */
export function draftRequest(release: SettleRelease | null, retry: AutoScanRequest | null): AutoScanRequest | null {
  if (release === "first") return { commit: false, reason: "刚进选人,先试读一次(不写记忆)" };
  if (release === "timeout") return { commit: false, reason: "画面 3 秒还没静止,先试读一次(不写记忆)" };
  if (release === "settled") return { commit: true, reason: "画面已静止" };
  return retry === null ? null : { commit: retry.commit, reason: `上次没识别成,重试(${retry.reason})` };
}

/** 一帧像不像选人界面(轻量):我的绿色外框和金色「轮到谁」卡都找得到。 */
export function looksLikeDraft(frame: RgbFrame, rect: ClientRect): boolean {
  return findMyRow(frame, rect) !== null && findActiveRow(frame, rect) !== null;
}

/** 自动扫描存帧的规矩(热键不受限,每帧都存):
 *  这一局还没见过选人界面之前一张不存(也就不建文件夹);选人界面的帧都存;
 *  不是选人界面的帧只存「选人界面之后的第一张」,每局最多 maxNotDraft 张。 */
export class AutoFramePolicy {
  private sawDraft = false;
  private lastWasDraft = false;
  private notDraftSaved = 0;

  constructor(private readonly maxNotDraft = 10) {}

  newGame(): void {
    this.sawDraft = false;
    this.lastWasDraft = false;
    this.notDraftSaved = 0;
  }

  shouldSave(onDraftScreen: boolean): boolean {
    if (onDraftScreen) {
      this.sawDraft = true;
      this.lastWasDraft = true;
      return true;
    }
    const first = this.lastWasDraft;
    this.lastWasDraft = false;
    if (!this.sawDraft || !first || this.notDraftSaved >= this.maxNotDraft) return false;
    this.notDraftSaved++;
    return true;
  }
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
  /** 上次放行了但没识别成的请求;下一帧带着它重试。 */
  let retry: AutoScanRequest | null = null;
  let scanFails = 0;
  /** 轻量查看连续像选人界面的次数。 */
  let watchHits = 0;
  let watchStats = { since: now(), grabs: 0, hits: 0 };
  /** 上一轮是不是因为 Dota 不在最前面跳过的(只在变化时记日志)。 */
  let skippedBackground = false;
  /** 已通知过「比例不支持」的尺寸;换成支持的比例就清掉。 */
  let notifiedUnsupported: string | null = null;
  /** 悬浮窗上是不是还留着「比例不支持」的提示(回到支持的比例时要撤掉)。 */
  let noticeShown = false;

  const inputs = (): AutoInputs => ({ enabled: deps.enabled(), gameRunning: deps.gameRunning(), gsi: deps.gsi() });
  /** 结果回来时模式还是不是取帧时那个。 */
  const stillIn = (mode: AutoMode): boolean => schedule.mode(inputs()) === mode;

  const noteWatch = (hit: boolean): void => {
    watchStats.grabs++;
    if (hit) watchStats.hits++;
    const t = now();
    if (t - watchStats.since < WATCH_STATS_EVERY_MS) return;
    diag(`[auto] 查看中:过去一分钟取帧 ${watchStats.grabs} 次,像选人界面 ${watchStats.hits} 次`);
    watchStats = { since: t, grabs: 0, hits: 0 };
  };

  const tick = async (): Promise<void> => {
    const i = inputs();
    const mode = schedule.mode(i);
    if (mode !== lastMode) {
      diag(modeChangeLine(lastMode, mode, modeReason(i, mode)));
      if (lastMode === "draft") deps.onLeaveDraft?.();
      if (mode !== "draft") { gate = new SettleGate(); retry = null; scanFails = 0; }
      if (mode === "watch") watchStats = { since: now(), grabs: 0, hits: 0 };
      watchHits = 0;
      lastMode = mode;
    }
    if (mode === "off") return;

    const fg = deps.gameForeground();
    if (fg === skippedBackground) {
      skippedBackground = !fg;
      diag(fg ? "[auto] Dota 回到最前面,接着看" : "[auto] Dota 不在最前面,先不看(不算不是选人界面)");
    }
    if (!fg) { notifiedUnsupported = null; return; } // 回到 Dota 时若还是不支持的尺寸,重新提示

    // 比例不支持:不截图、不识别、不喂 schedule,保持当前模式的间隔继续看,窗口改回来就恢复。
    if (deps.unsupportedRatio !== undefined) {
      const r0 = deps.rect();
      if (deps.unsupportedRatio(r0)) {
        const key = `${r0.width}x${r0.height}`;
        if (notifiedUnsupported !== key) { notifiedUnsupported = key; noticeShown = true; deps.onUnsupportedRatio?.(r0); }
        return;
      }
      notifiedUnsupported = null;
      if (noticeShown) { noticeShown = false; deps.onRatioSupportedAgain?.(r0); }
    }

    // 没 GSI 进的 draft 也可能是误判进来的(人其实在游戏里):画面流坏了也不退回普通截图(会让游戏顿一下)
    const frames = await deps.grabStreamFrame(mode, mode === "draft" && i.gsi !== null);
    if (frames === null || stopped) return;
    if (!deps.gameForeground()) return; // 取帧途中切走了:这一帧不是 Dota
    const rect = deps.rect();

    if (mode === "watch") {
      const hit = looksLikeDraft(frames.rgb, rect);
      if (!stillIn(mode)) return; // 模式已变,结果作废
      noteWatch(hit);
      watchHits = hit ? watchHits + 1 : 0;
      if (hit) diag(`[auto] 看到了我的绿色外框和「轮到谁」金卡,像是选人界面(连续 ${watchHits}/${WATCH_HITS_NEEDED} 次)`);
      schedule.onWatchResult(watchHits >= WATCH_HITS_NEEDED);
      return;
    }

    const req = draftRequest(gate.push(boardSignature(frames.rgb, rect), now()), retry);
    if (req === null) return;
    if (!stillIn(mode)) return;
    if (scanFails < SCAN_FAILS_BEFORE_BACKOFF) diag(`[auto] 识别:${req.reason}`);
    const res = await deps.scan(frames, req);
    if (res === null) {
      retry = req;
      if (++scanFails === SCAN_FAILS_BEFORE_BACKOFF) {
        diag(`[auto] 识别连续失败 ${scanFails} 次,之后每 ${SCAN_RETRY_BACKOFF_MS / 1000} 秒重试一次`);
      }
      return;
    }
    if (scanFails >= SCAN_FAILS_BEFORE_BACKOFF) diag(`[auto] 识别恢复了(之前连续失败 ${scanFails} 次)`);
    retry = null;
    scanFails = 0;
    if (stopped) return;
    if (!stillIn(mode)) { diag("[auto] 识别完时自动扫描已切换模式,这次结果不计"); return; }
    schedule.onDraftScan(res.onDraftScreen);
  };

  /** 下一次 tick 的间隔按这一轮结束时的模式算:watch 刚看到选人界面就按 draft 的 1 秒走,
   *  Dota 刚关就按 off 走,不用再等完上一模式的整个间隔。识别连续失败时放慢到 5 秒。 */
  const nextDelay = (): number => {
    const mode = schedule.mode(inputs());
    const base = intervalFor(mode) ?? OFF_POLL_MS;
    return mode === "draft" && scanFails >= SCAN_FAILS_BEFORE_BACKOFF ? Math.max(base, SCAN_RETRY_BACKOFF_MS) : base;
  };

  const loop = (): void => {
    if (stopped) return;
    tick().then(
      () => { if (!stopped) timer = setTimer(loop, nextDelay()); },
      (err) => { diag(`[auto] 出错: ${err}`); if (!stopped) timer = setTimer(loop, OFF_POLL_MS); },
    );
  };
  loop();
  return () => { stopped = true; if (timer !== null) clearTimer(timer); };
}
