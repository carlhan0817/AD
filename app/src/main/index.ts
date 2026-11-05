// app/src/main/index.ts
// Electron 主进程:建透明置顶 overlay 窗口 + 数据源 + IPC 推送。
// 默认数据源 = 扫描:新识别层 scanPool(分类器认技能 → 按组定英雄 → 本局记忆 → 打分),
// 见 docs/superpowers/plans/2026-10-03-recognition-rework.md。两种触发共用一个 scan():
// 热键 Ctrl+Shift+S 随时扫一次;自动扫描(auto_scan.ts,托盘可关)在选人阶段画面变了就扫,
// 见 docs/superpowers/specs/2026-11-05-auto-scan-design.md。
// 连续监控(LiveSnapshotSource 包装 runMonitorLoop)是保留资产,设 AD_MONITOR_LOOP=1 才启用;
// 它仍有已知限制:候选池为空、玩家卡布局是占位。
// 启动时探测游戏窗口/显示模式,定位 overlay 到客户区,独占全屏时只发引导文案(不强攻)。
// overlay:guide 频道当前无人消费,renderer 端展示待后续任务接 preload bridge。
import { app, BrowserWindow, globalShortcut, ipcMain, screen } from "electron";
import { join } from "node:path";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import sharp from "sharp";

// 诊断日志:主进程 console 在 electron-vite dev 终端不回显,故同时落盘到 app/.live.log,
// 便于确认扫描 / 推送链路在 Electron 内的真实运行状态(成功与失败都记)。
function diag(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try { appendFileSync(join(app.getAppPath(), ".live.log"), line); } catch { /* 忽略日志写入失败 */ }
  console.log(msg);
}
import { OVERLAY_CHANNEL, type OverlaySnapshot } from "@ad/shared/types/ipc";
import { LiveSnapshotSource, type LiveDeps } from "./live_snapshot_source";
import { OverlayPresence } from "./presence";
import { startAutoScan, turnReadingOf, type Frames } from "./auto_scan";
import { guideMessageFor } from "./display_mode_guide";
import { setOverlayClickThrough, raiseOverlayZOrder } from "@ad/main/ffi/overlay_window_ctl";
import { findGameWindow, gameClientRect, isGameForeground } from "@ad/main/ffi/game_window";
import { detectDisplayMode } from "@ad/main/ffi/display_mode";
import { rectToOverlayBounds, type WindowRect } from "@ad/main/ffi/geometry";
import { runMonitorLoop, type MonitorDeps } from "@ad/main/capture/loop";
import { scanPool, type PoolScanDeps, type PoolScanResult } from "@ad/main/capture/scan_pool";
import { FrameStore } from "@ad/main/capture/frame_store";
import { captureScreenFrames, physicalScreenSize, primaryScreenSourceId } from "@ad/main/capture/screen_source";
import { rawToFrames } from "@ad/main/decode";
import { loadIndex, type IndexEntry } from "@ad/core/recognition/index_store";
import { loadClassifier } from "@ad/core/recognition/classifier";
import { PoolMemory } from "@ad/core/recognition/pool_memory";
import { AutoScanSchedule } from "@ad/core/autoscan/schedule";
import { TurnLock } from "@ad/core/autoscan/turn_lock";
import { portraitVariants } from "@ad/core/recognition/hero_portrait";
import { remainingQuota } from "@ad/core/statemachine/quota";
import { buildAbilityLookup } from "@ad/core/db/ability_lookup";
import { ReferenceDb } from "@ad/core/db/reference";
import { defaultScoringConfig, loadScoringConfig } from "@ad/core/scoring/config";
import { buildSimilarMap, loadAbilityTags } from "@ad/core/scoring/similar";
import { roundOf } from "@ad/core/scoring/weights";
import type { DraftState, PlayerState } from "@ad/shared/types/draft";
import type { ScoredCandidate } from "@ad/shared/types/scoring";

const SCAN_HOTKEY = "CommandOrControl+Shift+S";
const FALLBACK_RECT: WindowRect = { x: 0, y: 0, width: 1920, height: 1080 };

// 路径锚点:app.getAppPath() 在 dev(electron-vite dev,cwd=app/)和打包后均稳定指向
// app/ 目录(含 app/package.json 的目录),与 main/src/capture/monitor_once.ts 用
// import.meta.url 相对 main/src 解出的 repo 根 + models|pipeline 路径等价。
function resolveModelPaths(): { index: string; db: string; model: string; classNames: string; selection: string; tags: string; scoring: string } {
  const appRoot = app.getAppPath(); // .../AD/app
  return {
    selection: join(appRoot, "../models/templates/sprites/panorama/images/heroes/selection"),
    tags: join(appRoot, "../models/tags/ability_tags.json"),
    scoring: join(appRoot, "../scoring_config.json"),
    index: join(appRoot, "../models/templates/phash_index.json"),
    db: join(appRoot, "../pipeline/out/reference.db"),
    model: join(appRoot, "../models/classifier/ability_classifier_fp16.onnx"),
    classNames: join(appRoot, "../models/classifier/class_names.json"),
  };
}

/** 游戏客户区矩形是物理像素(Win32 读出来的),而 BrowserWindow.setBounds 吃的是 DIP。
 *  系统缩放不是 100% 时(用户机器是 125%)直接传物理像素,overlay 会被放大成 2400×1350,
 *  右上角的面板跑到屏幕外——真机实测看不到悬浮窗就是这个原因。故先换算成 DIP。 */
function overlayBoundsFor(rect: WindowRect): Electron.Rectangle {
  const physical = rectToOverlayBounds(rect);
  return process.platform === "win32" ? screen.screenToDipRect(null, physical) : physical;
}

/** 读游戏客户区矩形(只读);游戏没开或读不到时回退 1920×1080@(0,0)。 */
function currentGameRect(): WindowRect {
  const hwnd = findGameWindow();
  return (hwnd ? gameClientRect(hwnd) : null) ?? FALLBACK_RECT;
}

/** 截帧存放处(app/.scan_frames/,不入库),以后可以拿运行时的真帧补进标准答案。
 *  截图里有别的玩家名字,只留在本机。 */
function scanFramesDir(): string { return join(app.getAppPath(), ".scan_frames"); }

/** 对比模式用:把那一帧直接存成 PNG(散放在 .scan_frames/ 下,不分局)。存失败只记日志。
 *  正式扫描的帧改由 FrameStore 按局存。 */
async function saveScanFrame(rgb: { width: number; height: number; data: Uint8Array }, n: number): Promise<void> {
  try {
    const dir = scanFramesDir();
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `scan_${new Date().toISOString().replace(/[:.]/g, "-")}_${n}.png`);
    await sharp(Buffer.from(rgb.data), { raw: { width: rgb.width, height: rgb.height, channels: 3 } }).png().toFile(file);
    diag(`[scan]   帧已存 ${file}`);
  } catch (err) {
    diag(`[scan]   存帧失败: ${err}`);
  }
}

// 「持续屏幕画面流」截图(默认开,设 AD_NO_STREAM_CAPTURE=1 才关;取帧在 preload 里做)。
// 普通截图每次整屏抓一遍,真机上每次都让游戏顿一下;画面流一直开着,取帧只是拿一张,不卡。
// 失败、超时、尺寸不对都返回 null,由调用方退回普通截图。
const STREAM_CAPTURE = !process.env.AD_NO_STREAM_CAPTURE;
// 对比模式(设 AD_CAPTURE_COMPARE=1):热键那次同时用画面流和普通截图各取一帧,各自用全新的记忆识别,
// 逐项对比写进日志,不写正式记忆、不推悬浮窗。用来决定识别能不能用画面流(画面流颜色有小偏差)。
const CAPTURE_COMPARE = !!process.env.AD_CAPTURE_COMPARE;
// 画面流截的帧能不能直接拿来识别。2026-11-05 真机对比 13 次全部一致
// (docs/superpowers/plans/2026-11-05-auto-scan-capture-check.md),所以识别也用画面流。
export const RECOGNIZE_WITH_STREAM = true;
const STREAM_TIMEOUT_MS = 2000;
let streamReqSeq = 0;
async function captureViaStream(win: BrowserWindow): Promise<ReturnType<typeof rawToFrames> | null> {
  const sourceId = await primaryScreenSourceId();
  if (sourceId === null || win.isDestroyed()) return null;
  const { width, height } = physicalScreenSize();
  const reqId = ++streamReqSeq;
  return new Promise((resolve) => {
    const done = (v: ReturnType<typeof rawToFrames> | null) => { clearTimeout(timer); ipcMain.removeListener("capture:frame", onFrame); resolve(v); };
    const timer = setTimeout(() => { diag("[capture] 画面流超时,退回普通截图"); done(null); }, STREAM_TIMEOUT_MS);
    const onFrame = (_e: unknown, msg: { reqId: number; width?: number; height?: number; data?: ArrayBuffer; error?: string }) => {
      if (msg.reqId !== reqId) return;
      if (msg.error || msg.data === undefined || msg.width !== width || msg.height !== height) {
        diag(`[capture] 画面流失败(${msg.error ?? `尺寸 ${msg.width}x${msg.height}`}),退回普通截图`);
        done(null);
        return;
      }
      done(rawToFrames(new Uint8Array(msg.data), width, height, "rgba"));
    };
    ipcMain.on("capture:frame", onFrame);
    win.webContents.send("capture:grab", { reqId, sourceId, width, height });
  });
}

/** 手动扫描:注册全局热键,每按一次截一帧 → scanPool → 推一帧 snapshot 给 overlay。
 *  资产(分类器/reference.db)加载失败时记日志并降级为不可扫描,overlay 保持显示。
 *  返回停止函数(注销热键 + 关 DB 连接,释放 node-sqlite3-wasm 的锁目录)。 */
async function startManualScan(win: BrowserWindow, presence: OverlayPresence): Promise<() => void> {
  try {
    const paths = resolveModelPaths();
    const clf = await loadClassifier(paths.model, paths.classNames);
    const ref = new ReferenceDb(paths.db);
    const lookup = buildAbilityLookup(ref);
    // pHash 索引只是「第二意见」和英雄模型核对用的,缺了不影响主流程。
    let index: IndexEntry[] | undefined;
    if (existsSync(paths.index)) index = loadIndex(paths.index);
    // valveId → 英文名(技能与英雄都在 abilities 表里,英雄是负 valveId),给 overlay 显示用。
    const nameOf = new Map<number, string>();
    for (const r of ref.all("SELECT valve_id, english_name FROM abilities") as { valve_id: number; english_name: string }[]) {
      nameOf.set(r.valve_id, r.english_name);
    }
    // 认「我」卡上的英雄要用英雄选取立绘(流水线下载到本地);缺了就不认,按没选英雄推荐。
    const pictureOf = new Map<number, string>();
    for (const r of ref.all("SELECT hero_id, picture FROM heroes") as { hero_id: number; picture: string }[]) {
      pictureOf.set(r.hero_id, r.picture);
    }
    const portraitCache = new Map<number, Float32Array[] | null>();
    const heroPortraits = async (heroId: number): Promise<Float32Array[] | null> => {
      if (portraitCache.has(heroId)) return portraitCache.get(heroId)!;
      let v: Float32Array[] | null = null;
      const file = join(paths.selection, `npc_dota_hero_${pictureOf.get(heroId)}_png.png`);
      if (existsSync(file)) {
        const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
        v = portraitVariants({ width: info.width, height: info.height, data: new Uint8Array(data) });
      }
      portraitCache.set(heroId, v);
      return v;
    };
    diag(`[scan] assets OK: 分类器 ${clf.classNames.length} 类, 技能表 ${lookup.size} 条, pHash 索引 ${index ? `${index.length} 条` : "无(不启用第二意见)"}, ` +
      `英雄立绘 ${existsSync(paths.selection) ? "有" : "无(不认我的英雄)"}`);

    const similar = existsSync(paths.tags) ? buildSimilarMap(loadAbilityTags(paths.tags), lookup) : undefined;
    diag(`[scan] 同类技能表 ${similar ? `${similar.size} 条` : "无"}`);
    // 权重放在仓库根的 scoring_config.json,每次扫描都重新读:改完存盘,下一次扫描就生效,不用重启。
    // 文件写错时记日志并沿用默认值,不影响扫描。
    const readCfg = () => {
      try { return existsSync(paths.scoring) ? loadScoringConfig(readFileSync(paths.scoring, "utf-8")) : defaultScoringConfig(); }
      catch (err) { diag(`[scan] scoring_config.json 读取失败,用默认权重: ${err}`); return defaultScoringConfig(); }
    };
    const memory = new PoolMemory();
    const turnLock = new TurnLock();
    const frameStore = new FrameStore(scanFramesDir());
    let version = 0;
    const blankSnapshot = (note: string): OverlaySnapshot => ({
      state: { activeRow: 0, players: [] }, recommendations: [], highlights: [],
      remaining: { hero: 1, normal: 3, ultimate: 1 }, note, version: ++version,
    });
    // GSI 说换了一局:不等画面对不上,直接清空记忆,并撤掉上一局的推荐。
    presence.onNewDraft = () => {
      memory.reset();
      turnLock.reset();
      frameStore.newGame();
      if (!win.isDestroyed()) win.webContents.send(OVERLAY_CHANNEL, blankSnapshot(presence.autoScanEnabled()
        ? "新的一局,选人画面出来后自动扫描"
        : `新的一局,按 ${SCAN_HOTKEY.replace("CommandOrControl", "Ctrl")} 扫描`));
    };
    // 对比模式:两种截图各识别一次,逐项写差异。
    const compareCaptures = async (rect: WindowRect): Promise<void> => {
      const t0 = Date.now();
      const streamed = await captureViaStream(win);
      const t1 = Date.now();
      const shot = await captureScreenFrames();
      const t2 = Date.now();
      if (streamed === null) { diag("[compare] 画面流取帧失败,这次没法对比"); return; }
      const run = (f: typeof shot) => scanPool(f, { clf, lookup, ref, cfg: readCfg(), rect, memory: new PoolMemory(), index, heroPortraits, similar });
      const a = await run(shot);
      const b = await run(streamed);
      const diffs: string[] = [];
      const same = (what: string, x: unknown, y: unknown) => {
        if (JSON.stringify(x) !== JSON.stringify(y)) diffs.push(`${what} 普通=${JSON.stringify(x)} 画面流=${JSON.stringify(y)}`);
      };
      same("选人界面", a.onDraftScreen, b.onDraftScreen);
      const cellText = (c: { empty: boolean; name: string | null }) => (c.empty ? "(空)" : c.name ?? "(没认出)");
      for (let i = 0; i < Math.max(a.cells.length, b.cells.length); i++) {
        same(`第${i + 1}格`, a.cells[i] ? cellText(a.cells[i]) : null, b.cells[i] ? cellText(b.cells[i]) : null);
      }
      same("已选走的英雄位置", a.takenHeroes, b.takenHeroes);
      same("我坐的行", a.myRow, b.myRow);
      same("轮到的行", a.activeRow, b.activeRow);
      same("我卡上的技能", a.myPicks, b.myPicks);
      diag(`[compare] 截图耗时 画面流 ${t1 - t0}ms 普通 ${t2 - t1}ms | 帧 ${shot.rgb.width}x${shot.rgb.height} / ${streamed.rgb.width}x${streamed.rgb.height}`);
      for (const d of diffs) diag(`[compare]   ${d}`);
      diag(`[compare] ${diffs.length === 0 ? "一致" : `不一致 ${diffs.length} 处`}`);
      void saveScanFrame(shot.rgb, ++version);
      void saveScanFrame(streamed.rgb, ++version);
    };
    // 存帧:只在真正跑了 scanPool 时存(选人界面与否都存),按局分文件夹。失败只记日志。
    const keepFrame = (rgb: Frames["rgb"], label: string): void => {
      void frameStore.save(rgb, label).then((file) => diag(file ? `[scan]   帧已存 ${file}` : "[scan]   存帧失败"));
    };
    // 热键和自动扫描共用一把 busy,不会同时跑两次识别。热键遇到 busy 不丢:排一次,
    // 当前这次扫完立刻补上;已经排着一次时再按就不再排。
    let busy = false;
    let hotkeyQueued = false;
    let lastBounds = "";
    /** 一次完整扫描。given:自动扫描已经取好的帧(调用方已确认 Dota 在最前面);不给就自己截。
     *  返回 null = 这次没跑识别(忙、Dota 不在最前面、对比模式或出错)。 */
    const scan = async (source: "hotkey" | "auto", given?: Frames): Promise<PoolScanResult | null> => {
      if (busy) {
        if (source === "hotkey" && !hotkeyQueued) { hotkeyQueued = true; diag("[scan] 正在扫描,这次热键排到它后面"); }
        return null;
      }
      busy = true;
      const who = source === "hotkey" ? "热键" : "自动";
      try {
        const hwnd = findGameWindow();
        const rect = (hwnd ? gameClientRect(hwnd) : null) ?? FALLBACK_RECT;
        const bounds = overlayBoundsFor(rect);
        const boundsKey = JSON.stringify(bounds);
        if (!win.isDestroyed() && boundsKey !== lastBounds) { win.setBounds(bounds); lastBounds = boundsKey; }
        // 截到的不是 Dota(玩家切到了别的窗口):这一帧整个跳过,不识别、不算「不是选人界面」。
        // 找不到 Dota 窗口时照旧扫(热键是手动的,开发时也要能用)。
        const background = () => hwnd !== null && !isGameForeground(hwnd);
        const skipBackground = () => { diag(`[scan] Dota 不在最前面,这次跳过(${who})`); return null; };
        if (given === undefined && background()) return skipBackground();
        if (CAPTURE_COMPARE) { await compareCaptures(rect); return null; }
        const t0 = Date.now();
        let how: string;
        let frames: Frames;
        if (given !== undefined && RECOGNIZE_WITH_STREAM) {
          frames = given;
          how = "自动扫描取的帧";
        } else {
          // 自动扫描在 RECOGNIZE_WITH_STREAM=false 时走这里:识别前用普通截图重新截一张。
          const s = given === undefined && STREAM_CAPTURE && RECOGNIZE_WITH_STREAM ? await captureViaStream(win) : null;
          how = s !== null ? "画面流" : "普通";
          frames = s ?? await captureScreenFrames();
          if (background()) return skipBackground();
        }
        const t1 = Date.now();
        const deps: PoolScanDeps = { clf, lookup, ref, cfg: readCfg(), rect, memory, index, heroPortraits, similar };
        const res = await scanPool(frames, deps);
        const tileText = res.heroTileStats.map((t) => `${t.pos}:${t.chroma.toFixed(0)}/${t.std.toFixed(0)}`).join(" ");
        if (!res.onDraftScreen) {
          diag(`[scan] ${who} | 这一帧不是选人界面,已跳过,没有写入记忆(英雄格 饱和度/对比度 ${tileText})`);
          keepFrame(frames.rgb, `${source}_not_draft`);
          // 自动扫描碰到过渡画面不撤推荐(连续 2 次不是选人界面 presence 会隐藏悬浮窗);热键照旧提示。
          if (source === "hotkey" && !win.isDestroyed()) win.webContents.send(OVERLAY_CHANNEL, blankSnapshot("不在选人界面,这次没有扫描"));
          presence.onScan(false);
          return res;
        }
        // 记忆发现换了一局(没开 GSI 时只能靠这个):帧换新文件夹,「轮到我」锁清掉。
        if (res.snapshot.reset) { frameStore.newGame(); turnLock.reset(); }
        diag(`[scan] ${who} | 帧 ${frames.rgb.width}x${frames.rgb.height} 截图(${how}) ${t1 - t0}ms 识别 ${Date.now() - t1}ms | ` +
          `池内技能 ${res.pool.length} 可选英雄 ${res.heroes.length}/12(已选走位置 ${res.takenHeroes.join(",") || "无"}) 没认出 ${res.unknownCells} 格` +
          `${res.snapshot.reset ? " (新的一局)" : ""} | 推荐 ${res.recommendations.map((r) => nameOf.get(r.candidate.valveId) ?? r.candidate.valveId).join(", ")}`);
        diag(`[scan]   英雄格 饱和度/对比度 ${tileText}`);
        // 每条推荐的各项得分,调权重时看。
        for (const r of res.recommendations) {
          const parts = Object.entries(r.breakdown).filter(([, v]) => v !== 0).map(([k, v]) => `${k} ${(v as number).toFixed(4)}`);
          diag(`[scan]   推荐 ${nameOf.get(r.candidate.valveId) ?? r.candidate.valveId} = ${r.score.toFixed(4)} (${parts.join(", ")})`);
        }
        // 逐组列出认到了什么(英雄 + 3 个普通技能 + 终极),供对照游戏画面核对。
        const heroName = (id: number | null) => (id === null ? "?" : nameOf.get(-id)?.replace(/^Hero: /, "") ?? `hero${id}`);
        const cellName = (c: { empty: boolean; name: string | null }) =>
          c.empty ? "(空)" : c.name === null ? "(没认出)" : nameOf.get(lookup.get(c.name)?.valveId ?? 0) ?? c.name;
        for (const g of res.groups) {
          diag(`[scan]   位置${String(g.hero).padStart(2)} ${heroName(g.heroId)} [${g.rule}] | ` +
            g.cells.map((c) => (c.slot.zone === "ultimate" ? `大招 ${cellName(c)}` : cellName(c))).join(" / "));
        }
        const rowText = (row: number | null) => (row === null ? "?" : row < 5 ? `左${row + 1}` : `右${row - 4}`);
        const myAbilities = res.myPicks ? [...res.myPicks.normals, ...(res.myPicks.ultimate ? [`大招 ${res.myPicks.ultimate}`] : [])] : [];
        diag(`[scan]   我=${rowText(res.myRow)} 选位=${res.seat ?? "?"} 轮到=${rowText(res.activeRow)} 第${res.pickIndex}手(第${roundOf(res.pickIndex)}轮) | ` +
          `我的英雄 ${res.me.hero === null ? "未选/没认出" : heroName(-res.me.hero)} | 我已选 ${myAbilities.join(", ") || "无"}` +
          `${res.myPicks && res.myPicks.unknown > 0 ? `(另有 ${res.myPicks.unknown} 格没认出)` : ""}`);
        keepFrame(frames.rgb, `${source}_turn_${rowText(res.activeRow)}`);
        const labels: Record<number, string> = {};
        for (const r of res.recommendations) {
          const n = nameOf.get(r.candidate.valveId);
          if (n !== undefined) labels[r.candidate.valveId] = n;
        }
        // 只知道「我」的情况(别人的卡目前不读),其余行留空。认不出我时按没选过东西的玩家显示配额。
        const players: PlayerState[] = Array.from({ length: 10 }, (_v, row) => ({ row, hero: null, normals: [], ultimates: [] }));
        if (res.myRow !== null) players[res.myRow] = res.me;
        if (res.me.hero !== null) labels[res.me.hero] = nameOf.get(res.me.hero) ?? String(res.me.hero);
        const left = remainingQuota(res.me);
        const full = res.myRow !== null && left.hero === 0 && left.normal === 0 && left.ultimate === 0;
        const note = res.myRow === null
          ? "没认出你坐哪(按没选过东西推荐)"
          : full
            ? `你:${rowText(res.myRow)} · 已选满`
            : `你:${rowText(res.myRow)} · 第${roundOf(res.pickIndex)}轮第${res.pickIndex}手${res.activeRow === res.myRow ? " · 轮到你" : ""}` +
              `${res.me.hero !== null ? ` · ${heroName(-res.me.hero)}` : ""}`;
        const snap: OverlaySnapshot = {
          state: { activeRow: res.myRow ?? 0, players },
          recommendations: res.recommendations,
          remaining: remainingQuota(res.myRow === null ? players[0] : res.me),
          labels,
          highlights: res.highlights,
          note,
          version: ++version,
        };
        // 轮到我时推荐锁住(热键不受限):锁住期间照常识别、写记忆,只是不推给悬浮窗。
        const decision = turnLock.decide(turnReadingOf(res), source === "hotkey");
        if (!win.isDestroyed()) {
          if (decision === "hold") {
            diag("[auto] 轮到你,推荐已锁住,不刷新");
          } else {
            win.webContents.send(OVERLAY_CHANNEL, snap);
            const b = win.getBounds();
            diag(`[overlay] 已推送 v${snap.version}(${snap.recommendations.length} 条);窗口 ${b.width}x${b.height}@(${b.x},${b.y}) 可见=${win.isVisible()}`);
          }
          presence.onScan(true);
        }
        return res;
      } catch (err) {
        diag(`[scan] 扫描失败: ${err}`);
        return null;
      } finally {
        busy = false;
        if (hotkeyQueued) { hotkeyQueued = false; void scan("hotkey"); }
      }
    };
    const ok = globalShortcut.register(SCAN_HOTKEY, () => { void scan("hotkey"); });
    // 开发用:设 AD_SCAN_ONCE_AFTER_MS 时启动后自动扫一次(不用按热键,方便冒烟测试)。
    const autoScanMs = Number(process.env.AD_SCAN_ONCE_AFTER_MS);
    if (Number.isFinite(autoScanMs) && autoScanMs >= 0) setTimeout(() => { void scan("hotkey"); }, autoScanMs);
    diag(ok ? `[scan] 已就绪:在选取界面按 ${SCAN_HOTKEY} 扫描(截图方式:${CAPTURE_COMPARE ? "对比模式,画面流和普通各一张" : STREAM_CAPTURE ? "画面流,失败退回普通" : "普通"})` : `[scan] 热键 ${SCAN_HOTKEY} 注册失败(被别的程序占用?)`);

    // 自动扫描。对比模式是诊断用的,只用热键,不开自动扫描。
    // 取帧:画面流优先;画面流失败时选人阶段退回普通截图(选人阶段普通截图不影响 FPS,已实测),
    // 轻量查看(可能在游戏里)不退回——普通截图每次都让游戏顿一下,宁可这一轮不看。
    const grabStreamFrame = async (mode: "watch" | "draft"): Promise<Frames | null> => {
      if (STREAM_CAPTURE) {
        const s = await captureViaStream(win);
        if (s !== null || mode === "watch") return s;
      }
      return captureScreenFrames();
    };
    const stopAuto = CAPTURE_COMPARE ? () => {} : startAutoScan({
      schedule: new AutoScanSchedule(),
      enabled: () => presence.autoScanEnabled(),
      gsi: () => presence.currentGsi(),
      gameRunning: () => findGameWindow() !== null,
      gameForeground: () => { const h = findGameWindow(); return h !== null && isGameForeground(h); },
      rect: currentGameRect,
      grabStreamFrame,
      scan: (frames) => scan("auto", frames),
      diag,
    });
    if (CAPTURE_COMPARE) diag("[auto] 对比模式下不开自动扫描,只用热键");
    return () => {
      stopAuto();
      globalShortcut.unregister(SCAN_HOTKEY);
      try { ref.close(); } catch { /* 忽略关闭期错误 */ }
    };
  } catch (err) {
    diag(`[scan] 启动失败(缺模型/reference.db?): ${err}`);
    return () => {};
  }
}

/** 包装 runMonitorLoop 为 LiveDeps.runLoop:构造 MonitorDeps(候选池暂留空,见文件头注释),
 *  fire-and-forget 启动(runMonitorLoop 是不会 resolve 的 while(true) 循环,无内建取消)。
 *  返回的停止函数是"最佳努力":并不能真正中断 runMonitorLoop 内部的轮询,
 *  而是置位 stopped 标记并让 onUpdate 在标记后短路,从而停止向 overlay 继续推送。
 *  loadIndex/ReferenceDb 在模型资产缺失或损坏时会同步抛出;此调用发生在
 *  did-finish-load 之后(窗口已显示),若不捕获会在主进程内成为未捕获异常,
 *  导致 overlay 永久空白且无诊断信息。因此整体 try/catch:失败时打印明确的
 *  console.error 并返回一个 no-op 停止函数,让 overlay 优雅降级(保持显示,但不推送数据)。 */
function startLiveLoop(
  onUpdate: (state: DraftState, activeRow: number, recs: ScoredCandidate[]) => void,
  rect: WindowRect,
): () => void {
  try {
    const { index: indexPath, db: dbPath } = resolveModelPaths();
    const index = loadIndex(indexPath);
    const ref = new ReferenceDb(dbPath);
    diag(`[live] assets OK: index=${index.length} 条, db=${dbPath}`);
    let stopped = false;
    let updates = 0;
    const deps: MonitorDeps = {
      index,
      ref,
      pool: [], // 已知限制:候选池来源尚未接入,留空 → recommend 在空池上恒返回 []
      cfg: defaultScoringConfig(),
      rect, // 启动时读到的游戏客户区矩形,供比例池布局推导像素
      log: diag, // 诊断:把循环每道门的状态落 .live.log,定位真机识别卡在哪道门
      onUpdate: (state, activeRow, recs) => {
        if (stopped) return;
        if (++updates <= 3) diag(`[live] update#${updates} activeRow=${activeRow} recs=${recs.length}`);
        onUpdate(state, activeRow, recs);
      },
    };
    runMonitorLoop(deps).catch((err) => diag(`[live] runMonitorLoop failed: ${err}`));
    diag("[live] monitor loop started");
    // 停止时除了置位 stopped 标记,还要 close 这个长连接,释放它持有的
    // node-sqlite3-wasm 锁目录(<dbpath>.lock)。否则正常退出(window-all-closed →
    // source.stop())也不会 rmdir 锁目录,下次启动就会撞上陈旧锁而 "database is locked"
    // ——即使是干净退出也必须显式 close,因为 ref 只在这个闭包里,外部拿不到引用。
    return () => { stopped = true; try { ref.close(); } catch { /* 忽略关闭期错误 */ } };
  } catch (err) {
    diag(`[live] failed to start monitor loop (missing/invalid model assets?): ${err}`);
    return () => {};
  }
}

function createOverlayWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 720,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
    },
  });
  win.setAlwaysOnTop(true, "screen-saver");
  setOverlayClickThrough(win);
  // 不要对本窗口 setContentProtection(true):真机上它让透明 overlay 在游戏上整个看不见
  // (2026-10-27 实测)。overlay 会被截屏一起拍进去,所以推荐面板固定放在右上角,
  // 避开技能池与两侧英雄模型格(见 renderer/src/Overlay.tsx)。
  // 渲染端出错时 overlay 只会是一片透明,看不出原因——把渲染端日志/崩溃/加载失败都落到 .live.log。
  win.webContents.on("console-message", (_e, level, message) => {
    if (level >= 2) diag(`[renderer] ${level === 3 ? "error" : "warn"}: ${message}`);
  });
  win.webContents.on("render-process-gone", (_e, d) => diag(`[renderer] 渲染进程退出: ${d.reason}`));
  win.webContents.on("did-fail-load", (_e, code, desc, url) => diag(`[renderer] 页面加载失败 ${code} ${desc} ${url}`));
  win.webContents.on("did-finish-load", () => {
    const b = win.getBounds();
    diag(`[overlay] 页面已加载;窗口 ${b.width}x${b.height}@(${b.x},${b.y}) DIP(系统缩放 ${screen.getPrimaryDisplay().scaleFactor}) 可见=${win.isVisible()} 置顶=${win.isAlwaysOnTop()}`);
  });
  win.once("ready-to-show", () => diag(`[overlay] 自身窗口拔到最顶层 ${raiseOverlayZOrder(win) ? "成功" : "失败"}`));
  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    win.loadFile(join(__dirname, "../renderer/index.html"));
  }
  return win;
}

app.whenReady().then(() => {
  const win = createOverlayWindow();

  const hwnd = findGameWindow();
  diag(`[live] findGameWindow -> ${hwnd ? "找到 Dota 2 窗口" : "未找到(游戏未运行?)"}`);
  // 池布局推导所需的客户区矩形;读不到时回退 1920×1080@(0,0)(诊断会标注)。
  let liveRect: WindowRect = FALLBACK_RECT;
  if (hwnd) {
    const monitorSize = screen.getPrimaryDisplay().size;
    const rect = gameClientRect(hwnd);
    const isFull = !!rect && rect.width >= monitorSize.width && rect.height >= monitorSize.height;
    const mode = detectDisplayMode(hwnd, isFull);
    diag(`[live] 游戏窗口 rect=${rect ? `${rect.width}x${rect.height}@(${rect.x},${rect.y})` : "null"} mode=${mode}`);
    const guide = guideMessageFor(mode);
    if (guide) win.webContents.send("overlay:guide", guide); // renderer 显示引导(独占全屏)
    if (rect) { win.setBounds(overlayBoundsFor(rect)); liveRect = rect; }
    else diag("[live] gameClientRect 读不到,池布局回退 1920×1080@(0,0)");
  } else {
    diag("[live] 无游戏窗口,池布局回退 1920×1080@(0,0)");
  }

  let stop: () => void = () => {};
  // 托盘菜单 + 显示/静默控制(GSI 开关也在托盘里)。
  const presence = new OverlayPresence(win, diag, () => {
    if (win.isDestroyed()) return;
    win.showInactive();
    raiseOverlayZOrder(win);
  }, () => findGameWindow() !== null);
  void presence.start().catch((err) => diag(`[presence] 启动失败: ${err}`));
  // preload 报告画面流「不带鼠标指针」的请求实际结果(只报一次)。
  ipcMain.on("capture:info", (_e, msg: string) => diag(`[capture] ${msg}`));
  // 等首帧加载完再开始推送,避免渲染前丢帧。
  win.webContents.once("did-finish-load", () => {
    // 手动扫描与连续监控各开一个 ReferenceDb 连到同一个 reference.db;两个连接并存会被
    // node-sqlite3-wasm 判定为 "database is locked"(见 core/src/db/reference.ts 头部注释),
    // 故二者互斥,只启动其中一个。
    if (process.env.AD_MONITOR_LOOP) {
      const liveDeps: LiveDeps = { runLoop: (onUpdate) => startLiveLoop(onUpdate, liveRect) };
      const source = new LiveSnapshotSource((snap) => {
        if (!win.isDestroyed()) win.webContents.send(OVERLAY_CHANNEL, snap);
      }, liveDeps);
      source.start(1500);
      stop = () => source.stop();
    } else {
      void startManualScan(win, presence).then((s) => { stop = s; });
    }
  });
  app.on("window-all-closed", () => { stop(); presence.stop(); app.quit(); });
});
