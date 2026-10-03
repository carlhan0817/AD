# 阶段 2 · 持续监控(差异化 1)实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: 用 superpowers:subagent-driven-development(推荐)或 superpowers:executing-plans 逐任务执行。步骤用 `- [ ]` 复选框跟踪。前置:阶段 0(`pipeline/out/reference.db`)与阶段 1(`core/src/recognition/*`、`core/src/db/reference.ts`)已落地。先读 `...-00-project-structure-and-roadmap.md` §2/§4 与计划书 §四。

**Goal:** 从进入选取界面起持续监控,经 frame-diff 门控 + 多 ROI 识别 + 四层无效帧防护,驱动一个「双重条件提交 + 状态对账」的草稿状态机,逐玩家记账(1 英雄 + 3 普通 + 1 终极),全程自动追踪一局选取并能从单个好帧自愈。

**Architecture:** 把所有判定逻辑下沉为 `core/` 纯函数(Vitest 可测,零 Electron):frame-diff、ROI 裁剪规格、Active Picker 探头、布局/遮挡校验、草稿状态机。Electron 侧 `main/` 只保留一个薄捕获循环把帧喂给纯逻辑。状态机设计成「可由任意一个好帧整帧重建」——对账而非事件溯源,丢帧不雪崩。实时草稿状态纯内存,对局结束销毁,绝不进库。

**Tech Stack:** TypeScript、Vitest(core 纯逻辑);`main/` 侧 `screenshot-desktop` + sharp(薄捕获层,手动冒烟)。复用阶段 1 的 `cropRaw`/`cropGrid`/`resizeGrayTo32`/`recognizeCell`/`ReferenceDb`。

---

## 关键设计决策

- **状态机是对账机,不是事件机。** 每个有效帧整帧重读 [当前 Active Picker + 十行槽位占用快照],与内存模型 diff 对账重建,而非「必须看到每一次转移」。这是计划书 §四「从事件溯源转向状态对账」的硬要求——只要拿到一个干净帧就能重新同步,丢帧最多造成短暂滞后,不会永久错位。
- **双重条件提交。** 合法转移须同时满足:① Active Picker 指示轮到玩家 A;② A 行出现新技能。冲突(新技能在 B 行但 UI 说轮到 A)判为误识别/帧伪影,**不提交**,走对账。
- **四层无效帧防护(计划书 §四)。** ① ROI 内 diff(非全屏);② 布局/遮挡校验(锚点不可见 → 保持上次有效状态);③ 时序一致性(连续 N 帧一致才提交);④ 状态机只接受合法单调转移(池只收缩、已选只增、落入合法槽位)。
- **纯逻辑与 Electron 严格隔离。** 所有可测判定在 `core/`;`main/` 捕获循环只做「截屏 → 转灰度 → 调 core 纯函数 → 持有内存状态」,无业务判定,故只手动冒烟。
- **slot_type 不在状态机重判。** 状态机拿到 `valveId` 后一律查阶段 1 的 `ReferenceDb.slotType()`(计划书 §一)。

---

## 文件结构

| 文件 | 职责 |
|---|---|
| `shared/types/draft.ts` | 跨层类型:`SlotType`、`PlayerState`、`DraftState`、`ActivePicker`、`SlotOccupancy`、`FrameObservation` |
| `core/src/recognition/frame_diff.ts` | ROI 内像素 hash 比对 + debounce(纯逻辑) |
| `core/src/recognition/roi.ts` | 多 ROI 规格:选取池 / 十行已选槽 / 计时 / Active Picker 高亮框(复用 `GridSpec`) |
| `core/src/recognition/active_picker.ts` | Active Picker 探头:固定高亮色 + 边框模板/颜色匹配,无需 NN |
| `core/src/recognition/layout_guard.ts` | 布局/遮挡校验:UI 锚点可见性 → 有效帧判定 |
| `core/src/statemachine/quota.ts` | 逐玩家配额记账(1 英雄 + 3 普通 + 1 终极) |
| `core/src/statemachine/reconcile.ts` | 整帧对账:由 `FrameObservation` 重建 `DraftState` |
| `core/src/statemachine/draft.ts` | 草稿状态机:时序一致性缓冲 + 双重条件提交 + 调对账 |
| `main/src/capture/loop.ts` | 低 Hz 捕获循环(薄 Electron 层,手动冒烟) |
| `main/src/capture/frame_source.ts` | 截屏 → `GrayFrame`(复用阶段 1 `toGrayFrame`) |
| `core/tests/**` | Vitest 测试 |

---

## Task 1: 草稿领域类型(shared/types/draft.ts)

先把全阶段共用的类型钉死。所有后续任务引用这些类型,**类型名/字段名不可在后续任务里漂移**。

**Files:**
- Create: `shared/types/draft.ts`
- Create: `shared/package.json`
- Create: `shared/tsconfig.json`
- Test: `core/tests/statemachine/types.test.ts`

- [ ] **Step 1: 写 shared 工程骨架**

`shared/package.json`:
```json
{
  "name": "@ad/shared",
  "version": "0.1.0",
  "type": "module",
  "main": "types/index.ts",
  "exports": {
    "./types/draft": "./types/draft.ts"
  }
}
```

`shared/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022", "module": "ESNext", "moduleResolution": "Bundler",
    "strict": true, "esModuleInterop": true, "skipLibCheck": true,
    "declaration": true, "outDir": "dist"
  },
  "include": ["types"]
}
```

- [ ] **Step 2: 写类型定义**

```ts
// shared/types/draft.ts
// 草稿领域类型(跨 core/main/renderer 共用)。计划书 §一/§四。
// slot_type 与阶段 1 ReferenceDb.SlotType 同集合;此处独立声明避免 core→shared 反向依赖。

export type SlotType = "hero" | "normal" | "ultimate";

/** 一名玩家的配额记账。剩余配额 = 上限 - 已用。 */
export interface PlayerState {
  /** 玩家行索引 0..9(对齐十行 UI 顺序)。 */
  row: number;
  /** 已选英雄的 valveId(负数 = -heroId);未选为 null。 */
  hero: number | null;
  /** 已选普通技能的 valveId 列表(正数),上限 3。 */
  normals: number[];
  /** 已选终极技能的 valveId 列表(正数),上限 1。 */
  ultimates: number[];
}

/** 配额上限(AD 模式硬约束:1 英雄 + 3 普通 + 1 终极)。 */
export const QUOTA = { hero: 1, normal: 3, ultimate: 1 } as const;

/** Active Picker 探头读出的「当前轮到谁」。none = 本帧未检出高亮(可能动画中)。 */
export interface ActivePicker {
  /** 当前活动玩家行;未检出为 null。 */
  row: number | null;
}

/** 单行槽位占用快照(整帧重读,用于对账)。 */
export interface SlotOccupancy {
  row: number;
  hero: number | null;
  normals: number[];
  ultimates: number[];
}

/** 一个有效帧的整帧观察结果,喂给对账器。 */
export interface FrameObservation {
  activePicker: ActivePicker;
  /** 十行槽位占用(长度 10)。 */
  slots: SlotOccupancy[];
}

/** 完整草稿状态。生命周期 = 一局,纯内存,不落库。 */
export interface DraftState {
  players: PlayerState[]; // 长度 10
  /** 当前轮到的玩家行;未知为 null。 */
  activeRow: number | null;
}
```

- [ ] **Step 3: 写类型烟囱测试(确保 core 能 import)**

```ts
// core/tests/statemachine/types.test.ts
import { describe, it, expect } from "vitest";
import { QUOTA, type DraftState } from "@ad/shared/types/draft";

describe("draft types", () => {
  it("QUOTA encodes 1 hero + 3 normal + 1 ultimate", () => {
    expect(QUOTA).toEqual({ hero: 1, normal: 3, ultimate: 1 });
  });
  it("DraftState shape is usable", () => {
    const s: DraftState = { players: [], activeRow: null };
    expect(s.activeRow).toBeNull();
  });
});
```

- [ ] **Step 4: 让 core 能解析 `@ad/shared`**

在 `core/tsconfig.json` 的 `compilerOptions` 加 path 映射(若无 `paths` 则新增):
```json
"baseUrl": ".",
"paths": { "@ad/shared/*": ["../shared/*"] }
```
并在 `core/vitest.config.ts` 加 resolve alias:
```ts
// core/vitest.config.ts
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
export default defineConfig({
  test: { environment: "node" },
  resolve: {
    alias: {
      "@ad/shared": fileURLToPath(new URL("../shared", import.meta.url)),
    },
  },
});
```

- [ ] **Step 5: 跑测试确认通过**

Run(在 `core/` 下):`npx vitest run statemachine/types`
Expected: PASS(2 passed)。

- [ ] **Step 6: Commit**

```bash
git add shared/types/draft.ts shared/package.json shared/tsconfig.json core/tests/statemachine/types.test.ts core/tsconfig.json core/vitest.config.ts
git commit -m "feat(shared): draft domain types (PlayerState/DraftState/FrameObservation)"
```

---

## Task 2: 逐玩家配额记账(statemachine/quota.ts)

把「1 英雄 + 3 普通 + 1 终极」的剩余配额计算固化为纯函数。后续硬过滤(阶段 3)与合法性校验都依赖它。

**Files:**
- Create: `core/src/statemachine/quota.ts`
- Test: `core/tests/statemachine/quota.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// core/tests/statemachine/quota.test.ts
import { describe, it, expect } from "vitest";
import { remainingQuota, isFull, emptyPlayer } from "../../src/statemachine/quota";
import type { PlayerState } from "@ad/shared/types/draft";

describe("quota", () => {
  it("empty player has full remaining quota", () => {
    const p = emptyPlayer(0);
    expect(remainingQuota(p)).toEqual({ hero: 1, normal: 3, ultimate: 1 });
  });

  it("counts used slots toward remaining", () => {
    const p: PlayerState = { row: 0, hero: -9, normals: [5051, 5048], ultimates: [] };
    expect(remainingQuota(p)).toEqual({ hero: 0, normal: 1, ultimate: 1 });
  });

  it("isFull true only when all three quotas exhausted", () => {
    const partial: PlayerState = { row: 0, hero: -9, normals: [1, 2, 3], ultimates: [] };
    const full: PlayerState = { row: 0, hero: -9, normals: [1, 2, 3], ultimates: [99] };
    expect(isFull(partial)).toBe(false);
    expect(isFull(full)).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run:`npx vitest run statemachine/quota`
Expected: FAIL,模块不存在。

- [ ] **Step 3: 最小实现**

```ts
// core/src/statemachine/quota.ts
import { QUOTA, type PlayerState } from "@ad/shared/types/draft";

export interface RemainingQuota { hero: number; normal: number; ultimate: number; }

export function emptyPlayer(row: number): PlayerState {
  return { row, hero: null, normals: [], ultimates: [] };
}

export function remainingQuota(p: PlayerState): RemainingQuota {
  return {
    hero: QUOTA.hero - (p.hero === null ? 0 : 1),
    normal: QUOTA.normal - p.normals.length,
    ultimate: QUOTA.ultimate - p.ultimates.length,
  };
}

export function isFull(p: PlayerState): boolean {
  const r = remainingQuota(p);
  return r.hero === 0 && r.normal === 0 && r.ultimate === 0;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run:`npx vitest run statemachine/quota`
Expected: PASS(3 passed)。

- [ ] **Step 5: Commit**

```bash
git add core/src/statemachine/quota.ts core/tests/statemachine/quota.test.ts
git commit -m "feat(core): per-player slot quota accounting"
```

---

## Task 3: ROI 内 frame-diff 门控(recognition/frame_diff.ts)

只对 ROI 区域算一个轻量像素 hash。**第一层无效帧防护**,核心是**真正的防抖(debounce),不是节流(throttle)**。

> **⚠️ 关键修正:节流 → 防抖。** Dota 2 选人有「飞入动画」(技能图标飞入槽位,持续数帧)。**错误做法(节流)**:画面一变就放行第一帧并进冷却——会把动画刚开始的「半截废帧」喂去识别,而动画结束、画面真正稳定的「最终有效帧」恰好撞在冷却期被丢弃 → **永久漏检这次抓取**。**正确做法(防抖)**:画面变 → 重置稳定计数器、丢弃当前帧;画面静止 → 计数器 +1;**只有连续 N 帧绝对静止**才认定动画结束,放行此刻的「最终稳定帧」。每段静止只放行一次(放行后不再重复放行,直到下次变化)。

**Files:**
- Create: `core/src/recognition/frame_diff.ts`
- Test: `core/tests/recognition/frame_diff.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// core/tests/recognition/frame_diff.test.ts
import { describe, it, expect } from "vitest";
import { roiHash, FrameGate } from "../../src/recognition/frame_diff";

function block(v: number, n = 16): number[][] {
  return Array.from({ length: n }, () => Array(n).fill(v));
}

describe("roiHash", () => {
  it("is stable for identical blocks", () => {
    expect(roiHash(block(100))).toBe(roiHash(block(100)));
  });
  it("differs for different blocks", () => {
    expect(roiHash(block(100))).not.toBe(roiHash(block(200)));
  });
});

describe("FrameGate (true debounce)", () => {
  it("does NOT pass a freshly-changed frame; waits for stability", () => {
    const gate = new FrameGate(2); // 需连续 2 帧静止才放行
    expect(gate.shouldProcess([block(50)])).toBe(false); // 首帧:才刚出现,未达稳定数
    expect(gate.shouldProcess([block(50)])).toBe(true);  // 连续第 2 帧静止 → 放行最终稳定帧
  });

  it("passes a settled frame only once, then stays quiet until next change", () => {
    const gate = new FrameGate(2);
    gate.shouldProcess([block(50)]);                      // false(稳定计数 1)
    expect(gate.shouldProcess([block(50)])).toBe(true);  // true(稳定计数 2,放行)
    expect(gate.shouldProcess([block(50)])).toBe(false); // 仍静止,但已放行过 → 不重复
    expect(gate.shouldProcess([block(50)])).toBe(false);
  });

  it("drops mid-animation frames and only releases the final stable frame", () => {
    const gate = new FrameGate(2);
    // 动画中:每帧都在变(50→51→52),全部丢弃(每变一次稳定计数重置为 1)
    expect(gate.shouldProcess([block(50)])).toBe(false); // 变(初始),计数 1
    expect(gate.shouldProcess([block(51)])).toBe(false); // 变,重置计数 1
    expect(gate.shouldProcess([block(52)])).toBe(false); // 变,重置计数 1(=本内容第 1 帧)
    // 动画结束,画面稳定在 52:再来 1 帧相同即达连续 2 帧 → 放行最终稳定帧 52
    expect(gate.shouldProcess([block(52)])).toBe(true);  // 计数 2 → 放行
    expect(gate.shouldProcess([block(52)])).toBe(false); // 已放行,不重复
  });

  it("treats any ROI change as motion (resets stability)", () => {
    const gate = new FrameGate(2);
    gate.shouldProcess([block(50), block(10)]);          // false(变,计数 1)
    // 第二个 ROI 变了 → 视为运动,重置计数为本内容第 1 帧
    expect(gate.shouldProcess([block(50), block(11)])).toBe(false); // 变,计数 1
    expect(gate.shouldProcess([block(50), block(11)])).toBe(true);  // 相同,计数 2 → 放行
  });

  it("stabilityFrames=1 passes on the first still frame after a change", () => {
    const gate = new FrameGate(1);
    expect(gate.shouldProcess([block(5)])).toBe(true);   // 出现即视为「1 帧静止」→ 放行
    expect(gate.shouldProcess([block(5)])).toBe(false);  // 已放行,不重复
    expect(gate.shouldProcess([block(9)])).toBe(true);   // 新画面,再 1 帧静止 → 放行
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run:`npx vitest run recognition/frame_diff`
Expected: FAIL,模块不存在。

- [ ] **Step 3: 最小实现**

```ts
// core/src/recognition/frame_diff.ts
// ROI 内像素 hash + 真正的防抖(第一层无效帧防护,计划书 §四)。
// 防抖语义:画面变 → 重置稳定计数、丢帧;静止 → 计数 +1;连续 stabilityFrames 帧静止
// 才放行「最终稳定帧」,且每段静止只放行一次。绝不放行动画中的半截废帧。

/** 轻量 FNV-1a over 像素,够区分「画面是否变了」,不需密码学强度。 */
export function roiHash(roi: number[][]): string {
  let h = 0x811c9dc5;
  for (const row of roi) {
    for (const v of row) {
      h ^= v & 0xff;
      h = Math.imul(h, 0x01000193) >>> 0;
    }
  }
  return h.toString(16).padStart(8, "0");
}

export class FrameGate {
  private last: string[] | null = null;
  private stableCount = 0;   // 当前画面已连续静止多少帧
  private released = false;   // 本段静止是否已放行过(防重复)

  /** stabilityFrames: 需连续静止多少帧才认定动画结束、放行最终稳定帧(≥1)。 */
  constructor(private readonly stabilityFrames = 3) {}

  /** rois: 本帧各 ROI 的灰度块。任一 ROI 的 hash 变化即「画面在动」。
   *  返回 true 仅当:画面已连续静止达 stabilityFrames 帧,且本段尚未放行过。 */
  shouldProcess(rois: number[][][]): boolean {
    const hashes = rois.map(roiHash);
    const changed =
      this.last === null ||
      hashes.length !== this.last.length ||
      hashes.some((h, i) => h !== this.last![i]);
    this.last = hashes;

    if (changed) {
      // 画面在动:重置稳定计数 + 放行标记,丢弃本帧。
      this.stableCount = 1; // 本帧本身算这段静止的第 1 帧
      this.released = false;
      // stabilityFrames=1 时:出现即满足「1 帧静止」,可立即放行。
      if (this.stableCount >= this.stabilityFrames && !this.released) {
        this.released = true;
        return true;
      }
      return false;
    }

    // 画面静止:累计。
    this.stableCount += 1;
    if (!this.released && this.stableCount >= this.stabilityFrames) {
      this.released = true; // 放行最终稳定帧,本段不再重复
      return true;
    }
    return false;
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run:`npx vitest run recognition/frame_diff`
Expected: PASS(7 passed)。

- [ ] **Step 5: Commit**

```bash
git add core/src/recognition/frame_diff.ts core/tests/recognition/frame_diff.test.ts
git commit -m "fix(core): frame gate is true debounce (release final stable frame, not first changed)"
```

---

## Task 4: 多 ROI 规格(recognition/roi.ts)

定义本阶段所有观察区:选取池(英雄+技能混合)、十行已选槽、回合计时、Active Picker 高亮框。复用阶段 1 的 `GridSpec`/`cropRaw`/`cropGrid`。坐标本阶段对 1920×1080 手填(分辨率映射留阶段 4)。

> **⚠️ 关键修正:英雄槽与技能槽必须物理解耦,不能用统一定宽正方形网格。** 玩家单行的 5 个已选槽 = **1 个英雄 + 4 个技能**;但**英雄头像是长方形**(约 128:72 / 256:144),**技能图标是正方形**(1:1)。若用统一 48×48 正方形网格去截首个槽(英雄头像),会把头像左右切掉 → 输入被裁错/挤压变形 → 该位的 pHash 频率特征错乱 → **识别率归零(雪崩)**。修正:`DraftLayout` 把同一行解耦为:
> - `heroSlot`:独立**长方形**坐标 + 宽高(1080p 占位 `85×48`)。
> - `abilitySlots`:`1×4` **正方形**网格(`48×48` + 固定间距)。
> 英雄裁出的长方形子矩形仍经共享 `resizeGrayTo32` 缩放到 32×32 喂 pHash——关键是**裁的是完整长方形头像**,而非被切掉两边的正方形。建索引侧的英雄 mini 头像同样走「原始裁切 → resize 32×32」,两端一致(阶段 1 共享缩放核)。

**Files:**
- Create: `core/src/recognition/roi.ts`
- Test: `core/tests/recognition/roi.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// core/tests/recognition/roi.test.ts
import { describe, it, expect } from "vitest";
import { LAYOUT_1080P, poolCells, slotRowCells, diffRois } from "../../src/recognition/roi";
import type { GrayFrame } from "../../src/recognition/grid";

function frame(w: number, h: number): GrayFrame {
  return { width: w, height: h, data: new Uint8Array(w * h) };
}

describe("roi layout", () => {
  it("pool grid yields rows*cols 32x32 cells", () => {
    const cells = poolCells(frame(1920, 1080), LAYOUT_1080P);
    const spec = LAYOUT_1080P.pool;
    expect(cells.length).toBe(spec.rows * spec.cols);
    expect(cells[0].length).toBe(32);
  });

  it("hero slot is rectangular, ability slots are square (decoupled)", () => {
    // 英雄槽长方形(宽≠高);技能槽正方形(宽=高)
    expect(LAYOUT_1080P.heroSlot.w).not.toBe(LAYOUT_1080P.heroSlot.h);
    expect(LAYOUT_1080P.abilitySlots.cellW).toBe(LAYOUT_1080P.abilitySlots.cellH);
    expect(LAYOUT_1080P.abilitySlots.cols).toBe(4); // 4 个技能槽
  });

  it("slotRowCells returns 10 rows, each with a hero cell + 4 ability cells, all 32x32", () => {
    const rows = slotRowCells(frame(1920, 1080), LAYOUT_1080P);
    expect(rows.length).toBe(10);
    expect(rows[0].hero.length).toBe(32);        // 英雄长方形 → resize 32x32
    expect(rows[0].hero[0].length).toBe(32);
    expect(rows[0].abilities.length).toBe(4);    // 4 个技能格
    expect(rows[0].abilities[0].length).toBe(32);
  });

  it("diffRois returns the gate-watched sub-blocks (pool + slots + timer)", () => {
    const rois = diffRois(frame(1920, 1080), LAYOUT_1080P);
    expect(rois.length).toBeGreaterThanOrEqual(3);
    expect(Array.isArray(rois[0])).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run:`npx vitest run recognition/roi`
Expected: FAIL,模块不存在。

- [ ] **Step 3: 最小实现**

```ts
// core/src/recognition/roi.ts
// 多 ROI 规格 + 裁剪。坐标对 1920x1080 手填;阶段 4 升级为按窗口尺寸推导。
// 英雄槽(长方形)与技能槽(正方形)物理解耦,避免对长方形头像做正方形裁切→形变→雪崩。
import { cropRaw, cropGrid, type GrayFrame, type GridSpec } from "./grid";
import { resizeGrayTo32 } from "./resize"; // 共享双线性缩放(阶段 1),与建索引侧同核

/** 矩形 ROI。 */
export interface Rect { x: number; y: number; w: number; h: number; }

export interface DraftLayout {
  /** 英雄+技能混合选取池网格(正方形格)。 */
  pool: GridSpec;
  /** 单行第 0 槽:英雄头像(**长方形**,独立宽高)。 */
  heroSlot: Rect;
  /** 单行第 1..4 槽:4 个技能(**正方形** 1×4 网格)。 */
  abilitySlots: GridSpec;
  /** 行间纵向步距(从第 r 行到第 r+1 行)。 */
  rowPitch: number;
  /** 回合计时 ROI(矩形)。 */
  timer: Rect;
  /** Active Picker 高亮边框扫描带(覆盖十行行首,用于颜色匹配)。 */
  pickerStrip: Rect;
}

// 占位标定值(阶段 2 手填,阶段 4 由窗口尺寸推导覆盖)。
// heroSlot 长方形(85×48);abilitySlots 正方形(48×48,cols=4)。
export const LAYOUT_1080P: DraftLayout = {
  pool: { x: 480, y: 200, cellW: 64, cellH: 64, gapX: 8, gapY: 8, rows: 4, cols: 12 },
  heroSlot: { x: 1300, y: 180, w: 85, h: 48 },
  abilitySlots: { x: 1392, y: 180, cellW: 48, cellH: 48, gapX: 4, gapY: 0, rows: 1, cols: 4 },
  rowPitch: 60,
  timer: { x: 900, y: 60, w: 120, h: 48 },
  pickerStrip: { x: 1260, y: 180, w: 30, h: 600 },
};

/** 单行的已选槽识别格:英雄(长方形裁切→32×32)+ 4 个技能(正方形→32×32)。 */
export interface SlotRowCells {
  hero: number[][];          // 32×32
  abilities: number[][][];   // 4 个 32×32
}

/** 选取池每格(已缩放到 32x32),供识别。 */
export function poolCells(frame: GrayFrame, layout: DraftLayout): number[][][] {
  return cropGrid(frame, layout.pool);
}

/** 十行已选槽。每行:英雄长方形单独裁切缩放,技能走 1×4 正方形网格。 */
export function slotRowCells(frame: GrayFrame, layout: DraftLayout): SlotRowCells[] {
  const out: SlotRowCells[] = [];
  for (let r = 0; r < 10; r++) {
    const dy = r * layout.rowPitch;
    // 英雄:裁完整长方形子矩形(不切边),再共享双线性缩放到 32×32。
    const heroRaw = cropRaw(frame, layout.heroSlot.x, layout.heroSlot.y + dy,
                            layout.heroSlot.w, layout.heroSlot.h);
    const hero = resizeGrayTo32(heroRaw);
    // 技能:1×4 正方形网格(cropGrid 内部已 resize 32×32)。
    const abilities = cropGrid(frame, { ...layout.abilitySlots, y: layout.abilitySlots.y + dy });
    out.push({ hero, abilities });
  }
  return out;
}

/** 门控用的原始(不缩放)ROI 块:池左上、十行槽带、计时器。 */
export function diffRois(frame: GrayFrame, layout: DraftLayout): number[][][] {
  const pool = cropRaw(frame, layout.pool.x, layout.pool.y, 64, 64);
  // 槽带覆盖英雄槽起点到 4 个技能槽末端,纵向覆盖十行。
  const slotsW = layout.abilitySlots.x + layout.abilitySlots.cols *
    (layout.abilitySlots.cellW + layout.abilitySlots.gapX) - layout.heroSlot.x;
  const slots = cropRaw(frame, layout.heroSlot.x, layout.heroSlot.y, slotsW, 10 * layout.rowPitch);
  const timer = cropRaw(frame, layout.timer.x, layout.timer.y, layout.timer.w, layout.timer.h);
  return [pool, slots, timer];
}
```

> **注:** `resizeGrayTo32` 直接从阶段 1 的 `./resize` import(权威双线性核,与建索引侧逐位一致)。英雄长方形头像走「`cropRaw` 完整裁切 → `resizeGrayTo32`」,与建索引侧英雄 mini 头像同一管线,pHash 才对得上。

- [ ] **Step 4: 跑测试确认通过**

Run:`npx vitest run recognition/roi`
Expected: PASS(3 passed)。

- [ ] **Step 5: Commit**

```bash
git add core/src/recognition/roi.ts core/tests/recognition/roi.test.ts
git commit -m "feat(core): multi-ROI layout spec + crops for draft monitoring"
```

---

## Task 5: Active Picker 探头(recognition/active_picker.ts)

Dota 2 UI 用固定高亮边框标识「当前轮到谁」。探头很轻:在 `pickerStrip` 扫描带里找哪一行的高亮色像素占比最高 → 该行就是 Active Picker。无需 NN(计划书 §四)。注意:本探头需要**彩色**信息(高亮色),故输入是 RGB 行带,不是灰度。

> **⚠️ 关键修正:通道步长不可硬编码 `*3`。** `screenshot-desktop` + sharp 取 raw buffer **默认带 Alpha(RGBA,4 字节/像素)**。若按 3 字节步长去读 4 字节数组,像素坐标会灾难性偏移,探头完全找不到高亮框。两道防线:
> 1. **入口规范通道**:采集 `pickerStrip` 的彩色 buffer 时,sharp 必须显式 `.removeAlpha()`,保证传进来的就是纯 RGB(见 Step 3 末的 `frameToRgbStrip` 约定 + 阶段 4 接线)。
> 2. **类型自带 `channels` 并断言**:`RgbStrip` 携带 `channels`,`detectActivePicker` 用它算步长并**断言 `channels === 3`**——拿到 4 通道直接抛错(fail loud),绝不静默错位。

**Files:**
- Create: `core/src/recognition/active_picker.ts`
- Test: `core/tests/recognition/active_picker.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// core/tests/recognition/active_picker.test.ts
import { describe, it, expect } from "vitest";
import { detectActivePicker, type RgbStrip, HIGHLIGHT } from "../../src/recognition/active_picker";

// 构造一个 10 行的彩色扫描带(纯 RGB,3 通道),只有第 row 行充满高亮色。
function strip(rowWithHighlight: number, rows = 10): RgbStrip {
  const rowH = 4, w = 3, channels = 3;
  const h = rows * rowH;
  const data = new Uint8Array(w * h * channels);
  for (let y = 0; y < h; y++) {
    const r = Math.floor(y / rowH);
    const c = r === rowWithHighlight ? HIGHLIGHT : { r: 20, g: 20, b: 20 };
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * channels;
      data[i] = c.r; data[i + 1] = c.g; data[i + 2] = c.b;
    }
  }
  return { width: w, height: h, rows, channels, data };
}

describe("detectActivePicker", () => {
  it("returns the highlighted row", () => {
    expect(detectActivePicker(strip(3)).row).toBe(3);
  });
  it("returns null when no row is highlighted", () => {
    expect(detectActivePicker(strip(-1)).row).toBeNull();
  });
  it("throws on a 4-channel (RGBA) strip instead of silently mis-offsetting", () => {
    const bad = { ...strip(3), channels: 4 };
    expect(() => detectActivePicker(bad)).toThrow(/RGB/i);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run:`npx vitest run recognition/active_picker`
Expected: FAIL,模块不存在。

- [ ] **Step 3: 最小实现**

```ts
// core/src/recognition/active_picker.ts
// Active Picker 高亮行探头(颜色匹配,无 NN)。顺位的权威真相(计划书 §四)。
// 通道步长由 strip.channels 决定,并断言为 3(纯 RGB)——杜绝 RGBA 偏移。
import type { ActivePicker } from "@ad/shared/types/draft";

export interface RgbStrip {
  width: number;
  height: number;
  rows: number;          // 行数(通常 10)
  channels: number;      // 每像素字节数;本探头要求 === 3(纯 RGB)
  data: Uint8Array;      // length = width*height*channels
}

/** Dota 2 Active Picker 高亮色近似值(实测可微调)。 */
export const HIGHLIGHT = { r: 240, g: 200, b: 90 };

/** 颜色距离阈值(曼哈顿距离)。 */
const COLOR_TOL = 90;
/** 一行被判为「高亮」所需的高亮像素占比下限。 */
const MIN_RATIO = 0.25;

function isHighlight(r: number, g: number, b: number): boolean {
  return (
    Math.abs(r - HIGHLIGHT.r) + Math.abs(g - HIGHLIGHT.g) + Math.abs(b - HIGHLIGHT.b) <=
    COLOR_TOL
  );
}

export function detectActivePicker(strip: RgbStrip): ActivePicker {
  if (strip.channels !== 3) {
    throw new Error(
      `active_picker expects pure RGB (channels=3), got channels=${strip.channels}. ` +
      `Call sharp(...).removeAlpha() before building the strip.`,
    );
  }
  const stride = strip.channels;
  const rowH = Math.floor(strip.height / strip.rows);
  let bestRow = -1;
  let bestRatio = 0;
  for (let r = 0; r < strip.rows; r++) {
    let hit = 0;
    let total = 0;
    for (let y = r * rowH; y < (r + 1) * rowH; y++) {
      for (let x = 0; x < strip.width; x++) {
        const i = (y * strip.width + x) * stride;
        if (isHighlight(strip.data[i], strip.data[i + 1], strip.data[i + 2])) hit += 1;
        total += 1;
      }
    }
    const ratio = total === 0 ? 0 : hit / total;
    if (ratio > bestRatio) {
      bestRatio = ratio;
      bestRow = r;
    }
  }
  return { row: bestRatio >= MIN_RATIO ? bestRow : null };
}
```

> **采集侧约定(阶段 4 接线时落地,此处先钉死契约):** `main/` 侧从截图裁出 `pickerStrip` 的彩色 buffer 时,**必须**:
> ```ts
> const { data, info } = await sharp(png)
>   .extract({ left: strip.x, top: strip.y, width: strip.w, height: strip.h })
>   .removeAlpha()            // ← 强制 3 通道,杜绝 RGBA 偏移
>   .raw().toBuffer({ resolveWithObject: true });
> // info.channels 此时应为 3;据此构 RgbStrip { ..., channels: info.channels, data: new Uint8Array(data) }
> ```
> 把 `info.channels` 原样填进 `RgbStrip.channels`——若上游漏了 `removeAlpha()`,探头会因 `channels!==3` 直接抛错暴露问题,而非静默错位。

- [ ] **Step 4: 跑测试确认通过**

Run:`npx vitest run recognition/active_picker`
Expected: PASS(3 passed)。

- [ ] **Step 5: Commit**

```bash
git add core/src/recognition/active_picker.ts core/tests/recognition/active_picker.test.ts
git commit -m "fix(core): active picker enforces RGB stride via channels (no RGBA mis-offset)"
```

---

## Task 6: 布局/遮挡校验(recognition/layout_guard.ts)

**第二层无效帧防护**:每帧先确认是否处于规范选取布局——检查预期 UI 锚点(计时器、技能网格边框)是否可见。详情面板/英雄介绍这类遮挡层会让锚点区域偏离「预期非空且有结构」的特征 → 判该帧无效。MVP 用一个朴素特征:锚点 ROI 的灰度方差(遮挡层常是大块半透明纯色,方差骤降)+ 平均亮度落在合理带内。

**Files:**
- Create: `core/src/recognition/layout_guard.ts`
- Test: `core/tests/recognition/layout_guard.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// core/tests/recognition/layout_guard.test.ts
import { describe, it, expect } from "vitest";
import { isValidLayout, anchorVariance } from "../../src/recognition/layout_guard";

function structured(): number[][] {
  // 高方差:棋盘
  return Array.from({ length: 16 }, (_, y) =>
    Array.from({ length: 16 }, (_, x) => ((x + y) % 2 ? 220 : 30)));
}
function flat(v: number): number[][] {
  return Array.from({ length: 16 }, () => Array(16).fill(v));
}

describe("layout_guard", () => {
  it("anchorVariance is high for structured anchors, ~0 for flat overlays", () => {
    expect(anchorVariance(structured())).toBeGreaterThan(1000);
    expect(anchorVariance(flat(128))).toBeLessThan(1);
  });

  it("valid layout: all anchors structured", () => {
    expect(isValidLayout([structured(), structured()])).toBe(true);
  });

  it("invalid layout: an anchor is occluded by a flat panel", () => {
    expect(isValidLayout([structured(), flat(120)])).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run:`npx vitest run recognition/layout_guard`
Expected: FAIL,模块不存在。

- [ ] **Step 3: 最小实现**

```ts
// core/src/recognition/layout_guard.ts
// 第二层无效帧防护:UI 锚点可见性。遮挡层(详情/英雄面板)→ 锚点方差骤降 → 判无效帧。

export function anchorVariance(roi: number[][]): number {
  let sum = 0;
  let n = 0;
  for (const row of roi) for (const v of row) { sum += v; n += 1; }
  const mean = sum / n;
  let varSum = 0;
  for (const row of roi) for (const v of row) varSum += (v - mean) ** 2;
  return varSum / n;
}

/** 锚点被认为「可见」的最小方差(遮挡半透明纯色面板方差远低于此)。 */
const MIN_ANCHOR_VARIANCE = 50;

/** 所有锚点 ROI 都需有结构(方差足够)才算规范选取布局。 */
export function isValidLayout(anchorRois: number[][][]): boolean {
  return anchorRois.every((roi) => anchorVariance(roi) >= MIN_ANCHOR_VARIANCE);
}
```

- [ ] **Step 4: 跑测试确认通过**

Run:`npx vitest run recognition/layout_guard`
Expected: PASS(3 passed)。

- [ ] **Step 5: Commit**

```bash
git add core/src/recognition/layout_guard.ts core/tests/recognition/layout_guard.test.ts
git commit -m "feat(core): layout/occlusion guard via anchor variance"
```

---

## Task 7: 整帧对账(statemachine/reconcile.ts)

**核心防雪崩**:给定一个有效帧的 `FrameObservation`(Active Picker + 十行槽位占用),整帧重建 `DraftState`,**不依赖历史转移**。这样任意一个干净帧都能让状态重新同步。slot_type 由注入的 `slotTypeOf(valveId)` 决定(实参为 `ReferenceDb.slotType` 的绑定),便于纯测。

**Files:**
- Create: `core/src/statemachine/reconcile.ts`
- Test: `core/tests/statemachine/reconcile.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// core/tests/statemachine/reconcile.test.ts
import { describe, it, expect } from "vitest";
import { reconcile } from "../../src/statemachine/reconcile";
import type { FrameObservation, SlotType } from "@ad/shared/types/draft";

// 测试用 slot_type 解析:负=hero,5048=ultimate,其余=normal
function slotTypeOf(valveId: number): SlotType | null {
  if (valveId < 0) return "hero";
  if (valveId === 5048) return "ultimate";
  return "normal";
}

function obs(rows: Array<{ hero: number | null; normals: number[]; ultimates: number[] }>, active: number | null): FrameObservation {
  return {
    activePicker: { row: active },
    slots: rows.map((r, i) => ({ row: i, ...r })),
  };
}

describe("reconcile", () => {
  it("rebuilds DraftState from a full observation, classifying by slot_type", () => {
    const observation = obs(
      [
        { hero: -9, normals: [5051], ultimates: [5048] },
        { hero: null, normals: [], ultimates: [] },
      ],
      0,
    );
    const state = reconcile(observation, slotTypeOf);
    expect(state.activeRow).toBe(0);
    expect(state.players[0]).toEqual({ row: 0, hero: -9, normals: [5051], ultimates: [5048] });
    expect(state.players[1].hero).toBeNull();
  });

  it("a clean frame fully resyncs regardless of prior state (no event sourcing)", () => {
    // 同一帧两次对账得到同一状态(幂等/可重建)
    const observation = obs([{ hero: -9, normals: [1, 2], ultimates: [] }], 0);
    expect(reconcile(observation, slotTypeOf)).toEqual(reconcile(observation, slotTypeOf));
  });

  it("routes a mis-placed ability by its true slot_type, not by which list it arrived in", () => {
    // 观察把 5048(终极)错放进 normals;对账按 slot_type 归位到 ultimates
    const observation = obs([{ hero: null, normals: [5048], ultimates: [] }], null);
    const state = reconcile(observation, slotTypeOf);
    expect(state.players[0].ultimates).toEqual([5048]);
    expect(state.players[0].normals).toEqual([]);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run:`npx vitest run statemachine/reconcile`
Expected: FAIL,模块不存在。

- [ ] **Step 3: 最小实现**

```ts
// core/src/statemachine/reconcile.ts
// 整帧对账:由 FrameObservation 重建 DraftState。不依赖历史 → 任意好帧可自愈(计划书 §四)。
import type { DraftState, FrameObservation, PlayerState, SlotType } from "@ad/shared/types/draft";
import { emptyPlayer } from "./quota";

/** 按真实 slot_type 重新归位每行的占用。识别可能把技能塞错列,这里以身份为准。 */
export function reconcile(
  obs: FrameObservation,
  slotTypeOf: (valveId: number) => SlotType | null,
): DraftState {
  const players: PlayerState[] = obs.slots.map((s) => {
    const p = emptyPlayer(s.row);
    const ids = [
      ...(s.hero === null ? [] : [s.hero]),
      ...s.normals,
      ...s.ultimates,
    ];
    for (const id of ids) {
      const t = slotTypeOf(id);
      if (t === "hero") p.hero = id;
      else if (t === "ultimate") p.ultimates.push(id);
      else if (t === "normal") p.normals.push(id);
      // t === null:未知身份,丢弃(由上层时序一致性兜底,不污染状态)
    }
    return p;
  });
  return { players, activeRow: obs.activePicker.row };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run:`npx vitest run statemachine/reconcile`
Expected: PASS(3 passed)。

- [ ] **Step 5: Commit**

```bash
git add core/src/statemachine/reconcile.ts core/tests/statemachine/reconcile.test.ts
git commit -m "feat(core): full-frame reconciliation rebuilds DraftState (no event sourcing)"
```

---

## Task 8: 草稿状态机(statemachine/draft.ts)

把前面零件组装成状态机。职责:**第三层(时序一致性)** + **双重条件提交** + 调对账。

- 喂入每个有效帧的 `FrameObservation`。
- **时序一致性**:同一观察连续 `confirmFrames` 帧一致才接受(瞬时 tooltip 不会持续产生稳定信号)。
- **双重条件**:对账后,只有「新增的技能落在 Active Picker 指向的行」时才认提交;若新增技能在别的行而 picker 指向另一行 → 冲突,**不提交**,保持上次有效状态。
- **第四层(合法单调转移)**由对账+配额天然保证:对账总是整帧重读真相,落位由 `slotTypeOf` 决定,满员类型不会被塞入(超额项丢弃)。

**Files:**
- Create: `core/src/statemachine/draft.ts`
- Test: `core/tests/statemachine/draft.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// core/tests/statemachine/draft.test.ts
import { describe, it, expect } from "vitest";
import { DraftMachine } from "../../src/statemachine/draft";
import type { FrameObservation, SlotType } from "@ad/shared/types/draft";

function slotTypeOf(valveId: number): SlotType | null {
  if (valveId < 0) return "hero";
  if (valveId === 5048) return "ultimate";
  return "normal";
}

function obs(rows: Array<{ hero: number | null; normals: number[]; ultimates: number[] }>, active: number | null): FrameObservation {
  return { activePicker: { row: active }, slots: rows.map((r, i) => ({ row: i, ...r })) };
}

const TWO_EMPTY = obs([{ hero: null, normals: [], ultimates: [] }, { hero: null, normals: [], ultimates: [] }], 0);

describe("DraftMachine", () => {
  it("commits only after N consistent frames (temporal consistency)", () => {
    const m = new DraftMachine(slotTypeOf, { confirmFrames: 2 });
    const pick = obs([{ hero: -9, normals: [], ultimates: [] }, { hero: null, normals: [], ultimates: [] }], 0);
    expect(m.observe(pick)).toBe(false); // 第 1 帧:未达确认数
    expect(m.observe(pick)).toBe(true);  // 第 2 帧:确认,提交
    expect(m.state().players[0].hero).toBe(-9);
  });

  it("rejects a conflicting frame (new ability in row B but picker says row A)", () => {
    const m = new DraftMachine(slotTypeOf, { confirmFrames: 1 });
    m.observe(TWO_EMPTY); // 基线
    // picker 指向行 0,但新技能出现在行 1 → 冲突,不提交
    const conflict = obs([{ hero: null, normals: [], ultimates: [] }, { hero: -7, normals: [], ultimates: [] }], 0);
    expect(m.observe(conflict)).toBe(false);
    expect(m.state().players[1].hero).toBeNull(); // 未污染
  });

  it("self-heals from a single clean frame after dropped frames", () => {
    const m = new DraftMachine(slotTypeOf, { confirmFrames: 1 });
    // 直接喂一个「已经进行到一半」的干净帧(模拟丢了中间所有帧)
    const midgame = obs(
      [
        { hero: -9, normals: [5051, 5052], ultimates: [5048] },
        { hero: -7, normals: [5100], ultimates: [] },
      ],
      1,
    );
    expect(m.observe(midgame)).toBe(true);
    expect(m.observe(midgame)).toBe(true); // 幂等再确认
    expect(m.state().players[0].normals).toEqual([5051, 5052]);
    expect(m.state().players[0].ultimates).toEqual([5048]);
    expect(m.state().activeRow).toBe(1);
  });

  it("holds last valid state when given no observation update", () => {
    const m = new DraftMachine(slotTypeOf, { confirmFrames: 1 });
    const pick = obs([{ hero: -9, normals: [], ultimates: [] }, { hero: null, normals: [], ultimates: [] }], 0);
    m.observe(pick);
    const before = m.state();
    // 不喂新帧,直接读 —— 保持
    expect(m.state()).toEqual(before);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run:`npx vitest run statemachine/draft`
Expected: FAIL,模块不存在。

- [ ] **Step 3: 最小实现**

```ts
// core/src/statemachine/draft.ts
// 草稿状态机:时序一致性 + 双重条件提交 + 整帧对账。计划书 §四。
import type { DraftState, FrameObservation, SlotType } from "@ad/shared/types/draft";
import { reconcile } from "./reconcile";

export interface DraftMachineOptions {
  /** 同一观察连续多少帧一致才提交。 */
  confirmFrames: number;
}

/** 把一帧观察压成可比较的指纹(用于时序一致性)。 */
function fingerprint(obs: FrameObservation): string {
  const slots = obs.slots
    .map((s) => `${s.row}:${s.hero ?? ""}|${[...s.normals].sort().join(",")}|${[...s.ultimates].sort().join(",")}`)
    .join(";");
  return `${obs.activePicker.row ?? "x"}#${slots}`;
}

/** 与上一已提交状态比,统计本观察相对各行的「新增技能」落在哪些行。 */
function changedRows(prev: DraftState, next: DraftState): Set<number> {
  const rows = new Set<number>();
  for (let i = 0; i < next.players.length; i++) {
    const a = prev.players[i];
    const b = next.players[i];
    if (!a) { rows.add(i); continue; }
    const grew =
      (a.hero === null && b.hero !== null) ||
      b.normals.length > a.normals.length ||
      b.ultimates.length > a.ultimates.length;
    if (grew) rows.add(i);
  }
  return rows;
}

export class DraftMachine {
  private committed: DraftState = { players: [], activeRow: null };
  private pendingFp: string | null = null;
  private pendingCount = 0;

  constructor(
    private readonly slotTypeOf: (valveId: number) => SlotType | null,
    private readonly opts: DraftMachineOptions,
  ) {}

  state(): DraftState {
    return this.committed;
  }

  /** 喂一个有效帧。返回是否提交了状态更新。 */
  observe(obs: FrameObservation): boolean {
    const fp = fingerprint(obs);
    if (fp === this.pendingFp) {
      this.pendingCount += 1;
    } else {
      this.pendingFp = fp;
      this.pendingCount = 1;
    }
    if (this.pendingCount < this.opts.confirmFrames) return false;

    const candidate = reconcile(obs, this.slotTypeOf);

    // 双重条件:任何「新增技能行」必须与 Active Picker 指向的行一致。
    // 首次提交(committed 为空)或纯重建(无新增行)直接接受 —— 这是自愈路径。
    if (this.committed.players.length === candidate.players.length) {
      const grown = changedRows(this.committed, candidate);
      if (grown.size > 0) {
        const picker = candidate.activeRow;
        const allMatchPicker = [...grown].every((r) => r === picker);
        if (!allMatchPicker) return false; // 冲突,不提交,保持上次有效状态
      }
    }

    this.committed = candidate;
    return true;
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run:`npx vitest run statemachine/draft`
Expected: PASS(4 passed)。

> **设计说明:** 「自愈」测试里第一帧 `committed.players.length`(0)≠ `candidate.players.length`(2),跳过双重条件直接接受——正是「任意好帧重建」。后续同长度帧才施加双重条件守新增行。

- [ ] **Step 5: Commit**

```bash
git add core/src/statemachine/draft.ts core/tests/statemachine/draft.test.ts
git commit -m "feat(core): draft state machine (temporal consistency + dual-condition + reconcile)"
```

---

## Task 9: 状态机集成测试(注入序列,断言收敛/自愈/不污染)

把整条链路(对账 + 状态机)用一串「(ActivePicker, 帧槽位快照)」序列跑一遍,断言计划书 §十阶段 2 的验收要点:全程收敛、丢帧自愈顺位不反、详情面板不污染。

**Files:**
- Test: `core/tests/statemachine/integration.test.ts`

- [ ] **Step 1: 写集成测试**

```ts
// core/tests/statemachine/integration.test.ts
import { describe, it, expect } from "vitest";
import { DraftMachine } from "../../src/statemachine/draft";
import type { FrameObservation, SlotType } from "@ad/shared/types/draft";

function slotTypeOf(v: number): SlotType | null {
  if (v < 0) return "hero";
  if (v >= 6000) return "ultimate";
  return "normal";
}

function obs(rows: Array<{ hero: number | null; normals: number[]; ultimates: number[] }>, active: number | null): FrameObservation {
  return { activePicker: { row: active }, slots: rows.map((r, i) => ({ row: i, ...r })) };
}

function empty(n: number) {
  return Array.from({ length: n }, () => ({ hero: null as number | null, normals: [] as number[], ultimates: [] as number[] }));
}

describe("draft integration", () => {
  it("converges over a sequence of legal picks", () => {
    const m = new DraftMachine(slotTypeOf, { confirmFrames: 1 });
    const rows = empty(3);
    // 行0 拿英雄 -9
    rows[0].hero = -9; m.observe(obs(rows, 0));
    // 行1 拿英雄 -7
    rows[1].hero = -7; m.observe(obs(rows, 1));
    // 行0 拿普通技能 5051
    rows[0].normals.push(5051); m.observe(obs(rows, 0));
    const s = m.state();
    expect(s.players[0].hero).toBe(-9);
    expect(s.players[0].normals).toEqual([5051]);
    expect(s.players[1].hero).toBe(-7);
  });

  it("recovers correct order from a single good frame after a gap", () => {
    const m = new DraftMachine(slotTypeOf, { confirmFrames: 1 });
    // 喂一个领先若干步的干净帧(模拟丢帧)
    const ahead = [
      { hero: -9, normals: [5051, 5052, 5053], ultimates: [6001] },
      { hero: -7, normals: [5100], ultimates: [] },
      { hero: -3, normals: [], ultimates: [] },
    ];
    m.observe(obs(ahead, 2));
    const s = m.state();
    expect(s.players[0].normals.length).toBe(3);
    expect(s.players[0].ultimates).toEqual([6001]);
    expect(s.activeRow).toBe(2); // 顺位正确,不反
  });

  it("does not get polluted by a detail-panel conflict frame", () => {
    const m = new DraftMachine(slotTypeOf, { confirmFrames: 1 });
    const base = empty(3);
    base[0].hero = -9;
    m.observe(obs(base, 0));
    // 模拟:用户点开行2的英雄详情,识别误把 -3 读进行2,但 picker 仍指 0 → 冲突
    const polluted = empty(3);
    polluted[0].hero = -9;
    polluted[2].hero = -3;
    expect(m.observe(obs(polluted, 0))).toBe(false);
    expect(m.state().players[2].hero).toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试确认通过**

Run:`npx vitest run statemachine/integration`
Expected: PASS(3 passed)。

- [ ] **Step 3: Commit**

```bash
git add core/tests/statemachine/integration.test.ts
git commit -m "test(core): draft machine integration — converge, self-heal, no pollution"
```

---

## Task 10: 薄捕获循环(main/capture/)+ 手动冒烟

唯一接触 Electron 生态的薄层:低 Hz 定时截屏 → 转灰度 → 调 core 纯函数(门控 → 布局校验 → ROI 识别 → 状态机)。无业务判定,故只手动冒烟,不做单测(纯逻辑都在 core 已测)。

**Files:**
- Create: `main/src/capture/frame_source.ts`
- Create: `main/src/capture/loop.ts`
- Create: `main/src/capture/monitor_once.ts`(手动冒烟脚本)

- [ ] **Step 1: frame_source.ts(复用阶段 1 decode)**

```ts
// main/src/capture/frame_source.ts
// 截屏 → GrayFrame。灰度公式须与阶段 1 Task 4b 决定一致(复用 toGrayFrame)。
import screenshot from "screenshot-desktop";
import { toGrayFrame } from "../decode";
import type { GrayFrame } from "@ad/core/recognition/grid";

export async function captureGrayFrame(): Promise<GrayFrame> {
  const png = await screenshot({ format: "png" });
  return toGrayFrame(png);
}
```

> **⚠️ 通道一致性(同 Task 5 的 RGBA 教训):** `GrayFrame.data` 按 **1 字节/像素**索引(`data[y*width + x]`)。阶段 1 的 `toGrayFrame` 必须在 sharp 链里 `.removeAlpha().greyscale()`(或等价),保证输出 raw buffer 是单通道——否则若残留 alpha,灰度索引同样会错位。若阶段 1 `decode.ts` 未显式 `removeAlpha()`,在此修(它是灰度热路径入口)。Active Picker 的彩色带走 `removeAlpha()` 到 3 通道(Task 5),灰度走 `removeAlpha()` 到 1 通道——**两条管线都不许带 alpha**。

- [ ] **Step 2: loop.ts(组装纯函数,持有内存状态)**

```ts
// main/src/capture/loop.ts
// 低 Hz 捕获循环。生命周期 = 进入选取界面 → 全部选完。所有判定委托 core 纯函数。
import { FrameGate } from "@ad/core/recognition/frame_diff";
import { LAYOUT_1080P, diffRois, poolCells, slotRowCells } from "@ad/core/recognition/roi";
import { isValidLayout } from "@ad/core/recognition/layout_guard";
import { recognizeCell } from "@ad/core/recognition/recognize";
import { loadIndex, type IndexEntry } from "@ad/core/recognition/index_store";
import { ReferenceDb } from "@ad/core/db/reference";
import { DraftMachine } from "@ad/core/statemachine/draft";
import type { FrameObservation, SlotType } from "@ad/shared/types/draft";
import { captureGrayFrame } from "./frame_source";
import type { GrayFrame } from "@ad/core/recognition/grid";

export interface MonitorDeps {
  index: IndexEntry[];
  ref: ReferenceDb;
  onUpdate: (machine: DraftMachine) => void;
}

/** 把一帧识别成 FrameObservation。Active Picker 需 RGB 带 —— 本 MVP 先留 null
 *  (颜色带的彩色采集在阶段 4 接入;此处链路先打通灰度识别部分)。
 *  英雄槽与技能槽已物理解耦:英雄走长方形识别,4 个技能走正方形识别。 */
function recognizeFrame(frame: GrayFrame, deps: MonitorDeps): FrameObservation {
  const slots = slotRowCells(frame, LAYOUT_1080P).map(({ hero: heroCell, abilities }, row) => {
    // 英雄槽:识别长方形头像格。
    const heroId = recognizeCell(heroCell, deps.index, 12)?.valveId ?? null;
    const hero = heroId !== null && deps.ref.slotType(heroId) === "hero" ? heroId : null;
    // 4 个技能格:按 slot_type 分流到 normals / ultimates。
    const abilityIds = abilities
      .map((cell) => recognizeCell(cell, deps.index, 12)?.valveId)
      .filter((v): v is number => v !== undefined && v !== null);
    const normals = abilityIds.filter((v) => deps.ref.slotType(v) === "normal");
    const ultimates = abilityIds.filter((v) => deps.ref.slotType(v) === "ultimate");
    return { row, hero, normals, ultimates };
  });
  return { activePicker: { row: null }, slots };
}

export async function runMonitorLoop(deps: MonitorDeps, intervalMs = 250): Promise<void> {
  const gate = new FrameGate(3); // 连续 3 帧静止才认定动画结束、放行最终稳定帧(防抖)
  const slotTypeOf = (v: number): SlotType | null => deps.ref.slotType(v);
  const machine = new DraftMachine(slotTypeOf, { confirmFrames: 3 });

  const tick = async () => {
    const frame = await captureGrayFrame();
    const rois = diffRois(frame, LAYOUT_1080P);
    if (!gate.shouldProcess(rois)) return;            // 第一层:frame-diff 门控
    if (!isValidLayout([rois[0], rois[2]])) return;   // 第二层:布局/遮挡校验
    const obs = recognizeFrame(frame, deps);
    if (machine.observe(obs)) deps.onUpdate(machine);  // 第三/四层在 machine 内
  };

  // 简单定时轮询;真正的生命周期/停止条件在阶段 4 接 overlay 时细化。
  // eslint-disable-next-line no-constant-condition
  while (true) {
    await tick();
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
```

> **注:** Active Picker 此处先置 null —— 灰度链路先打通;彩色 `pickerStrip` 采集与 `detectActivePicker` 接入放在阶段 4(overlay 已有窗口/彩色帧管线)。双重条件在 picker 为 null 时退化为「同长度帧的新增行无 picker 约束」,集成测试已覆盖纯重建路径。**这是已知的阶段边界,不是遗漏。**

- [ ] **Step 3: monitor_once.ts 手动冒烟**

```ts
// main/src/capture/monitor_once.ts
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { loadIndex } from "@ad/core/recognition/index_store";
import { ReferenceDb } from "@ad/core/db/reference";
import { runMonitorLoop } from "./loop";

const HERE = dirname(fileURLToPath(import.meta.url));
const INDEX = resolve(HERE, "../../../models/templates/phash_index.json");
const DB = resolve(HERE, "../../../pipeline/out/reference.db");

const index = loadIndex(INDEX);
const ref = new ReferenceDb(DB);
runMonitorLoop({
  index,
  ref,
  onUpdate: (m) => {
    const s = m.state();
    console.log("activeRow=", s.activeRow);
    s.players.forEach((p) =>
      console.log(`row ${p.row}: hero=${p.hero} normals=${p.normals} ult=${p.ultimates}`));
  },
});
```

- [ ] **Step 4: 手动冒烟(需进 AD 选取界面,better-sqlite3 需 electron-rebuild —— 见下注)**

Run(在 `main/` 下,纯 Node tsx 跑,不进 Electron):`npx tsx src/capture/monitor_once.ts`
Expected: 进入选取界面后,控制台随选取进度逐行刷新各玩家槽位;点开技能/英雄详情时**不刷出污染状态**(验收门)。

> **⚠️ better-sqlite3 × Electron:** 本冒烟用纯 `tsx`(Node)跑,无需重编译。但阶段 4 把 `main/` 装进 Electron 运行时,**必须** `electron-rebuild -f -w better-sqlite3`(阶段 1 Task 3 已预警)。届时在 `main/` 打包脚本加该步。

- [ ] **Step 5: Commit**

```bash
git add main/src/capture/frame_source.ts main/src/capture/loop.ts main/src/capture/monitor_once.ts
git commit -m "feat(main): thin low-Hz capture loop wiring gate/guard/recognize/statemachine"
```

---

## 阶段 2 验收清单(对应计划书 §十「阶段 2」)

- [ ] `core/` 下 `npm test` 全绿(types / quota / frame_diff / roi / active_picker / layout_guard / reconcile / draft / integration)。
- [ ] **全程自动追踪一局选取,状态正确收敛** —— `integration.test.ts::converges` + Task 10 手动冒烟。
- [ ] **丢帧/卡顿后能从单个好帧自愈、顺位不错位** —— `integration.test.ts::recovers correct order`(对账而非事件溯源)。
- [ ] **点开技能/英雄详情不致污染状态** —— `layout_guard`(第二层)+ `integration.test.ts::not polluted`(双重条件)。
- [ ] 四层无效帧防护各自有测:①`frame_diff`(**真防抖**:放行最终稳定帧,绝不喂半截动画帧)②`layout_guard` ③`draft`(confirmFrames)④`reconcile`(按 slot_type 归位,超额丢弃)。
- [ ] 逐玩家配额记账正确(`quota` 测)。
- [ ] **frame-diff 是防抖非节流**:动画期间零放行、稳定后放行一次(`frame_diff.test.ts::drops mid-animation frames` + Phase 4 `frame_gate_perf`)。
- [ ] **彩色管线无 RGBA 偏移**:`active_picker` 按 `channels===3` 断言,采集侧 `removeAlpha()`(`active_picker.test.ts::throws on a 4-channel strip`)。
- [ ] **英雄槽/技能槽物理解耦**:`heroSlot` 长方形、`abilitySlots` 正方形 1×4,不对长方形头像做正方形裁切(`roi.test.ts::hero slot is rectangular, ability slots are square`)。
- [ ] 纯逻辑零 Electron;`main/` 捕获循环只组装、不判定。
- [ ] (**差异化 1 达成**)

> **已知阶段边界(非遗漏):** Active Picker 彩色采集在 `main/loop.ts` 暂置 null,留阶段 4(彩色帧管线就绪)接入 `detectActivePicker`。`active_picker.ts` 纯逻辑本阶段已测齐。

> **下一步依赖:** `DraftState`/`PlayerState`/`remainingQuota` → 阶段 3 打分内核的硬过滤与上下文输入;状态机 `onUpdate` → 阶段 4 overlay 的 Zustand 订阅源。
