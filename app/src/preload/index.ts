// app/src/preload/index.ts
import { contextBridge, ipcRenderer } from "electron";
import { OVERLAY_CHANNEL, type OverlaySnapshot } from "@ad/shared/types/ipc";

contextBridge.exposeInMainWorld("adOverlay", {
  onSnapshot: (cb: (snap: OverlaySnapshot) => void) =>
    ipcRenderer.on(OVERLAY_CHANNEL, (_e, snap: OverlaySnapshot) => cb(snap)),
});
