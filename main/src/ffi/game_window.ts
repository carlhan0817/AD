// main/src/ffi/game_window.ts
// koffi 只读查 Dota2 窗口几何/样式。brand 在此唯一铸造,构造器不导出。
// x64 Windows only。合规:此模块只调读 API,绝不写。
import koffi from "koffi";
import type { WindowRect } from "./geometry";

declare const GameHwndBrand: unique symbol;
/** 只读游戏窗口句柄。只能由 findGameWindow 产出,只能流向本模块的读 API。 */
export type ReadonlyGameHwnd = (number | bigint) & { readonly [GameHwndBrand]: true };

const user32 = koffi.load("user32.dll");
const RECT = koffi.struct("RECT", { left: "long", top: "long", right: "long", bottom: "long" });
const POINT = koffi.struct("POINT", { x: "long", y: "long" });
const FindWindowW = user32.func("__stdcall", "FindWindowW", "void *", ["str16", "str16"]);
const GetClientRect = user32.func("__stdcall", "GetClientRect", "bool", ["void *", koffi.out(koffi.pointer(RECT))]);
const ClientToScreen = user32.func("__stdcall", "ClientToScreen", "bool", ["void *", koffi.inout(koffi.pointer(POINT))]);
const GetWindowLongW = user32.func("__stdcall", "GetWindowLongW", "long", ["void *", "int"]);
const GWL_STYLE = -16, GWL_EXSTYLE = -20;

// 私有:唯一铸造点。raw 必然来自 FindWindowW。
function brandGameHwnd(raw: number | bigint): ReadonlyGameHwnd {
  return raw as ReadonlyGameHwnd;
}

export function findGameWindow(): ReadonlyGameHwnd | null {
  const raw = FindWindowW(null, "Dota 2") as unknown as number | bigint;
  if (!raw) return null;
  return brandGameHwnd(raw);
}

export function gameClientRect(hwnd: ReadonlyGameHwnd): WindowRect | null {
  const r: { left: number; top: number; right: number; bottom: number } = { left: 0, top: 0, right: 0, bottom: 0 };
  if (!GetClientRect(hwnd as unknown as Buffer, r)) return null;
  const origin = { x: 0, y: 0 };
  if (!ClientToScreen(hwnd as unknown as Buffer, origin)) return null;
  return { x: origin.x, y: origin.y, width: r.right - r.left, height: r.bottom - r.top };
}

export function gameWindowStyleRaw(hwnd: ReadonlyGameHwnd): { style: number; exStyle: number } | null {
  const style = GetWindowLongW(hwnd as unknown as Buffer, GWL_STYLE);
  const exStyle = GetWindowLongW(hwnd as unknown as Buffer, GWL_EXSTYLE);
  return { style, exStyle };
}
