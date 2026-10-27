// app/src/preload/index.ts
import { contextBridge, ipcRenderer } from "electron";
import { OVERLAY_CHANNEL, type OverlaySnapshot } from "@ad/shared/types/ipc";

contextBridge.exposeInMainWorld("adOverlay", {
  onSnapshot: (cb: (snap: OverlaySnapshot) => void) =>
    ipcRenderer.on(OVERLAY_CHANNEL, (_e, snap: OverlaySnapshot) => cb(snap)),
});

// ── 可选:持续屏幕画面流截图(主进程在 AD_STREAM_CAPTURE=1 时才会请求)──────────────
// 每次扫描都让系统重新截整屏(desktopCapturer.getSources)真机要 0.03–1.4 秒不等;持续开一条
// 屏幕画面流、要用时直接取当前一帧,稳定在几十毫秒。只读屏幕,与 desktopCapturer 同性质。
// 画面流经过视频编码,颜色与直接截图有小差异(实测平均差 2 个亮度级),所以默认不启用。
// 一分钟没人要帧就关掉流,免得一直占着系统截屏。
type GrabRequest = { reqId: number; sourceId: string; width: number; height: number };
let video: HTMLVideoElement | null = null;
let canvas: HTMLCanvasElement | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
const STREAM_IDLE_STOP_MS = 60_000;

function stopStream(): void {
  if (video?.srcObject instanceof MediaStream) video.srcObject.getTracks().forEach((t) => t.stop());
  video = null;
}

async function ensureStream(req: GrabRequest): Promise<HTMLVideoElement> {
  if (video !== null && video.videoWidth === req.width && video.videoHeight === req.height) return video;
  stopStream();
  const constraints = { audio: false, video: { mandatory: {
    chromeMediaSource: "desktop", chromeMediaSourceId: req.sourceId,
    minWidth: req.width, maxWidth: req.width, minHeight: req.height, maxHeight: req.height,
  } } } as unknown as MediaStreamConstraints;
  const stream = await navigator.mediaDevices.getUserMedia(constraints);
  const v = document.createElement("video");
  v.srcObject = stream;
  v.muted = true;
  await v.play();
  video = v;
  return v;
}

ipcRenderer.on("capture:grab", async (_e, req: GrabRequest) => {
  try {
    const v = await ensureStream(req);
    if (canvas === null) canvas = document.createElement("canvas");
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (ctx === null) throw new Error("canvas 2d 不可用");
    ctx.drawImage(v, 0, 0);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    ipcRenderer.send("capture:frame", { reqId: req.reqId, width: canvas.width, height: canvas.height, data: data.buffer });
  } catch (err) {
    stopStream();
    ipcRenderer.send("capture:frame", { reqId: req.reqId, error: String(err) });
  }
  if (idleTimer !== null) clearTimeout(idleTimer);
  idleTimer = setTimeout(stopStream, STREAM_IDLE_STOP_MS);
});
