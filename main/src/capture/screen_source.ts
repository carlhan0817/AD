// main/src/capture/screen_source.ts
// Electron desktopCapturer 截屏(无边框基准)。系统级只读截图,不接触游戏进程。
// 返回契约与 frame_source.ts 的 captureGrayFrame 一致,可直接替换。
import { desktopCapturer, screen } from "electron";
import { toGrayFrame } from "../decode";
import type { GrayFrame } from "@ad/core/recognition/grid";

export async function captureScreenGrayFrame(): Promise<GrayFrame> {
  const { size } = screen.getPrimaryDisplay();
  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: { width: size.width, height: size.height },
  });
  if (sources.length === 0) throw new Error("desktopCapturer: no screen source");
  const png = sources[0].thumbnail.toPNG();
  return toGrayFrame(png);
}
