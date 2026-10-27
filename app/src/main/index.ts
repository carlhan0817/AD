// app/src/main/index.ts
// Electron 主进程:建透明置顶 overlay 窗口 + 数据源 + IPC 推送。
// 默认数据源 = 手动扫描(按 Ctrl+Shift+S 扫一次):新识别层 scanPool(分类器认技能 →
// 按组定英雄 → 本局记忆 → 打分),见 docs/superpowers/plans/2026-10-03-recognition-rework.md。
// 连续监控(LiveSnapshotSource 包装 runMonitorLoop)是保留资产,设 AD_MONITOR_LOOP=1 才启用;
// 它仍有已知限制:候选池为空、玩家卡布局是占位。
// 启动时探测游戏窗口/显示模式,定位 overlay 到客户区,独占全屏时只发引导文案(不强攻)。
// overlay:guide 频道当前无人消费,renderer 端展示待后续任务接 preload bridge。
import { app, BrowserWindow, globalShortcut, screen } from "electron";
import { join } from "node:path";
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
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
import { guideMessageFor } from "./display_mode_guide";
import { setOverlayClickThrough, raiseOverlayZOrder } from "@ad/main/ffi/overlay_window_ctl";
import { findGameWindow, gameClientRect } from "@ad/main/ffi/game_window";
import { detectDisplayMode } from "@ad/main/ffi/display_mode";
import { rectToOverlayBounds, type WindowRect } from "@ad/main/ffi/geometry";
import { runMonitorLoop, type MonitorDeps } from "@ad/main/capture/loop";
import { scanPool, type PoolScanDeps } from "@ad/main/capture/scan_pool";
import { captureScreenFrames } from "@ad/main/capture/screen_source";
import { loadIndex, type IndexEntry } from "@ad/core/recognition/index_store";
import { loadClassifier } from "@ad/core/recognition/classifier";
import { PoolMemory } from "@ad/core/recognition/pool_memory";
import { portraitVariants } from "@ad/core/recognition/hero_portrait";
import { remainingQuota } from "@ad/core/statemachine/quota";
import { buildAbilityLookup } from "@ad/core/db/ability_lookup";
import { ReferenceDb } from "@ad/core/db/reference";
import { defaultScoringConfig } from "@ad/core/scoring/config";
import type { DraftState, PlayerState } from "@ad/shared/types/draft";
import type { ScoredCandidate } from "@ad/shared/types/scoring";

const SCAN_HOTKEY = "CommandOrControl+Shift+S";
const FALLBACK_RECT: WindowRect = { x: 0, y: 0, width: 1920, height: 1080 };

// 路径锚点:app.getAppPath() 在 dev(electron-vite dev,cwd=app/)和打包后均稳定指向
// app/ 目录(含 app/package.json 的目录),与 main/src/capture/monitor_once.ts 用
// import.meta.url 相对 main/src 解出的 repo 根 + models|pipeline 路径等价。
function resolveModelPaths(): { index: string; db: string; model: string; classNames: string; selection: string } {
  const appRoot = app.getAppPath(); // .../AD/app
  return {
    selection: join(appRoot, "../models/templates/sprites/panorama/images/heroes/selection"),
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

/** 把扫描用的那一帧存成 PNG(app/.scan_frames/,不入库),以后可以拿运行时的真帧补进标准答案。
 *  截图里有别的玩家名字,只留在本机。存失败只记日志,不影响扫描。 */
async function saveScanFrame(rgb: { width: number; height: number; data: Uint8Array }, n: number): Promise<void> {
  try {
    const dir = join(app.getAppPath(), ".scan_frames");
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `scan_${new Date().toISOString().replace(/[:.]/g, "-")}_${n}.png`);
    await sharp(Buffer.from(rgb.data), { raw: { width: rgb.width, height: rgb.height, channels: 3 } }).png().toFile(file);
    diag(`[scan]   帧已存 ${file}`);
  } catch (err) {
    diag(`[scan]   存帧失败: ${err}`);
  }
}

/** 手动扫描:注册全局热键,每按一次截一帧 → scanPool → 推一帧 snapshot 给 overlay。
 *  资产(分类器/reference.db)加载失败时记日志并降级为不可扫描,overlay 保持显示。
 *  返回停止函数(注销热键 + 关 DB 连接,释放 node-sqlite3-wasm 的锁目录)。 */
async function startManualScan(win: BrowserWindow): Promise<() => void> {
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

    const memory = new PoolMemory();
    const cfg = defaultScoringConfig();
    let version = 0;
    let busy = false;
    const scan = async (): Promise<void> => {
      if (busy) return; // 上一次还没扫完,忽略连按
      busy = true;
      try {
        const rect = currentGameRect();
        if (!win.isDestroyed()) win.setBounds(overlayBoundsFor(rect));
        const t0 = Date.now();
        const frames = await captureScreenFrames();
        const t1 = Date.now();
        const deps: PoolScanDeps = { clf, lookup, ref, cfg, rect, memory, index, heroPortraits };
        const res = await scanPool(frames, deps);
        diag(`[scan] 帧 ${frames.rgb.width}x${frames.rgb.height} 截图 ${t1 - t0}ms 识别 ${Date.now() - t1}ms | ` +
          `池内技能 ${res.pool.length} 可选英雄 ${res.heroes.length}/12(已选走位置 ${res.takenHeroes.join(",") || "无"}) 没认出 ${res.unknownCells} 格` +
          `${res.snapshot.reset ? " (新的一局)" : ""} | 推荐 ${res.recommendations.map((r) => nameOf.get(r.candidate.valveId) ?? r.candidate.valveId).join(", ")}`);
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
        diag(`[scan]   我=${rowText(res.myRow)} 轮到=${rowText(res.activeRow)} 第${res.pickIndex}手 | ` +
          `我的英雄 ${res.me.hero === null ? "未选/没认出" : heroName(-res.me.hero)} | 我已选 ${myAbilities.join(", ") || "无"}` +
          `${res.myPicks && res.myPicks.unknown > 0 ? `(另有 ${res.myPicks.unknown} 格没认出)` : ""}`);
        void saveScanFrame(frames.rgb, version + 1);
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
            : `你:${rowText(res.myRow)} · 第${res.pickIndex}手${res.activeRow === res.myRow ? " · 轮到你" : ""}` +
              `${res.me.hero !== null ? ` · ${heroName(-res.me.hero)}` : ""}`;
        const snap: OverlaySnapshot = {
          state: { activeRow: res.myRow ?? 0, players },
          recommendations: res.recommendations,
          remaining: remainingQuota(res.myRow === null ? players[0] : res.me),
          labels,
          note,
          version: ++version,
        };
        if (!win.isDestroyed()) {
          win.webContents.send(OVERLAY_CHANNEL, snap);
          const b = win.getBounds();
          diag(`[overlay] 已推送 v${snap.version}(${snap.recommendations.length} 条);窗口 ${b.width}x${b.height}@(${b.x},${b.y}) 可见=${win.isVisible()}`);
        }
      } catch (err) {
        diag(`[scan] 扫描失败: ${err}`);
      } finally {
        busy = false;
      }
    };
    const ok = globalShortcut.register(SCAN_HOTKEY, () => { void scan(); });
    diag(ok ? `[scan] 已就绪:在选取界面按 ${SCAN_HOTKEY} 扫描` : `[scan] 热键 ${SCAN_HOTKEY} 注册失败(被别的程序占用?)`);
    return () => {
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
      void startManualScan(win).then((s) => { stop = s; });
    }
  });
  app.on("window-all-closed", () => { stop(); app.quit(); });
});
