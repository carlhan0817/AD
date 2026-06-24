# scanOnce 核心 + 触发 Mock 设计

日期:2026-06-24
状态:已批准设计,待写实现计划

## 目标

为识别系统提供一条**手动触发**的单帧扫描路径 `scanOnce`,**绕过现有连续监控的 4 道门**,
让首要目标——「准确识别 48 格技能池 + 对技能打分」——能在真实游戏帧上被快速、隔离地验证。

非目标(明确排除,YAGNI):
- ❌ 真触发层(热键切穿透 + 扫描按钮)—— 下一个独立设计
- ❌ 英雄识别 / 十行已选追踪
- ❌ 有上下文打分(真实 `me` / `pickIndex`)
- ❌ 分辨率缩放公式移植(与本目标正交)

## 背景与决策

### 触发路线:手动(过渡)
用户手动触发扫描(参考 Tiarin-Hino/ability-draft-plus 的手动「扫描」按钮路线)。
**手动是当前阶段的过渡形态,产品终态仍是连续监控**(实时不打扰)。

### 4 道门的去留:保留,不删
现有 `runMonitorLoop`([main/src/capture/loop.ts](../../../main/src/capture/loop.ts))串了 5 道串行判据:

| 门 | 作用 | 手动路径下 |
|---|---|---|
| ①frame-diff(静止) | 自动判断画面稳定才处理 | 用户挑稳定时机按扫描 → 人肉替代 |
| ②布局校验(layout_guard) | 自动判断未被面板遮挡、是规范选取界面 | 用户知道自己在选取界面才按 → 人肉替代 |
| ③状态机 observe | 连续帧确认「谁轮到选」变化 | 单次扫描不追踪时序 → 不需要 |
| ④activeRow | 自动找当前活动玩家 | 无上下文纯池排名不依赖 → 不需要 |

**手动路径完全绕过这 4 门,它们对手动扫描零贡献。** 但**有意保留**(不删 `runMonitorLoop` /
4 门 / `layout_guard.ts`),因为:
1. 手动是过渡,连续监控是终态,届时这 4 门(尤其已填坑的①②)重新启用;
2. ①②已付出填坑成本(倒计时混入 diff、方差判据,见项目 memory),删 = 丢弃资产。

> **保留意图须在代码注释/spec 中写明**,避免将来误把「scanOnce + runMonitorLoop 两条路」当冗余删错。

## 架构

`scanOnce` 是住在 main 包的**纯函数**(编排截屏后的识别+打分,本身不碰 Electron):

```
scanOnce(frame, deps)                          [新, main/src/capture/scan_once.ts]
  1. recognizePool(frame, rect, index, POOL_LAYOUT_RATIO, RECOGNIZE_MAX_DISTANCE)
                                                [复用, 已真机验证 48/48]  → valveId[]
  2. valveId[] → Candidate[] (deps.ref.slotType) [新, ~3 行桥接]
  3. recommend(candidates, 空me, null, deps.ref, deps.cfg)
                                                [复用]                    → ScoredCandidate[]
  ⇒ ScanResult { pool, recommendations }
```

### 复用 vs 新建账目

| scanOnce 步骤 | 新建 / 复用 |
|---|---|
| 识别 48 格池 | **复用** `recognizePool`(core/src/recognition/pool_recognize.ts,已验证 48/48) |
| valveId[] → Candidate[] 桥接 | **新**,约 3 行胶水 |
| 打分排名 | **复用** `recommend`(core/src/scoring/recommend.ts) |
| scanOnce 外壳函数 | **新文件**,仅串联上述三步,无新识别/打分算法 |

### 桥接细节
`recognizePool` 返回 `number[]`(valveId),`recommend` 需要 `Candidate[]`(`{ valveId, slotType }`)。
缺口仅 `slotType`,用现成 `deps.ref.slotType(v)` 补:
```ts
const candidates: Candidate[] = pool.map((v) => ({ valveId: v, slotType: deps.ref.slotType(v)! }));
```

### 无上下文纯池排名
首版 `me = { row:0, hero:null, normals:[], ultimates:[] }`、`pickIndex = null`。
- `base` / `aghs` / `shard`(只看技能自身)信号照常生效;
- `synergy`(依赖已选技能)/ `pos`(依赖 pickIndex)退化;
- **净结果 = 这局池子里单看技能客观强度的排序**(即「池中 OP 技能榜」)。
- 上下文是增量:英雄识别/已选追踪就绪后,把真实 `me`/`pickIndex` 灌进**同一个** `recommend`
  调用,排名自动升级为个性化推荐——函数不改,参数从空变满。

## 类型

均导出于 `main/src/capture/scan_once.ts`(暂不进 shared,YAGNI):

```ts
export interface ScanResult {
  pool: number[];                       // 识别到的候选池 valveId[](去重,铺平序)
  recommendations: ScoredCandidate[];   // 打分后 Top-K(按 score 降序)
}

export interface ScanDeps {
  index: IndexEntry[];
  ref: ReferenceDb;
  cfg: ScoringConfig;
  rect: WindowRect;   // 游戏客户区矩形,供比例池布局推导像素
}                     // 注意:不含 MonitorDeps.pool —— scanOnce 现场从识别结果造 Candidate,
                      // 绕开 app/src/main/index.ts 里 pool:[] 那个已知空数组坑。

export function scanOnce(frame: GrayFrame, deps: ScanDeps): ScanResult;
```

## 验证

### Trigger Mock:临时 demo 入口
帧来源 = **实时抓屏**(复用已有 `captureScreenGrayFrame`,不碰 PGM)。三步:
1. 构造 deps:复用 app/src/main/index.ts 现成的 `loadIndex` + `ReferenceDb` + `defaultScoringConfig`;
   `rect` 用 `findGameWindow` + `gameClientRect`(读不到回退 `1920×1080@(0,0)`)。
2. 抓真帧:`const frame = await captureScreenGrayFrame()`(Dota 开在选取界面)。
3. 跑 scanOnce + 打印可读结果(valveId → shortName,Top-K 带 breakdown):
   ```
   识别到 N 个技能: [valveId → shortName ...]
   推荐 Top-K: #1 furion_teleportation score=0.83 {base:.., aghs:..} ...
   ```

「触发」是手敲一条命令(mock),帧是真实抓屏 → 等价于真机的识别+打分输入。
唯一被跳过的是「用户按键/点按钮」这个交互动作,识别+打分两个目标 100% 覆盖。

### ⚠️ 待验证风险(实现第一步先确认)
`captureScreenGrayFrame` 用 Electron `desktopCapturer`,**可能依赖 Electron 主进程上下文**,
裸 `tsx` 脚本或跑不起来。实现第一步先验证它能否脱离 Electron 运行:
- **能** → demo 入口 = 裸脚本 `main/src/capture/scan_once_demo.ts`(`npx tsx ...`);
- **不能** → demo 入口 = app 启动时跑一次 scanOnce 并打日志的临时钩子
  (类似 app/src/main/index.ts 现有 `did-finish-load` 里的诊断段)。

### 回归单测
`main/tests/capture/scan_once.test.ts`,喂**合成帧**(复用测试里 `blankFrame`/`fillRect` 套路),
断言:`pool` 非空、`recommendations` 按 score 降序、长度 ≤ `cfg.topK`。
不依赖 Electron / 真帧 → CI 守门。

> 分工:demo 脚本(本地手跑,真帧)给「识别得准不准」的肉眼判断;单测(合成帧,入库)
> 给「链路通 + 排序对」的可复现回归。

## 对现有代码的影响:零破坏

| 现有东西 | 动作 |
|---|---|
| `runMonitorLoop` + ①②③④门 | **不删、不改**(旁置资产,终态回连续监控时启用) |
| `layout_guard.ts`(②门) | **不删、不改** |
| `recognizePool` / `recommend` / `poolFromFrame` | **不改**,纯复用 |
| `LiveSnapshotSource` / IPC / overlay | **不改** |

`scanOnce` 是**旁路新增**,不替换、不移除任何现有链路。它另起一条干净的手动路径,
让识别+打分调试绕开当前卡住的 ②门;门的问题留到回连续监控时再处理(或永不,若手动够用)。

## 文件清单

新增:
- `main/src/capture/scan_once.ts` —— `scanOnce` 纯函数 + `ScanResult`/`ScanDeps` 类型
- `main/src/capture/scan_once_demo.ts` —— 临时验证入口(或 app 临时钩子,视风险验证结果)
- `main/tests/capture/scan_once.test.ts` —— 合成帧回归单测

修改:无(零破坏)。

## 未决/后续(本设计范围外)
1. 真触发层:热键切穿透(`setIgnoreMouseEvents`)+ overlay 扫描按钮 —— 独立设计。
2. 英雄识别(候选:复用技能识别「靠 ability_order===2 反推英雄」,参考目标 repo)。
3. 有上下文打分:真实 `me` / `pickIndex` 灌入同一 `recommend`。
