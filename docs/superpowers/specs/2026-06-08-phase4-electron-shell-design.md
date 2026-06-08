# Phase 4 设计 · Electron 外壳（overlay 可启动）

日期:2026-06-08 · 分支:`phase4-overlay`

## 目标

让程序第一次能"开机":`npm run dev` 启动一个 Electron 应用,弹出 overlay 窗口,
通过 IPC 实时显示推荐。用假数据(mock snapshot)驱动跑通端到端闭环,同时把真实
截屏循环(`runMonitorLoop`)的接入点预留好。

**本阶段不做**:koffi/Win32 窗口穿透、窗口追踪对齐游戏窗口、鼠标穿透
(`setIgnoreMouseEvents`)、electron-builder 打包。这些留给后续阶段。

## 非目标(显式排除)

- 真实截屏循环驱动(依赖 pipeline 产物 phash 索引 + SQLite,尚未生成;且需真实
  Dota 画面,无法在开发机验证)。
- 把 `runMonitorLoop` 的 `onUpdate` 接打分 + `buildSnapshot`(留作切换数据源时做)。
- Active Picker 彩色采集(`activePicker.row` 当前仍为 null)。

## 架构

新增根级 `app/` 工程(electron-vite 项目),聚合 main/preload/renderer 三块。现有
`core/ main/ renderer/ shared/ pipeline/` 逻辑不动,只新增根 workspace 串联。

```
根 package.json (npm workspaces)
└── app/                          ← 新增,electron-vite 项目
    ├── package.json              ← electron + electron-vite + react 依赖
    ├── electron.vite.config.ts   ← main/preload/renderer 三份配置 + @ad/* alias
    ├── tsconfig.json
    ├── src/
    │   ├── main/
    │   │   ├── index.ts          ← Electron 主进程:建透明置顶窗口 + 启动 snapshot 源
    │   │   └── snapshot_source.ts← 数据源抽象:MockSnapshotSource | (预留) LiveSnapshotSource
    │   ├── preload/
    │   │   └── index.ts          ← contextBridge 暴露 window.adOverlay.onSnapshot
    │   └── renderer/
    │       ├── index.html
    │       ├── main.tsx          ← createRoot 挂载 <Overlay/>,订阅 IPC → store
    │       └── env.d.ts          ← window.adOverlay 类型声明
    └── tests/
        └── snapshot_source.test.ts
```

## 数据流

```
SnapshotSource (mock fixture, 注入式 timer 定时 tick)
  → 主进程 webContents.send(OVERLAY_CHANNEL, snapshot)
  → preload contextBridge → window.adOverlay.onSnapshot(cb)
  → renderer: 收到 → useOverlayStore.applySnapshot(snap)
  → <Overlay/> 渲染(已有逻辑;store 按 version 丢弃过期帧)
```

## 关键设计点

1. **snapshot 数据源做成可替换接口** `SnapshotSource`:
   - `MockSnapshotSource`:循环推送若干帧 fixture `OverlaySnapshot`,版本号递增,让
     overlay 真正动起来,验证闭环。
   - 预留 `LiveSnapshotSource`:包装 `main` 包的 `runMonitorLoop`。之后切换只需把
     `onUpdate` 里的 `DraftMachine` 接打分 + `buildSnapshot`,**不改**窗口/IPC/renderer。
   - 源的"产出 snapshot"逻辑与"定时器"解耦:产出是纯函数,timer 注入,便于单测。

2. **复用现有契约,零字符串/类型漂移**:`OVERLAY_CHANNEL`、`OverlaySnapshot` 直接从
   `@ad/shared/types/ipc` 引;preload、renderer、主进程共用同一常量与类型。

3. **preload 类型声明**:renderer 侧 `env.d.ts` 声明 `window.adOverlay: { onSnapshot(cb): void }`,
   保持 strict 编译。

4. **窗口**:`BrowserWindow` 透明(`transparent: true`)、置顶(`alwaysOnTop`)、无边框
   (`frame: false`)。视觉上即 overlay 形态。**本阶段不做** `setIgnoreMouseEvents` 穿透
   与窗口追踪(那是 koffi,下一阶段)。

5. **@ad/* alias 一致性**:electron.vite.config.ts 的 resolve.alias 与各 tsconfig paths
   对齐(`@ad/core`→core/src,`@ad/shared`→shared,`@ad/main`→main/src)。

## 测试策略

- `snapshot_source.test.ts`:用 vitest 测 mock 源的产出逻辑——注入假 timer,断言
  推送的 snapshot 版本号单调递增、内容为预期 fixture。主进程 / Electron API 不进单测。
- preload 桥接、renderer 挂载属集成接线,靠 `npm run dev` 手动验证 overlay 亮起。
- **merge 前跑全部四层并全绿**:`pipeline` 的 pytest + `core` / `main` / `renderer` /
  `app` 的 vitest。

## 流程

1. 在 `phase4-overlay` 分支工作。
2. 搭建 app 工程 + 根 workspace。
3. 跑全部测试(pytest + 四个 vitest)全绿。
4. merge 到 main 并 push。
