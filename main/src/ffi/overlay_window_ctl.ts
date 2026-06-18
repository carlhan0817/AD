// main/src/ffi/overlay_window_ctl.ts
// koffi 写操作。OwnOverlayHwnd 在此唯一铸造,且只从 BrowserWindow 取来源 —— 物理上
// 拿不到 Dota2 句柄。合规红线:本文件是全仓唯一允许调用 Win32 写 API 的地方。
import koffi from "koffi";
import type { BrowserWindow } from "electron";

declare const OwnOverlayBrand: unique symbol;
type OwnOverlayHwnd = (number | bigint) & { readonly [OwnOverlayBrand]: true };

const user32 = koffi.load("user32.dll");
const SetWindowPos = user32.func("__stdcall", "SetWindowPos", "bool",
  ["void *", "void *", "int", "int", "int", "int", "uint"]);
const HWND_TOPMOST = -1;
const SWP_NOMOVE = 0x0002, SWP_NOSIZE = 0x0001, SWP_NOACTIVATE = 0x0010;

// 私有铸造点:入参是 BrowserWindow,不是裸 hwnd —— 调用方无机会传错来源。
function ownHwndOf(win: BrowserWindow): OwnOverlayHwnd {
  const buf = win.getNativeWindowHandle(); // 我们自己的窗口
  return buf as unknown as OwnOverlayHwnd;
}

/** 把 overlay 自身拔到最顶层(只动自己)。 */
export function raiseOverlayZOrder(win: BrowserWindow): void {
  SetWindowPos(ownHwndOf(win) as unknown as Buffer, HWND_TOPMOST as unknown as Buffer,
    0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
}

/** 穿透由 Electron setIgnoreMouseEvents 主管;此处保留 koffi 兜底入口(当前委托 Electron)。 */
export function setOverlayClickThrough(win: BrowserWindow): void {
  win.setIgnoreMouseEvents(true, { forward: true });
}
