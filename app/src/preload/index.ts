// app/src/preload/index.ts
import { contextBridge, ipcRenderer } from "electron";
import { OVERLAY_CHANNEL, type OverlaySnapshot } from "@ad/shared/types/ipc";

contextBridge.exposeInMainWorld("adOverlay", {
  onSnapshot: (cb: (snap: OverlaySnapshot) => void) =>
    ipcRenderer.on(OVERLAY_CHANNEL, (_e, snap: OverlaySnapshot) => cb(snap)),
});

// ── 持续屏幕画面流截图(默认开;主进程设了 AD_NO_STREAM_CAPTURE 才不请求)──────────────
// 每次扫描都让系统重新截整屏(desktopCapturer.getSources)真机要 0.03–1.4 秒不等;持续开一条
// 屏幕画面流、要用时直接取当前一帧,稳定在几十毫秒。只读屏幕,与 desktopCapturer 同性质。
// 画面流经过视频编码,颜色与直接截图有小差异(实测平均差 2 个亮度级);2026-11-05 真机对比
// 识别结果 13 次全部一致,所以识别也直接用画面流。
// 一分钟没人要帧就关掉流,免得一直占着系统截屏。
type GrabRequest = { reqId: number; sourceId: string; width: number; height: number };
let video: HTMLVideoElement | null = null;
let canvas: HTMLCanvasElement | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
const STREAM_IDLE_STOP_MS = 60_000;
/** 「不带鼠标指针」的请求结果只报一次给主进程记日志。 */
let cursorReported = false;
function reportCursor(msg: string): void {
  if (cursorReported) return;
  cursorReported = true;
  ipcRenderer.send("capture:info", msg);
}

function stopStream(): void {
  if (video?.srcObject instanceof MediaStream) video.srcObject.getTracks().forEach((t) => t.stop());
  video = null;
}

/** 正在开的流:开流要一两秒,期间又来一次取帧就等这一个,不再开第二条(否则前一条没人关)。 */
let opening: Promise<HTMLVideoElement> | null = null;

async function ensureStream(req: GrabRequest): Promise<HTMLVideoElement> {
  if (opening !== null) {
    const v = await opening.catch(() => null);
    if (v !== null && v === video && v.videoWidth === req.width && v.videoHeight === req.height) return v;
  }
  if (video !== null && video.videoWidth === req.width && video.videoHeight === req.height) return video;
  const p = openStream(req);
  opening = p;
  try { return await p; } finally { if (opening === p) opening = null; }
}

async function openStream(req: GrabRequest): Promise<HTMLVideoElement> {
  stopStream();
  const mandatory = {
    chromeMediaSource: "desktop", chromeMediaSourceId: req.sourceId,
    minWidth: req.width, maxWidth: req.width, minHeight: req.height, maxHeight: req.height,
  };
  // 尽量请求不带鼠标指针:轮到我时鼠标常在池子上晃,带着指针画面就一直「在变」。
  // 放在 optional 里:不认识的可选约束 Chromium 会忽略,不至于整个流开不起来。
  // 实际有没有生效看 track.getSettings().cursor;没生效就由主进程的 3 秒超时兜底。
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia(
      { audio: false, video: { mandatory, optional: [{ cursor: "never" }] } } as unknown as MediaStreamConstraints);
  } catch (err) {
    stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { mandatory } } as unknown as MediaStreamConstraints);
    reportCursor(`画面流不接受「不带鼠标指针」的请求(${err}),改用默认设置,画面里会带指针,靠 3 秒超时兜底`);
  }
  const cursor = (stream.getVideoTracks()[0]?.getSettings() as { cursor?: string } | undefined)?.cursor;
  reportCursor(cursor === "never"
    ? "画面流已按请求不带鼠标指针(cursor=never)"
    : `画面流没理会「不带鼠标指针」的请求(cursor=${cursor ?? "没报"}),画面里可能带指针,靠 3 秒超时兜底`);
  const v = document.createElement("video");
  v.srcObject = stream;
  v.muted = true;
  try { await v.play(); }
  catch (err) { stream.getTracks().forEach((t) => t.stop()); throw err; }
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
