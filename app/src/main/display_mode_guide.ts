// 独占全屏时返回引导文案;其余返回 null(不强攻,只引导)。
import type { DisplayMode } from "@ad/main/ffi/display_mode";

export function guideMessageFor(mode: DisplayMode | null): string | null {
  if (mode === "exclusive-fullscreen") {
    return "为助手正常显示,请在 Dota2 视频设置中将显示模式改为【无边框窗口 (Borderless Window)】。";
  }
  return null;
}
