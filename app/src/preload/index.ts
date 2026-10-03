// app/src/preload/index.ts
import { contextBridge, ipcRenderer } from "electron";
import { OVERLAY_CHANNEL, type OverlaySnapshot } from "@ad/shared/types/ipc";

contextBridge.exposeInMainWorld("adOverlay", {
  onSnapshot: (cb: (snap: OverlaySnapshot) => void) =>
    ipcRenderer.on(OVERLAY_CHANNEL, (_e, snap: OverlaySnapshot) => cb(snap)),
  // 临时诊断:接收标定的池格坐标(overlay 本地坐标系),renderer 画框供肉眼对齐。排查完删除。
  onDebugCells: (cb: (cells: { x: number; y: number; w: number; h: number; zone: string }[]) => void) =>
    ipcRenderer.on("overlay:debug-cells", (_e, cells) => cb(cells)),
});
