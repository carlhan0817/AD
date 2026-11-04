// core/src/gsi/gsi.ts
// GSI(Valve 官方的游戏状态接口):Dota 启动时读 cfg/gamestate_integration/ 里的配置文件,
// 之后把游戏状态以 JSON POST 到配置里写的本机地址。这里只做纯逻辑:读数据、生成配置文件、
// 按阶段决定悬浮窗显示还是静默。收数据的服务器在 main/src/gsi/server.ts。
// 字段名对照过上游 ability-draft-plus 的真实抓包样本(map.game_state / matchid / clock_time)。
// GSI 不提供技能征召的技能池和谁选了什么,那些仍靠截图识别。

export interface GsiState {
  /** 例如 "DOTA_GAMERULES_STATE_HERO_SELECTION";不在对局里(主菜单)时没有,为 null。 */
  phase: string | null;
  /** 对局编号,用来分清是不是新的一局。 */
  matchId: string | null;
  /** 游戏时钟(秒);技能征召选人阶段从 -59 走到 0 是预览期。 */
  clock: number | null;
}

/** 配置文件里的口令,Dota 每次发数据都会带上;对不上的数据一律丢掉,防止别的程序冒充。 */
export function tokenOf(payload: unknown): string | null {
  const auth = (payload as { auth?: { token?: unknown } } | null)?.auth;
  return typeof auth?.token === "string" ? auth.token : null;
}

/** 读出阶段、对局编号、时钟。缺字段或格式不认识时当作「不知道」(null),不报错。 */
export function parseGsi(payload: unknown): GsiState {
  const map = (payload as { map?: Record<string, unknown> } | null)?.map;
  const str = (v: unknown) => (typeof v === "string" && v !== "" ? v : null);
  return {
    phase: map ? str(map.game_state) : null,
    matchId: map ? str(map.matchid) : null,
    clock: map && typeof map.clock_time === "number" ? map.clock_time : null,
  };
}

export const GSI_HERO_SELECTION = "DOTA_GAMERULES_STATE_HERO_SELECTION";
export const GSI_POST_GAME = "DOTA_GAMERULES_STATE_POST_GAME";

/** 悬浮窗该显示(选人中)还是静默(其他所有阶段,包括主菜单)。 */
export function overlayModeFor(phase: string | null): "active" | "silent" {
  return phase === GSI_HERO_SELECTION ? "active" : "silent";
}

export const GSI_CFG_FILE_NAME = "gamestate_integration_ad_assistant.cfg";

/** 生成配置文件内容。只要阶段/对局编号/时钟所在的 map 段;其他数据(英雄、物品等)这一轮不要。
 *  heartbeat:状态没变时也每 10 秒发一次,程序靠它判断 GSI 是否还在工作。 */
export function buildGsiCfg(port: number, token: string): string {
  return [
    '"AD Assistant GSI"',
    "{",
    `    "uri"           "http://127.0.0.1:${port}/"`,
    '    "timeout"       "5.0"',
    '    "buffer"        "0.1"',
    '    "throttle"      "0.5"',
    '    "heartbeat"     "10.0"',
    '    "auth"',
    "    {",
    `        "token"     "${token}"`,
    "    }",
    '    "data"',
    "    {",
    '        "provider"  "1"',
    '        "map"       "1"',
    "    }",
    "}",
    "",
  ].join("\r\n");
}

/** 从已有配置文件里读回端口和口令,用来检查它和程序当前设置是否一致。 */
export function parseGsiCfg(cfg: string): { port: number | null; token: string | null } {
  const port = /"uri"\s+"https?:\/\/[^"]*:(\d+)/i.exec(cfg);
  const token = /"token"\s+"([^"]*)"/i.exec(cfg);
  return { port: port ? Number(port[1]) : null, token: token ? token[1] : null };
}

// 超过这么久没收到数据,就认为 GSI 不在工作(没装、Dota 没重启、Dota 关了),退回画面判断。
// 配置里 heartbeat 是 10 秒,留出三倍余量。
export const GSI_STALE_MS = 30_000;

/** 记住最近一次 GSI 状态,判断它是否还新鲜,以及是否换了一局。 */
export class GsiTracker {
  private last: GsiState | null = null;
  private lastAt = 0;
  // 最后一次「知道」的阶段和对局编号。回主菜单时 Dota 发的是空数据,不能拿它覆盖,
  // 否则「打完 → 主菜单 → 下一局选人」就认不出是新的一局。
  private knownPhase: string | null = null;
  private knownMatchId: string | null = null;

  /** 记一条新状态;返回这条是否意味着换了一局(对局编号变了,或从别的阶段回到了选人)。 */
  update(state: GsiState, now: number): { newDraft: boolean } {
    // 同一个对局编号回到选人 = 掉线重连,不是新的一局(不能清空记忆)。
    const sameMatch = state.matchId !== null && state.matchId === this.knownMatchId;
    const newDraft = state.phase === GSI_HERO_SELECTION && !sameMatch && (
      (state.matchId !== null && this.knownMatchId !== null) ||
      (this.knownPhase !== null && this.knownPhase !== GSI_HERO_SELECTION)
    );
    if (state.phase !== null) this.knownPhase = state.phase;
    if (state.matchId !== null || newDraft) this.knownMatchId = state.matchId; // 新的一局:旧编号作废

    this.last = state;
    this.lastAt = now;
    return { newDraft };
  }

  /** GSI 还在工作就返回最近的状态,否则 null(调用方退回画面判断)。 */
  current(now: number): GsiState | null {
    return this.last !== null && now - this.lastAt <= GSI_STALE_MS ? this.last : null;
  }
}

// 没有 GSI 时的后备:连续这么多次「不是选人界面」才静默(说明框偶尔挡住时不会误判)。
export const FALLBACK_SILENT_AFTER = 2;

/** 决定悬浮窗该不该显示。
 *  - GSI 报了明确阶段:以 GSI 为准(选人显示,其余静默)。
 *  - GSI 报「不在对局里」:GSI 比画面慢几秒,选人刚开始时还是这个状态,所以改看画面——
 *    最近一次扫描确认是选人界面才显示(scanSawDraft),否则静默(主菜单过不了选人界面检查)。
 *  - 没有 GSI:连续几次扫描不是选人界面才静默。 */
export function decideOverlay(
  gsi: GsiState | null, nonDraftStreak: number, scanSawDraft: boolean,
): "active" | "silent" {
  if (gsi !== null) return gsi.phase === null ? (scanSawDraft ? "active" : "silent") : overlayModeFor(gsi.phase);
  return nonDraftStreak >= FALLBACK_SILENT_AFTER ? "silent" : "active";
}
