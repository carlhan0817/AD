// app/src/main/index.ts
// Electron 主进程:建透明置顶 overlay 窗口 + 启动 snapshot 源 + IPC 推送。
// 真实接入已完成(阶段 5):数据源 = LiveSnapshotSource,包装 main 包 runMonitorLoop;
// 启动时探测游戏窗口/显示模式,定位 overlay 到客户区,独占全屏时只发引导文案(不强攻)。
// 已知限制:① startLiveLoop 的候选池暂为空数组,需后续接入真实候选池来源;
// ② overlay:guide 频道当前无人消费,renderer 端展示待后续任务接 preload bridge。
// overlay 置顶 + 穿透已接 koffi own-hwnd 控制模块(阶段 4 完成)。
import { app, BrowserWindow, screen } from "electron";
import { join } from "node:path";
import { OVERLAY_CHANNEL } from "@ad/shared/types/ipc";
import { LiveSnapshotSource, type LiveDeps } from "./live_snapshot_source";
import { guideMessageFor } from "./display_mode_guide";
import { setOverlayClickThrough, raiseOverlayZOrder } from "@ad/main/ffi/overlay_window_ctl";
import { findGameWindow, gameClientRect } from "@ad/main/ffi/game_window";
import { detectDisplayMode } from "@ad/main/ffi/display_mode";
import { rectToOverlayBounds } from "@ad/main/ffi/geometry";
import { runMonitorLoop, type MonitorDeps } from "@ad/main/capture/loop";
import { loadIndex } from "@ad/core/recognition/index_store";
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
function startLiveLoop(onUpdate: (state: DraftState, activeRow: number, recs: ScoredCandidate[]) => void): () => void {
  try {
    const { index: indexPath, db: dbPath } = resolveModelPaths();
    const index = loadIndex(indexPath);
    const ref = new ReferenceDb(dbPath);
    let stopped = false;
    const deps: MonitorDeps = {
      index,
      ref,
      pool: [], // 已知限制:候选池来源尚未接入,留空 → recommend 在空池上恒返回 []
      dbPath,
      cfg: defaultScoringConfig(),
      onUpdate: (state, activeRow, recs) => { if (!stopped) onUpdate(state, activeRow, recs); },
    };
    runMonitorLoop(deps).catch((err) => console.error("runMonitorLoop failed:", err));
    return () => { stopped = true; };
  } catch (err) {
    console.error("[live] failed to start monitor loop (missing/invalid model assets?):", err);
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
  if (hwnd) {
    const monitorSize = screen.getPrimaryDisplay().size;
    const rect = gameClientRect(hwnd);
    const isFull = !!rect && rect.width >= monitorSize.width && rect.height >= monitorSize.height;
    const mode = detectDisplayMode(hwnd, isFull);
    const guide = guideMessageFor(mode);
    if (guide) win.webContents.send("overlay:guide", guide); // renderer 显示引导(独占全屏)
    if (rect) { const b = rectToOverlayBounds(rect); win.setBounds(b); }
  }

  const liveDeps: LiveDeps = { runLoop: startLiveLoop };
  const source = new LiveSnapshotSource((snap) => {
    if (!win.isDestroyed()) win.webContents.send(OVERLAY_CHANNEL, snap);
  }, liveDeps);
  // 等首帧加载完再开始推送,避免渲染前丢帧。
  win.webContents.once("did-finish-load", () => source.start(1500));
  app.on("window-all-closed", () => { source.stop(); app.quit(); });
});
