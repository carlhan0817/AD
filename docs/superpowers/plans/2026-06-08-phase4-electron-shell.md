# Phase 4 Electron 外壳(mock 驱动可启动)实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 前置:阶段 1–3 纯逻辑(`DraftMachine`、`recommend`、`OverlaySnapshot`、`Overlay` 组件、`store`)已落地。先读 spec:`docs/superpowers/specs/2026-06-08-phase4-electron-shell-design.md`。

**Goal:** 新增一个 electron-vite 的 `app/` 工程,`npm run dev` 启动后弹出透明置顶 overlay 窗口,主进程用 mock snapshot 源经 IPC 推送,renderer 复用现有 `Overlay` 组件实时渲染——端到端闭环可在开发机验证;真实 `runMonitorLoop` 接入点预留。

**Architecture:** `app/` 聚合 main/preload/renderer 三块,复用 `@ad/shared/types/ipc` 的 `OVERLAY_CHANNEL` 与 `OverlaySnapshot`、`@ad/renderer` 的 `Overlay`/`store`。数据源抽象为 `SnapshotSource`:本阶段实现 `MockSnapshotSource`(纯产出函数 + 注入式 timer),`LiveSnapshotSource` 仅留类型与注释。不接 koffi、不接 better-sqlite3、不接真实截屏。

**Tech Stack:** Electron + electron-vite、React 18、Zustand、Vitest。

---

## 文件结构

| 文件 | 职责 |
|---|---|
| `package.json`(仓库根) | npm workspaces,聚合 core/main/renderer/shared/app |
| `app/package.json` | electron + electron-vite + react 依赖与脚本 |
| `app/tsconfig.json` | strict + jsx + `@ad/*` paths |
| `app/electron.vite.config.ts` | main/preload/renderer 三份配置 + `@ad/*` alias |
| `app/src/main/snapshot_source.ts` | `SnapshotSource` 接口 + `MockSnapshotSource`(纯产出 + 注入 timer) |
| `app/src/main/index.ts` | Electron 主进程:建透明置顶窗口 + 启动 mock 源 + IPC 推送 |
| `app/src/preload/index.ts` | contextBridge 暴露 `window.adOverlay.onSnapshot` |
| `app/src/renderer/index.html` | renderer HTML 入口 |
| `app/src/renderer/main.tsx` | createRoot 挂载 `<Overlay/>` + 订阅 IPC → store |
| `app/src/renderer/env.d.ts` | `window.adOverlay` 类型声明 |
| `app/tests/snapshot_source.test.ts` | mock 源产出逻辑单测(注入 timer) |

---

## Task 1: 根 workspace 聚合

**Files:**
- Create: `package.json`(仓库根)

- [ ] **Step 1: 写根 package.json**

```json
{
  "name": "ad-draft-assistant",
  "private": true,
  "version": "0.1.0",
  "workspaces": ["shared", "core", "main", "renderer", "app"],
  "scripts": {
    "dev": "npm run dev --workspace app",
    "test:core": "npm test --workspace core",
    "test:main": "npm test --workspace main",
    "test:renderer": "npm test --workspace renderer",
    "test:app": "npm test --workspace app",
    "test:ts": "npm run test:core && npm run test:main && npm run test:renderer && npm run test:app"
  }
}
```

- [ ] **Step 2: 验证 workspace 解析**

Run(仓库根):`npm install`
Expected: 成功安装,无 workspace 解析错误(`app` 尚未建 package.json 时此步会失败 → 本 task 仅创建根文件,`npm install` 放到 Task 2 之后执行;此处只确认 JSON 合法)。改为校验 JSON:
Run:`node -e "require('./package.json')"`
Expected: 无输出、退出码 0。

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "chore: root npm workspace aggregating all packages"
```

---

## Task 2: app 工程骨架(package.json + tsconfig)

**Files:**
- Create: `app/package.json`
- Create: `app/tsconfig.json`

- [ ] **Step 1: 写 app/package.json**

```json
{
  "name": "@ad/app",
  "version": "0.1.0",
  "type": "module",
  "main": "out/main/index.js",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "preview": "electron-vite preview",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "zustand": "^4.5.0"
  },
  "devDependencies": {
    "electron": "^31.0.0",
    "electron-vite": "^2.3.0",
    "vite": "^5.3.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@types/node": "^20.0.0"
  }
}
```

- [ ] **Step 2: 写 app/tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "jsx": "react-jsx",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["node"],
    "outDir": "out",
    "paths": {
      "@ad/core/*": ["../core/src/*"],
      "@ad/shared/*": ["../shared/*"],
      "@ad/renderer/*": ["../renderer/src/*"]
    }
  },
  "include": ["src", "tests"]
}
```

- [ ] **Step 3: 安装依赖**

Run(仓库根):`npm install`
Expected: 成功,electron / electron-vite / react 等装入。

- [ ] **Step 4: Commit**

```bash
git add app/package.json app/tsconfig.json package-lock.json
git commit -m "chore(app): electron-vite project skeleton (package + tsconfig)"
```

---

## Task 3: SnapshotSource 接口 + MockSnapshotSource(纯逻辑,TDD)

mock 源把"产出下一帧 snapshot"做成纯函数(版本号单调递增、循环遍历 fixture 帧),timer 注入便于单测。

**Files:**
- Create: `app/src/main/snapshot_source.ts`
- Test: `app/tests/snapshot_source.test.ts`
- Create: `app/vitest.config.ts`

- [ ] **Step 1: 写 vitest 配置(alias 对齐)**

```ts
// app/vitest.config.ts
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: { environment: "node" },
  resolve: {
    alias: {
      "@ad/shared": fileURLToPath(new URL("../shared", import.meta.url)),
      "@ad/core": fileURLToPath(new URL("../core/src", import.meta.url)),
    },
  },
});
```

- [ ] **Step 2: 写失败测试**

```ts
// app/tests/snapshot_source.test.ts
import { describe, it, expect, vi } from "vitest";
import { MockSnapshotSource, MOCK_FRAMES } from "../src/main/snapshot_source";

describe("MockSnapshotSource", () => {
  it("emits frames with monotonically increasing version", () => {
    const got: number[] = [];
    const src = new MockSnapshotSource((snap) => got.push(snap.version));
    // 手动驱动 3 拍(不依赖真实 timer)
    src.tick(); src.tick(); src.tick();
    expect(got).toEqual([1, 2, 3]);
  });

  it("cycles through the fixture frames by content", () => {
    const seen: number[][] = [];
    const src = new MockSnapshotSource((snap) =>
      seen.push(snap.recommendations.map((r) => r.candidate.valveId)));
    for (let i = 0; i < MOCK_FRAMES.length; i++) src.tick();
    // 第 i 拍的推荐内容 = 第 i 个 fixture 帧的推荐内容
    MOCK_FRAMES.forEach((f, i) => {
      expect(seen[i]).toEqual(f.recommendations.map((r) => r.candidate.valveId));
    });
  });

  it("start() drives ticks via injected timer and stop() halts them", () => {
    vi.useFakeTimers();
    const got: number[] = [];
    const src = new MockSnapshotSource((snap) => got.push(snap.version));
    src.start(100);
    vi.advanceTimersByTime(350); // 100/200/300 三次
    src.stop();
    vi.advanceTimersByTime(500); // stop 后不再增加
    expect(got).toEqual([1, 2, 3]);
    vi.useRealTimers();
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

Run(`app/` 下):`npx vitest run snapshot_source`
Expected: FAIL,模块不存在。

- [ ] **Step 4: 最小实现**

```ts
// app/src/main/snapshot_source.ts
// 数据源抽象。本阶段:MockSnapshotSource(纯产出 + 注入式 timer)。
// 真实接入预留:LiveSnapshotSource 包装 main 包的 runMonitorLoop,把 DraftMachine
// 接 buildSnapshot + recommend 后经同一 emit 回调推送——切换不改窗口/IPC/renderer。
import type { OverlaySnapshot } from "@ad/shared/types/ipc";
import type { DraftState } from "@ad/shared/types/draft";
import type { ScoredCandidate } from "@ad/shared/types/scoring";

export type SnapshotEmit = (snap: OverlaySnapshot) => void;

export interface SnapshotSource {
  start(intervalMs: number): void;
  stop(): void;
}

// 两帧 fixture:模拟"先英雄候选、再技能候选"的推荐变化,让 overlay 真正动起来。
const STATE_A: DraftState = {
  activeRow: 0,
  players: [{ row: 0, hero: null, normals: [], ultimates: [] }],
};
const STATE_B: DraftState = {
  activeRow: 0,
  players: [{ row: 0, hero: -9, normals: [5051], ultimates: [] }],
};
const RECS_A: ScoredCandidate[] = [
  { candidate: { valveId: -9, slotType: "hero" }, score: 0.42, breakdown: { base: 0.42 } },
  { candidate: { valveId: 5052, slotType: "normal" }, score: 0.30, breakdown: { base: 0.1, synergy: 0.2 } },
];
const RECS_B: ScoredCandidate[] = [
  { candidate: { valveId: 5052, slotType: "normal" }, score: 0.35, breakdown: { base: 0.15, synergy: 0.2 } },
  { candidate: { valveId: 6001, slotType: "ultimate" }, score: 0.18, breakdown: { base: 0.12, aghs: 0.06 } },
];

/** 帧模板(不含 version,version 由源在 emit 时单调赋值)。 */
export const MOCK_FRAMES: Omit<OverlaySnapshot, "version">[] = [
  { state: STATE_A, recommendations: RECS_A, remaining: { hero: 1, normal: 3, ultimate: 1 } },
  { state: STATE_B, recommendations: RECS_B, remaining: { hero: 0, normal: 2, ultimate: 1 } },
];

export class MockSnapshotSource implements SnapshotSource {
  private version = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  constructor(private readonly emit: SnapshotEmit) {}

  /** 产出并推送下一帧(纯递增 + 循环 fixture)。 */
  tick(): void {
    const frame = MOCK_FRAMES[this.version % MOCK_FRAMES.length];
    this.emit({ ...frame, version: ++this.version });
  }

  start(intervalMs: number): void {
    this.stop();
    this.timer = setInterval(() => this.tick(), intervalMs);
  }

  stop(): void {
    if (this.timer !== null) { clearInterval(this.timer); this.timer = null; }
  }
}
```

- [ ] **Step 5: 跑测试确认通过**

Run:`npx vitest run snapshot_source`
Expected: PASS(3 passed)。

- [ ] **Step 6: Commit**

```bash
git add app/src/main/snapshot_source.ts app/tests/snapshot_source.test.ts app/vitest.config.ts
git commit -m "feat(app): SnapshotSource interface + mock source (TDD)"
```

---

## Task 4: preload 桥 + renderer 类型声明

preload 用 contextBridge 把 IPC 接收暴露成 `window.adOverlay.onSnapshot(cb)`,channel 复用 `OVERLAY_CHANNEL`。

**Files:**
- Create: `app/src/preload/index.ts`
- Create: `app/src/renderer/env.d.ts`

- [ ] **Step 1: 写 preload**

```ts
// app/src/preload/index.ts
import { contextBridge, ipcRenderer } from "electron";
import { OVERLAY_CHANNEL, type OverlaySnapshot } from "@ad/shared/types/ipc";

contextBridge.exposeInMainWorld("adOverlay", {
  onSnapshot: (cb: (snap: OverlaySnapshot) => void) =>
    ipcRenderer.on(OVERLAY_CHANNEL, (_e, snap: OverlaySnapshot) => cb(snap)),
});
```

- [ ] **Step 2: 写 renderer 类型声明**

```ts
// app/src/renderer/env.d.ts
import type { OverlaySnapshot } from "@ad/shared/types/ipc";

declare global {
  interface Window {
    adOverlay: {
      onSnapshot: (cb: (snap: OverlaySnapshot) => void) => void;
    };
  }
}
export {};
```

- [ ] **Step 3: 类型检查**

Run(`app/` 下):`npx tsc --noEmit`
Expected: 通过(renderer/main.tsx 尚未建,但 preload + env.d.ts 应无类型错误)。若因 electron 类型缺失报错,确认 Task 2 的 `npm install` 已装 electron。

- [ ] **Step 4: Commit**

```bash
git add app/src/preload/index.ts app/src/renderer/env.d.ts
git commit -m "feat(app): preload contextBridge + window.adOverlay typings"
```

---

## Task 5: renderer 入口(HTML + 挂载 + IPC 订阅)

复用 `@ad/renderer` 的 `Overlay` 组件与 `useOverlayStore`;入口只负责挂载 + 把 `onSnapshot` 接到 `applySnapshot`。

**Files:**
- Create: `app/src/renderer/index.html`
- Create: `app/src/renderer/main.tsx`

- [ ] **Step 1: 写 HTML 入口**

```html
<!-- app/src/renderer/index.html -->
<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <title>AD Overlay</title>
    <style>
      html, body, #root { margin: 0; height: 100%; background: transparent; }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 2: 写挂载入口**

```tsx
// app/src/renderer/main.tsx
import { createRoot } from "react-dom/client";
import { Overlay } from "@ad/renderer/Overlay";
import { useOverlayStore } from "@ad/renderer/store";

// IPC → store:每收到一帧 snapshot,交给 store(内部按 version 丢弃过期帧)。
window.adOverlay.onSnapshot((snap) => useOverlayStore.getState().applySnapshot(snap));

const root = createRoot(document.getElementById("root")!);
root.render(<Overlay />);
```

- [ ] **Step 3: 类型检查**

Run(`app/` 下):`npx tsc --noEmit`
Expected: 通过。若 `@ad/renderer/Overlay` 解析失败,确认 tsconfig paths 含 `@ad/renderer/*`(Task 2 已加)。

- [ ] **Step 4: Commit**

```bash
git add app/src/renderer/index.html app/src/renderer/main.tsx
git commit -m "feat(app): renderer entry mounting Overlay + IPC subscription"
```

---

## Task 6: electron-vite 配置 + 主进程入口

主进程建透明置顶无边框窗口,加载 renderer,启动 `MockSnapshotSource` 经 IPC 推送。真实 `runMonitorLoop` 接入点写注释预留。

**Files:**
- Create: `app/electron.vite.config.ts`
- Create: `app/src/main/index.ts`

- [ ] **Step 1: 写 electron.vite 配置**

```ts
// app/electron.vite.config.ts
import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const alias = {
  "@ad/shared": fileURLToPath(new URL("../shared", import.meta.url)),
  "@ad/core": fileURLToPath(new URL("../core/src", import.meta.url)),
  "@ad/renderer": fileURLToPath(new URL("../renderer/src", import.meta.url)),
};

export default defineConfig({
  main: { resolve: { alias }, build: { rollupOptions: { input: "src/main/index.ts" } } },
  preload: { resolve: { alias }, build: { rollupOptions: { input: "src/preload/index.ts" } } },
  renderer: {
    resolve: { alias },
    plugins: [react()],
    build: { rollupOptions: { input: "src/renderer/index.html" } },
  },
});
```

> 注:`@vitejs/plugin-react` 需加入 `app/package.json` devDependencies(`"@vitejs/plugin-react": "^4.3.0"`),在本 task Step 3 前 `npm install`。

- [ ] **Step 2: 写主进程入口**

```ts
// app/src/main/index.ts
// Electron 主进程:建透明置顶 overlay 窗口 + 启动 snapshot 源 + IPC 推送。
// 本阶段数据源 = MockSnapshotSource。真实接入(留待下一阶段):
//   把 MockSnapshotSource 换成包装 main 包 runMonitorLoop 的 LiveSnapshotSource,
//   其 onUpdate(machine) 内调 recommend + buildSnapshot 后经同一 emit 推送;
//   届时需:① main/loop.ts 的 onUpdate 补传 pool: Candidate[];② electron-rebuild
//   better-sqlite3;③ koffi 窗口追踪 + setIgnoreMouseEvents 穿透。本阶段全部不做。
import { app, BrowserWindow } from "electron";
import { join } from "node:path";
import { OVERLAY_CHANNEL } from "@ad/shared/types/ipc";
import { MockSnapshotSource } from "./snapshot_source";

function createOverlayWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 720,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
    },
  });
  // 本阶段不做 setIgnoreMouseEvents 穿透与窗口追踪(koffi,下一阶段)。
  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    win.loadFile(join(__dirname, "../renderer/index.html"));
  }
  return win;
}

app.whenReady().then(() => {
  const win = createOverlayWindow();
  const source = new MockSnapshotSource((snap) => {
    if (!win.isDestroyed()) win.webContents.send(OVERLAY_CHANNEL, snap);
  });
  // 等首帧加载完再开始推送,避免渲染前丢帧。
  win.webContents.once("did-finish-load", () => source.start(1500));
  app.on("window-all-closed", () => { source.stop(); app.quit(); });
});
```

- [ ] **Step 3: 安装 react 插件 + 构建验证**

Run(仓库根,先把 `@vitejs/plugin-react` 加入 app devDeps 后):`npm install`
Run(`app/` 下):`npx electron-vite build`
Expected: main / preload / renderer 三块构建成功,产物落 `app/out/`。

- [ ] **Step 4: 手动验收(开发机,无需 Dota)**

Run(`app/` 下):`npm run dev`
Expected(对应 spec 验收):
- 弹出一个透明无边框置顶窗口。
- 窗口内显示 overlay:剩余配额行 + 推荐列表,top 项高亮。
- 每 ~1.5s 内容在两帧 fixture 间切换、version 递增(store 不丢新帧)。

- [ ] **Step 5: Commit**

```bash
git add app/electron.vite.config.ts app/src/main/index.ts app/package.json package-lock.json
git commit -m "feat(app): electron-vite config + main process with mock-driven overlay"
```

---

## 阶段 4(本阶段)验收清单

- [ ] `npm run dev` 启动弹出透明置顶 overlay 窗口(手动,Task 6 Step 4)。
- [ ] overlay 经 IPC 收到 mock snapshot 并渲染,version 递增、过期帧丢弃(复用 store 逻辑)。
- [ ] mock 源产出逻辑单测全绿(Task 3)。
- [ ] 复用现有 `OVERLAY_CHANNEL` / `OverlaySnapshot` / `Overlay` / `store`,无契约漂移。
- [ ] 真实 `runMonitorLoop` 接入点在 `app/src/main/index.ts` 注释中明确预留(koffi / better-sqlite3 rebuild / loop onUpdate 改签 / 鼠标穿透 全部留待下一阶段)。
- [ ] **merge 前**:`pipeline` pytest + `core`/`main`/`renderer`/`app` vitest 全绿。

> 与旧计划 `2026-06-04-06-phase4-overlay.md` 的关系:旧计划 Task 1–5、8(纯逻辑)已落地并复用;旧 Task 6(koffi)+ 旧 Task 7 的"真实窗口追踪/穿透/真实数据接线"整体推迟,本计划以 mock 驱动的可启动外壳替代,使端到端闭环可在无游戏环境验证。
