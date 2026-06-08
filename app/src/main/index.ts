// app/src/main/index.ts
// Electron 主进程:建透明置顶 overlay 窗口 + 启动 snapshot 源 + IPC 推送。
// 本阶段数据源 = MockSnapshotSource。真实接入(留待下一阶段):
//   把 MockSnapshotSource 换成包装 main 包 runMonitorLoop 的 LiveSnapshotSource,
//   其 onUpdate(machine) 内调 recommend + buildSnapshot 后经同一 emit 推送;
//   届时需:① main/loop.ts 的 onUpdate 补传 pool: Candidate[];② electron-rebuild
//   better-sqlite3;③ koffi 窗口追踪 + setIgnoreMouseEvents 穿透。本阶段全部不做。
import { app, BrowserWindow } from "electron";
import { join } from "node:path";
import { OVERLAY_CHANNEL } from "@ad/shared/types/ipc";
import { MockSnapshotSource } from "./snapshot_source";

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
  // 本阶段不做 setIgnoreMouseEvents 穿透与窗口追踪(koffi,下一阶段)。
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
