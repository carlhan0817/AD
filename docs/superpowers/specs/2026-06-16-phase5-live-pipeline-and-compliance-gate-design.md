# Phase 5 设计 — 真实接入 + 合规守门(Live Pipeline & Compliance Gate)

> 版本:2026-06-16
> 关联:`docs/compliance/technical-behavior-and-anticheat.md`、`docs/compliance/compliance-verification-checklist.md`
> 记忆:`fullscreen-design-baseline`、`koffi-write-only-on-own-hwnd`、`phase4-mock-shell-status`

## 背景与问题

合规文档(技术行为说明书 + 验证流程)已写到"目标态",但代码仍停在 Phase 4 的 mock 外壳:

- 截屏用 `screenshot-desktop`([main/src/capture/frame_source.ts](../../../main/src/capture/frame_source.ts)),**与合规文档的 DXGI 叙事冲突**。
- koffi 窗口追踪、显示模式检测、`screen-saver` 层级、`setIgnoreMouseEvents` 穿透、真实数据接线**全部未实现**(源码零命中)。
- 验证流程的所有 🚫 红线项当前"真空通过"——不是因为安全,是因为没有被测对象,会造成合规假象。

本阶段(Phase 5)打通"无边框下截屏 + overlay 盖上 + 真实数据"物理链路,并把合规红线变成**结构性 + 自动化**的守门,而非人肉约定。

## 目标

1. 截屏链路在无边框窗口下抓到非黑屏帧,喂进现有识别管线。
2. koffi 只读查 Dota2 窗口几何,overlay 对齐;独占全屏只读检测 + 引导用户切无边框。
3. overlay 补 `screen-saver` 层级 + 点击穿透;写操作物理上只能作用于自身窗口。
4. Mock 数据源换成真实 `runMonitorLoop` 接线,端到端闭环。
5. 合规红线落成"类型封装 + grep 脚本"双保险;验证清单加实现状态维度。

## 非目标(YAGNI)

- 不在本阶段强上 DXGI native 模块——先用 Electron `desktopCapturer` 验证无边框链路,不足再升级。
- 不强攻独占全屏(技术现实障碍 + 合规风险);只做只读检测 + 引导。
- 不做全局键盘/鼠标钩子;热键如需,用 Electron `globalShortcut`。
- 不做 electron-builder 打包分发(后续阶段)。

## 架构与模块边界

每个新单元单一职责、独立可测、经明确接口通信。

```
main/src/capture/
  desktop_capturer_source.ts   新:Electron desktopCapturer 截屏(无边框基准),实现现有 FrameSource 接口
  frame_source.ts              保留:screenshot-desktop 降级兜底,不删

main/src/ffi/
  game_window.ts               新:koffi 只读查 Dota2 窗口几何,产出 ReadonlyGameHwnd(读句柄)
  overlay_window_ctl.ts        新:koffi 写操作,只接受 OwnOverlayHwnd(自身窗口句柄)
  display_mode.ts              新:只读检测无边框 / 独占全屏

app/src/main/
  index.ts                     改:补 screen-saver 层级 + setIgnoreMouseEvents;Mock→Live
  live_snapshot_source.ts      新:包 runMonitorLoop,onUpdate(machine)→recommend+buildSnapshot→emit
  display_mode_guide.ts        新:检测到独占全屏 → 触发引导 UI

scripts/
  compliance-scan.ps1          新:阶段 A 黑名单 grep + brand 强转检查,进 CI
```

### 合规红线的结构性保证(核心设计)

红线"koffi 写操作绝不指向 Dota2 窗口"靠**类型 brand + 私有构造器 + 出生地隔离**保证,不靠人肉约定。关键在于**谁有权造标签**:每个 brand 的构造器私有化到唯一"出生地"模块,且出生地物理上只能拿到正确来源。

**第 1 层:读句柄 brand 封死在 game_window.ts**

```ts
declare const GameHwndBrand: unique symbol;
export type ReadonlyGameHwnd = number & { readonly [GameHwndBrand]: true };

// 私有,不导出。唯一能造 ReadonlyGameHwnd 的地方。
function brandGameHwnd(raw: number): ReadonlyGameHwnd {
  return raw as ReadonlyGameHwnd;
}

// 唯一出口:产出的 raw 必然来自 FindWindowW。
export function findGameWindow(): ReadonlyGameHwnd | null {
  const raw = FindWindowW(null, "Dota 2");
  if (!raw || raw === 0) return null;
  return brandGameHwnd(raw);
}
```

外部模块看不见 `brandGameHwnd`,只能拿 `findGameWindow()` 的返回值;其 raw 来源必然是 `FindWindowW`。`ReadonlyGameHwnd` 只能流向只读封装(`GetClientRect`/`ClientToScreen`)。

**第 2 层:写句柄 brand 封死在 overlay_window_ctl.ts,且出生地只接受 BrowserWindow**

```ts
declare const OwnOverlayBrand: unique symbol;
type OwnOverlayHwnd = number & { readonly [OwnOverlayBrand]: true };  // 类型也不导出

// 私有构造器,唯一入参是 BrowserWindow(不是裸 number),来源被钉死成"自己的窗口"。
function ownHwndOf(win: BrowserWindow): OwnOverlayHwnd {
  const buf = win.getNativeWindowHandle();
  return buf.readUInt32LE(0) as OwnOverlayHwnd;  // x64 实际取指针,示意
}

// 对外只暴露"对自己的窗口做什么",入参是 BrowserWindow,调用方无机会传裸 hwnd。
export function raiseOverlayZOrder(win: BrowserWindow): void {
  SetWindowPos(ownHwndOf(win), HWND_TOPMOST, /* ... */);
}
```

写 API 的 koffi 签名只吃 `OwnOverlayHwnd`,而它只能由 `ownHwndOf(win)` 产出 → 来源永远是自己的窗口。读句柄类型与写函数入参类型不相交,编译期拒绝混用。调用方对外入参是 `BrowserWindow` 而非 hwnd,根本没机会传错 Dota2 句柄。

**第 3 层:grep 脚本兜底 `as` 强转后门**

- `as ReadonlyGameHwnd` / `as OwnOverlayHwnd` / `as any` 出现在 `ffi/` 目录外 → FAIL。
- 写 API 调用点实参不得是 `findGameWindow` 的产物。
- `getNativeWindowHandle` 结果不得流向读路径(反向防一手)。

**工程现实说明**:x64 窗口句柄是 64 位指针,koffi 可能返回 `void*`(BigInt/外部指针对象)而非 32 位 number。brand 机制不变,底座类型(`number` / `bigint` / koffi pointer)按 koffi 实际返回在实装时冒烟确认后调整。

## 数据流

```
desktopCapturer → GrayFrame → (现有) FrameGate → layout_guard → recognizeFrame → DraftMachine
                                                                                      │
game_window(只读几何) ──→ overlay 对齐坐标                                            │ onUpdate(machine)
display_mode(只读) ──→ 无边框? 正常 / 独占全屏? 引导UI                               ▼
                                                            recommend + buildSnapshot → emit(OVERLAY_CHANNEL) → renderer
```

对 Dota2 进程全程:只读屏幕画面 + 只读窗口几何/样式,零写入、零注入、零输入。

## 实装顺序(五步,每步完成即推进对应验证项 N/A→PASS)

| 步 | 实装 | 推进验证项 | 冒烟判据 |
|---|---|---|---|
| 1 | `desktop_capturer_source.ts`(screenshot-desktop 降级保留);建 `compliance-scan.ps1` 进 CI | B1 N/A→PASS | 无边框下抓非黑屏帧,喂识别出结果 |
| 2 | `game_window.ts`:koffi 只读查几何,产出 `ReadonlyGameHwnd` | B2 N/A→PASS;A1 获首个被测对象 | API Monitor 确认对 Dota2 hwnd 只有读调用;overlay 按几何对齐 |
| 3 | `display_mode.ts` + `display_mode_guide.ts` | C1/C2 N/A→PASS | 切独占全屏→检测到→弹引导;全程无写 API、游戏不崩 |
| 4 | `overlay_window_ctl.ts` + `index.ts`:`screen-saver` + 穿透;写操作只吃 `OwnOverlayHwnd` | B3 N/A→PASS | overlay 浮在游戏上、点击穿透、置顶生效 |
| 5 | `live_snapshot_source.ts`:Mock→Live | B4 N/A→PASS;端到端闭环 | 真实选取界面下 overlay 显示真实评分 |

依赖:1→2 硬依赖;2→3、2→4 依赖 2 的几何;5 依赖 1+2+4;3 可与 4 并行。`compliance-scan.ps1` 第 1 步即进 CI,从第 2 步首个 koffi 调用起守门到位。

## 错误处理

- `findGameWindow()` 返回 null(游戏未启动/未找到)→ overlay 隐藏或显示"等待 Dota2",不报错崩溃。
- 截屏失败/黑屏 → 跳过该帧(现有 FrameGate 容忍),不中断循环;连续黑屏可触发"是否独占全屏"检测路径。
- 独占全屏检测命中 → 不尝试任何窗口写操作,只弹引导 UI。
- koffi 加载失败(非 x64 Windows)→ 启动期明确报错并退出,不静默降级到危险路径。

## 测试策略

- **纯逻辑(Vitest,CI)**:坐标映射(窗口矩形→overlay 位置)、snapshot 序列化、brand 类型的编译期约束(type-level 测试)。
- **平台绑定(手动冒烟)**:koffi 取几何、截屏非黑屏、穿透/置顶、独占全屏检测+引导——无法 CI 纯测,按验证清单冒烟。
- **合规自动化**:`compliance-scan.ps1` 进 CI(阶段 A 全部红线 grep + brand 强转检查)。

## 文档与记忆的冲突修正(本阶段一并完成)

1. `technical-behavior-and-anticheat.md` §2.1 截屏叙事:"DXGI" → "Electron desktopCapturer 起步(无边框基准只读屏幕帧);不足再升级 DXGI"。合规性质不变(系统级只读截图,不碰游戏进程),API 诚实化。
2. `compliance-verification-checklist.md` 加实现状态维度:每项前缀 `[N/A]/[PASS]/[FAIL]`;红线项初始一律 N/A,只能随实装步骤推进;合并门禁 = 无 🚫 项停留 FAIL,且已实现的 🚫 项全 PASS。
3. 记忆 `phase4-mock-shell-status` 纠正:"四点未做" → "四点真实完成度 0,且 DXGI 这点依赖错配(现为 screenshot-desktop);Phase 5 按 desktopCapturer 起步重做"。

## 验收门禁

- 五步对应验证项全部 N/A→PASS(无边框基准下)。
- 阶段 A 合规扫描在 CI 绿;所有 🚫 红线项无 FAIL。
- 独占全屏路径冒烟:只读检测 + 引导,游戏无崩溃、无 Crash Dump。
- 阶段 E(政策面)人工复核记录在案。
