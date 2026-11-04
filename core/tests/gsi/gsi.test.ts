// core/tests/gsi/gsi.test.ts
import { describe, it, expect } from "vitest";
import {
  parseGsi, tokenOf, buildGsiCfg, parseGsiCfg, overlayModeFor, decideOverlay, GsiTracker,
  GSI_STALE_MS, GSI_HERO_SELECTION, FALLBACK_SILENT_AFTER,
} from "../../src/gsi/gsi";

// 结构与上游 ability-draft-plus 的真实抓包样本一致(只保留用到的字段)。
const HERO_SELECTION = {
  provider: { name: "Dota 2", appid: 570, version: 48, timestamp: 1785336685 },
  map: { name: "start", matchid: "8913204102", clock_time: -5, game_state: GSI_HERO_SELECTION, paused: false },
  auth: { token: "abc123" },
};

describe("parseGsi", () => {
  it("读出阶段、对局编号、时钟", () => {
    expect(parseGsi(HERO_SELECTION)).toEqual({ phase: GSI_HERO_SELECTION, matchId: "8913204102", clock: -5 });
  });
  it("主菜单(没有 map 段)、乱七八糟的输入都不报错,当作不知道", () => {
    const none = { phase: null, matchId: null, clock: null };
    expect(parseGsi({ provider: {} })).toEqual(none);
    expect(parseGsi(null)).toEqual(none);
    expect(parseGsi("nope")).toEqual(none);
    expect(parseGsi({ map: { game_state: 3, matchid: "", clock_time: "x" } })).toEqual(none);
  });
  it("读口令", () => {
    expect(tokenOf(HERO_SELECTION)).toBe("abc123");
    expect(tokenOf({})).toBeNull();
    expect(tokenOf({ auth: { token: 5 } })).toBeNull();
  });
});

describe("配置文件", () => {
  it("只发给本机,带口令,只要 provider 和 map 两段", () => {
    const cfg = buildGsiCfg(39871, "tok");
    expect(cfg).toContain('"http://127.0.0.1:39871/"');
    expect(cfg).toContain('"token"     "tok"');
    expect(cfg).toContain('"map"       "1"');
    expect(cfg).not.toMatch(/"items"|"player"|"allplayers"/);
  });
  it("能读回端口和口令", () => {
    expect(parseGsiCfg(buildGsiCfg(40001, "zz"))).toEqual({ port: 40001, token: "zz" });
    expect(parseGsiCfg("garbage")).toEqual({ port: null, token: null });
  });
});

describe("显示还是静默", () => {
  it("只有选人阶段显示;策略时间、游戏中、结束、主菜单都静默", () => {
    expect(overlayModeFor(GSI_HERO_SELECTION)).toBe("active");
    for (const p of ["DOTA_GAMERULES_STATE_STRATEGY_TIME", "DOTA_GAMERULES_STATE_PRE_GAME",
      "DOTA_GAMERULES_STATE_GAME_IN_PROGRESS", "DOTA_GAMERULES_STATE_POST_GAME", null]) {
      expect(overlayModeFor(p)).toBe("silent");
    }
  });
  it("有 GSI 以 GSI 为准;没有时连续 2 次不是选人界面才静默", () => {
    const inGame = { phase: "DOTA_GAMERULES_STATE_GAME_IN_PROGRESS", matchId: "1", clock: 90 };
    expect(decideOverlay(inGame, 0, true)).toBe("silent");
    expect(decideOverlay({ ...inGame, phase: GSI_HERO_SELECTION }, 5, false)).toBe("active");
    expect(decideOverlay(null, FALLBACK_SILENT_AFTER - 1, false)).toBe("active");
    expect(decideOverlay(null, FALLBACK_SILENT_AFTER, false)).toBe("silent");
  });
  it("GSI 说不在对局里(比画面慢)时看画面:扫到选人界面就显示,否则静默", () => {
    const menu = { phase: null, matchId: null, clock: null };
    expect(decideOverlay(menu, 0, true)).toBe("active");
    expect(decideOverlay(menu, 0, false)).toBe("silent");
  });
});

describe("GsiTracker", () => {
  const s = (phase: string | null, matchId: string | null) => ({ phase, matchId, clock: 0 });
  it("超过 30 秒没收到数据就当 GSI 不在工作", () => {
    const t = new GsiTracker();
    expect(t.current(0)).toBeNull();
    t.update(s(GSI_HERO_SELECTION, "1"), 1000);
    expect(t.current(1000 + GSI_STALE_MS)).not.toBeNull();
    expect(t.current(1001 + GSI_STALE_MS)).toBeNull();
  });
  it("对局编号变了,或从别的阶段回到选人 = 新的一局;同一局里重复的选人数据不算", () => {
    const t = new GsiTracker();
    expect(t.update(s(GSI_HERO_SELECTION, "1"), 0).newDraft).toBe(false);
    expect(t.update(s(GSI_HERO_SELECTION, "1"), 1).newDraft).toBe(false);
    expect(t.update(s("DOTA_GAMERULES_STATE_POST_GAME", "1"), 2).newDraft).toBe(false);
    expect(t.update(s(GSI_HERO_SELECTION, "2"), 3).newDraft).toBe(true);
    expect(t.update(s(GSI_HERO_SELECTION, "3"), 4).newDraft).toBe(true);
    expect(t.update(s(null, null), 5).newDraft).toBe(false);
    expect(t.update(s(GSI_HERO_SELECTION, null), 6).newDraft).toBe(false);
  });
  it("打完回主菜单(空数据)再进下一局选人,也算新的一局", () => {
    const t = new GsiTracker();
    t.update(s(GSI_HERO_SELECTION, "1"), 0);
    t.update(s("DOTA_GAMERULES_STATE_GAME_IN_PROGRESS", "1"), 1);
    expect(t.update(s(null, null), 2).newDraft).toBe(false);
    expect(t.update(s(GSI_HERO_SELECTION, null), 3).newDraft).toBe(true);
    expect(t.update(s(GSI_HERO_SELECTION, "2"), 4).newDraft).toBe(false); // 同一局里补上了编号,不重复清空
  });
  it("选人中途掉线再重连(同一个对局编号)不算新的一局", () => {
    const t = new GsiTracker();
    t.update(s(GSI_HERO_SELECTION, "7"), 0);
    t.update(s("DOTA_GAMERULES_STATE_DISCONNECT", "7"), 1);
    t.update(s(null, null), 2);
    expect(t.update(s(GSI_HERO_SELECTION, "7"), 3).newDraft).toBe(false);
    expect(t.update(s(GSI_HERO_SELECTION, "8"), 4).newDraft).toBe(true);
  });
});
