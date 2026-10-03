# 阶段 4 · Overlay 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: 用 superpowers:subagent-driven-development(推荐)或 superpowers:executing-plans 逐任务执行。步骤用 `- [ ]` 复选框跟踪。前置:阶段 2(`DraftMachine`/捕获循环)与阶段 3(`recommend`/`ScoringConfig`)已落地。先读计划书 §三/§四/§九。**x64 Windows only**(koffi)。

**Goal:** Electron 透明点击穿透叠层窗口对齐到游戏窗口,实时渲染候选排序/配额/推荐高亮;捕获循环 → 状态机 → 打分 → IPC → Zustand → React 全链路打通,刷新无明显延迟。

**Architecture:** `main/`(窗口追踪 via koffi FFI、透明穿透叠层窗口、捕获循环宿主)+ `renderer/`(React + shadcn/ui + Tailwind + Zustand)。两进程经 IPC 传 `DraftState` + `ScoredCandidate[]`。**把可测逻辑下沉为纯函数**:坐标映射(游戏窗口矩形 → overlay 位置 + 分辨率推导 GridSpec)、IPC 载荷序列化、Zustand reducer。真正平台绑定的部分(koffi 取窗口矩形、透明/穿透、真实渲染)用手动冒烟检查点验收。

**Tech Stack:** Electron + electron-vite、React 18、Zustand、Tailwind + shadcn/ui、koffi(Win32 FFI)、Vitest(纯逻辑)、Playwright(渲染冒烟,可选)。

---

## 关键设计决策

- **可测逻辑 vs 平台绑定分离。** 坐标映射、IPC 载荷、store reducer 是纯函数 → TDD;koffi 窗口矩形、`setIgnoreMouseEvents`、透明窗口、真实 GPU 渲染 → 手动冒烟(无法在 CI 纯测)。
- **GridSpec 从手填升级为分辨率推导。** 阶段 1/2 的 `LAYOUT_1080P` 是对 1920×1080 标定的常量;本阶段加 `deriveLayout(windowRect)`,按游戏窗口实际尺寸等比推导各 ROI,替换硬编码。1080p 时须退化回与 `LAYOUT_1080P` 一致(回归测试守住)。
- **IPC 载荷是结构化纯数据。** `DraftState` + `ScoredCandidate[]` 序列化为可 JSON 化的快照,经 `ipcMain`/`ipcRenderer` 单向 main→renderer 推送。载荷构造是纯函数,可测。
- **overlay 与控制面板共用窗口栈(计划书 §三)。** 同一 BrowserWindow 体系;overlay 透明穿透,控制面板可交互(权重调节用阶段 3 的 `ScoringConfig`)。
- **性能预算(计划书 §九)。** frame-diff 门控(阶段 2 已有)是避免持续烧 GPU 的关键;本阶段加一个渲染节流(状态未变不重渲),并留压测检查点。
- **better-sqlite3 × Electron 重编译(阶段 1/2 已预警,本阶段必做)。** `main/` 进 Electron 运行时,打包/启动前 `electron-rebuild -f -w better-sqlite3`,否则 `NODE_MODULE_VERSION` 不匹配。

---

## 文件结构

| 文件 | 职责 |
|---|---|
| `core/src/recognition/layout_derive.ts` | 由窗口矩形推导 `DraftLayout`(替代硬编码 1080p) |
| `shared/types/ipc.ts` | IPC 载荷类型:`OverlaySnapshot`(DraftState + 排序候选 + 元信息) |
| `main/src/overlay/snapshot.ts` | 由 `DraftMachine` + `recommend` 构建 `OverlaySnapshot`(纯函数) |
| `main/src/ffi/window_track.ts` | koffi:找游戏窗口、取矩形(平台绑定,冒烟) |
| `main/src/overlay/window.ts` | 透明点击穿透叠层窗口 + 对齐(平台绑定,冒烟) |
| `main/src/overlay/ipc.ts` | main 侧推送 snapshot 到 renderer |
| `main/src/main.ts` | Electron 入口:建窗口 + 启捕获循环 + 接 IPC |
| `renderer/src/store.ts` | Zustand:订阅 snapshot,持有一局生命周期状态 |
| `renderer/src/Overlay.tsx` | 渲染候选排序、配额、推荐高亮 |
| `renderer/src/ControlPanel.tsx` | 控制面板:可调 `ScoringConfig` 权重 |
| `renderer/src/main.tsx` | React 挂载 + IPC 订阅 |
| `electron.vite.config.ts` | electron-vite 配置 |

---

## Task 1: 分辨率推导布局(core/src/recognition/layout_derive.ts)

把硬编码 `LAYOUT_1080P` 升级为 `deriveLayout(rect)`:按窗口实际宽高相对 1920×1080 的缩放比,等比推导各 ROI 坐标/尺寸。1080p 时必须等于 `LAYOUT_1080P`(回归守门)。

**Files:**
- Create: `core/src/recognition/layout_derive.ts`
- Test: `core/tests/recognition/layout_derive.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// core/tests/recognition/layout_derive.test.ts
import { describe, it, expect } from "vitest";
import { deriveLayout } from "../../src/recognition/layout_derive";
import { LAYOUT_1080P } from "../../src/recognition/roi";

describe("deriveLayout", () => {
  it("returns the calibrated 1080p layout at 1920x1080 (regression)", () => {
    const got = deriveLayout({ x: 0, y: 0, width: 1920, height: 1080 });
    expect(got.pool).toEqual(LAYOUT_1080P.pool);
    expect(got.timer).toEqual(LAYOUT_1080P.timer);
    expect(got.rowPitch).toBe(LAYOUT_1080P.rowPitch);
  });

  it("scales coordinates proportionally at 2560x1440 (1.333x)", () => {
    const got = deriveLayout({ x: 0, y: 0, width: 2560, height: 1440 });
    expect(got.pool.x).toBe(Math.round(LAYOUT_1080P.pool.x * (2560 / 1920)));
    expect(got.pool.cellW).toBe(Math.round(LAYOUT_1080P.pool.cellW * (1440 / 1080)));
  });

  it("offsets by window origin (non-zero x/y)", () => {
    const got = deriveLayout({ x: 100, y: 50, width: 1920, height: 1080 });
    expect(got.pool.x).toBe(LAYOUT_1080P.pool.x + 100);
    expect(got.pool.y).toBe(LAYOUT_1080P.pool.y + 50);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run(在 `core/` 下):`npx vitest run recognition/layout_derive`
Expected: FAIL,模块不存在。

- [ ] **Step 3: 最小实现**

```ts
// core/src/recognition/layout_derive.ts
// 由游戏窗口矩形推导 DraftLayout。替代硬编码 1080p(阶段 4)。
// 缩放基准 = 1920x1080;1080p 全屏(origin 0,0)时与 LAYOUT_1080P 逐字段相等。
import { LAYOUT_1080P, type DraftLayout } from "./roi";

export interface WindowRect { x: number; y: number; width: number; height: number; }

const BASE_W = 1920;
const BASE_H = 1080;

export function deriveLayout(rect: WindowRect): DraftLayout {
  const sx = rect.width / BASE_W;
  const sy = rect.height / BASE_H;
  const X = (v: number) => Math.round(v * sx) + rect.x;
  const Y = (v: number) => Math.round(v * sy) + rect.y;
  const W = (v: number) => Math.round(v * sx);
  const H = (v: number) => Math.round(v * sy);
  const b = LAYOUT_1080P;
  return {
    pool: { x: X(b.pool.x), y: Y(b.pool.y), cellW: W(b.pool.cellW), cellH: H(b.pool.cellH),
            gapX: W(b.pool.gapX), gapY: H(b.pool.gapY), rows: b.pool.rows, cols: b.pool.cols },
    // 英雄槽(长方形)与技能槽(正方形)分别等比推导,保持各自纵横比。
    heroSlot: { x: X(b.heroSlot.x), y: Y(b.heroSlot.y), w: W(b.heroSlot.w), h: H(b.heroSlot.h) },
    abilitySlots: { x: X(b.abilitySlots.x), y: Y(b.abilitySlots.y),
                    cellW: W(b.abilitySlots.cellW), cellH: H(b.abilitySlots.cellH),
                    gapX: W(b.abilitySlots.gapX), gapY: H(b.abilitySlots.gapY),
                    rows: b.abilitySlots.rows, cols: b.abilitySlots.cols },
    rowPitch: H(b.rowPitch),
    timer: { x: X(b.timer.x), y: Y(b.timer.y), w: W(b.timer.w), h: H(b.timer.h) },
    pickerStrip: { x: X(b.pickerStrip.x), y: Y(b.pickerStrip.y), w: W(b.pickerStrip.w), h: H(b.pickerStrip.h) },
  };
}
```

> **回归注意:** 1080p 且 origin (0,0) 时 `sx=sy=1`,`Math.round(v*1)+0 === v`,故各字段恒等于 `LAYOUT_1080P`——第一个测试守住。

- [ ] **Step 4: 跑测试确认通过**

Run:`npx vitest run recognition/layout_derive`
Expected: PASS(3 passed)。

- [ ] **Step 5: Commit**

```bash
git add core/src/recognition/layout_derive.ts core/tests/recognition/layout_derive.test.ts
git commit -m "feat(core): derive ROI layout from window rect (replaces hardcoded 1080p)"
```

---

## Task 2: IPC 载荷类型 + 构建(shared/types/ipc.ts + main/src/overlay/snapshot.ts)

定义 main→renderer 的单向快照载荷,并写一个纯函数把 `DraftState` + `ScoredCandidate[]` 组装成可 JSON 化的 `OverlaySnapshot`。

**Files:**
- Create: `shared/types/ipc.ts`
- Modify: `shared/package.json`(加 exports)
- Create: `main/src/overlay/snapshot.ts`
- Test: `main/tests/overlay/snapshot.test.ts`

- [ ] **Step 1: 写类型**

```ts
// shared/types/ipc.ts
// main → renderer 单向推送载荷。必须 JSON 可序列化(过 IPC)。
import type { DraftState } from "./draft";
import type { ScoredCandidate } from "./scoring";

export interface OverlaySnapshot {
  /** 当前完整草稿状态。 */
  state: DraftState;
  /** 本人这一手的排序候选(已硬过滤 + 打分),top 优先。 */
  recommendations: ScoredCandidate[];
  /** 本人当前剩余配额,供 UI 显示。 */
  remaining: { hero: number; normal: number; ultimate: number };
  /** 单调递增版本号,renderer 用于丢弃过期帧。 */
  version: number;
}

/** IPC channel 名(main/renderer 共用,避免字符串漂移)。 */
export const OVERLAY_CHANNEL = "overlay:snapshot" as const;
```

`shared/package.json` exports 加:`"./types/ipc": "./types/ipc.ts"`

- [ ] **Step 2: 写 snapshot 失败测试**

```ts
// main/tests/overlay/snapshot.test.ts
import { describe, it, expect } from "vitest";
import { buildSnapshot } from "../../src/overlay/snapshot";
import type { DraftState } from "@ad/shared/types/draft";
import type { ScoredCandidate } from "@ad/shared/types/scoring";

const state: DraftState = {
  activeRow: 0,
  players: [
    { row: 0, hero: -9, normals: [5051], ultimates: [] },
    { row: 1, hero: null, normals: [], ultimates: [] },
  ],
};
const recs: ScoredCandidate[] = [
  { candidate: { valveId: 5052, slotType: "normal" }, score: 0.2, breakdown: { base: 0.1 } },
];

describe("buildSnapshot", () => {
  it("packs state + recs + remaining for the active player", () => {
    const snap = buildSnapshot(state, 0, recs, 7);
    expect(snap.version).toBe(7);
    expect(snap.recommendations[0].candidate.valveId).toBe(5052);
    // 行0:hero 已选 → hero 剩 0;normal 选 1 → 剩 2;ult 剩 1
    expect(snap.remaining).toEqual({ hero: 0, normal: 2, ultimate: 1 });
  });

  it("is JSON-serializable (survives IPC)", () => {
    const snap = buildSnapshot(state, 0, recs, 1);
    expect(JSON.parse(JSON.stringify(snap))).toEqual(snap);
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

Run(在 `main/` 下):`npx vitest run overlay/snapshot`
Expected: FAIL,模块不存在。

- [ ] **Step 4: 最小实现**

```ts
// main/src/overlay/snapshot.ts
// 由状态机 + 打分输出构建 IPC 快照(纯函数,JSON 可序列化)。
import type { DraftState } from "@ad/shared/types/draft";
import type { ScoredCandidate } from "@ad/shared/types/scoring";
import type { OverlaySnapshot } from "@ad/shared/types/ipc";
import { remainingQuota, emptyPlayer } from "@ad/core/statemachine/quota";

export function buildSnapshot(
  state: DraftState,
  activeRow: number,
  recommendations: ScoredCandidate[],
  version: number,
): OverlaySnapshot {
  const me = state.players[activeRow] ?? emptyPlayer(activeRow);
  return { state, recommendations, remaining: remainingQuota(me), version };
}
```

> `core/package.json` 的 `./statemachine/quota` 导出已在阶段 3 Task 9 Step 4 一并加好(`"./statemachine/quota": "./src/statemachine/quota.ts"`),此处直接消费。

- [ ] **Step 5: 跑测试确认通过**

Run:`npx vitest run overlay/snapshot`
Expected: PASS(2 passed)。

- [ ] **Step 6: Commit**

```bash
git add shared/types/ipc.ts shared/package.json main/src/overlay/snapshot.ts main/tests/overlay/snapshot.test.ts
git commit -m "feat(overlay): IPC snapshot type + pure builder from state+scores"
```

---

## Task 3: Zustand store(renderer/src/store.ts)

renderer 侧纯状态容器:`applySnapshot(snap)` 用版本号丢弃过期帧;`reset()` 一局结束清空。reducer 是纯逻辑,可在 Node 环境单测(不挂 React)。

**Files:**
- Create: `renderer/package.json`(含 `zustand`、`react`、vitest)
- Create: `renderer/src/store.ts`
- Test: `renderer/tests/store.test.ts`

- [ ] **Step 1: 写 store 失败测试**

```ts
// renderer/tests/store.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { useOverlayStore } from "../src/store";
import type { OverlaySnapshot } from "@ad/shared/types/ipc";

function snap(version: number): OverlaySnapshot {
  return {
    version,
    state: { activeRow: 0, players: [{ row: 0, hero: -9, normals: [], ultimates: [] }] },
    recommendations: [{ candidate: { valveId: 5052, slotType: "normal" }, score: 0.3, breakdown: {} }],
    remaining: { hero: 0, normal: 3, ultimate: 1 },
  };
}

describe("overlay store", () => {
  beforeEach(() => useOverlayStore.getState().reset());

  it("applies a newer snapshot", () => {
    useOverlayStore.getState().applySnapshot(snap(1));
    expect(useOverlayStore.getState().snapshot?.version).toBe(1);
  });

  it("ignores an older/duplicate snapshot (stale frame)", () => {
    useOverlayStore.getState().applySnapshot(snap(5));
    useOverlayStore.getState().applySnapshot(snap(3)); // 旧帧
    expect(useOverlayStore.getState().snapshot?.version).toBe(5);
  });

  it("reset clears state for a new game", () => {
    useOverlayStore.getState().applySnapshot(snap(2));
    useOverlayStore.getState().reset();
    expect(useOverlayStore.getState().snapshot).toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run(在 `renderer/` 下,先 `npm install`):`npx vitest run store`
Expected: FAIL,模块不存在。

- [ ] **Step 3: 最小实现**

```ts
// renderer/src/store.ts
// Zustand:订阅 overlay snapshot,生命周期 = 一局。版本号丢弃过期帧。
import { create } from "zustand";
import type { OverlaySnapshot } from "@ad/shared/types/ipc";

interface OverlayState {
  snapshot: OverlaySnapshot | null;
  applySnapshot: (snap: OverlaySnapshot) => void;
  reset: () => void;
}

export const useOverlayStore = create<OverlayState>((set, get) => ({
  snapshot: null,
  applySnapshot: (snap) => {
    const cur = get().snapshot;
    if (cur && snap.version <= cur.version) return; // 过期/重复帧丢弃
    set({ snapshot: snap });
  },
  reset: () => set({ snapshot: null }),
}));
```

- [ ] **Step 4: 跑测试确认通过**

Run:`npx vitest run store`
Expected: PASS(3 passed)。

- [ ] **Step 5: Commit**

```bash
git add renderer/package.json renderer/src/store.ts renderer/tests/store.test.ts
git commit -m "feat(renderer): zustand overlay store with stale-frame guard"
```

---

## Task 4: Overlay 渲染组件(renderer/src/Overlay.tsx)

订阅 store,渲染:配额条、候选排序列表(top 高亮)、各候选的 breakdown。组件逻辑里可测的部分(把 snapshot 映射为渲染行)抽成纯函数 `toViewModel` 单测;JSX 本身靠手动冒烟。

**Files:**
- Create: `renderer/src/view_model.ts`
- Create: `renderer/src/Overlay.tsx`
- Test: `renderer/tests/view_model.test.ts`

- [ ] **Step 1: 写 view_model 失败测试**

```ts
// renderer/tests/view_model.test.ts
import { describe, it, expect } from "vitest";
import { toViewModel } from "../src/view_model";
import type { OverlaySnapshot } from "@ad/shared/types/ipc";

const snap: OverlaySnapshot = {
  version: 1,
  state: { activeRow: 0, players: [{ row: 0, hero: -9, normals: [], ultimates: [] }] },
  remaining: { hero: 0, normal: 3, ultimate: 1 },
  recommendations: [
    { candidate: { valveId: 5052, slotType: "normal" }, score: 0.30, breakdown: { base: 0.1, synergy: 0.2 } },
    { candidate: { valveId: 6001, slotType: "ultimate" }, score: 0.12, breakdown: { base: 0.12 } },
  ],
};

describe("toViewModel", () => {
  it("marks the top recommendation as highlighted", () => {
    const vm = toViewModel(snap);
    expect(vm.rows[0].highlighted).toBe(true);
    expect(vm.rows[1].highlighted).toBe(false);
  });
  it("formats score and surfaces top contributing signal", () => {
    const vm = toViewModel(snap);
    expect(vm.rows[0].topSignal).toBe("synergy"); // 最大 breakdown 项
    expect(vm.rows[0].scoreText).toBe("0.30");
  });
  it("passes remaining quota through for the quota bar", () => {
    expect(toViewModel(snap).remaining).toEqual({ hero: 0, normal: 3, ultimate: 1 });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run:`npx vitest run view_model`
Expected: FAIL,模块不存在。

- [ ] **Step 3: 最小实现 view_model + 薄 Overlay.tsx**

```ts
// renderer/src/view_model.ts
import type { OverlaySnapshot } from "@ad/shared/types/ipc";
import type { SignalId } from "@ad/shared/types/scoring";

export interface RecRow {
  valveId: number;
  slotType: string;
  scoreText: string;
  topSignal: SignalId | null;
  highlighted: boolean;
}
export interface OverlayViewModel {
  rows: RecRow[];
  remaining: { hero: number; normal: number; ultimate: number };
}

function topSignal(breakdown: Partial<Record<SignalId, number>>): SignalId | null {
  let best: SignalId | null = null;
  let bestV = -Infinity;
  for (const [k, v] of Object.entries(breakdown) as [SignalId, number][]) {
    if (v > bestV) { bestV = v; best = k; }
  }
  return best;
}

export function toViewModel(snap: OverlaySnapshot): OverlayViewModel {
  return {
    remaining: snap.remaining,
    rows: snap.recommendations.map((r, i) => ({
      valveId: r.candidate.valveId,
      slotType: r.candidate.slotType,
      scoreText: r.score.toFixed(2),
      topSignal: topSignal(r.breakdown),
      highlighted: i === 0,
    })),
  };
}
```

```tsx
// renderer/src/Overlay.tsx
import { useOverlayStore } from "./store";
import { toViewModel } from "./view_model";

export function Overlay() {
  const snapshot = useOverlayStore((s) => s.snapshot);
  if (!snapshot) return null;
  const vm = toViewModel(snapshot);
  return (
    <div className="pointer-events-none fixed inset-0 p-4 text-sm text-white">
      <div className="mb-2">
        剩余:英雄 {vm.remaining.hero} · 普通 {vm.remaining.normal} · 终极 {vm.remaining.ultimate}
      </div>
      <ul>
        {vm.rows.map((r) => (
          <li key={r.valveId} className={r.highlighted ? "font-bold text-yellow-300" : ""}>
            {r.valveId} ({r.slotType}) — {r.scoreText} · {r.topSignal ?? "—"}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 4: 跑测试确认通过**

Run:`npx vitest run view_model`
Expected: PASS(3 passed)。

- [ ] **Step 5: Commit**

```bash
git add renderer/src/view_model.ts renderer/src/Overlay.tsx renderer/tests/view_model.test.ts
git commit -m "feat(renderer): overlay view-model (highlight + top signal) and component"
```

---

## Task 5: 控制面板——可调权重 + 动态系数(renderer/src/ControlPanel.tsx)

复用阶段 3 的 `ScoringConfig`(`baseWeights` 各信号基础权重 + 动态系数 `alpha`/`beta`/`sigma` + `topK`),让用户实时调。改动 → 经 IPC 回传 main → 下一手用新 config 跑 `recommend`。可测部分:`configToControls`(config ↔ 控件值,含基础权重与系数)+ 校验。

**Files:**
- Create: `renderer/src/config_controls.ts`
- Create: `renderer/src/ControlPanel.tsx`
- Test: `renderer/tests/config_controls.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// renderer/tests/config_controls.test.ts
import { describe, it, expect } from "vitest";
import { configToControls, controlsToConfig } from "../src/config_controls";
import { defaultScoringConfig } from "@ad/core/scoring/config";

describe("config controls", () => {
  it("round-trips the default config through controls (weights + coefficients)", () => {
    const cfg = defaultScoringConfig();
    expect(controlsToConfig(configToControls(cfg))).toEqual(cfg);
  });
  it("clamps negative base weights to 0 (no negative weighting via UI)", () => {
    const ctrls = configToControls(defaultScoringConfig());
    ctrls.weights = ctrls.weights.map((w) => (w.id === "base" ? { ...w, weight: -3 } : w));
    expect(controlsToConfig(ctrls).baseWeights.base).toBe(0);
  });
  it("carries alpha/beta/sigma/topK through", () => {
    const ctrls = configToControls(defaultScoringConfig());
    ctrls.alpha = 0.9;
    expect(controlsToConfig(ctrls).alpha).toBe(0.9);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run:`npx vitest run config_controls`
Expected: FAIL,模块不存在。

- [ ] **Step 3: 最小实现 + 薄 ControlPanel.tsx**

```ts
// renderer/src/config_controls.ts
// ScoringConfig ↔ UI 控件。编辑 baseWeights 各项 + 动态系数 alpha/beta/sigma + topK。
import type { ScoringConfig, SignalId } from "@ad/shared/types/scoring";

export interface WeightControl { id: SignalId; weight: number; }
export interface ConfigControls {
  weights: WeightControl[];
  alpha: number;
  beta: number;
  sigma: number;
  firstRoundSize: number;
  topK: number;
}

export function configToControls(cfg: ScoringConfig): ConfigControls {
  return {
    weights: (Object.entries(cfg.baseWeights) as [SignalId, number][]).map(([id, weight]) => ({ id, weight })),
    alpha: cfg.alpha, beta: cfg.beta, sigma: cfg.sigma,
    firstRoundSize: cfg.firstRoundSize, topK: cfg.topK,
  };
}

export function controlsToConfig(c: ConfigControls): ScoringConfig {
  const baseWeights: Partial<Record<SignalId, number>> = {};
  for (const w of c.weights) baseWeights[w.id] = Math.max(0, w.weight); // UI 不允许负权重
  return {
    baseWeights,
    alpha: c.alpha, beta: c.beta, sigma: c.sigma,
    firstRoundSize: c.firstRoundSize, topK: c.topK,
  };
}
```

```tsx
// renderer/src/ControlPanel.tsx
import { useState } from "react";
import { defaultScoringConfig } from "@ad/core/scoring/config";
import { configToControls, controlsToConfig, type ConfigControls } from "./config_controls";

declare global {
  interface Window { ad?: { setConfig: (cfg: unknown) => void } }
}

export function ControlPanel() {
  const [controls, setControls] = useState<ConfigControls>(() => configToControls(defaultScoringConfig()));
  const push = (next: ConfigControls) => {
    setControls(next);
    window.ad?.setConfig(controlsToConfig(next)); // 回传 main(preload 暴露)
  };
  const setWeight = (i: number, weight: number) =>
    push({ ...controls, weights: controls.weights.map((w, j) => (j === i ? { ...w, weight } : w)) });
  return (
    <div className="p-4 space-y-2">
      {controls.weights.map((w, i) => (
        <label key={w.id} className="flex items-center gap-2">
          <span className="w-28">{w.id}</span>
          <input type="range" min={0} max={5} step={0.1} value={w.weight}
                 onChange={(e) => setWeight(i, Number(e.target.value))} />
          <span>{w.weight.toFixed(1)}</span>
        </label>
      ))}
      <label className="flex items-center gap-2">
        <span className="w-28">α 前置激进</span>
        <input type="range" min={0} max={2} step={0.1} value={controls.alpha}
               onChange={(e) => push({ ...controls, alpha: Number(e.target.value) })} />
        <span>{controls.alpha.toFixed(1)}</span>
      </label>
      <label className="flex items-center gap-2">
        <span className="w-28">β 后置激进</span>
        <input type="range" min={0} max={2} step={0.1} value={controls.beta}
               onChange={(e) => push({ ...controls, beta: Number(e.target.value) })} />
        <span>{controls.beta.toFixed(1)}</span>
      </label>
    </div>
  );
}
```

- [ ] **Step 4: 跑测试确认通过**

Run:`npx vitest run config_controls`
Expected: PASS(3 passed)。

- [ ] **Step 5: Commit**

```bash
git add renderer/src/config_controls.ts renderer/src/ControlPanel.tsx renderer/tests/config_controls.test.ts
git commit -m "feat(renderer): control panel for live scoring weight tuning"
```

---

## Task 6: koffi 窗口追踪(main/src/ffi/window_track.ts)——平台绑定,手动冒烟

koffi 调 Win32 `FindWindowW` + `GetWindowRect` 找 Dota 2 窗口并取矩形。**x64 Windows only**。无法在 CI 纯测,用手动冒烟脚本验收;但把「矩形 → DraftLayout」的纯部分留给 Task 1 已测的 `deriveLayout`。

**Files:**
- Create: `main/src/ffi/window_track.ts`
- Create: `main/src/ffi/probe_window.ts`(手动冒烟脚本)
- Modify: `main/package.json`(加 `koffi`)

- [ ] **Step 1: 实现 window_track.ts**

```ts
// main/src/ffi/window_track.ts
// koffi Win32 FFI:找游戏窗口 + 取矩形。x64 Windows only(计划书 §三/§九)。
import koffi from "koffi";
import type { WindowRect } from "@ad/core/recognition/layout_derive";

const user32 = koffi.load("user32.dll");
// RECT { LONG left, top, right, bottom }
const RECT = koffi.struct("RECT", { left: "long", top: "long", right: "long", bottom: "long" });
const FindWindowW = user32.func("__stdcall", "FindWindowW", "void *", ["str16", "str16"]);
const GetWindowRect = user32.func("__stdcall", "GetWindowRect", "bool", ["void *", koffi.out(koffi.pointer(RECT))]);

/** 找到游戏窗口的客户矩形;未找到返回 null。 */
export function findGameWindowRect(titleSubstring = "Dota 2"): WindowRect | null {
  const hwnd = FindWindowW(null, titleSubstring);
  if (!hwnd) return null;
  const rect = {} as { left: number; top: number; right: number; bottom: number };
  if (!GetWindowRect(hwnd, rect)) return null;
  return { x: rect.left, y: rect.top, width: rect.right - rect.left, height: rect.bottom - rect.top };
}
```

- [ ] **Step 2: 冒烟脚本**

```ts
// main/src/ffi/probe_window.ts
import { findGameWindowRect } from "./window_track";
import { deriveLayout } from "@ad/core/recognition/layout_derive";

const rect = findGameWindowRect("Dota 2");
if (!rect) { console.log("game window not found"); process.exit(1); }
console.log("rect:", rect);
console.log("derived pool:", deriveLayout(rect).pool);
```

- [ ] **Step 3: 手动冒烟(Dota 2 开着,窗口/无边框模式)**

Run(在 `main/` 下):`npx tsx src/ffi/probe_window.ts`
Expected: 打印游戏窗口矩形 + 推导出的 pool ROI 坐标;数值随窗口大小变化合理。

- [ ] **Step 4: Commit**

```bash
git add main/src/ffi/window_track.ts main/src/ffi/probe_window.ts main/package.json
git commit -m "feat(main): koffi window tracking (find game window rect)"
```

---

## Task 7: 透明穿透叠层窗口 + Electron 装配(main/src/overlay/window.ts + main.ts + ipc.ts)——平台绑定,手动冒烟

建透明、点击穿透、置顶的 Electron 叠层窗口,对齐到游戏窗口矩形;装配捕获循环 → 打分 → IPC 推送;控制面板共用窗口栈。全平台绑定,手动冒烟。

**Files:**
- Create: `main/src/overlay/window.ts`
- Create: `main/src/overlay/ipc.ts`
- Create: `main/src/main.ts`
- Create: `main/preload.ts`
- Create: `electron.vite.config.ts`
- Modify: `main/package.json`(加 `electron`、`electron-vite`、`@electron/rebuild`)

- [ ] **Step 1: 透明穿透窗口**

```ts
// main/src/overlay/window.ts
import { BrowserWindow } from "electron";
import type { WindowRect } from "@ad/core/recognition/layout_derive";

export function createOverlayWindow(): BrowserWindow {
  const win = new BrowserWindow({
    transparent: true, frame: false, alwaysOnTop: true, skipTaskbar: true,
    resizable: false, focusable: false,
    webPreferences: { preload: `${__dirname}/preload.js`, contextIsolation: true },
  });
  win.setIgnoreMouseEvents(true, { forward: true }); // 点击穿透到游戏
  win.setAlwaysOnTop(true, "screen-saver");
  return win;
}

/** overlay 对齐到游戏窗口矩形。 */
export function alignToGame(win: BrowserWindow, rect: WindowRect): void {
  win.setBounds({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
}
```

- [ ] **Step 2: IPC 推送 + preload**

```ts
// main/src/overlay/ipc.ts
import type { BrowserWindow } from "electron";
import { OVERLAY_CHANNEL, type OverlaySnapshot } from "@ad/shared/types/ipc";

export function pushSnapshot(win: BrowserWindow, snap: OverlaySnapshot): void {
  if (!win.isDestroyed()) win.webContents.send(OVERLAY_CHANNEL, snap);
}
```

```ts
// main/preload.ts
import { contextBridge, ipcRenderer } from "electron";
import { OVERLAY_CHANNEL } from "@ad/shared/types/ipc";

contextBridge.exposeInMainWorld("ad", {
  onSnapshot: (cb: (snap: unknown) => void) =>
    ipcRenderer.on(OVERLAY_CHANNEL, (_e, snap) => cb(snap)),
  setConfig: (cfg: unknown) => ipcRenderer.send("config:set", cfg),
});
```

- [ ] **Step 3: main.ts 装配**

```ts
// main/src/main.ts
// 装配:建 overlay 窗口 → 追游戏窗口 → 启捕获循环 → 每次状态更新跑 recommend → 推 snapshot。
// 控制面板经 ipc "config:set" 回传新 ScoringConfig → 下一手即用(可配置机制端到端连通)。
import { app, ipcMain } from "electron";
import { createOverlayWindow, alignToGame } from "./overlay/window";
import { pushSnapshot } from "./overlay/ipc";
import { findGameWindowRect } from "./ffi/window_track";
import { buildSnapshot } from "./overlay/snapshot";
import { runMonitorLoop } from "./capture/loop";
import { loadIndex } from "@ad/core/recognition/index_store";
import { ReferenceDb } from "@ad/core/db/reference";
import { recommend } from "@ad/core/scoring/recommend";
import { defaultScoringConfig } from "@ad/core/scoring/config";
import type { Candidate, ScoringConfig } from "@ad/shared/types/scoring";
import { resolve } from "node:path";

app.whenReady().then(() => {
  const win = createOverlayWindow();
  win.loadFile(resolve(__dirname, "../renderer/index.html"));

  const rect = findGameWindowRect("Dota 2");
  if (rect) alignToGame(win, rect);

  const index = loadIndex(resolve(__dirname, "../../models/templates/phash_index.json"));
  const dbPath = resolve(__dirname, "../../pipeline/out/reference.db");
  const ref = new ReferenceDb(dbPath); // 路径显式持有,传给 recommend(不访问私有字段)
  let cfg = defaultScoringConfig();    // 可变:控制面板改权重/系数后替换
  let version = 0;

  // 控制面板回传新 config(基础权重 + α/β/σ/topK)→ 下一手即用。
  ipcMain.on("config:set", (_e, next: ScoringConfig) => { cfg = next; });

  runMonitorLoop({
    index, ref,
    // onUpdate 现接收 (machine, pool):pool 是本帧的混合候选池(见下注的 loop.ts 增量)。
    onUpdate: (machine, pool: Candidate[]) => {
      const state = machine.state();
      const activeRow = state.activeRow ?? 0;
      const recs = recommend(pool, state.players[activeRow], activeRow, dbPath, cfg);
      pushSnapshot(win, buildSnapshot(state, activeRow, recs, ++version));
    },
  });
});
```

> **接线增量(执行本任务时先做,非遗漏):** `recommend` 需要「当前帧的混合候选池 `Candidate[]`」,但阶段 2 的 `loop.ts` 的 `onUpdate` 只传 `machine`。在本任务里把 `MonitorDeps.onUpdate` 改成 `(machine: DraftMachine, pool: Candidate[]) => void`,并在 `loop.ts` 的 `tick` 里用 `poolCells(frame, LAYOUT_1080P)` 识别池格、`ref.slotType(valveId)` 组装 `pool: Candidate[]` 后随回调传出。DB 路径已用上面的 `dbPath` 局部变量显式传入 `recommend`,**不访问 `ReferenceDb` 私有字段**。Active Picker 的彩色采集(阶段 2 留的 null)也在此接 `detectActivePicker`——彩色帧管线此处已具备。

- [ ] **Step 4: electron.vite.config.ts + better-sqlite3 重编译**

```ts
// electron.vite.config.ts
import { defineConfig } from "electron-vite";
export default defineConfig({
  main: { build: { rollupOptions: { input: "main/src/main.ts" } } },
  preload: { build: { rollupOptions: { input: "main/preload.ts" } } },
  renderer: { root: "renderer", build: { rollupOptions: { input: "renderer/index.html" } } },
});
```

Run(在仓库根,装好 Electron 依赖后):`npx electron-rebuild -f -w better-sqlite3`
Expected: 重编译成功(否则进 Electron 报 `NODE_MODULE_VERSION` 不匹配,阶段 1/2 已预警)。

- [ ] **Step 5: 手动冒烟(完整链路)**

准备:Dota 2 进 AD 选取界面(窗口/无边框);已跑过阶段 0 `build` + 阶段 1 `build-index`;已 `electron-rebuild`;已按 Step 3 注完成 `loop.ts` 池接线。
Run:`npx electron-vite preview`(或 `npm run dev` 配好后)
Expected(验收门,计划书 §十阶段 4):
- overlay 透明、覆盖在游戏上、**对齐游戏窗口**(移动/缩放游戏窗口后 overlay 跟随——可手动再调 `alignToGame`)。
- 点击穿透(能正常点游戏)。
- 随选取进度,候选排序/配额**实时刷新无明显延迟**。
- 控制面板拖动权重 → 下一手排序变化。

- [ ] **Step 6: Commit**

```bash
git add main/src/overlay/window.ts main/src/overlay/ipc.ts main/src/main.ts main/preload.ts electron.vite.config.ts main/package.json
git commit -m "feat(overlay): transparent click-through window + electron wiring + IPC push"
```

---

## Task 8: 性能压测检查点(计划书 §九)

frame-diff 门控做不好会持续烧 GPU。加一个最小压测:静止画面(无变化)下,捕获循环的「实际放行识别次数 / 总 tick 数」应远小于 1(门控生效)。可在 `core/` 纯测(用模拟帧序列驱动 `FrameGate`)。

**Files:**
- Test: `core/tests/recognition/frame_gate_perf.test.ts`

- [ ] **Step 1: 写压测断言测试**

```ts
// core/tests/recognition/frame_gate_perf.test.ts
import { describe, it, expect } from "vitest";
import { FrameGate } from "../../src/recognition/frame_diff";

function block(v: number): number[][] {
  return Array.from({ length: 16 }, () => Array(16).fill(v));
}

describe("frame gate perf budget", () => {
  it("a static screen releases the settled frame exactly once (then gates the rest)", () => {
    const gate = new FrameGate(2);
    let passes = 0;
    const still = [block(50), block(60), block(70)];
    for (let i = 0; i < 100; i++) if (gate.shouldProcess(still)) passes += 1;
    expect(passes).toBe(1); // 连续静止 → 第 2 帧放行最终稳定帧,之后不再重复
  });

  it("under continuous change (animation), debounce releases NOTHING", () => {
    const gate = new FrameGate(2);
    let passes = 0;
    for (let i = 0; i < 99; i++) if (gate.shouldProcess([block(i)])) passes += 1;
    // 每帧都在变 → 稳定计数永远到不了 2 → 一帧都不放行(绝不喂半截动画帧)
    expect(passes).toBe(0);
  });
});
```

- [ ] **Step 2: 跑测试确认通过**

Run:`npx vitest run recognition/frame_gate_perf`
Expected: PASS(2 passed)。

- [ ] **Step 3: Commit**

```bash
git add core/tests/recognition/frame_gate_perf.test.ts
git commit -m "test(core): frame-diff gate performance budget assertions"
```

---

## 阶段 4 验收清单(对应计划书 §十「阶段 4」)

- [ ] `core/` + `renderer/` 纯逻辑测试全绿(layout_derive / snapshot / store / view_model / config_controls / frame_gate_perf)。
- [ ] **overlay 对齐游戏窗口** —— Task 6(koffi 取矩形)+ Task 7 Step 5 手动冒烟。
- [ ] **实时刷新无明显延迟** —— Task 7 Step 5 冒烟;门控保证不烧 GPU(Task 8)。
- [ ] GridSpec 从手填升级为分辨率推导,1080p 退化回 `LAYOUT_1080P`(回归测试守住)。
- [ ] IPC 载荷 JSON 可序列化;版本号丢弃过期帧。
- [ ] 控制面板可调 `ScoringConfig` 权重并即时影响排序(连通阶段 3 可配置机制)。
- [ ] `electron-rebuild -f -w better-sqlite3` 已执行(阶段 1/2 预警闭环)。

> **已知接线增量(执行 Task 7 时完成,非遗漏):** `loop.ts` 的 `onUpdate` 需补传「当前帧混合候选池 `Candidate[]`」;`recommend` 的 DB 路径显式传入,不访问 `ReferenceDb` 私有字段;Active Picker 彩色采集(阶段 2 留的 null)在此接 `detectActivePicker`——**裁 `pickerStrip` 时 sharp 必须 `.removeAlpha()`**,按阶段 2 Task 5 末「采集侧约定」构 `RgbStrip{channels: info.channels(=3), data}`,否则探头按 `channels!==3` 抛错(防 RGBA 偏移)。

> **下一步依赖:** overlay 全链路 = MVP 闭环(计划书 §十:持续监控 + 条件化打分跑通)。阶段 5 在此之上做 NN 识别替换 / LLM 解释层增强,均不得拖慢本链路。
