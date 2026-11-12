// app/src/main/presence.ts
// 悬浮窗什么时候出现、什么时候静默,以及 GSI 的开关。
//   - 启用了 GSI 且它还在工作:选人阶段显示(连续 2 次扫描都不是 AD 选人界面则隐藏);
//     加载中 / 不在对局里时看画面(最近一次扫描是选人界面才显示);其他阶段静默。
//   - 没有 GSI:连续 2 次扫描都不是选人界面就静默,扫到选人界面就恢复。
//   - 不管哪种:Dota 不在最前面时悬浮窗先藏起来,切回来再按上面的判断显示。
// GSI 的配置文件只在用户点了托盘菜单里的「启用」、并在弹窗里确认后才写;
// 写完要重启 Dota 才生效。设置(开关、端口、口令、Dota 位置、自动扫描开关)存在用户数据目录的 gsi.json。
import { app, dialog, Menu, nativeImage, Tray, type BrowserWindow } from "electron";
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildGsiCfg, decideOverlay, GSI_HERO_SELECTION, GSI_INIT, GSI_WAIT_FOR_PLAYERS, GsiTracker, parseGsiCfg, type GsiState } from "@ad/core/gsi/gsi";
import { startGsiServer, type GsiServer } from "@ad/main/gsi/server";
import { findDotaDir, gsiCfgPath, readGsiCfg, removeGsiCfg, writeGsiCfg } from "@ad/main/gsi/dota_path";

interface GsiSettings {
  enabled: boolean; port: number; token: string; dotaDir: string | null;
  /** 托盘「自动扫描」勾选(和 GSI 无关,只是存在同一个文件里)。默认开。 */
  autoScan: boolean;
}

/** 第一次启用时尝试的端口;被占用就让系统另挑一个(需要重写配置文件)。 */
const DEFAULT_PORT = 39871;
const RECHECK_MS = 5_000;
/** 多久查一次 Dota 在不在最前面(切走后悬浮窗藏起来的反应时间)。 */
const FOREGROUND_CHECK_MS = 500;

function settingsPath(): string { return join(app.getPath("userData"), "gsi.json"); }
const DEFAULT_SETTINGS: GsiSettings = { enabled: false, port: DEFAULT_PORT, token: "", dotaDir: null, autoScan: true };
function loadSettings(): GsiSettings {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(readFileSync(settingsPath(), "utf-8")) }; }
  catch { return { ...DEFAULT_SETTINGS }; }
}
function saveSettings(s: GsiSettings): void {
  try { writeFileSync(settingsPath(), JSON.stringify(s, null, 2), "utf-8"); } catch { /* 存不下就下次重来 */ }
}

/** 托盘图标:32×32 的金色方块加黑边(PNG 直接写在代码里,不用额外的图片文件)。 */
const TRAY_ICON_PNG = "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAOUlEQVR4nO3OMQEAIAzEwIp4EfhXgauyooAy3JAh21WSnqwA7um9ngQAAAAAAAAAAAAAAPAvYCKAA2EDaTR0N1llAAAAAElFTkSuQmCC";
function trayIcon(): Electron.NativeImage {
  return nativeImage.createFromDataURL(`data:image/png;base64,${TRAY_ICON_PNG}`).resize({ width: 16, height: 16 });
}

export class OverlayPresence {
  private tracker = new GsiTracker();
  private nonDraftStreak = 0;
  /** 最近一次扫描是不是选人界面。GSI 报出选人以外的明确阶段时作废(防止回主菜单时沿用上一局的结果)。 */
  private scanSawDraft = false;
  /** GSI 上一条的阶段(只用来发现阶段变化)。 */
  private lastPhase: string | null | undefined = undefined;
  private mode: "active" | "silent" | null = null;
  private server: GsiServer | null = null;
  private settings = loadSettings();
  private tray: Tray | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private fgTimer: ReturnType<typeof setInterval> | null = null;
  /** 悬浮窗现在是不是露着(mode 为显示且 Dota 在最前面)。 */
  private shown: boolean | null = null;
  /** 上次查到的「Dota 在最前面」。 */
  private lastForeground: boolean | null = null;
  /** 已启用 GSI 但本机端口开不起来时的原因(托盘里直接显示,不然会被当成 Dota 没重启)。 */
  private serverError: string | null = null;
  /** 上次托盘菜单的内容;没变就不重建。 */
  private menuKey = "";

  /** GSI 说换了一局时调用(扫描启动后由扫描那边接上:清空本局记忆)。 */
  onNewDraft: () => void = () => {};

  /** show:显示悬浮窗(不抢焦点)。gameRunning:Dota 窗口还在不在(只读查找)。 */
  constructor(
    private readonly win: BrowserWindow,
    private readonly diag: (m: string) => void,
    private readonly show: () => void,
    private readonly gameRunning: () => boolean,
    private readonly gameForeground: () => boolean,
  ) {}

  async start(): Promise<void> {
    const icon = trayIcon();
    this.tray = new Tray(icon);
    this.tray.setToolTip("AD 助手");
    this.diag(`[presence] 托盘图标已创建(图标 ${icon.getSize().width}x${icon.getSize().height}${icon.isEmpty() ? ",是空图!" : ""})`);
    this.refreshMenu();
    this.checkCfg();
    if (this.settings.enabled) await this.startServer(this.settings.port);
    // 定时复查:GSI 断了能及时退回画面判断,Dota 关了能及时隐藏,托盘状态也跟着更新。
    this.timer = setInterval(() => this.apply(), RECHECK_MS);
    this.fgTimer = setInterval(() => this.checkForeground(), FOREGROUND_CHECK_MS);
    this.apply();
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    if (this.fgTimer !== null) clearInterval(this.fgTimer);
    void this.server?.close();
    this.tray?.destroy();
  }

  /** 已经知道的 Dota 安装位置(启用游戏内追踪时找到或用户选的);不知道为 null。 */
  dotaDir(): string | null { return this.settings.dotaDir; }

  /** 现在的 GSI 状态(没开或超过 30 秒没数据为 null)。给自动扫描用。 */
  currentGsi(): GsiState | null {
    return this.tracker.current(Date.now());
  }

  /** 托盘「自动扫描」有没有勾上。 */
  autoScanEnabled(): boolean {
    return this.settings.autoScan;
  }

  /** 每次扫描后调用。 */
  onScan(onDraftScreen: boolean): void {
    this.nonDraftStreak = onDraftScreen ? 0 : this.nonDraftStreak + 1;
    this.scanSawDraft = onDraftScreen;
    this.apply();
  }

  private onGsi(s: GsiState): void {
    const { newDraft } = this.tracker.update(s, Date.now());
    if (s.phase !== this.lastPhase) {
      this.diag(`[gsi] 阶段 ${this.lastPhase === undefined ? "(开始)" : this.lastPhase ?? "不在对局里"} → ${s.phase ?? "不在对局里"}(对局 ${s.matchId ?? "?"})`);
      // 离开选人(哪怕是中途退出直接回主菜单):之前「扫到选人界面」的结果作废。
      if (s.phase !== GSI_HERO_SELECTION) this.scanSawDraft = false;
      this.nonDraftStreak = 0; // 阶段一变,上一局(可能是非 AD 模式)的「不是选人界面」计数作废
      this.lastPhase = s.phase;
      this.refreshMenu();
    }
    if (newDraft) {
      this.nonDraftStreak = 0;
      this.diag(`[gsi] 新的一局(对局 ${s.matchId ?? "?"}),清空记忆`);
      this.onNewDraft();
    }
    this.apply();
  }

  private apply(): void {
    this.refreshMenu(); // GSI 断了 / 恢复时托盘状态要跟着变
    const gsi = this.tracker.current(Date.now());
    // Dota 关了或崩了:直接隐藏。否则 GSI 断开后退回画面判断,没人扫描时会在桌面上冒出来。
    const running = this.gameRunning();
    const mode = running ? decideOverlay(gsi, this.nonDraftStreak, this.scanSawDraft) : "silent";
    if (this.win.isDestroyed()) return;
    if (mode !== this.mode) { this.mode = mode; this.logMode(mode, running, gsi); this.refreshMenu(); }
    // 悬浮窗只在 Dota 在最前面时露出来:切到别的窗口(或没开 GSI 时在后台退了这一局、
    // 程序看不到画面)都不会把框留在别的窗口上。切回 Dota 时按 mode 重新显示。
    const fg = running && this.gameForeground();
    this.lastForeground = fg;
    const visible = mode === "active" && fg;
    if (visible === this.shown) return;
    if (mode === "active") this.diag(fg ? "[presence] Dota 回到最前面,悬浮窗重新显示" : "[presence] Dota 不在最前面,悬浮窗先藏起来");
    this.shown = visible;
    if (visible) this.show(); else this.win.hide();
  }

  /** 定时查 Dota 在不在最前面(只读);变了才重新判断显示。 */
  private checkForeground(): void {
    const fg = this.gameRunning() && this.gameForeground();
    if (fg !== this.lastForeground) this.apply();
  }

  private logMode(mode: "active" | "silent", running: boolean, gsi: GsiState | null): void {
    const sawText = `最近一次扫描${this.scanSawDraft ? "是" : "不是"}选人界面`;
    let why: string;
    if (!running) why = "没找到 Dota 窗口";
    else if (gsi === null) why = `画面判断(连续 ${this.nonDraftStreak} 次不是选人界面)`;
    else if (gsi.phase === null) why = `GSI 不在对局里,看画面(${sawText})`;
    else if (gsi.phase === GSI_INIT || gsi.phase === GSI_WAIT_FOR_PLAYERS) why = `GSI 阶段 ${gsi.phase}(加载中),看画面(${sawText})`;
    else if (gsi.phase === GSI_HERO_SELECTION && mode === "silent") why = `GSI 阶段选人,但连续 ${this.nonDraftStreak} 次扫描不是 AD 选人界面,隐藏`;
    else why = `GSI 阶段 ${gsi.phase}`;
    this.diag(`[presence] ${mode === "active" ? "显示" : "静默"}:${why}`);
  }

  private async startServer(port: number): Promise<GsiServer | null> {
    try {
      this.server = await startGsiServer(port, this.settings.token, (s) => this.onGsi(s));
      this.serverError = null;
      this.diag(`[gsi] 本机服务器已启动 127.0.0.1:${this.server.port}`);
      return this.server;
    } catch (err) {
      this.diag(`[gsi] 端口 ${port} 无法使用: ${err}`);
      this.serverError = `端口 ${port} 被占用`;
      return null;
    }
  }

  private refreshMenu(): void {
    if (this.tray === null) return;
    const gsi = this.tracker.current(Date.now());
    const status = !this.settings.enabled ? "游戏内追踪:未启用(按画面判断)"
      : this.server === null ? `游戏内追踪:${this.serverError ?? "没在接收"},请先关闭再重新启用(会换一个端口)`
        : gsi !== null ? `游戏内追踪:工作中(${gsi.phase ?? "不在对局里"})` : "游戏内追踪:已启用,还没收到数据(Dota 重启了吗?)";
    const key = `${status}|${this.mode}|${this.settings.enabled}|${this.settings.autoScan}`;
    if (key === this.menuKey) return;
    this.menuKey = key;
    this.tray.setContextMenu(Menu.buildFromTemplate([
      { label: status, enabled: false },
      { label: `悬浮窗:${this.mode === "silent" ? "静默" : "显示"}`, enabled: false },
      { type: "separator" },
      { label: "自动扫描", type: "checkbox", checked: this.settings.autoScan, click: () => this.toggleAutoScan() },
      ...(this.settings.enabled ? [] : [{ label: "启用游戏内追踪可以省掉游戏里的截图开销", enabled: false }]),
      { type: "separator" },
      this.settings.enabled
        ? { label: "关闭游戏内追踪…", click: () => { void this.disable(); } }
        : { label: "启用游戏内追踪(自动出现/静默)…", click: () => { void this.enable(); } },
      { type: "separator" },
      { label: "退出 AD 助手", click: () => app.quit() },
    ]));
  }

  private toggleAutoScan(): void {
    this.settings = { ...this.settings, autoScan: !this.settings.autoScan };
    saveSettings(this.settings);
    this.diag(`[presence] 自动扫描 ${this.settings.autoScan ? "已打开" : "已关闭(只用热键)"}`);
    this.refreshMenu();
  }

  /** 启用:找 Dota → 开服务器 → 弹窗说明要写什么、写到哪 → 用户确认后才写 → 提示重启 Dota。 */
  private async enable(): Promise<void> {
    let dotaDir = this.settings.dotaDir ?? await findDotaDir();
    if (dotaDir === null) {
      const pick = await dialog.showOpenDialog({
        title: "没找到 Dota 2,请选择 dota 2 beta 文件夹", properties: ["openDirectory"],
      });
      if (pick.canceled || pick.filePaths.length === 0) return;
      dotaDir = pick.filePaths[0];
    }
    const token = randomBytes(16).toString("hex");
    this.settings = { ...this.settings, token };
    await this.server?.close();
    this.server = null;
    const server = await this.startServer(DEFAULT_PORT) ?? await this.startServer(0);
    if (server === null) {
      await dialog.showMessageBox({ type: "error", message: "无法在本机开启接收端口,游戏内追踪没有启用。" });
      return;
    }
    const port = server.port;
    const content = buildGsiCfg(port, token);
    const path = gsiCfgPath(dotaDir);
    const { response } = await dialog.showMessageBox({
      type: "question",
      buttons: ["写入", "取消"], defaultId: 0, cancelId: 1,
      title: "启用游戏内追踪",
      message: "要往 Dota 的配置文件夹写入一个文件,让 Dota 把游戏阶段发给本程序。",
      detail: `只写这一个文件,不改 Dota 的其他任何文件;数据只发到本机,不联网。\n\n位置:\n${path}\n\n内容:\n${content}`,
    });
    if (response !== 0) {
      await server.close();
      this.server = null;
      return;
    }
    try { writeGsiCfg(dotaDir, content); }
    catch (err) {
      await dialog.showMessageBox({ type: "error", message: `写入失败:${err}` });
      return;
    }
    this.settings = { ...this.settings, enabled: true, port, token, dotaDir };
    saveSettings(this.settings);
    this.diag(`[gsi] 已启用,配置文件写到 ${path}`);
    this.refreshMenu();
    await dialog.showMessageBox({ type: "info", message: "已写入。请重启 Dota 2,游戏内追踪才会生效。" });
  }

  /** 关闭:停服务器;问用户要不要删掉配置文件。 */
  private async disable(): Promise<void> {
    await this.server?.close();
    this.server = null;
    const dotaDir = this.settings.dotaDir;
    this.settings = { ...this.settings, enabled: false };
    saveSettings(this.settings);
    if (dotaDir !== null && readGsiCfg(dotaDir) !== null) {
      const { response } = await dialog.showMessageBox({
        type: "question", buttons: ["删除", "保留"], defaultId: 0, cancelId: 1,
        message: "游戏内追踪已关闭。要删除写进 Dota 文件夹的那个配置文件吗?", detail: gsiCfgPath(dotaDir),
      });
      if (response === 0) removeGsiCfg(dotaDir);
    }
    this.diag("[gsi] 已关闭");
    this.refreshMenu();
    this.apply();
  }

  /** 启动时检查:已启用但配置文件里的端口/口令和程序不一致(比如被手动改过),记日志提示重新启用。 */
  private checkCfg(): void {
    const dir = this.settings.dotaDir;
    if (!this.settings.enabled || dir === null) return;
    const cfg = readGsiCfg(dir);
    const got = cfg === null ? null : parseGsiCfg(cfg);
    if (got === null || got.port !== this.settings.port || got.token !== this.settings.token) {
      this.diag("[gsi] Dota 文件夹里的配置文件不见了或和程序对不上,请在托盘菜单里重新启用游戏内追踪");
    }
  }
}
