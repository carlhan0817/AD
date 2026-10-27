// main/src/capture/screen_source.ts
// Electron desktopCapturer 截屏(无边框基准)。系统级只读截图,不接触游戏进程。
// 返回契约与 frame_source.ts 的 captureGrayFrame 一致,可直接替换。
import { desktopCapturer, screen } from "electron";
import { rawToFrames } from "../decode";
import type { GrayFrame } from "@ad/core/recognition/grid";
import type { RgbFrame } from "@ad/core/recognition/rgb";

/** 截一帧,同时给出彩色(分类器用)与灰度(pHash/门控用)两份。 */
export async function captureScreenFrames(): Promise<{ rgb: RgbFrame; gray: GrayFrame }> {
  const { width, height } = physicalScreenSize();
  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: { width, height },
  });
  if (sources.length === 0) throw new Error("desktopCapturer: no screen source");
  // 直接取原始位图(BGRA),不再 toPNG 再解码:真机实测省 ~80ms,像素逐字节一致。
  const img = sources[0].thumbnail;
  const got = img.getSize();
  return rawToFrames(img.toBitmap(), got.width, got.height, "bgra");
}

/** 主屏的物理像素尺寸。size 是【逻辑】分辨率(已被 DPI 缩放除过):125% 缩放下 1920x1080 物理屏
 *  返回 1536x864;而所有识别坐标都是按物理像素标的,故截图必须按物理像素抓(物理 = 逻辑 × 缩放)。 */
export function physicalScreenSize(): { width: number; height: number } {
  const { size, scaleFactor } = screen.getPrimaryDisplay();
  return { width: Math.round(size.width * scaleFactor), height: Math.round(size.height * scaleFactor) };
}

let cachedScreenId: string | null = null;
/** 主屏的截屏源 id(只取 id、不生成缩略图,第一次之后用缓存)。给「持续画面流」截图用。 */
export async function primaryScreenSourceId(): Promise<string | null> {
  if (cachedScreenId !== null) return cachedScreenId;
  const sources = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width: 0, height: 0 } });
  cachedScreenId = sources[0]?.id ?? null;
  return cachedScreenId;
}

export async function captureScreenGrayFrame(): Promise<GrayFrame> {
  return (await captureScreenFrames()).gray;
}
