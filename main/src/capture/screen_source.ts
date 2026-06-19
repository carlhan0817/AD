// main/src/capture/screen_source.ts
// Electron desktopCapturer 截屏(无边框基准)。系统级只读截图,不接触游戏进程。
// 返回契约与 frame_source.ts 的 captureGrayFrame 一致,可直接替换。
import { desktopCapturer, screen } from "electron";
import { toGrayFrame } from "../decode";
import type { GrayFrame } from "@ad/core/recognition/grid";

export async function captureScreenGrayFrame(): Promise<GrayFrame> {
  // size 是【逻辑】分辨率(已被 DPI 缩放除过):125% 缩放下 1920x1080 物理屏返回 1536x864。
  // 但 LAYOUT_1080P 的 ROI 坐标是按【物理】1920x1080 手填的,故截图必须按物理像素抓,
  // 否则两者差一个 scaleFactor 倍、所有 ROI 全错位(真机表现:识别恒 0 行)。
  // 物理像素 = 逻辑尺寸 × scaleFactor。
  const { size, scaleFactor } = screen.getPrimaryDisplay();
  const width = Math.round(size.width * scaleFactor);
  const height = Math.round(size.height * scaleFactor);
  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: { width, height },
  });
  if (sources.length === 0) throw new Error("desktopCapturer: no screen source");
  const png = sources[0].thumbnail.toPNG();
  return toGrayFrame(png);
}
