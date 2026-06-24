// app/src/main/index.ts
// Electron 主进程:建透明置顶 overlay 窗口 + 启动 snapshot 源 + IPC 推送。
// 真实接入已完成(阶段 5):数据源 = LiveSnapshotSource,包装 main 包 runMonitorLoop;
// 启动时探测游戏窗口/显示模式,定位 overlay 到客户区,独占全屏时只发引导文案(不强攻)。
// 已知限制:① startLiveLoop 的候选池暂为空数组,需后续接入真实候选池来源;
// ② overlay:guide 频道当前无人消费,renderer 端展示待后续任务接 preload bridge。
// overlay 置顶 + 穿透已接 koffi own-hwnd 控制模块(阶段 4 完成)。
import { app, BrowserWindow, screen } from "electron";
import { join } from "node:path";
import { appendFileSync } from "node:fs";

// 诊断日志:主进程 console 在 electron-vite dev 终端不回显,故同时落盘到 app/.live.log,
// 便于确认 startLiveLoop / 推送链路在 Electron 内的真实运行状态(成功与失败都记)。
function diag(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try { appendFileSync(join(app.getAppPath(), ".live.log"), line); } catch { /* 忽略日志写入失败 */ }
  console.log(msg);
}
import { OVERLAY_CHANNEL } from "@ad/shared/types/ipc";
import { LiveSnapshotSource, type LiveDeps } from "./live_snapshot_source";
import { guideMessageFor } from "./display_mode_guide";
import { setOverlayClickThrough, raiseOverlayZOrder } from "@ad/main/ffi/overlay_window_ctl";
import { findGameWindow, gameClientRect } from "@ad/main/ffi/game_window";
import { detectDisplayMode } from "@ad/main/ffi/display_mode";
import { rectToOverlayBounds, type WindowRect } from "@ad/main/ffi/geometry";
import { runMonitorLoop, type MonitorDeps } from "@ad/main/capture/loop";
import { runScanOnceDemo } from "@ad/main/capture/scan_once_demo";
import { loadIndex } from "@ad/core/recognition/index_store";
// 临时诊断:画框用。排查完连同 debug-cells 发送/zoneOfFlatIndex 一起删除。
import { poolCellRects, poolCellZones } from "@ad/core/recognition/roi";
import { ReferenceDb } from "@ad/core/db/reference";
import { defaultScoringConfig } from "@ad/core/scoring/config";
import type { DraftState } from "@ad/shared/types/draft";
import type { ScoredCandidate } from "@ad/shared/types/scoring";

// 路径锚点:app.getAppPath() 在 dev(electron-vite dev,cwd=app/)和打包后均稳定指向
// app/ 目录(含 app/package.json 的目录),与 main/src/capture/monitor_once.ts 用
// import.meta.url 相对 main/src 解出的 repo 根 + models|pipeline 路径等价。
function resolveModelPaths(): { index: string; db: string } {
  const appRoot = app.getAppPath(); // .../AD/app
  return {
    index: join(appRoot, "../models/templates/phash_index.json"),
    db: join(appRoot, "../pipeline/out/reference.db"),
  };
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

// 临时诊断:把铺平的格子索引映射回其所属 zone(终极/标准),供画框分色。排查完删除。
function zoneOfFlatIndex(flat: number): string {
  return poolCellZones()[flat] ?? "?";
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
  win.once("ready-to-show", () => raiseOverlayZOrder(win));
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
  // 比例池布局推导所需的客户区矩形;读不到时回退 1920×1080@(0,0)(诊断会标注)。
  let liveRect: WindowRect = { x: 0, y: 0, width: 1920, height: 1080 };
  if (hwnd) {
    const monitorSize = screen.getPrimaryDisplay().size;
    const rect = gameClientRect(hwnd);
    const isFull = !!rect && rect.width >= monitorSize.width && rect.height >= monitorSize.height;
    const mode = detectDisplayMode(hwnd, isFull);
    diag(`[live] 游戏窗口 rect=${rect ? `${rect.width}x${rect.height}@(${rect.x},${rect.y})` : "null"} mode=${mode}`);
    const guide = guideMessageFor(mode);
    if (guide) win.webContents.send("overlay:guide", guide); // renderer 显示引导(独占全屏)
    if (rect) { const b = rectToOverlayBounds(rect); win.setBounds(b); liveRect = rect; }
    else diag("[live] gameClientRect 读不到,池布局回退 1920×1080@(0,0)");
  } else {
    diag("[live] 无游戏窗口,池布局回退 1920×1080@(0,0)");
  }

  const liveDeps: LiveDeps = { runLoop: (onUpdate) => startLiveLoop(onUpdate, liveRect) };
  const source = new LiveSnapshotSource((snap) => {
    if (!win.isDestroyed()) win.webContents.send(OVERLAY_CHANNEL, snap);
  }, liveDeps);
  // 等首帧加载完再开始推送,避免渲染前丢帧。
  win.webContents.once("did-finish-load", () => {
    source.start(1500);
    // 临时诊断:把标定的池格坐标(换算到 overlay 本地坐标系 = 减去客户区原点)发给 renderer 画框。
    // overlay 窗口已 setBounds 到客户区,故 overlay 本地 (0,0) = 客户区 (liveRect.x, liveRect.y)。排查完删除。
    const debugCells = poolCellRects({ rows: [] }, liveRect).map((c, i) => ({
      x: c.x - liveRect.x, y: c.y - liveRect.y, w: c.w, h: c.h,
      zone: zoneOfFlatIndex(i),
    }));
    diag(`[debug-cells] 发送 ${debugCells.length} 个池格坐标到 overlay 画框`);
    if (!win.isDestroyed()) win.webContents.send("overlay:debug-cells", debugCells);
    // 临时:启动后跑一次手动扫描诊断(验证识别+打分闭环)。验证完删除本行 + scan_once_demo.ts。
    const { index: idxPath, db: dbP } = resolveModelPaths();
    void runScanOnceDemo(idxPath, dbP, liveRect, diag);
  });
  app.on("window-all-closed", () => { source.stop(); app.quit(); });
});
