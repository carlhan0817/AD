// core/tests/autoscan/schedule.test.ts
import { describe, it, expect } from "vitest";
import {
  AutoScanSchedule,
  intervalFor,
  WATCH_INTERVAL_MS,
  DRAFT_INTERVAL_MS,
  type AutoInputs,
} from "../../src/autoscan/schedule";
import { GSI_INIT, GSI_WAIT_FOR_PLAYERS, GSI_HERO_SELECTION, type GsiState } from "../../src/gsi/gsi";

const gs = (phase: string | null): GsiState => ({ phase, matchId: "1", clock: 0 });
const inp = (o: Partial<AutoInputs> = {}): AutoInputs => ({ enabled: true, gameRunning: true, gsi: null, ...o });

describe("AutoScanSchedule", () => {
  it("没开自动扫描或游戏没在跑 → off,不管 GSI", () => {
    const s = new AutoScanSchedule();
    expect(s.mode(inp({ enabled: false }))).toBe("off");
    expect(s.mode(inp({ gameRunning: false }))).toBe("off");
    expect(s.mode(inp({ enabled: false, gsi: gs(GSI_HERO_SELECTION) }))).toBe("off");
    expect(s.mode(inp({ gameRunning: false, gsi: gs(GSI_HERO_SELECTION) }))).toBe("off");
  });

  it("GSI 阶段:INIT / 等玩家加载 / 选人 → draft;其他与主菜单 → off", () => {
    const s = new AutoScanSchedule();
    for (const p of [GSI_INIT, GSI_WAIT_FOR_PLAYERS, GSI_HERO_SELECTION]) {
      expect(s.mode(inp({ gsi: gs(p) }))).toBe("draft");
    }
    for (const p of ["DOTA_GAMERULES_STATE_STRATEGY_TIME", "DOTA_GAMERULES_STATE_GAME_IN_PROGRESS", null]) {
      expect(s.mode(inp({ gsi: gs(p) }))).toBe("off");
    }
  });

  it("没 GSI:初始 watch;看到选人界面进 draft", () => {
    const s = new AutoScanSchedule();
    expect(s.mode(inp())).toBe("watch");
    s.onWatchResult(false);
    expect(s.mode(inp())).toBe("watch");
    s.onWatchResult(true);
    expect(s.mode(inp())).toBe("draft");
  });

  it("没 GSI:连续两次不是选人界面退回 watch,中间有一次是则清零", () => {
    const s = new AutoScanSchedule();
    s.mode(inp());
    s.onWatchResult(true);
    s.onDraftScan(false);
    expect(s.mode(inp())).toBe("draft");
    s.onDraftScan(false);
    expect(s.mode(inp())).toBe("watch");

    s.onWatchResult(true);
    s.onDraftScan(false);
    s.onDraftScan(true);
    s.onDraftScan(false);
    expect(s.mode(inp())).toBe("draft");
    s.onDraftScan(false);
    expect(s.mode(inp())).toBe("watch");
  });

  it("没 GSI 在 draft 中游戏关掉 → off,再开 → watch 而不是直接 draft", () => {
    const s = new AutoScanSchedule();
    s.mode(inp());
    s.onWatchResult(true);
    expect(s.mode(inp())).toBe("draft");
    expect(s.mode(inp({ gameRunning: false }))).toBe("off");
    expect(s.mode(inp())).toBe("watch");
  });

  it("开着 GSI 时两个回调不影响结果", () => {
    const s = new AutoScanSchedule();
    expect(s.mode(inp({ gsi: gs("DOTA_GAMERULES_STATE_GAME_IN_PROGRESS") }))).toBe("off");
    s.onWatchResult(true);
    expect(s.mode(inp({ gsi: gs("DOTA_GAMERULES_STATE_GAME_IN_PROGRESS") }))).toBe("off");
    expect(s.mode(inp({ gsi: gs(GSI_HERO_SELECTION) }))).toBe("draft");
    s.onDraftScan(false);
    s.onDraftScan(false);
    expect(s.mode(inp({ gsi: gs(GSI_HERO_SELECTION) }))).toBe("draft");
  });

  it("GSI 选人中途变 null(超时)→ watch,轻量查看后回 draft", () => {
    const s = new AutoScanSchedule();
    expect(s.mode(inp({ gsi: gs(GSI_HERO_SELECTION) }))).toBe("draft");
    s.onWatchResult(true); // GSI 在时的回调应被忽略
    expect(s.mode(inp())).toBe("watch");
    s.onWatchResult(true);
    expect(s.mode(inp())).toBe("draft");
  });

  it("扫描间隔", () => {
    expect(intervalFor("watch")).toBe(3000);
    expect(intervalFor("draft")).toBe(1000);
    expect(intervalFor("off")).toBeNull();
    expect(WATCH_INTERVAL_MS).toBe(3000);
    expect(DRAFT_INTERVAL_MS).toBe(1000);
  });
});
