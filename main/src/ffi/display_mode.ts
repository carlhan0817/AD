// 只读判定显示模式。classify 为纯函数(可测);detect 是薄 koffi 读包装。
import { gameWindowStyleRaw, type ReadonlyGameHwnd } from "./game_window";

export type DisplayMode = "borderless" | "exclusive-fullscreen" | "windowed";

const WS_POPUP = 0x80000000;
const WS_CAPTION = 0x00C00000;

/** 纯分类:由窗口样式 + 是否铺满显示器,判定显示模式。 */
export function classifyDisplayMode(style: number, exStyle: number, isClientFullMonitor: boolean): DisplayMode {
  const hasCaption = (style & WS_CAPTION) === WS_CAPTION;
  if (hasCaption || !isClientFullMonitor) return "windowed";
  // 铺满 + 无标题:popup → 无边框全屏;否则视为独占全屏。
  const isPopup = (style & WS_POPUP) !== 0;
  return isPopup ? "borderless" : "exclusive-fullscreen";
}

/** 薄读包装:取样式后交给纯分类器。isClientFullMonitor 由调用方按显示器比对算好。 */
export function detectDisplayMode(hwnd: ReadonlyGameHwnd, isClientFullMonitor: boolean): DisplayMode | null {
  const s = gameWindowStyleRaw(hwnd);
  if (!s) return null;
  return classifyDisplayMode(s.style, s.exStyle, isClientFullMonitor);
}
