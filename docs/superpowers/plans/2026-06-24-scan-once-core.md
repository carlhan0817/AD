# scanOnce 核心 + 触发 Mock 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增手动单帧扫描 `scanOnce(frame, deps)`,复用已验证的池识别 + 打分,绕过 4 道连续监控门,产出「候选池 valveId[] + Top-K 推荐」。

**Architecture:** `scanOnce` 是住在 main 包的纯函数,三步:`recognizePool`(复用,已验证 48/48)→ `valveId[]→Candidate[]` 桥接(`ref.slotType`)→ `recommend`(空 `me`/`pickIndex=null` = 无上下文纯池排名)。配一个临时 demo 入口(实时抓屏验证)和一个合成帧回归单测。现有 `runMonitorLoop` / 4 门 / `layout_guard` 零改动保留。

**Tech Stack:** TypeScript,vitest(`vitest run`),Electron(`desktopCapturer` 截屏),node-sqlite3-wasm(`ReferenceDb`)。

## Global Constraints

- 测试运行器:`vitest run`(main 包 `npm test --workspace main`,根 `npm run test:core` 跑 core)。
- main 包路径别名(`main/tsconfig.json`):`@ad/core/* → ../core/src/*`,`@ad/shared/* → ../shared/*`。测试/源码引 main 自身用相对路径 `../../src/...`,引 core/shared 用 `@ad/...`。
- 类型权威:`Candidate = { valveId: number; slotType: SlotType }`;`SlotType = "hero" | "normal" | "ultimate"`;`Queryable = { all(sql: string): unknown[] }`;`ReferenceDb implements Queryable` 且有 `slotType(valveId): SlotType | null`。
- 识别阈值沿用 `RECOGNIZE_MAX_DISTANCE = 20`(真机标定值,见 main/src/capture/loop.ts)。
- 不删、不改 `runMonitorLoop` / `layout_guard.ts` / `recognizePool` / `recommend`。`scanOnce` 是旁路新增。
- 提交信息结尾:`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`。

---

## 文件结构

| 文件 | 职责 | 动作 |
|---|---|---|
| `main/src/capture/scan_once.ts` | `scanOnce` 纯函数 + `ScanResult`/`ScanDeps` 类型 | Create |
| `main/tests/capture/scan_once.test.ts` | 合成帧回归单测(链路通+排序对+≤topK) | Create |
| `main/src/capture/scan_once_demo.ts` | 临时验证入口(实时抓屏 → scanOnce → 打印) | Create(临时) |

---

### Task 1: scanOnce 纯函数 + 合成帧单测

**Files:**
- Create: `main/src/capture/scan_once.ts`
- Test: `main/tests/capture/scan_once.test.ts`

**Interfaces:**
- Consumes(均已存在):
  - `recognizePool(frame: GrayFrame, rect: ClientRect, index: IndexEntry[], layout?: PoolLayout, maxDistance?: number): number[]` from `@ad/core/recognition/pool_recognize`
  - `recommend(pool: Candidate[], me: PlayerState, pickIndex: number | null, q: Queryable, cfg: ScoringConfig): ScoredCandidate[]` from `@ad/core/scoring/recommend`
  - `POOL_LAYOUT_RATIO`、`type ClientRect` from `@ad/core/recognition/roi`
  - `type IndexEntry` from `@ad/core/recognition/index_store`
  - `type GrayFrame` from `@ad/core/recognition/grid`
  - `type Candidate, ScoredCandidate, ScoringConfig` from `@ad/shared/types/scoring`
  - `type SlotType, PlayerState` from `@ad/shared/types/draft`
  - `ReferenceDb`(有 `slotType(v): SlotType | null` + `all(sql): unknown[]`)from `@ad/core/db/reference`
  - `type WindowRect` from `../ffi/geometry`
- Produces(后续 Task 2 依赖):
  - `interface ScanResult { pool: number[]; recommendations: ScoredCandidate[] }`
  - `interface ScanDeps { index: IndexEntry[]; ref: ReferenceDb; cfg: ScoringConfig; rect: WindowRect }`
  - `function scanOnce(frame: GrayFrame, deps: ScanDeps): ScanResult`

- [ ] **Step 1: 写失败测试**

Create `main/tests/capture/scan_once.test.ts`:

```typescript
// main/tests/capture/scan_once.test.ts
import { describe, it, expect } from "vitest";
import { scanOnce, type ScanDeps } from "../../src/capture/scan_once";
import { poolCellRects, POOL_LAYOUT_RATIO } from "@ad/core/recognition/roi";
import type { GrayFrame } from "@ad/core/recognition/grid";
import type { IndexEntry } from "@ad/core/recognition/index_store";
import type { ReferenceDb } from "@ad/core/db/reference";
import type { ScoringConfig } from "@ad/shared/types/scoring";
import type { SlotType } from "@ad/shared/types/draft";

// 纯色 cell → phashFromGray 得全 0 hash → 命中 phash="0000..." 的模板(与 pool_recognize.test.ts 同理)。
const index: IndexEntry[] = [{ valveId: 700, shortName: "solid", phash: "0000000000000000" }];

// 假 ReferenceDb:只实现 scanOnce 触达的两个方法。
// - slotType: 700 当作 normal 技能。
// - all: 给 buildScoringContext 喂一行 700 的胜率,其余表空 → 打分非零、可排序。
function fakeRef(): ReferenceDb {
  return {
    slotType: (v: number): SlotType | null => (v === 700 ? "normal" : null),
    all: (sql: string): unknown[] => {
      if (sql.includes("ability_winrate")) {
        return [{ ability_id: 700, winrate: 0.55, avg_pick_position: 10 }];
      }
      return []; // hero_winrate / ability_pairs / ability_aghs 全空
    },
  } as unknown as ReferenceDb;
}

const cfg: ScoringConfig = {
  baseWeights: { base: 1.0 }, // 只开 base 维度(无上下文,synergy/pos 退化)
  alpha: 0.5, beta: 0.4, sigma: 10, firstRoundSize: 10, topK: 4,
};

function depsWith(rect: ScanDeps["rect"]): ScanDeps {
  return { index, rect, ref: fakeRef(), cfg };
}

describe("scanOnce", () => {
  it("识别到候选池并产出打分推荐(无上下文纯池排名)", () => {
    const rect = { x: 0, y: 0, width: 1920, height: 1080 };
    const f: GrayFrame = { width: 1920, height: 1080, data: new Uint8Array(1920 * 1080) }; // 全 0 → 命中 700
    // sanity:池布局确实算出了格子。
    expect(poolCellRects(POOL_LAYOUT_RATIO, rect).length).toBeGreaterThan(0);

    const res = scanOnce(f, depsWith(rect));
    // 识别:池非空,含 700。
    expect(res.pool).toContain(700);
    // 打分:有推荐,且全是已识别候选。
    expect(res.recommendations.length).toBeGreaterThan(0);
    expect(res.recommendations.length).toBeLessThanOrEqual(cfg.topK);
    // 排序:score 降序(非递增)。
    const scores = res.recommendations.map((r) => r.score);
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeLessThanOrEqual(scores[i - 1]);
    }
  });

  it("空池(无命中)时推荐为空", () => {
    const rect = { x: 0, y: 0, width: 1920, height: 1080 };
    const f: GrayFrame = { width: 1920, height: 1080, data: new Uint8Array(1920 * 1080) };
    // index 只有距全 0 极远的模板 → maxDistance 内无命中 → 池空。
    const farIndex: IndexEntry[] = [{ valveId: 999, shortName: "far", phash: "ffffffffffffffff" }];
    const deps: ScanDeps = { index: farIndex, rect, ref: fakeRef(), cfg };
    const res = scanOnce(f, deps);
    expect(res.pool).toEqual([]);
    expect(res.recommendations).toEqual([]);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test --workspace main -- scan_once`
Expected: FAIL,报 `scan_once` 模块/`scanOnce` 找不到(Cannot find module `../../src/capture/scan_once`)。

- [ ] **Step 3: 写最小实现**

Create `main/src/capture/scan_once.ts`:

```typescript
// main/src/capture/scan_once.ts
// 手动单帧扫描:截屏后的一帧 → 识别 48 格技能池 → 桥接 Candidate → 打分排名。
// 有意绕过 runMonitorLoop 的 4 道连续监控门(①frame-diff ②layout_guard ③状态机 ④activeRow)。
// 手动是过渡形态,产品终态回连续监控时那 4 门重新启用(故 runMonitorLoop/layout_guard 保留不删)。
// 见 docs/superpowers/specs/2026-06-24-scan-once-core-design.md。
import { recognizePool } from "@ad/core/recognition/pool_recognize";
import { POOL_LAYOUT_RATIO } from "@ad/core/recognition/roi";
import { recommend } from "@ad/core/scoring/recommend";
import type { IndexEntry } from "@ad/core/recognition/index_store";
import type { GrayFrame } from "@ad/core/recognition/grid";
import type { ReferenceDb } from "@ad/core/db/reference";
import type { Candidate, ScoredCandidate, ScoringConfig } from "@ad/shared/types/scoring";
import type { PlayerState } from "@ad/shared/types/draft";
import type { WindowRect } from "../ffi/geometry";

// 识别命中阈值:与 runMonitorLoop 一致(真机标定 48/48,见 loop.ts 的 RECOGNIZE_MAX_DISTANCE)。
const RECOGNIZE_MAX_DISTANCE = 20;

// 无上下文纯池排名:还没人选技能 → me 空、pickIndex 未知。
// base/aghs/shard(看技能自身)信号照常;synergy(依赖已选)/pos(依赖 pickIndex)退化。
// 净结果 = 这局池子里单看技能客观强度的排序。上下文是后续增量(灌真实 me/pickIndex,函数不改)。
const EMPTY_ME: PlayerState = { row: 0, hero: null, normals: [], ultimates: [] };

export interface ScanResult {
  /** 识别到的候选池 valveId[](去重,铺平序)。 */
  pool: number[];
  /** 打分后 Top-K(按 score 降序)。 */
  recommendations: ScoredCandidate[];
}

export interface ScanDeps {
  index: IndexEntry[];
  ref: ReferenceDb;
  cfg: ScoringConfig;
  /** 游戏客户区矩形,供比例池布局推导像素。 */
  rect: WindowRect;
}

/** 单帧扫描:识别技能池 → 桥接 Candidate → 无上下文打分。不经过任何门。 */
export function scanOnce(frame: GrayFrame, deps: ScanDeps): ScanResult {
  // 1. 识别 48 格池(复用,已验证 48/48)。
  const pool = recognizePool(
    frame, deps.rect, deps.index, POOL_LAYOUT_RATIO, RECOGNIZE_MAX_DISTANCE,
  );
  // 2. 桥接:valveId[] → Candidate[]。recognizePool 不给 slotType,用 ref 现补。
  //    slotType 查不到的(理论上不该发生,识别出的 valveId 必在库)直接跳过,不进打分。
  const candidates: Candidate[] = [];
  for (const valveId of pool) {
    const slotType = deps.ref.slotType(valveId);
    if (slotType === null) continue;
    candidates.push({ valveId, slotType });
  }
  // 3. 打分(空 me / pickIndex=null = 无上下文纯池排名)。
  const recommendations = recommend(candidates, EMPTY_ME, null, deps.ref, deps.cfg);
  return { pool, recommendations };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test --workspace main -- scan_once`
Expected: PASS,2 个用例全绿。

- [ ] **Step 5: typecheck**

Run: `npm run typecheck --workspace main`
Expected: 无错误(确认类型对齐 Candidate/ScanDeps/ReferenceDb)。

- [ ] **Step 6: 提交**

```bash
git add main/src/capture/scan_once.ts main/tests/capture/scan_once.test.ts
git commit -m "$(cat <<'EOF'
feat(scan): scanOnce single-frame pool recognition + context-free scoring

Bypasses the 4 continuous-monitoring gates. Reuses recognizePool
(48/48 verified) + recommend (empty me/pickIndex). Synthetic-frame
regression test asserts pool non-empty, recommendations descending,
length <= topK.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: 临时 demo 入口(实时抓屏验证)

> 此任务先验证待决风险:`captureScreenGrayFrame` 用 Electron `desktopCapturer`,
> 裸 `tsx`/`node` 脚本中 `import { desktopCapturer } from "electron"` 在非 Electron 进程里
> 取不到值。**Step 1 先验证**,据结果二选一定 demo 形态。

**Files:**
- Create: `main/src/capture/scan_once_demo.ts`(临时,验证完即删)

**Interfaces:**
- Consumes:
  - `scanOnce`、`type ScanDeps` from `./scan_once`(Task 1)
  - `captureScreenGrayFrame()` from `./screen_source`
  - `loadIndex(path): IndexEntry[]` from `@ad/core/recognition/index_store`
  - `ReferenceDb`(`new ReferenceDb(path)`)from `@ad/core/db/reference`
  - `defaultScoringConfig(): ScoringConfig` from `@ad/core/scoring/config`
  - `findGameWindow()`、`gameClientRect(hwnd)` from `@ad/main/ffi/game_window`
- Produces: 无(临时诊断,不被其它任务依赖)。

- [ ] **Step 1: 验证 captureScreenGrayFrame 能否脱离 Electron 运行**

Run(从仓库根):
```bash
node -e "const e=require('electron'); console.log('desktopCapturer:', typeof e.desktopCapturer)"
```
判读:
- 打印 `desktopCapturer: object` → 极少见,可裸脚本(走 1A)。
- 打印 `desktopCapturer: undefined` 或 `electron` 解析为字符串路径(典型)→ **必须** app 内钩子(走 1B)。

> 默认走 **1B**(几乎可以确定):`electron` 在非 Electron 的 node 进程里 `require` 得到的是
> 可执行文件路径字符串,`desktopCapturer` 为 undefined。

- [ ] **Step 2(1B 路径):写 app 临时钩子**

在 `app/src/main/index.ts` 的 `did-finish-load` 回调里(现有诊断段附近,约 [index.ts:146](../../../app/src/main/index.ts)),
追加一段一次性 scanOnce 诊断。**Create `main/src/capture/scan_once_demo.ts`** 封装这段逻辑,
保持 index.ts 只加一行调用:

```typescript
// main/src/capture/scan_once_demo.ts
// 临时诊断:app 启动后跑一次 scanOnce 并把结果打到日志,验证识别+打分闭环。
// 验证完连同 index.ts 里的调用一起删除。
import { scanOnce, type ScanDeps } from "./scan_once";
import { captureScreenGrayFrame } from "./screen_source";
import { loadIndex } from "@ad/core/recognition/index_store";
import { ReferenceDb } from "@ad/core/db/reference";
import { defaultScoringConfig } from "@ad/core/scoring/config";
import type { WindowRect } from "../ffi/geometry";

/** 跑一次手动扫描并把可读结果交给 log。indexPath/dbPath 由调用方(index.ts)按已有逻辑解析。 */
export async function runScanOnceDemo(
  indexPath: string,
  dbPath: string,
  rect: WindowRect,
  log: (msg: string) => void,
): Promise<void> {
  let ref: ReferenceDb | null = null;
  try {
    const index = loadIndex(indexPath);
    ref = new ReferenceDb(dbPath);
    const deps: ScanDeps = { index, ref, cfg: defaultScoringConfig(), rect };
    // valveId → shortName 用 index(IndexEntry 自带 shortName),ReferenceDb 无此方法。
    const nameOf = new Map(index.map((e) => [e.valveId, e.shortName]));
    const frame = await captureScreenGrayFrame();
    const res = scanOnce(frame, deps);
    const names = res.pool.map((v) => `${v}:${nameOf.get(v) ?? "?"}`).join(", ");
    log(`[scan-once] 识别到 ${res.pool.length} 个技能: [${names}]`);
    log(`[scan-once] 推荐 Top-${res.recommendations.length}:`);
    res.recommendations.forEach((r, i) => {
      const bd = Object.entries(r.breakdown).map(([k, v]) => `${k}:${(v as number).toFixed(2)}`).join(", ");
      log(`[scan-once]   #${i + 1} valveId=${r.candidate.valveId} score=${r.score.toFixed(3)} {${bd}}`);
    });
  } catch (err) {
    log(`[scan-once] 失败: ${err}`);
  } finally {
    try { ref?.close(); } catch { /* 忽略关闭期错误 */ }
  }
}
```

> 注:`IndexEntry` 自带 `shortName`(`ReferenceDb` 无此方法),故用 index 建 valveId→name 映射;
> 查不到回落 `"?"`,不阻塞验证(valveId 本身已足够肉眼核对)。

- [ ] **Step 3(1B 路径):在 index.ts 接钩子**

在 `app/src/main/index.ts` 顶部 import 区加:
```typescript
import { runScanOnceDemo } from "@ad/main/capture/scan_once_demo";
```
在 `did-finish-load` 回调内、现有 `debug-cells` 诊断之后追加一行(`resolveModelPaths()` 与 `liveRect` 均为现有局部变量):
```typescript
    // 临时:启动后跑一次手动扫描诊断(验证识别+打分闭环)。验证完删除本行 + scan_once_demo.ts。
    const { index: idxPath, db: dbP } = resolveModelPaths();
    void runScanOnceDemo(idxPath, dbP, liveRect, diag);
```

- [ ] **Step 4: typecheck 两个包**

Run: `npm run typecheck --workspace main` 和(若 app 有 typecheck 脚本)`npm run typecheck --workspace app`
Expected: 无错误。若 app 无 typecheck 脚本,跳过,靠 Step 5 的 dev 启动暴露类型问题。

- [ ] **Step 5: 真机验证(手动)**

前置:Dota 2 开在 Ability Draft 选取界面(无边框窗口,见全屏设计基准)。
Run: `npm run dev`(从仓库根,启动 app)。
查看 `app/.live.log`,确认出现:
- `[scan-once] 识别到 N 个技能: [...]`,N 接近 48(理想全中)。
- `[scan-once] 推荐 Top-K`,列出 valveId + score + breakdown,score 降序。
肉眼判断:排在前面的是不是真的强技能。

> 这是 mock 触发(手敲 `npm run dev` 代替用户按键)+ 真实抓屏帧 → 等价真机识别+打分输入。

- [ ] **Step 6: 提交(保留 demo 供迭代,标记临时)**

```bash
git add main/src/capture/scan_once_demo.ts app/src/main/index.ts
git commit -m "$(cat <<'EOF'
chore(scan): temp scanOnce demo hook for live-frame verification

App-startup one-shot scanOnce against a real captured frame, logs
recognized pool + Top-K to .live.log. Mock trigger (npm run dev) +
real desktopCapturer frame. Remove demo + index.ts call once verified.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

**1. Spec coverage:**
- scanOnce 纯函数(识别→桥接→打分) → Task 1 ✅
- 无上下文纯池排名(空 me/pickIndex=null) → Task 1 Step 3 `EMPTY_ME` ✅
- 桥接 valveId[]→Candidate[](ref.slotType) → Task 1 Step 3 ✅
- 复用 recognizePool/recommend 不改 → Task 1(仅 import) ✅
- 合成帧回归单测(非空+降序+≤topK) → Task 1 Step 1 ✅
- demo 实时抓屏验证 → Task 2 ✅
- desktopCapturer Electron 依赖风险(裸脚本 vs app 钩子) → Task 2 Step 1 验证 + 1B 默认路径 ✅
- 4 门/runMonitorLoop/layout_guard 零改动保留 → 全程不触碰,注释写明意图 ✅
- ScanDeps 不含 pool(绕开空数组坑) → Task 1 Step 3 类型 ✅

**2. Placeholder scan:** 无 TBD/TODO/"add error handling"。所有测试与实现均为完整代码。Task 2 的 1A 分支故意不展开成完整脚本——因为它几乎确定不会走(Step 1 验证为 1B);若真为 1A,裸脚本 = 把 `runScanOnceDemo` 体直接放进一个加 `main()` 调用的脚本,逻辑同 1B 已给的封装。

**3. Type consistency:**
- `ScanResult { pool: number[]; recommendations: ScoredCandidate[] }` — Task 1 定义,Task 2 消费(`res.pool`/`res.recommendations`)一致 ✅
- `ScanDeps { index, ref, cfg, rect }` — Task 1 定义,Task 2 构造一致 ✅
- `recommend(pool, me, pickIndex, q, cfg)` 五参 — Task 1 Step 3 调用 `recommend(candidates, EMPTY_ME, null, deps.ref, deps.cfg)` 对齐 ✅
- `ReferenceDb.slotType(v): SlotType | null` — 测试 fakeRef 与实现调用一致 ✅
- `recognizePool(frame, rect, index, layout, maxDistance)` 五参 — 调用对齐 ✅
