# 阶段 3 · 打分内核(差异化 2、3)实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: 用 superpowers:subagent-driven-development(推荐)或 superpowers:executing-plans 逐任务执行。步骤用 `- [ ]` 复选框跟踪。前置:阶段 0(`pipeline/out/reference.db`)与阶段 2(`shared/types/draft.ts`、`core/src/statemachine/quota.ts`)已落地。**实现前先读同目录 `打分细则.md`(数理内核权威规格)** 与计划书 §五、`...-00 §4`(ID 模型)。

**Goal:** 实现一个**动态多准则决策模型(Dynamic MCDM)**:槽位硬过滤先于一切 → 每个打分维度是独立信号函数 $S_i$ → 经**顺位时变动态权重 $w_i(P_{curr})$** 加权合成 → 全局降序取 Top 3~4。打分机制**完全可配置**(信号是注册表、权重经基础配置 + 动态调节系数解析),确定性纯计算,LLM 不进关键路径。

**Architecture:** 三段。
1. **硬过滤**(`filter.ts`):依本人三类剩余配额裁剪混合候选池,满员类型整类剔除。
2. **信号注册表 + 动态加权合成**(可配置核心,对齐 `打分细则.md`):
   - 每个维度 = 一个 `Signal` 纯函数 `(ctx, candidate) => number`,所有胜率信号以「相对 0.5 的偏移量」为量纲。本阶段落齐细则的五个信号:`base`、`synergy`(平均协同)、`pos`(tanh 稀缺度)、`aghs`、`shard`。
   - **权重是顺位 $P_{curr}$ 的函数**,不是常数:`resolveWeights(cfg, pickIndex)` 用 `f_front`/`f_back` 衰减/增益因子 + `α`/`β` 把基础权重 $w^0$ 解析成本手实际权重。
   - `score()` 对维度无知:`Σ w_i(P_curr) · S_i`。新增维度 = 增 signal + 注册 + 给基础权重,**不改 `score()`**。
3. **数据访问**(`data.ts`):从阶段 0 的 `reference.db` 只读各信号所需行(含 `ability_aghs` 的 scepter/shard 收益)。
4. **选拔**(`recommend.ts`):硬过滤 → 构建上下文 → 动态打分 → 降序取 **Top 3~4**。

**Tech Stack:** TypeScript、Vitest、better-sqlite3(只读 `reference.db`)。纯 domain,零 Electron(计划书 §八)。

---

## 关键设计决策

- **动态多准则决策(对齐 `打分细则.md`)。** 最终得分 $Score(c) = \sum_i w_i(P_{curr}) \cdot S_i(c, ctx)$。两层都可配:信号(注册表)与权重(基础 $w^0$ + 动态系数 $\alpha,\beta$)。
- **权重时变,不是常数(细则 §3,用户战略意图)。** 「首轮前置位优先单强、首轮后置位优先搭配与神杖」靠权重随顺位变化实现:
  - 前置位倾向因子 `f_front(P) = max(0, (10 - P)/9)`(第1手=1,第10手→0)。
  - 后置位倾向因子 `f_back(P)  = max(0, (P - 1)/9)`(第1手=0,第10手→1)。
  - `w_base = w_base⁰·(1 + α·f_front)`(前置位放大单体胜率)。
  - `w_synergy = w_synergy⁰·f_back`(前置位无搭配→置零,后置位全力组合)。
  - `w_aghs = w_aghs⁰·(1 + β·f_back)`(后置位为后期体系提权神杖)。
  - `w_shard`、`w_pos` 恒定。
- **信号量纲统一为「相对 0.5 偏移」(细则 §2)。** 胜率类信号都减 0.5,跨维度可比。
- **`synergy` 用平均协同偏移(细则 §2②)。** `(1/|M|)·Σ(WR(c,m)-0.5)`,避免已选数量多导致无脑放大。`|M|=0` 时为 0。
- **`pos` 用 tanh 有界(细则 §2③)。** `tanh((P_curr - P_avg)/σ)`,σ=10,严格有界 [-1,1],辅助调整不掩盖胜率。
- **硬过滤先于一切打分(计划书 §五 第 0 步 / 细则 §4.1)。** 满员类型整类剔除。候选集是混合的(英雄/普通/终极可同时合法)。
- **跨类型统一比较 + Top-K 截断(细则 §4)。** 英雄与技能用同一 `score()`,全局降序取 Top 3~4。
- **确定性纯计算,signal 不碰 DB、LLM 不进关键路径(计划书 §五)。** DB 行在 `ScoringContext` 构建期一次性注入;`breakdown` 保留各维度贡献供 overlay/解释层。

---

## 文件结构

| 文件 | 职责 |
|---|---|
| `shared/types/scoring.ts` | `Candidate`、`ScoringContext`、`Signal`、`SignalId`、`ScoringConfig`、`ScoredCandidate` |
| `core/src/scoring/filter.ts` | 第 0 步槽位硬过滤(依剩余配额裁剪混合候选池) |
| `core/src/scoring/data.ts` | 从 `reference.db` 只读各信号所需行,构建 `ScoringContext` |
| `core/src/scoring/signals/base.ts` | 信号①:单技能/英雄基础胜率 $S_{base}$ |
| `core/src/scoring/signals/synergy.ts` | 信号②:平均协同 $S_{synergy}$ |
| `core/src/scoring/signals/pos.ts` | 信号③:tanh 选取位置稀缺度 $S_{pos}$ |
| `core/src/scoring/signals/aghs.ts` | 信号④:神杖增益 $S_{aghs}$ + 魔晶增益 $S_{shard}$ |
| `core/src/scoring/signals/index.ts` | `SIGNALS` 注册表(SignalId → Signal) |
| `core/src/scoring/weights.ts` | 动态权重:`f_front`/`f_back`/`resolveWeights(cfg, P_curr)` |
| `core/src/scoring/config.ts` | `defaultScoringConfig`(基础 $w^0$ + α/β/σ)+ `loadScoringConfig`(JSON) |
| `core/src/scoring/score.ts` | 动态加权合成(对维度无知)+ 排序 |
| `core/src/scoring/recommend.ts` | 端到端:硬过滤 → 上下文 → 动态打分 → Top-K |
| `core/src/scoring/backtest.ts` | 离线回测 top-K 命中率 |
| `core/tests/scoring/**` | Vitest 测试 |

---

## Task 1: 打分领域类型(shared/types/scoring.ts)

钉死类型。`Signal` 统一签名 + `ScoringConfig`(含基础权重与动态系数)是「动态可配置打分机制」的核心契约。

**Files:**
- Create: `shared/types/scoring.ts`
- Modify: `shared/package.json`(加 exports 子路径)
- Test: `core/tests/scoring/types.test.ts`

- [ ] **Step 1: 写类型定义**

```ts
// shared/types/scoring.ts
// 打分领域类型(动态 MCDM)。权威规格见 docs/.../打分细则.md。
import type { PlayerState, SlotType } from "./draft";

/** 一个候选(英雄伪技能用负 valveId,真实技能用正)。 */
export interface Candidate {
  valveId: number;
  slotType: SlotType;
}

/** 单技能/英雄的胜率数据行(来自 ability_winrate / hero_winrate)。 */
export interface WinrateRow {
  winrate: number | null;
  avgPickPosition: number | null;
}

/** 神杖/魔晶升级后的独立胜率(来自 ability_aghs)。已是相对基础胜率的「收益差」。 */
export interface AghsRow {
  scepterGain: number | null; // WR_aghs - WR_base
  shardGain: number | null;   // WR_shard - WR_base
}

/** 打分上下文:本人状态 + 已查好的只读数据,注入给各 signal。signal 不碰 DB。 */
export interface ScoringContext {
  /** 当前活动玩家(本人)状态。 */
  me: PlayerState;
  /** 本人当前绝对选取顺位 P_curr(全局第几手,1..40);未知为 null。 */
  pickIndex: number | null;
  /** valveId → 胜率行。 */
  winrate: Map<number, WinrateRow>;
  /** "a|b"(a<b 的 valveId 对,字符串键)→ pair 胜率。 */
  pairWinrate: Map<string, number>;
  /** valveId → 神杖/魔晶收益。 */
  aghs: Map<number, AghsRow>;
}

/** SignalId:对齐 打分细则.md §2 的五个信号。可扩展。 */
export type SignalId =
  | "base"     // 单技能/英雄基础胜率
  | "synergy"  // 平均协同
  | "pos"      // tanh 选取位置稀缺度
  | "aghs"     // 神杖增益
  | "shard"    // 魔晶增益
  // 扩展位(后续按同一注册表模式接入,不改 score()):
  | "snipe"
  | "teammate_protect";

/** 一个打分维度:纯函数,返回该候选在该维度的**原始分**(未加权)。 */
export type Signal = (ctx: ScoringContext, candidate: Candidate) => number;

/** 打分配置:基础权重 w⁰ + 动态调节系数。可由 JSON 加载(细则 §3「参数推荐配置」)。 */
export interface ScoringConfig {
  /** 各维度基础权重 w_i⁰。缺省/0 = 关闭该维度。 */
  baseWeights: Partial<Record<SignalId, number>>;
  /** 前置位对高胜率单核的激进提权(默认 0.5)。 */
  alpha: number;
  /** 后置位对神杖流体系的激进提权(默认 0.4)。 */
  beta: number;
  /** pos 信号 tanh 平滑因子 σ(默认 10)。 */
  sigma: number;
  /** 第一轮的玩家数(f_front/f_back 的边界窗;默认 10)。 */
  firstRoundSize: number;
  /** 最终返回的 Top-K(默认 4,即 3~4)。 */
  topK: number;
}

/** 打分结果。breakdown 保留各维度贡献(w·S),供 overlay/解释层 grounded 展示。 */
export interface ScoredCandidate {
  candidate: Candidate;
  score: number;
  breakdown: Partial<Record<SignalId, number>>;
}
```

- [ ] **Step 2: 加 exports 子路径**

`shared/package.json` 的 `exports` 加:
```json
"./types/scoring": "./types/scoring.ts"
```

- [ ] **Step 3: 写类型烟囱测试**

```ts
// core/tests/scoring/types.test.ts
import { describe, it, expect } from "vitest";
import type { ScoringConfig, Candidate } from "@ad/shared/types/scoring";

describe("scoring types", () => {
  it("ScoringConfig carries base weights + dynamic coefficients", () => {
    const cfg: ScoringConfig = {
      baseWeights: { base: 1, synergy: 1.5 },
      alpha: 0.5, beta: 0.4, sigma: 10, firstRoundSize: 10, topK: 4,
    };
    expect(cfg.baseWeights.base).toBe(1);
    expect(cfg.alpha).toBe(0.5);
  });
  it("Candidate carries valveId + slotType", () => {
    const c: Candidate = { valveId: -9, slotType: "hero" };
    expect(c.slotType).toBe("hero");
  });
});
```

- [ ] **Step 4: 跑测试确认通过**

Run(在 `core/` 下):`npx vitest run scoring/types`
Expected: PASS(2 passed)。

- [ ] **Step 5: Commit**

```bash
git add shared/types/scoring.ts shared/package.json core/tests/scoring/types.test.ts
git commit -m "feat(shared): dynamic-MCDM scoring types (Signal/ScoringConfig with alpha/beta/sigma)"
```

---

## Task 2: 槽位硬过滤(scoring/filter.ts)

第 0 步,先于一切打分(细则 §4.1)。依本人三类剩余配额裁剪混合候选池:英雄槽满剔所有英雄,普通满剔所有普通,终极满剔所有终极。复用阶段 2 的 `remainingQuota`。

**Files:**
- Create: `core/src/scoring/filter.ts`
- Test: `core/tests/scoring/filter.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// core/tests/scoring/filter.test.ts
import { describe, it, expect } from "vitest";
import { hardFilter } from "../../src/scoring/filter";
import type { Candidate } from "@ad/shared/types/scoring";
import type { PlayerState } from "@ad/shared/types/draft";

const POOL: Candidate[] = [
  { valveId: -9, slotType: "hero" },
  { valveId: -7, slotType: "hero" },
  { valveId: 5051, slotType: "normal" },
  { valveId: 5052, slotType: "normal" },
  { valveId: 6001, slotType: "ultimate" },
];

describe("hardFilter", () => {
  it("keeps all types when nothing is full", () => {
    const me: PlayerState = { row: 0, hero: null, normals: [], ultimates: [] };
    expect(hardFilter(POOL, me).map((c) => c.valveId).sort()).toEqual([-9, -7, 5051, 5052, 6001].sort());
  });

  it("drops all heroes when hero slot is full", () => {
    const me: PlayerState = { row: 0, hero: -9, normals: [], ultimates: [] };
    const kept = hardFilter(POOL, me);
    expect(kept.some((c) => c.slotType === "hero")).toBe(false);
    expect(kept.some((c) => c.slotType === "normal")).toBe(true);
  });

  it("drops all normals when 3 normals taken; keeps mixed legal rest", () => {
    const me: PlayerState = { row: 0, hero: -9, normals: [1, 2, 3], ultimates: [] };
    const kept = hardFilter(POOL, me);
    expect(kept.every((c) => c.slotType === "ultimate")).toBe(true);
  });

  it("drops ultimates when ultimate slot full", () => {
    const me: PlayerState = { row: 0, hero: null, normals: [], ultimates: [6001] };
    expect(hardFilter(POOL, me).some((c) => c.slotType === "ultimate")).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run:`npx vitest run scoring/filter`
Expected: FAIL,模块不存在。

- [ ] **Step 3: 最小实现**

```ts
// core/src/scoring/filter.ts
// 第 0 步槽位硬过滤(计划书 §五 / 细则 §4.1):满员类型整类剔除。候选集是混合的。
import type { Candidate } from "@ad/shared/types/scoring";
import type { PlayerState } from "@ad/shared/types/draft";
import { remainingQuota } from "../statemachine/quota";

export function hardFilter(pool: Candidate[], me: PlayerState): Candidate[] {
  const q = remainingQuota(me);
  const allow = {
    hero: q.hero > 0,
    normal: q.normal > 0,
    ultimate: q.ultimate > 0,
  } as const;
  return pool.filter((c) => allow[c.slotType]);
}
```

- [ ] **Step 4: 跑测试确认通过**

Run:`npx vitest run scoring/filter`
Expected: PASS(4 passed)。

- [ ] **Step 5: Commit**

```bash
git add core/src/scoring/filter.ts core/tests/scoring/filter.test.ts
git commit -m "feat(core): slot hard-filter by remaining quota (legal-only candidates)"
```

---

## Task 3: 信号①——基础胜率 $S_{base}$(signals/base.ts)

细则 §2①:`S_base(c) = WR(c) - 0.5`。从 `ctx.winrate` 取候选胜率,减 0.5 基线;无数据返回 0。英雄伪技能(负 valveId)同在此表(winrate 来自 hero_winrate,见 data.ts 合并)。

**Files:**
- Create: `core/src/scoring/signals/base.ts`
- Test: `core/tests/scoring/signals/base.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// core/tests/scoring/signals/base.test.ts
import { describe, it, expect } from "vitest";
import { base } from "../../../src/scoring/signals/base";
import type { ScoringContext } from "@ad/shared/types/scoring";

function ctx(winrate: Map<number, { winrate: number | null; avgPickPosition: number | null }>): ScoringContext {
  return {
    me: { row: 0, hero: null, normals: [], ultimates: [] },
    pickIndex: 1, winrate, pairWinrate: new Map(), aghs: new Map(),
  };
}

describe("base signal (S_base = WR - 0.5)", () => {
  it("returns winrate minus 0.5 baseline", () => {
    const c = ctx(new Map([[5051, { winrate: 0.55, avgPickPosition: null }]]));
    expect(base(c, { valveId: 5051, slotType: "normal" })).toBeCloseTo(0.05, 6);
  });
  it("returns 0 when no data", () => {
    expect(base(ctx(new Map()), { valveId: 9999, slotType: "normal" })).toBe(0);
  });
  it("works for hero pseudo-abilities (negative valveId)", () => {
    const c = ctx(new Map([[-9, { winrate: 0.52, avgPickPosition: null }]]));
    expect(base(c, { valveId: -9, slotType: "hero" })).toBeCloseTo(0.02, 6);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run:`npx vitest run scoring/signals/base`
Expected: FAIL,模块不存在。

- [ ] **Step 3: 最小实现**

```ts
// core/src/scoring/signals/base.ts
// 信号①:单技能/英雄基础胜率(细则 §2①)。S_base = WR(c) - 0.5。
import type { Signal } from "@ad/shared/types/scoring";

export const base: Signal = (ctx, candidate) => {
  const row = ctx.winrate.get(candidate.valveId);
  if (!row || row.winrate === null) return 0;
  return row.winrate - 0.5;
};
```

- [ ] **Step 4: 跑测试确认通过**

Run:`npx vitest run scoring/signals/base`
Expected: PASS(3 passed)。

- [ ] **Step 5: Commit**

```bash
git add core/src/scoring/signals/base.ts core/tests/scoring/signals/base.test.ts
git commit -m "feat(core): base-winrate signal (S_base = WR - 0.5)"
```

---

## Task 4: 信号②——平均协同 $S_{synergy}$(signals/synergy.ts)

细则 §2②:`S_synergy(c) = (1/|M|)·Σ_{m∈M}(WR(c,m) - 0.5)`(|M|=0 → 0)。M = 本人已选(含英雄)。**用平均而非求和**,避免已选数量放大。注意:平均的分母 `|M|` 是「本人全部已选件数」,不是「有 pair 数据的件数」(细则原文 `1/|M|`)。pair 键升序拼 `"min|max"`。

**Files:**
- Create: `core/src/scoring/signals/synergy.ts`
- Test: `core/tests/scoring/signals/synergy.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// core/tests/scoring/signals/synergy.test.ts
import { describe, it, expect } from "vitest";
import { synergy, pairKey } from "../../../src/scoring/signals/synergy";
import type { ScoringContext } from "@ad/shared/types/scoring";

function ctx(me: { hero: number | null; normals: number[]; ultimates: number[] }, pairs: Map<string, number>): ScoringContext {
  return { me: { row: 0, ...me }, pickIndex: 3, winrate: new Map(), pairWinrate: pairs, aghs: new Map() };
}

describe("pairKey", () => {
  it("is order-independent (sorted)", () => {
    expect(pairKey(5051, -9)).toBe(pairKey(-9, 5051));
    expect(pairKey(5051, -9)).toBe("-9|5051");
  });
});

describe("synergy signal (averaged offset)", () => {
  it("averages pair-winrate offsets over |M| (all my picks incl hero)", () => {
    const pairs = new Map<string, number>([
      [pairKey(-9, 5052), 0.56], // 候选 5052 × 我的英雄 -9
      [pairKey(5051, 5052), 0.54], // 候选 5052 × 我的已选普通 5051
    ]);
    // M = {-9, 5051},|M|=2;Σ(0.06 + 0.04)=0.10;平均 = 0.05
    const c = ctx({ hero: -9, normals: [5051], ultimates: [] }, pairs);
    expect(synergy(c, { valveId: 5052, slotType: "normal" })).toBeCloseTo(0.05, 6);
  });

  it("divides by |M| even when some pairs have no data (missing => 0 offset)", () => {
    // M = {-9, 5051},|M|=2;只有一个 pair 有数据(0.56→+0.06),另一项缺数据计 0
    const pairs = new Map<string, number>([[pairKey(-9, 5052), 0.56]]);
    const c = ctx({ hero: -9, normals: [5051], ultimates: [] }, pairs);
    expect(synergy(c, { valveId: 5052, slotType: "normal" })).toBeCloseTo(0.03, 6); // 0.06/2
  });

  it("returns 0 when I have no picks yet (|M|=0)", () => {
    const c = ctx({ hero: null, normals: [], ultimates: [] }, new Map());
    expect(synergy(c, { valveId: 5052, slotType: "normal" })).toBe(0);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run:`npx vitest run scoring/signals/synergy`
Expected: FAIL,模块不存在。

- [ ] **Step 3: 最小实现**

```ts
// core/src/scoring/signals/synergy.ts
// 信号②:平均协同(细则 §2②)。S_synergy = (1/|M|)·Σ(WR(c,m)-0.5);|M|=0→0。
// |M| = 本人全部已选件数(含英雄);缺 pair 数据的项按 0 偏移计入分子,分母仍是 |M|。
import type { Signal } from "@ad/shared/types/scoring";

/** 顺序无关的 pair 键:两 valveId 升序拼接。 */
export function pairKey(a: number, b: number): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export const synergy: Signal = (ctx, candidate) => {
  const mine = [
    ...(ctx.me.hero === null ? [] : [ctx.me.hero]),
    ...ctx.me.normals,
    ...ctx.me.ultimates,
  ].filter((id) => id !== candidate.valveId);
  if (mine.length === 0) return 0;
  let sum = 0;
  for (const owned of mine) {
    const wr = ctx.pairWinrate.get(pairKey(candidate.valveId, owned));
    if (wr !== undefined) sum += wr - 0.5; // 缺数据 → 贡献 0,但仍计入 |M| 分母
  }
  return sum / mine.length;
};
```

- [ ] **Step 4: 跑测试确认通过**

Run:`npx vitest run scoring/signals/synergy`
Expected: PASS(4 passed)。

- [ ] **Step 5: Commit**

```bash
git add core/src/scoring/signals/synergy.ts core/tests/scoring/signals/synergy.test.ts
git commit -m "feat(core): averaged ability-pair synergy signal (S_synergy)"
```

---

## Task 5: 信号③——tanh 选取位置稀缺度 $S_{pos}$(signals/pos.ts)

细则 §2③:`S_pos(c) = tanh((P_curr - P_avg(c)) / σ)`,σ 由 config 给(默认 10),严格有界 [-1,1]。`P_curr > P_avg` → 正(反常稀缺,提权)。pickIndex 未知或无 `avgPickPosition` → 0。σ 由调用方注入(从 config 取),便于回测改 σ。

**Files:**
- Create: `core/src/scoring/signals/pos.ts`
- Test: `core/tests/scoring/signals/pos.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// core/tests/scoring/signals/pos.test.ts
import { describe, it, expect } from "vitest";
import { makePosSignal } from "../../../src/scoring/signals/pos";
import type { ScoringContext } from "@ad/shared/types/scoring";

function ctx(pickIndex: number | null, app: number | null): ScoringContext {
  return {
    me: { row: 0, hero: null, normals: [], ultimates: [] },
    pickIndex,
    winrate: new Map([[5051, { winrate: 0.5, avgPickPosition: app }]]),
    pairWinrate: new Map(), aghs: new Map(),
  };
}

const pos = makePosSignal(10); // σ=10

describe("pos signal (tanh scarcity)", () => {
  it("matches tanh((P_curr - P_avg)/sigma)", () => {
    // P_curr=18, P_avg=8 → tanh(10/10)=tanh(1)≈0.7616
    expect(pos(ctx(18, 8), { valveId: 5051, slotType: "normal" })).toBeCloseTo(Math.tanh(1), 6);
  });
  it("is positive when item usually taken earlier than now (scarce)", () => {
    expect(pos(ctx(20, 5), { valveId: 5051, slotType: "normal" })).toBeGreaterThan(0);
  });
  it("is negative when item usually picked much later", () => {
    expect(pos(ctx(3, 20), { valveId: 5051, slotType: "normal" })).toBeLessThan(0);
  });
  it("is strictly bounded in [-1, 1]", () => {
    expect(Math.abs(pos(ctx(40, 1), { valveId: 5051, slotType: "normal" }))).toBeLessThanOrEqual(1);
  });
  it("returns 0 when pickIndex unknown or no position data", () => {
    expect(pos(ctx(null, 5), { valveId: 5051, slotType: "normal" })).toBe(0);
    expect(pos(ctx(8, null), { valveId: 5051, slotType: "normal" })).toBe(0);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run:`npx vitest run scoring/signals/pos`
Expected: FAIL,模块不存在。

- [ ] **Step 3: 最小实现**

```ts
// core/src/scoring/signals/pos.ts
// 信号③:tanh 选取位置稀缺度(细则 §2③)。S_pos = tanh((P_curr - P_avg)/σ),有界 [-1,1]。
// σ 经工厂注入(从 config.sigma),便于回测改 σ 而不改信号。
import type { Signal } from "@ad/shared/types/scoring";

export function makePosSignal(sigma: number): Signal {
  return (ctx, candidate) => {
    if (ctx.pickIndex === null) return 0;
    const row = ctx.winrate.get(candidate.valveId);
    if (!row || row.avgPickPosition === null) return 0;
    return Math.tanh((ctx.pickIndex - row.avgPickPosition) / sigma);
  };
}
```

> **注:** `pos` 是唯一依赖 config(σ)的信号,故用工厂 `makePosSignal(σ)` 产出。注册表在 `index.ts` 用默认 σ 注册一份;`score()` 实际用 `resolveWeights` 同源的 config σ 重建(见 Task 7),保证回测改 σ 即时生效。

- [ ] **Step 4: 跑测试确认通过**

Run:`npx vitest run scoring/signals/pos`
Expected: PASS(5 passed)。

- [ ] **Step 5: Commit**

```bash
git add core/src/scoring/signals/pos.ts core/tests/scoring/signals/pos.test.ts
git commit -m "feat(core): tanh pick-position scarcity signal (S_pos)"
```

---

## Task 6: 信号④——神杖增益 $S_{aghs}$ + 魔晶增益 $S_{shard}$(signals/aghs.ts)

细则 §2④:`S_aghs = WR_aghs - WR_base`、`S_shard = WR_shard - WR_base`。阶段 0 的 `ability_aghs` 表已存好 `scepter_gain`/`shard_gain`(= 有杖减无杖胜率差),故信号直接取 `ctx.aghs` 的对应字段。无数据 → 0。

**Files:**
- Create: `core/src/scoring/signals/aghs.ts`
- Test: `core/tests/scoring/signals/aghs.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// core/tests/scoring/signals/aghs.test.ts
import { describe, it, expect } from "vitest";
import { aghs, shard } from "../../../src/scoring/signals/aghs";
import type { ScoringContext } from "@ad/shared/types/scoring";

function ctx(map: Map<number, { scepterGain: number | null; shardGain: number | null }>): ScoringContext {
  return {
    me: { row: 0, hero: null, normals: [], ultimates: [] },
    pickIndex: 5, winrate: new Map(), pairWinrate: new Map(), aghs: map,
  };
}

describe("aghs/shard signals (gain over base)", () => {
  it("aghs returns scepter gain", () => {
    const c = ctx(new Map([[5051, { scepterGain: 0.078, shardGain: 0.047 }]]));
    expect(aghs(c, { valveId: 5051, slotType: "normal" })).toBeCloseTo(0.078, 6);
  });
  it("shard returns shard gain", () => {
    const c = ctx(new Map([[5051, { scepterGain: 0.078, shardGain: 0.047 }]]));
    expect(shard(c, { valveId: 5051, slotType: "normal" })).toBeCloseTo(0.047, 6);
  });
  it("both return 0 when no data", () => {
    const c = ctx(new Map());
    expect(aghs(c, { valveId: 999, slotType: "normal" })).toBe(0);
    expect(shard(c, { valveId: 999, slotType: "normal" })).toBe(0);
  });
  it("null gain treated as 0", () => {
    const c = ctx(new Map([[5051, { scepterGain: null, shardGain: null }]]));
    expect(aghs(c, { valveId: 5051, slotType: "normal" })).toBe(0);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run:`npx vitest run scoring/signals/aghs`
Expected: FAIL,模块不存在。

- [ ] **Step 3: 最小实现**

```ts
// core/src/scoring/signals/aghs.ts
// 信号④:神杖/魔晶增益(细则 §2④)。阶段 0 已把「有杖减无杖胜率差」存为 scepter_gain/shard_gain。
import type { Signal } from "@ad/shared/types/scoring";

export const aghs: Signal = (ctx, candidate) => {
  const row = ctx.aghs.get(candidate.valveId);
  return row?.scepterGain ?? 0;
};

export const shard: Signal = (ctx, candidate) => {
  const row = ctx.aghs.get(candidate.valveId);
  return row?.shardGain ?? 0;
};
```

- [ ] **Step 4: 跑测试确认通过**

Run:`npx vitest run scoring/signals/aghs`
Expected: PASS(4 passed)。

- [ ] **Step 5: Commit**

```bash
git add core/src/scoring/signals/aghs.ts core/tests/scoring/signals/aghs.test.ts
git commit -m "feat(core): aghs/shard gain scoring signals (S_aghs, S_shard)"
```

---

## Task 7: 动态权重(scoring/weights.ts)

细则 §3 的核心:权重随顺位变化。实现 `f_front`/`f_back` 与 `resolveWeights(cfg, pickIndex)` —— 把基础权重 $w^0$ 解析成本手实际权重。pickIndex 未知时退化为基础权重(动态因子按「无前后置倾向」处理 → 用 f_front=f_back=0,即 `w_base=w_base⁰`、`w_synergy=0`、`w_aghs=w_aghs⁰`)。

**Files:**
- Create: `core/src/scoring/weights.ts`
- Test: `core/tests/scoring/weights.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// core/tests/scoring/weights.test.ts
import { describe, it, expect } from "vitest";
import { fFront, fBack, resolveWeights } from "../../src/scoring/weights";
import type { ScoringConfig } from "@ad/shared/types/scoring";

const CFG: ScoringConfig = {
  baseWeights: { base: 1.0, synergy: 1.5, aghs: 0.8, shard: 0.5, pos: 0.6 },
  alpha: 0.5, beta: 0.4, sigma: 10, firstRoundSize: 10, topK: 4,
};

describe("f_front / f_back", () => {
  it("f_front: 1 at P=1, 0 at P=10 (decay)", () => {
    expect(fFront(1, 10)).toBeCloseTo(1, 6);
    expect(fFront(10, 10)).toBeCloseTo(0, 6);
  });
  it("f_back: 0 at P=1, 1 at P=10 (growth)", () => {
    expect(fBack(1, 10)).toBeCloseTo(0, 6);
    expect(fBack(10, 10)).toBeCloseTo(1, 6);
  });
  it("both clamp at 0 past the first round", () => {
    expect(fFront(15, 10)).toBe(0);
    expect(fBack(15, 10)).toBe(1); // P-1 over 9 已 >1 → 但细则 max(0,·) 只防负;增益超 1 由设计容忍
  });
});

describe("resolveWeights (dynamic per pick position)", () => {
  it("front pick (P=1): base maximized, synergy zeroed, aghs normal", () => {
    const w = resolveWeights(CFG, 1);
    expect(w.base).toBeCloseTo(1.0 * (1 + 0.5 * 1), 6); // w_base⁰·(1+α)
    expect(w.synergy).toBeCloseTo(0, 6);                // w_synergy⁰·f_back(=0)
    expect(w.aghs).toBeCloseTo(0.8 * (1 + 0.4 * 0), 6); // 正常化
    expect(w.shard).toBeCloseTo(0.5, 6);                // 恒定
    expect(w.pos).toBeCloseTo(0.6, 6);                  // 恒定
  });

  it("back pick (P=10): synergy maximized, aghs boosted, base normal", () => {
    const w = resolveWeights(CFG, 10);
    expect(w.base).toBeCloseTo(1.0, 6);                 // w_base⁰·(1+α·0)
    expect(w.synergy).toBeCloseTo(1.5, 6);              // w_synergy⁰·f_back(=1)
    expect(w.aghs).toBeCloseTo(0.8 * (1 + 0.4 * 1), 6); // 提权
  });

  it("unknown pickIndex degrades to no front/back tendency", () => {
    const w = resolveWeights(CFG, null);
    expect(w.base).toBeCloseTo(1.0, 6);   // f_front=0
    expect(w.synergy).toBeCloseTo(0, 6);  // f_back=0
    expect(w.aghs).toBeCloseTo(0.8, 6);
  });

  it("omits a signal whose base weight is 0/absent", () => {
    const w = resolveWeights({ ...CFG, baseWeights: { base: 1 } }, 5);
    expect(w.base).toBeGreaterThan(0);
    expect(w.synergy).toBeUndefined();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run:`npx vitest run scoring/weights`
Expected: FAIL,模块不存在。

- [ ] **Step 3: 最小实现**

```ts
// core/src/scoring/weights.ts
// 动态权重(细则 §3):权重随顺位 P_curr 变化。把基础 w⁰ 解析成本手实际权重。
import type { ScoringConfig, SignalId } from "@ad/shared/types/scoring";

/** 前置位倾向(衰减):第1手=1,第 firstRoundSize 手→0。 */
export function fFront(pCurr: number, firstRoundSize: number): number {
  return Math.max(0, (firstRoundSize - pCurr) / (firstRoundSize - 1));
}

/** 后置位倾向(增益):第1手=0,第 firstRoundSize 手→1。 */
export function fBack(pCurr: number, firstRoundSize: number): number {
  return Math.max(0, (pCurr - 1) / (firstRoundSize - 1));
}

/** 解析本手各信号实际权重。pickIndex=null → f_front=f_back=0(无前后置倾向)。 */
export function resolveWeights(
  cfg: ScoringConfig,
  pickIndex: number | null,
): Partial<Record<SignalId, number>> {
  const ff = pickIndex === null ? 0 : fFront(pickIndex, cfg.firstRoundSize);
  const fb = pickIndex === null ? 0 : fBack(pickIndex, cfg.firstRoundSize);
  const b = cfg.baseWeights;
  const out: Partial<Record<SignalId, number>> = {};
  // 仅解析基础权重存在且非 0 的维度(关闭的维度不出现)。
  if (b.base)    out.base = b.base * (1 + cfg.alpha * ff);
  if (b.synergy) out.synergy = b.synergy * fb;
  if (b.aghs)    out.aghs = b.aghs * (1 + cfg.beta * fb);
  if (b.shard)   out.shard = b.shard;
  if (b.pos)     out.pos = b.pos;
  // 扩展位维度(snipe/teammate_protect 等):无动态规则时按恒定基础权重透传。
  for (const id of Object.keys(b) as SignalId[]) {
    if (out[id] === undefined && b[id]) out[id] = b[id];
  }
  return out;
}
```

> **注:** `f_back` 在 P > firstRoundSize 时 `(P-1)/9` 会 >1(细则只 `max(0,·)` 防负,不封顶)。这是细则设计容忍的——后续轮次仍偏后置位逻辑。若要封顶在 1,可改 `Math.min(1, max(0, ...))`,但**本阶段忠实于细则原文不封顶**。

- [ ] **Step 4: 跑测试确认通过**

Run:`npx vitest run scoring/weights`
Expected: PASS(7 passed)。

- [ ] **Step 5: Commit**

```bash
git add core/src/scoring/weights.ts core/tests/scoring/weights.test.ts
git commit -m "feat(core): dynamic per-pick-position weight resolution (f_front/f_back/alpha/beta)"
```

---

## Task 8: 信号注册表 + 可配置默认 config(signals/index.ts + config.ts)

「打分机制可供修改」的枢纽。注册表把 SignalId 映射到 signal(`pos` 用 config.sigma 实例化);config 给基础权重 + α/β/σ/topK。`loadScoringConfig` 从 JSON 读(供离线回测改参数不重编译)。

**Files:**
- Create: `core/src/scoring/signals/index.ts`
- Create: `core/src/scoring/config.ts`
- Test: `core/tests/scoring/config.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// core/tests/scoring/config.test.ts
import { describe, it, expect } from "vitest";
import { buildSignals } from "../../src/scoring/signals/index";
import { defaultScoringConfig, loadScoringConfig } from "../../src/scoring/config";

describe("signal registry", () => {
  it("builds the five spec signals (base/synergy/pos/aghs/shard)", () => {
    const signals = buildSignals(defaultScoringConfig());
    expect(Object.keys(signals)).toEqual(
      expect.arrayContaining(["base", "synergy", "pos", "aghs", "shard"]),
    );
  });
  it("every built signal is a function", () => {
    const signals = buildSignals(defaultScoringConfig());
    for (const id of Object.keys(signals)) {
      expect(typeof signals[id as keyof typeof signals]).toBe("function");
    }
  });
});

describe("scoring config", () => {
  it("default config matches 打分细则 §3 recommended params", () => {
    const cfg = defaultScoringConfig();
    expect(cfg.baseWeights).toEqual({ base: 1.0, synergy: 1.5, aghs: 0.8, shard: 0.5, pos: 0.6 });
    expect(cfg.alpha).toBe(0.5);
    expect(cfg.beta).toBe(0.4);
    expect(cfg.sigma).toBe(10);
    expect(cfg.topK).toBe(4);
  });
  it("loadScoringConfig parses JSON, rejects unknown signal ids, fills defaults", () => {
    const ok = loadScoringConfig('{"baseWeights":{"base":2},"alpha":0.7}');
    expect(ok.baseWeights.base).toBe(2);
    expect(ok.alpha).toBe(0.7);
    expect(ok.beta).toBe(0.4);   // 缺省回落默认
    expect(ok.sigma).toBe(10);
    expect(() => loadScoringConfig('{"baseWeights":{"nope":1}}')).toThrow();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run:`npx vitest run scoring/config`
Expected: FAIL,模块不存在。

- [ ] **Step 3: 最小实现**

```ts
// core/src/scoring/signals/index.ts
// 信号注册表:按 config 构建(pos 需 config.sigma)。新增维度 = 在此注册一个 signal。
import type { ScoringConfig, Signal, SignalId } from "@ad/shared/types/scoring";
import { base } from "./base";
import { synergy } from "./synergy";
import { makePosSignal } from "./pos";
import { aghs, shard } from "./aghs";

/** 已知 SignalId 全集(用于 config 校验)。 */
export const KNOWN_SIGNALS: SignalId[] = [
  "base", "synergy", "pos", "aghs", "shard", "snipe", "teammate_protect",
];

/** 用 config 构建 signal 集(pos 注入 σ)。扩展位实现后在此加。 */
export function buildSignals(cfg: ScoringConfig): Partial<Record<SignalId, Signal>> {
  return {
    base,
    synergy,
    pos: makePosSignal(cfg.sigma),
    aghs,
    shard,
    // snipe / teammate_protect:实现后在此注册 + 给基础权重即可生效。
  };
}
```

```ts
// core/src/scoring/config.ts
// 可配置打分:默认参数(细则 §3)+ 从 JSON 加载(回测改参数不重编译)。
import type { ScoringConfig, SignalId } from "@ad/shared/types/scoring";
import { KNOWN_SIGNALS } from "./signals/index";

export function defaultScoringConfig(): ScoringConfig {
  return {
    baseWeights: { base: 1.0, synergy: 1.5, aghs: 0.8, shard: 0.5, pos: 0.6 },
    alpha: 0.5, beta: 0.4, sigma: 10, firstRoundSize: 10, topK: 4,
  };
}

/** 解析 JSON config;校验 baseWeights 的 key 都是已知 SignalId;缺省字段回落默认。 */
export function loadScoringConfig(json: string): ScoringConfig {
  const parsed = JSON.parse(json) as Partial<ScoringConfig>;
  const d = defaultScoringConfig();
  const baseWeights = parsed.baseWeights ?? d.baseWeights;
  for (const id of Object.keys(baseWeights)) {
    if (!KNOWN_SIGNALS.includes(id as SignalId)) {
      throw new Error(`unknown signal id in scoring config: ${id}`);
    }
  }
  return {
    baseWeights,
    alpha: parsed.alpha ?? d.alpha,
    beta: parsed.beta ?? d.beta,
    sigma: parsed.sigma ?? d.sigma,
    firstRoundSize: parsed.firstRoundSize ?? d.firstRoundSize,
    topK: parsed.topK ?? d.topK,
  };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run:`npx vitest run scoring/config`
Expected: PASS(4 passed)。

- [ ] **Step 5: Commit**

```bash
git add core/src/scoring/signals/index.ts core/src/scoring/config.ts core/tests/scoring/config.test.ts
git commit -m "feat(core): signal registry + loadable config (params from 打分细则 §3)"
```

---

## Task 9: 动态加权合成 + 排序(scoring/score.ts)

对维度无知的合成器:`resolveWeights(cfg, pickIndex)` 得本手权重 → 对每候选 `Σ w_i · S_i(ctx)`,记 breakdown(`w·S`),按总分降序。**新增维度时本文件零改动**——这正是「可配置」的证据。

**Files:**
- Create: `core/src/scoring/score.ts`
- Test: `core/tests/scoring/score.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// core/tests/scoring/score.test.ts
import { describe, it, expect } from "vitest";
import { scoreCandidates } from "../../src/scoring/score";
import { defaultScoringConfig } from "../../src/scoring/config";
import type { Candidate, ScoringContext, ScoringConfig } from "@ad/shared/types/scoring";

function ctx(pickIndex: number | null): ScoringContext {
  return {
    me: { row: 0, hero: -9, normals: [5051], ultimates: [] },
    pickIndex,
    winrate: new Map([
      [5052, { winrate: 0.58, avgPickPosition: 4 }],
      [5053, { winrate: 0.50, avgPickPosition: 25 }],
      [-7, { winrate: 0.55, avgPickPosition: null }],
    ]),
    pairWinrate: new Map([["-9|5052", 0.57], ["5051|5052", 0.56]]),
    aghs: new Map([[5052, { scepterGain: 0.06, shardGain: 0.02 }]]),
  };
}
const POOL: Candidate[] = [
  { valveId: 5052, slotType: "normal" },
  { valveId: 5053, slotType: "normal" },
  { valveId: -7, slotType: "hero" },
];

describe("scoreCandidates (dynamic weighting)", () => {
  it("ranks the synergistic + high-winrate candidate first (mid pick)", () => {
    const ranked = scoreCandidates(POOL, ctx(5), defaultScoringConfig());
    expect(ranked[0].candidate.valveId).toBe(5052);
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score);
  });

  it("compares heroes and abilities on one unified score (cross-type)", () => {
    // 只开 base:5052(.58) > -7(.55) > 5053(.50)
    const onlyBase: ScoringConfig = { ...defaultScoringConfig(), baseWeights: { base: 1 } };
    const ranked = scoreCandidates(POOL, ctx(5), onlyBase);
    expect(ranked.map((r) => r.candidate.valveId)).toEqual([5052, -7, 5053]);
  });

  it("front pick zeroes synergy contribution (dynamic weight)", () => {
    // P=1 → w_synergy=0 → 5052 的 breakdown 不含 synergy 贡献(或为 0)
    const ranked = scoreCandidates(POOL, ctx(1), defaultScoringConfig());
    const top = ranked.find((r) => r.candidate.valveId === 5052)!;
    expect(top.breakdown.synergy ?? 0).toBe(0);
  });

  it("back pick gives synergy a positive contribution", () => {
    const ranked = scoreCandidates(POOL, ctx(10), defaultScoringConfig());
    const top = ranked.find((r) => r.candidate.valveId === 5052)!;
    expect(top.breakdown.synergy ?? 0).toBeGreaterThan(0);
  });

  it("reweighting changes ranking (mechanism is modifiable)", () => {
    const synergyHeavy: ScoringConfig = {
      ...defaultScoringConfig(), baseWeights: { base: 0.1, synergy: 10 },
    };
    const ranked = scoreCandidates(POOL, ctx(10), synergyHeavy);
    expect(ranked[0].candidate.valveId).toBe(5052);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run:`npx vitest run scoring/score`
Expected: FAIL,模块不存在。

- [ ] **Step 3: 最小实现**

```ts
// core/src/scoring/score.ts
// 动态加权合成(细则 §1)+ 排序。对维度无知:新增维度不改本文件。
import type {
  Candidate, ScoredCandidate, ScoringConfig, ScoringContext, SignalId,
} from "@ad/shared/types/scoring";
import { buildSignals } from "./signals/index";
import { resolveWeights } from "./weights";

export function scoreCandidates(
  pool: Candidate[],
  ctx: ScoringContext,
  cfg: ScoringConfig,
): ScoredCandidate[] {
  const signals = buildSignals(cfg);
  const weights = resolveWeights(cfg, ctx.pickIndex); // 本手动态权重
  const activeIds = (Object.keys(weights) as SignalId[]).filter(
    (id) => (weights[id] ?? 0) !== 0 && signals[id] !== undefined,
  );

  const scored = pool.map((candidate): ScoredCandidate => {
    const breakdown: Partial<Record<SignalId, number>> = {};
    let total = 0;
    for (const id of activeIds) {
      const w = weights[id] ?? 0;
      const contrib = w * signals[id]!(ctx, candidate);
      breakdown[id] = contrib;
      total += contrib;
    }
    return { candidate, score: total, breakdown };
  });

  scored.sort((a, b) => b.score - a.score); // 跨类型统一降序
  return scored;
}
```

> **关于「front pick zeroes synergy」测试:** P=1 时 `resolveWeights` 算出 `synergy` 权重 = `w_synergy⁰·f_back(1)=1.5·0=0`,被 `activeIds` 过滤掉 → breakdown 无 `synergy` 键,`?? 0` 取 0。✓

- [ ] **Step 4: 跑测试确认通过**

Run:`npx vitest run scoring/score`
Expected: PASS(5 passed)。

- [ ] **Step 5: Commit**

```bash
git add core/src/scoring/score.ts core/tests/scoring/score.test.ts
git commit -m "feat(core): dimension-agnostic dynamic weighted scoring + cross-type ranking"
```

---

## Task 10: 数据访问——从 reference.db 构建 ScoringContext(scoring/data.ts)

一次性从 `reference.db` 只读查好 signal 所需数据,合并成 `ScoringContext`:胜率合并 `ability_winrate`(正)与 `hero_winrate`(英雄→-heroId);pair 读 `ability_pairs`(键用 `pairKey`);**神杖/魔晶收益读 `ability_aghs`**(阶段 0 已存 `scepter_gain`/`shard_gain`)。

**Files:**
- Create: `core/src/scoring/data.ts`
- Test: `core/tests/scoring/data.test.ts`

- [ ] **Step 1: 写失败测试(临时 sqlite,造阶段 0 schema 子集)**

```ts
// core/tests/scoring/data.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Database from "better-sqlite3";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";
import { buildScoringContext } from "../../src/scoring/data";
import { pairKey } from "../../src/scoring/signals/synergy";
import type { PlayerState } from "@ad/shared/types/draft";

let dbPath: string;
beforeAll(() => {
  dbPath = join(tmpdir(), `score-${Date.now()}.db`);
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE ability_winrate (ability_id INTEGER PRIMARY KEY, patch TEXT,
      num_picks INTEGER, wins INTEGER, winrate REAL, avg_pick_position REAL, pick_rate REAL);
    CREATE TABLE hero_winrate (hero_id INTEGER PRIMARY KEY, patch TEXT,
      wins INTEGER, num_games INTEGER, winrate REAL);
    CREATE TABLE ability_pairs (ability_id_one INTEGER, ability_id_two INTEGER,
      num_picks INTEGER, wins INTEGER, winrate REAL, PRIMARY KEY (ability_id_one, ability_id_two));
    CREATE TABLE ability_aghs (ability_id INTEGER PRIMARY KEY, scepter_gain REAL, shard_gain REAL);
  `);
  db.prepare("INSERT INTO ability_winrate VALUES (5051,'p',10,5,0.55,8.4,0.9)").run();
  db.prepare("INSERT INTO hero_winrate VALUES (9,'p',1,2,0.52)").run();
  db.prepare("INSERT INTO ability_pairs VALUES (-9,5051,10,6,0.57)").run();
  db.prepare("INSERT INTO ability_aghs VALUES (5051,0.078,0.047)").run();
  db.close();
});
afterAll(() => rmSync(dbPath, { force: true }));

describe("buildScoringContext", () => {
  const me: PlayerState = { row: 0, hero: -9, normals: [], ultimates: [] };

  it("merges ability + hero winrates into one map keyed by valveId", () => {
    const ctx = buildScoringContext(dbPath, me, 5);
    expect(ctx.winrate.get(5051)?.winrate).toBe(0.55);
    expect(ctx.winrate.get(5051)?.avgPickPosition).toBe(8.4);
    expect(ctx.winrate.get(-9)?.winrate).toBe(0.52); // hero 9 → -9
  });

  it("loads ability pairs under order-independent pairKey", () => {
    expect(buildScoringContext(dbPath, me, 5).pairWinrate.get(pairKey(-9, 5051))).toBe(0.57);
  });

  it("loads aghs scepter/shard gains", () => {
    const ctx = buildScoringContext(dbPath, me, 5);
    expect(ctx.aghs.get(5051)?.scepterGain).toBeCloseTo(0.078, 6);
    expect(ctx.aghs.get(5051)?.shardGain).toBeCloseTo(0.047, 6);
  });

  it("carries me + pickIndex through", () => {
    const ctx = buildScoringContext(dbPath, me, 7);
    expect(ctx.me.hero).toBe(-9);
    expect(ctx.pickIndex).toBe(7);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run:`npx vitest run scoring/data`
Expected: FAIL,模块不存在。

- [ ] **Step 3: 最小实现**

```ts
// core/src/scoring/data.ts
// 从 reference.db 只读构建 ScoringContext。signal 不碰 DB —— 数据在此一次性备齐。
import Database from "better-sqlite3";
import type { ScoringContext, WinrateRow, AghsRow } from "@ad/shared/types/scoring";
import type { PlayerState } from "@ad/shared/types/draft";
import { pairKey } from "./signals/synergy";

export function buildScoringContext(
  dbPath: string,
  me: PlayerState,
  pickIndex: number | null,
): ScoringContext {
  const db = new Database(dbPath, { readonly: true });
  try {
    const winrate = new Map<number, WinrateRow>();
    for (const r of db.prepare(
      "SELECT ability_id, winrate, avg_pick_position FROM ability_winrate",
    ).all() as Array<{ ability_id: number; winrate: number | null; avg_pick_position: number | null }>) {
      winrate.set(r.ability_id, { winrate: r.winrate, avgPickPosition: r.avg_pick_position });
    }
    for (const r of db.prepare(
      "SELECT hero_id, winrate FROM hero_winrate",
    ).all() as Array<{ hero_id: number; winrate: number | null }>) {
      winrate.set(-r.hero_id, { winrate: r.winrate, avgPickPosition: null });
    }

    const pairWinrate = new Map<string, number>();
    for (const r of db.prepare(
      "SELECT ability_id_one, ability_id_two, winrate FROM ability_pairs",
    ).all() as Array<{ ability_id_one: number; ability_id_two: number; winrate: number | null }>) {
      if (r.winrate !== null) pairWinrate.set(pairKey(r.ability_id_one, r.ability_id_two), r.winrate);
    }

    const aghs = new Map<number, AghsRow>();
    for (const r of db.prepare(
      "SELECT ability_id, scepter_gain, shard_gain FROM ability_aghs",
    ).all() as Array<{ ability_id: number; scepter_gain: number | null; shard_gain: number | null }>) {
      aghs.set(r.ability_id, { scepterGain: r.scepter_gain, shardGain: r.shard_gain });
    }

    return { me, pickIndex, winrate, pairWinrate, aghs };
  } finally {
    db.close();
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run:`npx vitest run scoring/data`
Expected: PASS(4 passed)。

- [ ] **Step 5: Commit**

```bash
git add core/src/scoring/data.ts core/tests/scoring/data.test.ts
git commit -m "feat(core): build ScoringContext from reference.db (winrate/pairs/aghs)"
```

---

## Task 11: 端到端打分编排 + Top-K(scoring/recommend.ts)

细则 §4 全流程:硬过滤 → 构建上下文 → 动态打分排序 → **取 Top-K(默认 3~4)**。验收覆盖计划书 §十阶段 3:推荐永远合法、典型局面排序合理、跨类型、Top-K 截断。

**Files:**
- Create: `core/src/scoring/recommend.ts`
- Modify: `core/package.json`(加 scoring + statemachine/quota exports 子路径)
- Test: `core/tests/scoring/recommend.test.ts`

- [ ] **Step 1: 写失败测试(临时 DB)**

```ts
// core/tests/scoring/recommend.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Database from "better-sqlite3";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";
import { recommend } from "../../src/scoring/recommend";
import { defaultScoringConfig } from "../../src/scoring/config";
import type { Candidate } from "@ad/shared/types/scoring";
import type { PlayerState } from "@ad/shared/types/draft";

let dbPath: string;
beforeAll(() => {
  dbPath = join(tmpdir(), `rec-${Date.now()}.db`);
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE ability_winrate (ability_id INTEGER PRIMARY KEY, patch TEXT,
      num_picks INTEGER, wins INTEGER, winrate REAL, avg_pick_position REAL, pick_rate REAL);
    CREATE TABLE hero_winrate (hero_id INTEGER PRIMARY KEY, patch TEXT, wins INTEGER, num_games INTEGER, winrate REAL);
    CREATE TABLE ability_pairs (ability_id_one INTEGER, ability_id_two INTEGER, num_picks INTEGER, wins INTEGER, winrate REAL, PRIMARY KEY (ability_id_one, ability_id_two));
    CREATE TABLE ability_aghs (ability_id INTEGER PRIMARY KEY, scepter_gain REAL, shard_gain REAL);
  `);
  // 6 个普通候选,胜率递减,确保 Top-K 截断可验
  for (let i = 0; i < 6; i++) {
    db.prepare("INSERT INTO ability_winrate VALUES (?,?,?,?,?,?,?)").run(5050 + i, "p", 10, 5, 0.6 - i * 0.02, 5, 0.9);
  }
  db.prepare("INSERT INTO ability_winrate VALUES (6001,'p',10,5,0.59,3,0.9)").run();
  db.prepare("INSERT INTO ability_pairs VALUES (-9,5050,10,6,0.57)").run();
  db.close();
});
afterAll(() => rmSync(dbPath, { force: true }));

describe("recommend (acceptance, 细则 §4)", () => {
  it("never recommends a full slot type (always legal)", () => {
    const pool: Candidate[] = [
      { valveId: 5050, slotType: "normal" }, { valveId: 6001, slotType: "ultimate" },
    ];
    const me: PlayerState = { row: 0, hero: -9, normals: [], ultimates: [99] }; // 终极满
    const out = recommend(pool, me, 5, dbPath, defaultScoringConfig());
    expect(out.some((r) => r.candidate.slotType === "ultimate")).toBe(false);
  });

  it("truncates to topK (default 4)", () => {
    const pool: Candidate[] = Array.from({ length: 6 }, (_, i) => ({ valveId: 5050 + i, slotType: "normal" as const }));
    const me: PlayerState = { row: 0, hero: -9, normals: [], ultimates: [] };
    const out = recommend(pool, me, 5, dbPath, defaultScoringConfig());
    expect(out.length).toBe(4);
    expect(out[0].candidate.valveId).toBe(5050); // 最高胜率
  });

  it("respects a custom topK", () => {
    const pool: Candidate[] = Array.from({ length: 6 }, (_, i) => ({ valveId: 5050 + i, slotType: "normal" as const }));
    const me: PlayerState = { row: 0, hero: -9, normals: [], ultimates: [] };
    const out = recommend(pool, me, 5, dbPath, { ...defaultScoringConfig(), topK: 3 });
    expect(out.length).toBe(3);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run:`npx vitest run scoring/recommend`
Expected: FAIL,模块不存在。

- [ ] **Step 3: 最小实现**

```ts
// core/src/scoring/recommend.ts
// 端到端(细则 §4):硬过滤 → 上下文 → 动态打分 → Top-K。
import type { Candidate, ScoredCandidate, ScoringConfig } from "@ad/shared/types/scoring";
import type { PlayerState } from "@ad/shared/types/draft";
import { hardFilter } from "./filter";
import { buildScoringContext } from "./data";
import { scoreCandidates } from "./score";

export function recommend(
  pool: Candidate[],
  me: PlayerState,
  pickIndex: number | null,
  dbPath: string,
  cfg: ScoringConfig,
): ScoredCandidate[] {
  const legal = hardFilter(pool, me);             // 第 0 步:先于一切打分
  if (legal.length === 0) return [];
  const ctx = buildScoringContext(dbPath, me, pickIndex);
  const ranked = scoreCandidates(legal, ctx, cfg);
  return ranked.slice(0, cfg.topK);                // Top 3~4
}
```

- [ ] **Step 4: 加 core exports 子路径**

`core/package.json` 的 `exports` 加(`statemachine/quota` 供阶段 4 `main/` 子路径消费,一并导出):
```json
"./scoring/recommend": "./src/scoring/recommend.ts",
"./scoring/config": "./src/scoring/config.ts",
"./statemachine/quota": "./src/statemachine/quota.ts"
```

- [ ] **Step 5: 跑测试确认通过**

Run:`npx vitest run scoring/recommend`
Expected: PASS(3 passed)。

- [ ] **Step 6: Commit**

```bash
git add core/src/scoring/recommend.ts core/package.json core/tests/scoring/recommend.test.ts
git commit -m "feat(core): recommend entrypoint (hard-filter -> dynamic score -> Top-K)"
```

---

## Task 12: 离线回测钩子(scoring/backtest.ts)

计划书 §六 / 细则可回测:给定「局面 + 实际选取」,用不同 `ScoringConfig` 跑 `recommend`,报告 top-K 命中率,证明参数可调(权重 + α/β/σ)且回测闭环存在。

**Files:**
- Create: `core/src/scoring/backtest.ts`
- Create: `core/scripts/backtest.ts`
- Test: `core/tests/scoring/backtest.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// core/tests/scoring/backtest.test.ts
import { describe, it, expect } from "vitest";
import { hitRateAtK, type BacktestCase } from "../../src/scoring/backtest";
import type { ScoredCandidate } from "@ad/shared/types/scoring";

function ranked(ids: number[]): ScoredCandidate[] {
  return ids.map((valveId, i) => ({
    candidate: { valveId, slotType: "normal" as const },
    score: ids.length - i, breakdown: {},
  }));
}

describe("hitRateAtK", () => {
  it("counts a case as hit when actual pick is within top-K", () => {
    const cases: BacktestCase[] = [
      { actualPick: 5052, ranked: ranked([5052, 6001]) },
      { actualPick: 6001, ranked: ranked([5052, 6001]) },
    ];
    expect(hitRateAtK(cases, 1)).toBeCloseTo(0.5, 6);
    expect(hitRateAtK(cases, 2)).toBeCloseTo(1.0, 6);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run:`npx vitest run scoring/backtest`
Expected: FAIL,模块不存在。

- [ ] **Step 3: 最小实现(回测纯函数 + 薄脚本)**

```ts
// core/src/scoring/backtest.ts
// 回测:给定「局面 + 实际选取」,某 config 下排序的 top-K 命中率。
import type { ScoredCandidate } from "@ad/shared/types/scoring";

export interface BacktestCase {
  actualPick: number;
  ranked: ScoredCandidate[];
}

export function hitRateAtK(cases: BacktestCase[], k: number): number {
  if (cases.length === 0) return 0;
  let hits = 0;
  for (const c of cases) {
    if (c.ranked.slice(0, k).some((r) => r.candidate.valveId === c.actualPick)) hits += 1;
  }
  return hits / cases.length;
}
```

```ts
// core/scripts/backtest.ts
// 手动回测:对同一批局面跑两套 config,对比 top-3 命中率,证明「参数可改 → 排序可变」。
// 用法:npx tsx core/scripts/backtest.ts <reference.db> <cases.json>
import { readFileSync } from "node:fs";
import { recommend } from "../src/scoring/recommend";
import { defaultScoringConfig, loadScoringConfig } from "../src/scoring/config";
import { hitRateAtK, type BacktestCase } from "../src/scoring/backtest";

const [dbPath, casesPath] = process.argv.slice(2);
const raw = JSON.parse(readFileSync(casesPath, "utf-8")) as Array<{
  pool: { valveId: number; slotType: "hero" | "normal" | "ultimate" }[];
  me: { row: number; hero: number | null; normals: number[]; ultimates: number[] };
  pickIndex: number | null;
  actualPick: number;
}>;

function run(label: string, json?: string) {
  const cfg = json ? loadScoringConfig(json) : defaultScoringConfig();
  const cases: BacktestCase[] = raw.map((c) => ({
    actualPick: c.actualPick,
    ranked: recommend(c.pool, c.me, c.pickIndex, dbPath, cfg),
  }));
  console.log(`${label}: hit@3 = ${hitRateAtK(cases, 3).toFixed(3)}`);
}

run("default");
// 调 α/β/σ 与权重,观察命中率变化:
run("front-aggressive", '{"alpha":1.0,"beta":0.2,"baseWeights":{"base":2,"synergy":1,"aghs":0.8,"shard":0.5,"pos":0.6}}');
```

- [ ] **Step 4: 跑测试确认通过**

Run:`npx vitest run scoring/backtest`
Expected: PASS(1 passed)。

- [ ] **Step 5: Commit**

```bash
git add core/src/scoring/backtest.ts core/scripts/backtest.ts core/tests/scoring/backtest.test.ts
git commit -m "feat(core): offline backtest hook (top-K hit rate across configs)"
```

---

## 阶段 3 验收清单(对应计划书 §十「阶段 3」+ `打分细则.md`)

- [ ] `core/` 下 `npm test` 全绿(types / filter / signals×4文件 / weights / config / score / data / recommend / backtest)。
- [ ] **推荐永远合法**:`recommend.test.ts::never recommends a full slot type`(硬过滤先于打分,细则 §4.1)。
- [ ] **排序在典型局面下合理 + 跨类型统一比较**:`score.test.ts`、`recommend.test.ts`。
- [ ] **Top 3~4 截断**:`recommend.test.ts::truncates to topK` / `respects a custom topK`(细则 §4.4)。
- [ ] **五个信号对齐细则 §2**:
  - `base` = WR-0.5;`synergy` = 平均协同(分母 |M|);`pos` = tanh((P_curr-P_avg)/σ) 有界;`aghs`/`shard` = 收益差。
- [ ] **动态时变权重对齐细则 §3**:`weights.test.ts` —— f_front/f_back、前置位放大 base、后置位置零→满载 synergy、后置位提权 aghs;`score.test.ts::front pick zeroes synergy` / `back pick gives synergy`。
- [ ] **打分机制可供修改(用户硬要求 + 细则核心)** —— 证据:
  - 信号是注册表(`config.test.ts::builds the five spec signals`)。
  - 权重 = 基础 w⁰ + 动态系数 α/β/σ,且可从 JSON 加载、拒绝未知信号(`config.test.ts::loadScoringConfig`)。
  - 改权重/系数即变排序(`score.test.ts::reweighting changes ranking`;`weights.test.ts`)。
  - 新增维度不改 `score.ts`(对维度无知,扩展位 snipe/teammate_protect 已留)。
- [ ] 默认参数 = 细则 §3 推荐值(`config.test.ts::matches 打分细则 §3`)。
- [ ] 确定性纯计算,signal 不碰 DB、不触 LLM;离线回测闭环存在(计划书 §五/§六)。

> **扩展位(本阶段留好接口,后续按同一注册表 + 动态权重模式接入,不改 `score()`):** `snipe`(截胡:对手价值高 × 本人可用)、`teammate_protect`(队友保护)——计划书 §五.5–6。每个 = 一个 signal + 在 `buildSignals` 注册 + 给基础权重 + (可选)在 `resolveWeights` 加动态规则。

> **下一步依赖:** `recommend()` 输出的 `ScoredCandidate[]`(已 Top-K)→ 阶段 4 overlay 渲染源(候选排序 + breakdown 高亮);`ScoringConfig`(基础权重 + α/β/σ/topK)→ 阶段 4 控制面板的可调参数 UI 数据模型;`breakdown` → 阶段 5 LLM 解释层的 grounded 输入。
