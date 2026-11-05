// app/src/main/watch_spike.ts
// 临时测量(用完删):「一直盯屏幕」要花多少资源。设 AD_WATCH_TEST_MS 才启用。
// Dota 开着时每隔 N 毫秒截一张图(不识别),每 10 次在日志里记一行:截图平均耗时、
// 本程序所有进程的 CPU 占用。AD_WATCH_TEST_MODE 选截图方式:
//   full   普通截图,全分辨率(现在热键用的方式)
//   small  普通截图,缩到 480×270(只判断是不是选人界面时够用)
//   stream 持续画面流,全分辨率
import { app, desktopCapturer } from "electron";

export function startWatchSpike(opts: {
  everyMs: number;
  mode: string;
  gameRunning: () => boolean;
  captureFull: () => Promise<unknown>;
  captureStream: () => Promise<unknown>;
  diag: (m: string) => void;
}): () => void {
  const { everyMs, mode, gameRunning, diag } = opts;
  const captureSmall = async () => {
    const s = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width: 480, height: 270 } });
    return s[0]?.thumbnail.toBitmap();
  };
  const capture = mode === "small" ? captureSmall : mode === "stream" ? opts.captureStream : opts.captureFull;
  let times: number[] = [];
  let skipped = 0;
  let busy = false;
  diag(`[watch-test] 开始:每 ${everyMs}ms 截一次,方式 ${mode}`);
  app.getAppMetrics(); // 第一次调用只建立 CPU 统计基线
  const timer = setInterval(async () => {
    if (busy) return;
    if (!gameRunning()) { skipped++; return; }
    busy = true;
    const t0 = performance.now();
    try { await capture(); times.push(performance.now() - t0); }
    catch (err) { diag(`[watch-test] 截图失败: ${err}`); }
    finally { busy = false; }
    if (times.length >= 10) {
      const cpu = app.getAppMetrics().reduce((sum, m) => sum + m.cpu.percentCPUUsage, 0);
      const avg = times.reduce((a, b) => a + b, 0) / times.length;
      diag(`[watch-test] ${mode}: 截图平均 ${avg.toFixed(0)}ms 最慢 ${Math.max(...times).toFixed(0)}ms | ` +
        `本程序 CPU ${cpu.toFixed(1)}%(相对单核)| 期间 Dota 没开跳过 ${skipped} 次`);
      times = [];
      skipped = 0;
    }
  }, everyMs);
  return () => clearInterval(timer);
}
