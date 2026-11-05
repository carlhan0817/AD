import { describe, it, expect, vi } from "vitest";
import {
  draftTrigger, modeChangeLine, modeReason, OFF_POLL_MS, startAutoScan, turnReadingOf,
  type AutoScanDeps, type Frames,
} from "../src/main/auto_scan";
import { AutoScanSchedule, DRAFT_INTERVAL_MS, WATCH_INTERVAL_MS } from "@ad/core/autoscan/schedule";
import { boardSignature } from "@ad/core/autoscan/board_change";
import { GSI_HERO_SELECTION, type GsiState } from "@ad/core/gsi/gsi";
import type { PoolScanResult } from "@ad/main/capture/scan_pool";

const RECT = { x: 0, y: 0, width: 1920, height: 1080 };
const blackFrames = (): Frames => ({
  rgb: { width: 1920, height: 1080, data: new Uint8Array(1920 * 1080 * 3) },
  gray: { width: 1920, height: 1080, data: new Uint8Array(1920 * 1080) },
} as unknown as Frames);
const gs = (phase: string | null): GsiState => ({ phase, matchId: "1", clock: 0 });
const result = (o: Partial<PoolScanResult> = {}): PoolScanResult => ({
  onDraftScreen: true, myRow: 2, activeRow: 5, unknownCells: 0, myPicks: null,
  me: { row: 2, hero: null, normals: [], ultimates: [] }, ...o,
} as PoolScanResult);

describe("turnReadingOf", () => {
  it("我的选数 = 技能数 + 英雄(选了算 1)", () => {
    const r = turnReadingOf(result({ me: { row: 2, hero: -14, normals: [1, 2], ultimates: [3] } }));
    expect(r).toEqual({ myRow: 2, activeRow: 5, myPickCount: 4, complete: true });
    expect(turnReadingOf(result()).myPickCount).toBe(0);
  });
  it("完整 = 池里没有没认出的格,且我的卡没有没认出的格", () => {
    expect(turnReadingOf(result({ unknownCells: 1 })).complete).toBe(false);
    const picks = { row: 2, normals: [], ultimate: null, unknown: 1 };
    expect(turnReadingOf(result({ myPicks: picks })).complete).toBe(false);
    expect(turnReadingOf(result({ myPicks: { ...picks, unknown: 0 } })).complete).toBe(true);
  });
});

describe("模式日志", () => {
  it("第一次只写当前模式(冒烟时找「自动扫描 off」),之后写 旧→新", () => {
    const i = { enabled: true, gameRunning: false, gsi: null };
    expect(modeChangeLine(null, "off", modeReason(i, "off"))).toBe("[auto] 自动扫描 off(没找到 Dota 窗口)");
    expect(modeChangeLine("off", "draft", "x")).toBe("[auto] 自动扫描 off→draft(x)");
  });
  it("原因按优先级:托盘关 > 没 Dota > GSI > 画面", () => {
    expect(modeReason({ enabled: false, gameRunning: false, gsi: null }, "off")).toMatch(/托盘/);
    expect(modeReason({ enabled: true, gameRunning: true, gsi: gs(null) }, "off")).toMatch(/不在对局里/);
    expect(modeReason({ enabled: true, gameRunning: true, gsi: null }, "watch")).toMatch(/每 3 秒/);
  });
});

describe("draftTrigger", () => {
  const a = boardSignature(blackFrames().rgb, RECT);
  it("闸门放行:首帧 / 静止 / 超时;不放行时只有重试才识别", () => {
    expect(draftTrigger(null, a, true, false)).toMatch(/刚进选人/);
    expect(draftTrigger(a, a, true, false)).toMatch(/已静止/);
    expect(draftTrigger({ ...a, activeRow: 2 }, { ...a, activeRow: 1 }, true, false)).toMatch(/3 秒/);
    expect(draftTrigger(a, a, false, true)).toMatch(/重试/);
    expect(draftTrigger(a, a, false, false)).toBeNull();
  });
});

/** 假时钟:setTimer 只记下回调,step() 等当前 tick 跑完再触发下一个。 */
function harness(over: Partial<AutoScanDeps>) {
  const logs: string[] = [];
  const t: { next: { fn: () => void; ms: number } | null } = { next: null };
  const deps: AutoScanDeps = {
    schedule: new AutoScanSchedule(),
    enabled: () => true,
    gsi: () => null,
    gameRunning: () => true,
    gameForeground: () => true,
    rect: () => RECT,
    grabStreamFrame: vi.fn(async () => blackFrames()),
    scan: vi.fn(async () => result()),
    diag: (m) => logs.push(m),
    setTimer: (fn, ms) => { t.next = { fn, ms }; return 1; },
    clearTimer: () => { t.next = null; },
    ...over,
  };
  const flush = () => new Promise((r) => setTimeout(r, 0));
  const pending = () => t.next;
  const stop = startAutoScan(deps);
  return {
    deps, logs, stop,
    /** 等当前 tick 跑完,返回它定的下一次间隔。 */
    settle: async () => { for (let k = 0; k < 5; k++) await flush(); return pending()?.ms; },
    step: async () => { const n = t.next; t.next = null; n?.fn(); for (let k = 0; k < 5; k++) await flush(); return pending()?.ms; },
  };
}

describe("startAutoScan", () => {
  it("没找到 Dota:off,不截图,每秒复查", async () => {
    const h = harness({ gameRunning: () => false });
    expect(await h.settle()).toBe(OFF_POLL_MS);
    expect(h.logs).toContain("[auto] 自动扫描 off(没找到 Dota 窗口)");
    expect(h.deps.grabStreamFrame).not.toHaveBeenCalled();
    h.stop();
  });

  it("Dota 不在最前面:不截图、不识别", async () => {
    const h = harness({ gameForeground: () => false, gsi: () => gs(GSI_HERO_SELECTION) });
    expect(await h.settle()).toBe(DRAFT_INTERVAL_MS);
    expect(h.deps.grabStreamFrame).not.toHaveBeenCalled();
    expect(h.deps.scan).not.toHaveBeenCalled();
    expect(h.logs.some((l) => l.includes("不在最前面"))).toBe(true);
    h.stop();
  });

  it("取帧途中切走:这一帧丢掉,不识别", async () => {
    let fg = true;
    const h = harness({
      gsi: () => gs(GSI_HERO_SELECTION),
      gameForeground: () => fg,
      grabStreamFrame: vi.fn(async () => { fg = false; return blackFrames(); }),
    });
    await h.settle();
    expect(h.deps.scan).not.toHaveBeenCalled();
    h.stop();
  });

  it("draft:首帧识别,结果喂给 schedule;画面没变就不再识别", async () => {
    const schedule = new AutoScanSchedule();
    const onDraftScan = vi.spyOn(schedule, "onDraftScan");
    const h = harness({ schedule, gsi: () => gs(GSI_HERO_SELECTION) });
    expect(await h.settle()).toBe(DRAFT_INTERVAL_MS);
    expect(h.deps.scan).toHaveBeenCalledTimes(1);
    expect(onDraftScan).toHaveBeenCalledWith(true);
    await h.step();
    await h.step();
    expect(h.deps.scan).toHaveBeenCalledTimes(1);
    h.stop();
  });

  it("识别没跑成(返回 null,比如热键正在扫):下一帧重试", async () => {
    const scan = vi.fn<(f: Frames) => Promise<PoolScanResult | null>>().mockResolvedValueOnce(null).mockResolvedValue(result());
    const h = harness({ scan, gsi: () => gs(GSI_HERO_SELECTION) });
    await h.settle();
    await h.step();
    expect(scan).toHaveBeenCalledTimes(2);
    expect(h.logs.some((l) => l.includes("重试"))).toBe(true);
    await h.step();
    expect(scan).toHaveBeenCalledTimes(2);
    h.stop();
  });

  it("watch 结果回来时 Dota 已关:结果作废,不会在下次开 Dota 时直接进 draft", async () => {
    let running = true;
    const schedule = new AutoScanSchedule();
    const onWatch = vi.spyOn(schedule, "onWatchResult");
    const h = harness({
      schedule,
      gameRunning: () => running,
      grabStreamFrame: vi.fn(async () => { running = false; return blackFrames(); }),
    });
    expect(await h.settle()).toBe(OFF_POLL_MS); // Dota 关了:下一次按 off 的间隔,不等满 3 秒
    expect(onWatch).not.toHaveBeenCalled();
    h.stop();
  });

  it("watch 没看到选人界面:下一次还是 3 秒后", async () => {
    const h = harness({});
    expect(await h.settle()).toBe(WATCH_INTERVAL_MS);
    h.stop();
  });

  it("watch 看到选人界面:下一次按 draft 的 1 秒走,不再等 3 秒", async () => {
    const schedule = new AutoScanSchedule();
    // 合成帧上画不出我的绿框,这里直接让 schedule 收到「看到了」。
    vi.spyOn(schedule, "onWatchResult").mockImplementation(() => AutoScanSchedule.prototype.onWatchResult.call(schedule, true));
    const h = harness({ schedule });
    expect(await h.settle()).toBe(DRAFT_INTERVAL_MS);
    await h.step();
    expect(h.logs).toContain("[auto] 自动扫描 watch→draft(没 GSI,看到了选人界面)");
    expect(h.deps.scan).toHaveBeenCalledTimes(1);
    h.stop();
  });

  it("draft 识别完时模式已变:不喂 onDraftScan", async () => {
    let gsi: GsiState | null = gs(GSI_HERO_SELECTION);
    const schedule = new AutoScanSchedule();
    const onDraftScan = vi.spyOn(schedule, "onDraftScan");
    const h = harness({
      schedule, gsi: () => gsi,
      scan: vi.fn(async () => { gsi = gs("DOTA_GAMERULES_STATE_STRATEGY_TIME"); return result(); }),
    });
    await h.settle();
    expect(onDraftScan).not.toHaveBeenCalled();
    expect(h.logs.some((l) => l.includes("这次结果不计"))).toBe(true);
    expect(await h.step()).toBe(OFF_POLL_MS);
    h.stop();
  });
});
