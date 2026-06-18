// app/src/main/index.ts
// Electron 主进程:建透明置顶 overlay 窗口 + 启动 snapshot 源 + IPC 推送。
// 本阶段数据源 = MockSnapshotSource。真实接入(留待下一阶段):
//   把 MockSnapshotSource 换成包装 main 包 runMonitorLoop 的 LiveSnapshotSource,
//   其 onUpdate(machine) 内调 recommend + buildSnapshot 后经同一 emit 推送;
//   届时需:① main/loop.ts 的 onUpdate 补传 pool: Candidate[];② electron-rebuild
//   better-sqlite3。overlay 置顶 + 穿透已接 koffi own-hwnd 控制模块(本阶段完成)。
import { app, BrowserWindow } from "electron";
import { join } from "node:path";
import { OVERLAY_CHANNEL } from "@ad/shared/types/ipc";
import { MockSnapshotSource } from "./snapshot_source";
import { setOverlayClickThrough, raiseOverlayZOrder } from "@ad/main/ffi/overlay_window_ctl";

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
  const source = new MockSnapshotSource((snap) => {
    if (!win.isDestroyed()) win.webContents.send(OVERLAY_CHANNEL, snap);
  });
  // 等首帧加载完再开始推送,避免渲染前丢帧。
  win.webContents.once("did-finish-load", () => source.start(1500));
  app.on("window-all-closed", () => { source.stop(); app.quit(); });
});
