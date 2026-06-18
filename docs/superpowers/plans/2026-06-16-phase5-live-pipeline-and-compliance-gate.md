# Phase 5 — Live Pipeline & Compliance Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the Phase-4 mock Electron shell to real screen capture, koffi window tracking, display-mode detection, and live scoring — with the "never write to the Dota2 window" compliance red-line enforced structurally (branded hwnd types + private constructors + a CI grep scan), not by convention.

**Architecture:** Each platform-bound capability is split into a **pure part** (coordinate math, brand-type constraints, snapshot wiring — TDD via Vitest in CI) and a **platform-bound part** (koffi/Win32, desktopCapturer, overlay Z-order — verified by manual smoke per `docs/compliance/compliance-verification-checklist.md`). Two branded hwnd types make read (`ReadonlyGameHwnd`, only flows to read APIs) and write (`OwnOverlayHwnd`, only minted from our own `BrowserWindow`) physically non-interchangeable at the type level; a grep scan closes the `as`-cast back door.

**Tech Stack:** TypeScript, Electron (`desktopCapturer`, `BrowserWindow`), koffi (Win32 FFI, x64 Windows only), Vitest (pure logic), PowerShell (compliance scan). Reuses existing `@ad/core` recognition/scoring/statemachine, `@ad/shared/types`, `main/src/decode.ts`, `main/src/overlay/snapshot.ts`.

## Global Constraints

- **x64 Windows only** — koffi FFI + Windows capture stack; non-x64-Windows must fail loudly at startup, never silently degrade.
- **Compliance red-line (hard gate):** Win32 **write** APIs (`SetWindowPos`/`SetWindowLong`/`SetWindowLongPtr`/`SetWindowDisplayAffinity`/`SendMessage`/`PostMessage`/`ShowWindow`/`MoveWindow`) may target **only our own overlay HWND**, never the Dota2 HWND. The Dota2 hwnd may flow only to read APIs (`GetClientRect`/`ClientToScreen`/read-only `GetWindowLong`).
- **Zero game-process contact:** no memory read/write, no injection, no render hook, no simulated input. Capture reads the screen; tracking reads window geometry/style only.
- **Exclusive fullscreen is never fought** — read-only detect, then guide the user to switch to Borderless. Borderless is the runtime baseline.
- **brand constructors are never exported**; brand `as`-casts may appear only inside `main/src/ffi/`. The底座 type under each brand (`number` / `bigint` / koffi pointer) is confirmed by smoke in Task 3 against koffi's actual return, then applied consistently.
- Game window title match: `FindWindowW(null, "Dota 2")`.
- IPC channel + payload are frozen: `OVERLAY_CHANNEL` / `OverlaySnapshot` from `@ad/shared/types/ipc`. Live wiring must not change them.

---

## File Structure

| File | Responsibility |
|---|---|
| `scripts/compliance-scan.ps1` | CI gate: blacklist grep for write-API misuse + brand `as`-cast outside `ffi/`. Built first. |
| `main/src/capture/screen_source.ts` | `desktopCapturer` → PNG Buffer → `GrayFrame` (reuses `toGrayFrame`). Implements same shape as `captureGrayFrame`. |
| `main/src/ffi/geometry.ts` | Pure: `WindowRect` type + `rectToOverlayBounds()` (game rect → overlay x/y/w/h). No koffi. TDD. |
| `main/src/ffi/game_window.ts` | koffi read-only: `findGameWindow()` → `ReadonlyGameHwnd`; `gameClientRect(hwnd)` → `WindowRect`. brand minted here only. |
| `main/src/ffi/display_mode.ts` | koffi read-only: `detectDisplayMode(hwnd)` → `"borderless" \| "exclusive-fullscreen" \| "windowed"`. Pure classifier split out + tested. |
| `main/src/ffi/overlay_window_ctl.ts` | koffi write: `raiseOverlayZOrder(win)`, `setClickThrough(win)` — accept `BrowserWindow` only, mint `OwnOverlayHwnd` internally. |
| `app/src/main/live_snapshot_source.ts` | `LiveSnapshotSource implements SnapshotSource`: wraps `runMonitorLoop`, `onUpdate(machine)` → `recommend` + `buildSnapshot` → `emit`. |
| `app/src/main/display_mode_guide.ts` | Pure: `guideMessageFor(mode)` → user-facing guidance string or null. TDD. |
| `app/src/main/index.ts` | Modify: `screen-saver` level + click-through; Mock→Live; display-mode guide on startup. |

---

## Task 1: Compliance scan script (CI gate, built first)

**Files:**
- Create: `scripts/compliance-scan.ps1`
- Test: manual run (PowerShell script; verified by running against current clean tree)

**Interfaces:**
- Consumes: nothing.
- Produces: `scripts/compliance-scan.ps1` — exits 0 when clean, exits 1 and prints offending file:line when a red-line pattern is found. Later tasks rely on it staying green.

- [ ] **Step 1: Write the scan script**

```powershell
# scripts/compliance-scan.ps1
# Compliance gate. Exit 1 if any red-line pattern is found. See
# docs/compliance/compliance-verification-checklist.md stage A.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$fail = $false

function Report($msg, $hits) {
  if ($hits) { Write-Host "FAIL: $msg" -ForegroundColor Red; $hits | ForEach-Object { Write-Host "  $_" }; $script:fail = $true }
}

# A2/A3: no injection / memory / render-hook / simulated-input APIs anywhere in src.
$banned = 'ReadProcessMemory|WriteProcessMemory|CreateRemoteThread|SetWindowsHookEx|SendInput|keybd_event|mouse_event'
$srcTs = Get-ChildItem -Path $root -Recurse -Include *.ts -File |
  Where-Object { $_.FullName -notmatch '\\node_modules\\' -and $_.FullName -notmatch '\\tests?\\' -and $_.FullName -notmatch '\\docs\\' }
Report 'banned injection/input API present' (
  $srcTs | Select-String -Pattern $banned | ForEach-Object { "$($_.Path):$($_.LineNumber): $($_.Line.Trim())" })

# A1 back door: brand as-casts may appear ONLY inside main/src/ffi/.
$brandCast = 'as\s+ReadonlyGameHwnd|as\s+OwnOverlayHwnd'
Report 'brand cast outside main/src/ffi/' (
  $srcTs | Where-Object { $_.FullName -notmatch '\\main\\src\\ffi\\' } |
    Select-String -Pattern $brandCast | ForEach-Object { "$($_.Path):$($_.LineNumber): $($_.Line.Trim())" })

# A1: write APIs must not appear outside the overlay_window_ctl module.
$writeApi = 'SetWindowPos|SetWindowLong|SetWindowLongPtr|SetWindowDisplayAffinity|\bShowWindow\b|\bMoveWindow\b'
Report 'Win32 write API outside overlay_window_ctl.ts' (
  $srcTs | Where-Object { $_.FullName -notmatch 'overlay_window_ctl\.ts$' } |
    Select-String -Pattern $writeApi | ForEach-Object { "$($_.Path):$($_.LineNumber): $($_.Line.Trim())" })

if ($fail) { Write-Host "`nCOMPLIANCE SCAN FAILED" -ForegroundColor Red; exit 1 }
Write-Host "compliance scan clean" -ForegroundColor Green; exit 0
```

- [ ] **Step 2: Run it against the current tree to verify it passes (no ffi code yet)**

Run: `powershell -ExecutionPolicy Bypass -File scripts/compliance-scan.ps1`
Expected: prints `compliance scan clean`, exit 0.

- [ ] **Step 3: Add an npm script and wire into CI**

Modify root `package.json` scripts: add `"compliance": "powershell -ExecutionPolicy Bypass -File scripts/compliance-scan.ps1"`. If a CI workflow exists, add a step running `npm run compliance`; if none exists, note it in the commit message as a manual pre-merge step.

- [ ] **Step 4: Commit**

```bash
git add scripts/compliance-scan.ps1 package.json
git commit -m "chore(compliance): add red-line scan script (CI gate)"
```

---

## Task 2: Pure geometry — game rect → overlay bounds

**Files:**
- Create: `main/src/ffi/geometry.ts`
- Test: `main/tests/ffi/geometry.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `export interface WindowRect { x: number; y: number; width: number; height: number }`
  - `export function rectToOverlayBounds(rect: WindowRect): { x: number; y: number; width: number; height: number }` — returns overlay bounds covering the game client area exactly.

- [ ] **Step 1: Write the failing test**

```ts
// main/tests/ffi/geometry.test.ts
import { describe, it, expect } from "vitest";
import { rectToOverlayBounds, type WindowRect } from "../../src/ffi/geometry";

describe("rectToOverlayBounds", () => {
  it("covers the game client area exactly", () => {
    const rect: WindowRect = { x: 100, y: 50, width: 1920, height: 1080 };
    expect(rectToOverlayBounds(rect)).toEqual({ x: 100, y: 50, width: 1920, height: 1080 });
  });
  it("handles a non-origin multi-monitor offset", () => {
    const rect: WindowRect = { x: -1920, y: 0, width: 1280, height: 720 };
    expect(rectToOverlayBounds(rect)).toEqual({ x: -1920, y: 0, width: 1280, height: 720 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd main && npx vitest run tests/ffi/geometry.test.ts`
Expected: FAIL — cannot resolve `../../src/ffi/geometry`.

- [ ] **Step 3: Write minimal implementation**

```ts
// main/src/ffi/geometry.ts
// 纯几何:游戏客户区矩形 → overlay 窗口 bounds。无 koffi,可 CI 测。
export interface WindowRect { x: number; y: number; width: number; height: number }

/** overlay 完整覆盖游戏客户区(当前为 1:1;后续若需留边在此调整)。 */
export function rectToOverlayBounds(rect: WindowRect): { x: number; y: number; width: number; height: number } {
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd main && npx vitest run tests/ffi/geometry.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add main/src/ffi/geometry.ts main/tests/ffi/geometry.test.ts
git commit -m "feat(ffi): pure game-rect to overlay-bounds mapping"
```

---

## Task 3: koffi read-only game window (platform-bound, smoke)

**Files:**
- Create: `main/src/ffi/game_window.ts`
- Modify: `main/package.json` (add `koffi` dependency)
- Test: manual smoke (koffi cannot run in CI)

**Interfaces:**
- Consumes: `WindowRect` from `main/src/ffi/geometry.ts`.
- Produces:
  - `export type ReadonlyGameHwnd` (branded, opaque — constructor NOT exported)
  - `export function findGameWindow(): ReadonlyGameHwnd | null`
  - `export function gameClientRect(hwnd: ReadonlyGameHwnd): WindowRect | null`
  - `export function gameWindowStyleRaw(hwnd: ReadonlyGameHwnd): { style: number; exStyle: number } | null` (read-only GetWindowLong, consumed by Task 4)

- [ ] **Step 1: Add koffi dependency**

Run: `cd main && npm install koffi`
Expected: `koffi` added to `main/package.json` dependencies.

- [ ] **Step 2: Write the module**

```ts
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
```

- [ ] **Step 3: Smoke test (manual, Dota2 running in Borderless)**

Write a throwaway `main/src/ffi/_smoke_window.ts` that imports `findGameWindow` + `gameClientRect`, prints the result, runs via `npx tsx`. Confirm: non-null hwnd, plausible rect (e.g. 1920×1080 at the monitor origin). **Confirm the底座 type** — log `typeof raw`; if it is `bigint`, the `(number | bigint)` brand base is correct as written; if always `number`, no change needed. Delete the smoke file before commit.

- [ ] **Step 4: Run compliance scan (must stay green — read-only module)**

Run: `npm run compliance`
Expected: `compliance scan clean` (no write APIs introduced).

- [ ] **Step 5: Commit**

```bash
git add main/src/ffi/game_window.ts main/package.json main/package-lock.json
git commit -m "feat(ffi): koffi read-only game window geometry + style"
```

---

## Task 4: Display-mode classifier (pure TDD + thin koffi wrapper)

**Files:**
- Create: `main/src/ffi/display_mode.ts`
- Test: `main/tests/ffi/display_mode.test.ts`

**Interfaces:**
- Consumes: `gameWindowStyleRaw`, `ReadonlyGameHwnd` from `game_window.ts`.
- Produces:
  - `export type DisplayMode = "borderless" | "exclusive-fullscreen" | "windowed"`
  - `export function classifyDisplayMode(style: number, exStyle: number, isClientFullMonitor: boolean): DisplayMode` (pure, tested)
  - `export function detectDisplayMode(hwnd: ReadonlyGameHwnd, isClientFullMonitor: boolean): DisplayMode | null` (thin wrapper; read-only)

- [ ] **Step 1: Write the failing test**

```ts
// main/tests/ffi/display_mode.test.ts
import { describe, it, expect } from "vitest";
import { classifyDisplayMode } from "../../src/ffi/display_mode";

const WS_POPUP = 0x80000000, WS_CAPTION = 0x00C00000;

describe("classifyDisplayMode", () => {
  it("borderless = popup (no caption) AND covering full monitor", () => {
    expect(classifyDisplayMode(WS_POPUP, 0, true)).toBe("borderless");
  });
  it("exclusive-fullscreen = covers monitor but lacks normal window chrome and is not a borderless popup", () => {
    // exclusive: no popup style bit, no caption, full monitor
    expect(classifyDisplayMode(0, 0, true)).toBe("exclusive-fullscreen");
  });
  it("windowed = has caption / not full monitor", () => {
    expect(classifyDisplayMode(WS_CAPTION, 0, false)).toBe("windowed");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd main && npx vitest run tests/ffi/display_mode.test.ts`
Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Write minimal implementation**

```ts
// main/src/ffi/display_mode.ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd main && npx vitest run tests/ffi/display_mode.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Run compliance scan**

Run: `npm run compliance`
Expected: `compliance scan clean`.

- [ ] **Step 6: Commit**

```bash
git add main/src/ffi/display_mode.ts main/tests/ffi/display_mode.test.ts
git commit -m "feat(ffi): read-only display-mode classifier"
```

---

## Task 5: Guidance message (pure TDD)

**Files:**
- Create: `app/src/main/display_mode_guide.ts`
- Test: `app/tests/display_mode_guide.test.ts`

**Interfaces:**
- Consumes: `DisplayMode` from `@ad/main/ffi/display_mode` (type import only).
- Produces: `export function guideMessageFor(mode: DisplayMode | null): string | null` — non-null only for `"exclusive-fullscreen"`.

- [ ] **Step 1: Write the failing test**

```ts
// app/tests/display_mode_guide.test.ts
import { describe, it, expect } from "vitest";
import { guideMessageFor } from "../src/main/display_mode_guide";

describe("guideMessageFor", () => {
  it("prompts to switch only on exclusive fullscreen", () => {
    expect(guideMessageFor("exclusive-fullscreen")).toMatch(/无边框/);
  });
  it("stays silent on borderless / windowed / null", () => {
    expect(guideMessageFor("borderless")).toBeNull();
    expect(guideMessageFor("windowed")).toBeNull();
    expect(guideMessageFor(null)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run tests/display_mode_guide.test.ts`
Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Write minimal implementation**

```ts
// app/src/main/display_mode_guide.ts
// 独占全屏时返回引导文案;其余返回 null(不强攻,只引导)。
import type { DisplayMode } from "@ad/main/ffi/display_mode";

export function guideMessageFor(mode: DisplayMode | null): string | null {
  if (mode === "exclusive-fullscreen") {
    return "为助手正常显示,请在 Dota2 视频设置中将显示模式改为【无边框窗口 (Borderless Window)】。";
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run tests/display_mode_guide.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add app/src/main/display_mode_guide.ts app/tests/display_mode_guide.test.ts
git commit -m "feat(app): exclusive-fullscreen guidance message (pure)"
```

---

## Task 6: desktopCapturer screen source (platform-bound, smoke)

**Files:**
- Create: `main/src/capture/screen_source.ts`
- Test: manual smoke (desktopCapturer needs Electron runtime)

**Interfaces:**
- Consumes: `toGrayFrame` from `main/src/decode.ts`; `GrayFrame` from `@ad/core/recognition/grid`.
- Produces: `export async function captureScreenGrayFrame(): Promise<GrayFrame>` — same return contract as existing `captureGrayFrame`, so `runMonitorLoop`'s frame source can be swapped.

- [ ] **Step 1: Write the module**

```ts
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
```

- [ ] **Step 2: Smoke test (manual, in Electron main, Dota2 in Borderless)**

Temporarily call `captureScreenGrayFrame()` from `app/src/main/index.ts` after `whenReady`, log `frame.width/height` and a center-pixel value. Run `npm run dev` in `app/`. Confirm: dimensions match the display and the center pixel is **not** uniformly 0 (non-black frame, B1). Revert the temporary call.

- [ ] **Step 3: Run compliance scan**

Run: `npm run compliance`
Expected: `compliance scan clean`.

- [ ] **Step 4: Commit**

```bash
git add main/src/capture/screen_source.ts
git commit -m "feat(capture): desktopCapturer screen source (borderless baseline)"
```

---

## Task 7: koffi overlay window control — write APIs, own-HWND only (platform-bound, smoke)

**Files:**
- Create: `main/src/ffi/overlay_window_ctl.ts`
- Test: manual smoke + compliance scan (this is the ONLY file allowed to call write APIs)

**Interfaces:**
- Consumes: `BrowserWindow` from `electron`.
- Produces:
  - `export function raiseOverlayZOrder(win: BrowserWindow): void`
  - `export function setOverlayClickThrough(win: BrowserWindow): void` (koffi `WS_EX_LAYERED|TRANSPARENT` belt-and-suspenders alongside Electron `setIgnoreMouseEvents`)

- [ ] **Step 1: Write the module**

```ts
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
```

- [ ] **Step 2: Run compliance scan — write API is confined to this file**

Run: `npm run compliance`
Expected: `compliance scan clean`. (If `SetWindowPos` shows up anywhere else, scan fails — that is the gate working.)

- [ ] **Step 3: Smoke test (manual, deferred to Task 8 where the window exists)**

No standalone smoke here; verified in Task 8 when wired to the real overlay window.

- [ ] **Step 4: Commit**

```bash
git add main/src/ffi/overlay_window_ctl.ts
git commit -m "feat(ffi): overlay window control (write APIs, own-hwnd only)"
```

---

## Task 8: Overlay window — screen-saver level + click-through (platform-bound, smoke)

**Files:**
- Modify: `app/src/main/index.ts` (lines 13-33: `createOverlayWindow`)

**Interfaces:**
- Consumes: `setOverlayClickThrough`, `raiseOverlayZOrder` from `@ad/main/ffi/overlay_window_ctl`.
- Produces: an overlay window that is click-through and stays above fullscreen games.

- [ ] **Step 1: Modify createOverlayWindow**

In `app/src/main/index.ts`, replace the `createOverlayWindow` body's post-construction section (currently the comment "本阶段不做 setIgnoreMouseEvents...") with:

```ts
  win.setAlwaysOnTop(true, "screen-saver");
  setOverlayClickThrough(win);
  win.once("ready-to-show", () => raiseOverlayZOrder(win));
```

And add the import at top:

```ts
import { setOverlayClickThrough, raiseOverlayZOrder } from "@ad/main/ffi/overlay_window_ctl";
```

- [ ] **Step 2: Smoke test (manual, Dota2 in Borderless)**

Run `npm run dev` in `app/`. Confirm (B3): overlay is visible above the game; clicking the overlay area passes the click to the game (click-through); overlay stays on top. Confirm no game crash.

- [ ] **Step 3: Run compliance scan**

Run: `npm run compliance`
Expected: `compliance scan clean`.

- [ ] **Step 4: Commit**

```bash
git add app/src/main/index.ts
git commit -m "feat(app): overlay screen-saver level + click-through via own-hwnd control"
```

---

## Task 9: LiveSnapshotSource — wire runMonitorLoop to real scoring

**Files:**
- Create: `app/src/main/live_snapshot_source.ts`
- Modify: `main/src/capture/loop.ts` (swap frame source; add `pool` + `onUpdate` snapshot data)
- Test: `app/tests/live_snapshot_source.test.ts` (pure mapping via injected machine + recommend stub)

**Interfaces:**
- Consumes: `SnapshotSource`, `SnapshotEmit` from `./snapshot_source`; `buildSnapshot` from `@ad/main/overlay/snapshot`; `recommend` from `@ad/core/scoring/recommend`; `DraftMachine` from `@ad/core/statemachine/draft`.
- Produces: `export class LiveSnapshotSource implements SnapshotSource` whose `start()` runs the monitor loop and emits a real `OverlaySnapshot` per committed update.

- [ ] **Step 1: Write the failing test (pure mapping, no koffi/capture)**

```ts
// app/tests/live_snapshot_source.test.ts
import { describe, it, expect, vi } from "vitest";
import { machineToSnapshot } from "../src/main/live_snapshot_source";

describe("machineToSnapshot", () => {
  it("builds an OverlaySnapshot from machine state + recommendations", () => {
    const state = { activeRow: 0, players: [{ row: 0, hero: null, normals: [], ultimates: [] }] };
    const recs = [{ candidate: { valveId: 5051, slotType: "normal" as const }, score: 0.4, breakdown: { base: 0.4 } }];
    const snap = machineToSnapshot(state, 0, recs, 7);
    expect(snap.version).toBe(7);
    expect(snap.recommendations).toEqual(recs);
    expect(snap.state).toBe(state);
    expect(snap.remaining).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run tests/live_snapshot_source.test.ts`
Expected: FAIL — cannot resolve module / `machineToSnapshot` undefined.

- [ ] **Step 3: Write the module**

```ts
// app/src/main/live_snapshot_source.ts
// 真实数据源:包 runMonitorLoop,把每次提交的 DraftMachine 经 recommend + buildSnapshot
// 推送。machineToSnapshot 抽成纯函数以便测试;start/stop 是平台绑定的薄壳。
import type { SnapshotSource, SnapshotEmit } from "./snapshot_source";
import type { OverlaySnapshot } from "@ad/shared/types/ipc";
import type { DraftState } from "@ad/shared/types/draft";
import type { ScoredCandidate } from "@ad/shared/types/scoring";
import { buildSnapshot } from "@ad/main/overlay/snapshot";

/** 纯映射:状态 + 推荐 → OverlaySnapshot(复用 buildSnapshot 的配额计算)。 */
export function machineToSnapshot(
  state: DraftState, activeRow: number, recs: ScoredCandidate[], version: number,
): OverlaySnapshot {
  return buildSnapshot(state, activeRow, recs, version);
}

export interface LiveDeps {
  /** 启动监控循环;每次提交调 onUpdate(state, activeRow, recommendations)。返回停止函数。 */
  runLoop: (onUpdate: (state: DraftState, activeRow: number, recs: ScoredCandidate[]) => void) => () => void;
}

export class LiveSnapshotSource implements SnapshotSource {
  private version = 0;
  private stopFn: (() => void) | null = null;
  constructor(private readonly emit: SnapshotEmit, private readonly deps: LiveDeps) {}

  start(_intervalMs: number): void {
    this.stop();
    this.stopFn = this.deps.runLoop((state, activeRow, recs) => {
      this.emit(machineToSnapshot(state, activeRow, recs, ++this.version));
    });
  }
  stop(): void { if (this.stopFn) { this.stopFn(); this.stopFn = null; } }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run tests/live_snapshot_source.test.ts`
Expected: PASS.

- [ ] **Step 5: Update `main/src/capture/loop.ts` to use the new source + emit scoring data**

In `loop.ts`: import `captureScreenGrayFrame` from `./screen_source` and use it in `tick()` instead of `captureGrayFrame`. Change `MonitorDeps.onUpdate` to `(state: DraftState, activeRow: number, recs: ScoredCandidate[]) => void`, and in `tick()` after `machine.observe(obs)` returns true, compute the active player's `recommend(...)` and call `onUpdate(machine.state(), activeRow, recs)`. (Pool + dbPath + cfg come from `MonitorDeps`; add them to the interface.) Keep all existing gate/layout/recognition logic unchanged.

- [ ] **Step 6: Run the existing pipeline integration test to confirm no regression**

Run: `cd main && npx vitest run tests/pipeline_integration.test.ts`
Expected: PASS (adjust the test's `onUpdate` shape if it asserts the old signature).

- [ ] **Step 7: Commit**

```bash
git add app/src/main/live_snapshot_source.ts app/tests/live_snapshot_source.test.ts main/src/capture/loop.ts main/tests/pipeline_integration.test.ts
git commit -m "feat(app): LiveSnapshotSource wiring monitor loop to real scoring"
```

---

## Task 10: Swap Mock→Live + display-mode guide in main process (platform-bound, smoke)

**Files:**
- Modify: `app/src/main/index.ts`

**Interfaces:**
- Consumes: `LiveSnapshotSource` (Task 9), `findGameWindow`/`gameClientRect` (Task 3), `detectDisplayMode` (Task 4), `guideMessageFor` (Task 5), `rectToOverlayBounds` (Task 2).
- Produces: a running overlay fed by real data, positioned over the game, with an exclusive-fullscreen guidance prompt.

- [ ] **Step 1: Modify app whenReady block**

Replace the `MockSnapshotSource` usage with `LiveSnapshotSource`, and add startup display-mode detection + overlay positioning:

```ts
  const hwnd = findGameWindow();
  if (hwnd) {
    const monitorSize = require("electron").screen.getPrimaryDisplay().size;
    const rect = gameClientRect(hwnd);
    const isFull = !!rect && rect.width >= monitorSize.width && rect.height >= monitorSize.height;
    const mode = detectDisplayMode(hwnd, isFull);
    const guide = guideMessageFor(mode);
    if (guide) win.webContents.send("overlay:guide", guide); // renderer 显示引导(独占全屏)
    if (rect) { const b = rectToOverlayBounds(rect); win.setBounds(b); }
  }
  const source = new LiveSnapshotSource(
    (snap) => { if (!win.isDestroyed()) win.webContents.send(OVERLAY_CHANNEL, snap); },
    { runLoop: /* 注入包装 runMonitorLoop 的启动器,返回停止函数 */ startLiveLoop },
  );
```

(Add a `startLiveLoop` helper in this file that constructs the `MonitorDeps` — loading index + ReferenceDb as `monitor_once.ts` does — and runs `runMonitorLoop`, returning a stop function. Reuse paths from `main/src/capture/monitor_once.ts`.)

- [ ] **Step 2: Smoke test (manual, full end-to-end, Dota2 in Borderless AD lobby)**

Run `npm run dev` in `app/`. Enter an Ability Draft custom lobby. Confirm (B4 + end-to-end): overlay shows **real** recommendations matching the on-screen draft; overlay is aligned to the game client area. Then switch Dota2 to exclusive fullscreen and restart: confirm (C1/C2) the guidance prompt appears and **no** window-write is attempted on the game (game does not crash/tear).

- [ ] **Step 3: Run compliance scan**

Run: `npm run compliance`
Expected: `compliance scan clean`.

- [ ] **Step 4: Commit**

```bash
git add app/src/main/index.ts
git commit -m "feat(app): swap mock->live source + exclusive-fullscreen guide"
```

---

## Task 11: Update compliance checklist to实现状态维度 + correct memory

**Files:**
- Modify: `docs/compliance/compliance-verification-checklist.md`
- Modify: `docs/compliance/technical-behavior-and-anticheat.md` (§2.1)

**Interfaces:** docs only.

- [ ] **Step 1: Add实现状态 prefixes to every checklist item**

Prefix each `- [ ]` with `[N/A]` initially, and change the gate section to: "合并门禁 = 无 🚫 项停留 FAIL;且已实现的 🚫 项必须全 PASS;N/A 表示该能力尚未实现,允许存在。" Then flip each item that this plan completed (B1, B2, B3, B4, C1, C2, A1/A2/A3 via scan) from `[N/A]` to `[PASS]`, citing the task that delivered it.

- [ ] **Step 2: Correct §2.1 capture narrative**

In `technical-behavior-and-anticheat.md` §2.1, change "DXGI Desktop Duplication" as the primary to: "起步用 Electron `desktopCapturer`(无边框基准下只读屏幕帧);若无边框下仍不足,升级 DXGI Desktop Duplication。" Keep the合规性质 unchanged (系统级只读截图,不碰游戏进程).

- [ ] **Step 3: Commit docs**

```bash
git add docs/compliance/compliance-verification-checklist.md docs/compliance/technical-behavior-and-anticheat.md
git commit -m "docs(compliance): add impl-status dimension + correct capture narrative"
```

- [ ] **Step 4: Correct the phase4 memory file**

Update `C:\Users\17441\.claude\projects\c--Users-17441-Desktop-textbook-AD-AD\memory\phase4-mock-shell-status.md`: change "四点未做" to "Phase 5 已实装:desktopCapturer 截屏 + koffi 只读窗口追踪 + 显示模式检测引导 + 真实数据接线;合规红线靠 branded hwnd + compliance-scan.ps1 守门。" Update the MEMORY.md pointer line accordingly. (Memory edit, not a git commit.)

---

## Self-Review

**Spec coverage:** capture (T6), koffi read window (T3), display-mode detect+guide (T4/T5/T10), overlay screen-saver+click-through (T7/T8), live wiring (T9/T10), branded-type structural guarantee (T3/T7), grep scan (T1), checklist实现状态 + doc/memory corrections (T11). All spec sections map to a task. ✓

**Placeholder scan:** Each code step shows real code. Task 9 Step 5 and Task 10 Step 1 describe modifications in prose with the exact code fragments and the exact source files/symbols to reuse (`monitor_once.ts`, `MonitorDeps`) — acceptable because they are edits to existing files whose full bodies are already in the repo, not new modules. ✓

**Type consistency:** `ReadonlyGameHwnd` (T3) consumed by T4; `WindowRect` (T2) by T3/T10; `DisplayMode` (T4) by T5/T10; `OwnOverlayHwnd` minted only in T7; `SnapshotSource`/`SnapshotEmit` (existing) by T9; `machineToSnapshot` (T9) used in T9 test. Names consistent across tasks. ✓

**Compliance ordering:** scan built in T1, runs after every ffi/write change (T3/T4/T6/T7/T8/T10). Write API confined to `overlay_window_ctl.ts` (T7), enforced by scan. ✓
