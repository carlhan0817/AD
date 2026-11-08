import { describe, it, expect, vi, beforeEach } from "vitest";

// 合成帧上画不出我的绿框和金卡:轻量查看用到的两个判断改成可控的(null = 用真实实现)。
const cards = vi.hoisted(() => ({ myRow: null as number | null, activeRow: null as number | null }));
vi.mock("@ad/core/recognition/card_reading", async (orig) => {
  const real = await orig<typeof import("@ad/core/recognition/card_reading")>();
  return {
    ...real,
    findMyRow: (...a: Parameters<typeof real.findMyRow>) => cards.myRow ?? real.findMyRow(...a),
    findActiveRow: (...a: Parameters<typeof real.findActiveRow>) => cards.activeRow ?? real.findActiveRow(...a),
  };
});

import {
  AutoFramePolicy, draftRequest, looksLikeDraft, modeChangeLine, modeReason, OFF_POLL_MS,
  SCAN_RETRY_BACKOFF_MS, startAutoScan, turnReadingOf, WATCH_STATS_EVERY_MS,
  type AutoScanDeps, type AutoScanRequest, type Frames,
} from "../src/main/auto_scan";
import { AutoScanSchedule, DRAFT_INTERVAL_MS, WATCH_INTERVAL_MS } from "@ad/core/autoscan/schedule";
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

beforeEach(() => { cards.myRow = null; cards.activeRow = null; });

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

describe("draftRequest", () => {
  it("只有静止的画面写记忆;首帧和超时只试读;不放行时只有重试才识别(沿用那次的写不写)", () => {
    expect(draftRequest("first", null)).toMatchObject({ commit: false, reason: expect.stringMatching(/刚进选人/) });
    expect(draftRequest("settled", null)).toMatchObject({ commit: true, reason: expect.stringMatching(/已静止/) });
    expect(draftRequest("timeout", null)).toMatchObject({ commit: false, reason: expect.stringMatching(/3 秒/) });
    const prev: AutoScanRequest = { commit: true, reason: "画面已静止" };
    expect(draftRequest(null, prev)).toEqual({ commit: true, reason: "上次没识别成,重试(画面已静止)" });
    expect(draftRequest("timeout", prev)?.commit).toBe(false); // 新的放行优先
    expect(draftRequest(null, null)).toBeNull();
  });
});

describe("looksLikeDraft", () => {
  it("绿框和金卡都要有", () => {
    const f = blackFrames().rgb;
    expect(looksLikeDraft(f, RECT)).toBe(false);
    cards.myRow = 2;
    expect(looksLikeDraft(f, RECT)).toBe(false);
    cards.activeRow = 5;
    expect(looksLikeDraft(f, RECT)).toBe(true);
  });
});

describe("AutoFramePolicy(自动扫描存帧)", () => {
  it("这局见到选人界面之前一张不存", () => {
    const p = new AutoFramePolicy();
    expect([p.shouldSave(false), p.shouldSave(false)]).toEqual([false, false]);
    expect(p.shouldSave(true)).toBe(true);
  });
  it("不是选人界面的帧只存选人界面之后的第一张", () => {
    const p = new AutoFramePolicy();
    p.shouldSave(true);
    expect([p.shouldSave(false), p.shouldSave(false), p.shouldSave(true), p.shouldSave(false)]).toEqual([true, false, true, true]);
  });
  it("不是选人界面的帧每局最多存 10 张;newGame 后重新计", () => {
    const p = new AutoFramePolicy();
    let saved = 0;
    for (let k = 0; k < 15; k++) { p.shouldSave(true); if (p.shouldSave(false)) saved++; }
    expect(saved).toBe(10);
    p.newGame();
    expect(p.shouldSave(false)).toBe(false);
    p.shouldSave(true);
    expect(p.shouldSave(false)).toBe(true);
  });
});

/** 假时钟:setTimer 只记下回调,step() 把时钟拨过这段间隔、等当前 tick 跑完再触发下一个。 */
function harness(over: Partial<AutoScanDeps>) {
  const logs: string[] = [];
  const clock = { t: 0 };
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
    now: () => clock.t,
    setTimer: (fn, ms) => { t.next = { fn, ms }; return 1; },
    clearTimer: () => { t.next = null; },
    ...over,
  };
  const flush = () => new Promise((r) => setTimeout(r, 0));
  const pending = () => t.next;
  const stop = startAutoScan(deps);
  return {
    deps, logs, stop, clock,
    /** 等当前 tick 跑完,返回它定的下一次间隔。 */
    settle: async () => { for (let k = 0; k < 5; k++) await flush(); return pending()?.ms; },
    step: async () => {
      const n = t.next; t.next = null; clock.t += n?.ms ?? 0; n?.fn();
      for (let k = 0; k < 5; k++) await flush();
      return pending()?.ms;
    },
  };
}

describe("startAutoScan", () => {
  it("离开选人(draft→别的模式)时调用 onLeaveDraft 一次;没进过选人不调", async () => {
    let phase = "DOTA_GAMERULES_STATE_HERO_SELECTION";
    const onLeaveDraft = vi.fn();
    const h = harness({ gsi: () => ({ phase, matchId: "1", clock: 0 }), onLeaveDraft });
    await h.settle();
    expect(onLeaveDraft).not.toHaveBeenCalled();
    phase = "DOTA_GAMERULES_STATE_STRATEGY_TIME";
    await h.step();
    expect(onLeaveDraft).toHaveBeenCalledTimes(1);
    await h.step();
    expect(onLeaveDraft).toHaveBeenCalledTimes(1);
    h.stop();
  });

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

  it("draft:首帧试读(不写记忆),静止后再识别一次(写记忆),结果喂给 schedule;之后画面没变不再识别", async () => {
    const schedule = new AutoScanSchedule();
    const onDraftScan = vi.spyOn(schedule, "onDraftScan");
    const scan = vi.fn(async (_f: Frames, _r: AutoScanRequest) => result());
    const h = harness({ schedule, scan, gsi: () => gs(GSI_HERO_SELECTION) });
    expect(await h.settle()).toBe(DRAFT_INTERVAL_MS);
    expect(scan).toHaveBeenCalledTimes(1);
    expect(scan.mock.calls[0][1].commit).toBe(false);
    expect(onDraftScan).toHaveBeenCalledWith(true);
    await h.step();
    await h.step();
    expect(scan).toHaveBeenCalledTimes(2);
    expect(scan.mock.calls[1][1]).toEqual({ commit: true, reason: "画面已静止" });
    await h.step();
    await h.step();
    expect(scan).toHaveBeenCalledTimes(2);
    h.stop();
  });

  it("识别没跑成(返回 null,比如热键正在扫):下一帧带着原请求重试", async () => {
    const scan = vi.fn<(f: Frames, r: AutoScanRequest) => Promise<PoolScanResult | null>>()
      .mockResolvedValueOnce(null).mockResolvedValue(result());
    const h = harness({ scan, gsi: () => gs(GSI_HERO_SELECTION) });
    await h.settle();
    await h.step();
    expect(scan).toHaveBeenCalledTimes(2);
    expect(scan.mock.calls[1][1].commit).toBe(false);
    expect(h.logs.some((l) => l.includes("重试"))).toBe(true);
    h.stop();
  });

  it("识别连续失败 3 次:之后每 5 秒重试,只记一行「连续失败」;成功后恢复每秒", async () => {
    let fail = true;
    const scan = vi.fn(async () => (fail ? null : result()));
    const h = harness({ scan, gsi: () => gs(GSI_HERO_SELECTION) });
    expect(await h.settle()).toBe(DRAFT_INTERVAL_MS);
    expect(await h.step()).toBe(DRAFT_INTERVAL_MS);
    expect(await h.step()).toBe(SCAN_RETRY_BACKOFF_MS);
    expect(await h.step()).toBe(SCAN_RETRY_BACKOFF_MS);
    expect(h.logs.filter((l) => l.includes("连续失败")).length).toBe(1);
    expect(h.logs.filter((l) => l.includes("[auto] 识别:")).length).toBe(3); // 放慢后不再每次记
    fail = false;
    expect(await h.step()).toBe(DRAFT_INTERVAL_MS);
    expect(h.logs.some((l) => l.includes("识别恢复了"))).toBe(true);
    h.stop();
  });

  it("取帧退回普通截图只在开着 GSI 的 draft 允许", async () => {
    const grab = vi.fn(async (_m: "watch" | "draft", _fb: boolean) => blackFrames());
    const h = harness({ grabStreamFrame: grab, gsi: () => gs(GSI_HERO_SELECTION) });
    await h.settle();
    expect(grab.mock.calls[0]).toEqual(["draft", true]);
    h.stop();
    cards.myRow = 2; cards.activeRow = 5;
    const grab2 = vi.fn(async (_m: "watch" | "draft", _fb: boolean) => blackFrames());
    const h2 = harness({ grabStreamFrame: grab2 });
    await h2.settle();
    await h2.step();
    await h2.step(); // 没 GSI 进的 draft
    expect(grab2.mock.calls.map((c) => c.join(":"))).toEqual(["watch:false", "watch:false", "draft:false"]);
    h2.stop();
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

  it("watch 连续 2 次像选人界面才进 draft,下一次按 draft 的 1 秒走", async () => {
    cards.myRow = 2; cards.activeRow = 5;
    const h = harness({});
    expect(await h.settle()).toBe(WATCH_INTERVAL_MS); // 第 1 次还不算
    expect(await h.step()).toBe(DRAFT_INTERVAL_MS);
    await h.step();
    expect(h.logs).toContain("[auto] 自动扫描 watch→draft(没 GSI,看到了选人界面)");
    expect(h.deps.scan).toHaveBeenCalledTimes(1);
    h.stop();
  });

  it("watch 中间断一次就重新数;只有绿框没有金卡不算", async () => {
    cards.myRow = 2; cards.activeRow = 5;
    const h = harness({});
    await h.settle();
    cards.activeRow = null; // 合成帧上真实的 findActiveRow 读不到金卡
    expect(await h.step()).toBe(WATCH_INTERVAL_MS);
    cards.activeRow = 5;
    expect(await h.step()).toBe(WATCH_INTERVAL_MS);
    expect(await h.step()).toBe(DRAFT_INTERVAL_MS);
    h.stop();
  });

  it("watch 每分钟记一行取帧统计", async () => {
    cards.myRow = 2; // 只有绿框:取帧算,像选人界面不算
    const h = harness({});
    await h.settle();
    for (let k = 0; k < 20; k++) await h.step(); // 3 秒一次,第 21 帧在 60 秒
    expect(h.logs.filter((l) => l.startsWith("[auto] 查看中"))).toEqual(["[auto] 查看中:过去一分钟取帧 21 次,像选人界面 0 次"]);
    expect(WATCH_STATS_EVERY_MS).toBe(60_000);
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

describe("startAutoScan 不支持的屏幕比例", () => {
  const BAD = { x: 0, y: 0, width: 1500, height: 920 };
  const isBad = (r: { width: number; height: number }) => r.width === 1500;

  it("watch:不取帧、不喂 schedule,间隔照旧;同一尺寸只通知一次,变回支持再变回来会再通知", async () => {
    let rect = BAD;
    const schedule = new AutoScanSchedule();
    const onWatchResult = vi.spyOn(schedule, "onWatchResult");
    const onUnsupportedRatio = vi.fn();
    const h = harness({ schedule, rect: () => rect, unsupportedRatio: isBad, onUnsupportedRatio });
    expect(await h.settle()).toBe(WATCH_INTERVAL_MS);
    await h.step(); await h.step();
    expect(h.deps.grabStreamFrame).not.toHaveBeenCalled();
    expect(onWatchResult).not.toHaveBeenCalled();
    expect(onUnsupportedRatio).toHaveBeenCalledTimes(1);
    rect = RECT;
    await h.step();
    expect(h.deps.grabStreamFrame).toHaveBeenCalledTimes(1);
    expect(onWatchResult).toHaveBeenCalledTimes(1);
    rect = BAD;
    await h.step();
    expect(onUnsupportedRatio).toHaveBeenCalledTimes(2);
    expect(h.deps.grabStreamFrame).toHaveBeenCalledTimes(1);
    h.stop();
  });

  it("draft(GSI 选人阶段):不取帧、不识别,按 draft 的 1 秒继续看", async () => {
    const onUnsupportedRatio = vi.fn();
    const h = harness({ gsi: () => gs(GSI_HERO_SELECTION), rect: () => BAD, unsupportedRatio: isBad, onUnsupportedRatio });
    expect(await h.settle()).toBe(DRAFT_INTERVAL_MS);
    await h.step();
    expect(h.deps.grabStreamFrame).not.toHaveBeenCalled();
    expect(h.deps.scan).not.toHaveBeenCalled();
    expect(onUnsupportedRatio).toHaveBeenCalledTimes(1);
    h.stop();
  });
  it("watch:不支持→支持只调一次 onRatioSupportedAgain;从没不支持过就不调", async () => {
    let rect = BAD;
    const onRatioSupportedAgain = vi.fn();
    const h = harness({ rect: () => rect, unsupportedRatio: isBad, onUnsupportedRatio: vi.fn(), onRatioSupportedAgain });
    await h.settle();
    await h.step();
    expect(onRatioSupportedAgain).not.toHaveBeenCalled();
    rect = RECT;
    await h.step(); await h.step();
    expect(onRatioSupportedAgain).toHaveBeenCalledTimes(1);
    h.stop();
    const never = vi.fn();
    const h2 = harness({ unsupportedRatio: isBad, onRatioSupportedAgain: never });
    await h2.settle(); await h2.step();
    expect(never).not.toHaveBeenCalled();
    h2.stop();
  });

  it("Dota 离开最前面再回来,尺寸还是不支持:重新通知", async () => {
    let fg = true;
    const onUnsupportedRatio = vi.fn();
    const h = harness({ gameForeground: () => fg, rect: () => BAD, unsupportedRatio: isBad, onUnsupportedRatio });
    await h.settle();
    expect(onUnsupportedRatio).toHaveBeenCalledTimes(1);
    fg = false;
    await h.step();
    fg = true;
    await h.step();
    expect(onUnsupportedRatio).toHaveBeenCalledTimes(2);
    h.stop();
  });
});
