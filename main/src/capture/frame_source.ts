// main/src/capture/frame_source.ts
// 截屏 → GrayFrame。灰度公式须与阶段 1 Task 4b 决定一致(复用 toGrayFrame)。
import screenshot from "screenshot-desktop";
import { toGrayFrame } from "../decode";
import type { GrayFrame } from "@ad/core/recognition/grid";

export async function captureGrayFrame(): Promise<GrayFrame> {
  const png = await screenshot({ format: "png" });
  return toGrayFrame(png);
}
