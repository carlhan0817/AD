# AD 中央技能池 ROI 重标定(比例化)+ 候选池识别 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把识别布局从错误的"十行 4×12 单网格"改成贴合真实 AD 界面的中央双区技能池(比例化坐标),让识别链路越过 `②布局校验`,并识别出池中所有技能产出本局候选池 `valveId[]`。

**Architecture:** 在 `core/src/recognition/roi.ts` 新增"相对客户区比例(0..1)"的 `PoolRowSpec`/`PoolLayout` 模型与 `POOL_LAYOUT_RATIO` 标定常量,以及"比例 × 窗口矩形 → 像素 ROI"纯函数推导;新增 `core/src/recognition/pool_recognize.ts` 把比例布局裁格、复用现有 `recognizeCell` 识别、收集候选池;`diffRois` 改用池区代表格作 `anchors`;在 `main/src/capture/loop.ts` 把 `gameClientRect` 的窗口矩形经 `MonitorDeps` 传入,tick 中用它推导像素布局、过②校验、调 `recognizePool` 并诊断打印"识别到 N 个技能";`app/src/main/index.ts` 启动时把 `gameClientRect(hwnd)` 放进 `MonitorDeps`。

**Tech Stack:** TypeScript(monorepo,`@ad/core` / `@ad/main` / `@ad/shared` 包别名),Vitest 测试,Electron 主进程,koffi(只读 user32),既有 phash 模板索引 + 灰度链。

## Global Constraints

- **TDD**:core 纯逻辑全部先写失败测试再实现;运行 `npm test`(在 `core/` 目录)用 Vitest。
- **坐标全部比例化**:`PoolRowSpec` 字段一律是 0..1 的相对客户区比例,绝不写死像素;像素仅在运行时由 `× gameClientRect` 推导。
- **复用不重写**:`recognizeCell`、phash 索引、`toGrayFrame`/灰度链、`cropRaw`/`cropGrid`、`resizeGrayTo32`、`FrameGate`、`isValidLayout`(`anchorVariance` / `MIN_ANCHOR_VARIANCE=50`)、状态机、所有 ffi/koffi/合规/DB 代码 **保持不动**。
- **合规红线**:任何 koffi 写操作只能作用于自身 overlay HWND,绝不改 Dota2 窗口。本计划不新增任何 koffi 调用。
- **范围红线**:本计划只产出候选池 `valveId[]` 并诊断打印,**不**把候选池喂 `recommend`,**不**做用户绿框/ActivePicker/两列玩家卡片识别(明确留后续)。
- **标定基准**:`POOL_LAYOUT_RATIO` 比例值量自用户 1920×1080 无边框真机截图(`docs/screenshot/20260619152847_1.jpg`、`docs/screenshot/20260619153032_1.jpg` 等);等比缩放假设仅在 1920×1080 真机验证。
- **rect 类型**:窗口矩形复用既有 `WindowRect`(`main/src/ffi/geometry.ts`:`{ x, y, width, height }`),不新建类型。

---

### Task 1: 比例池模型 + 比例→像素 ROI 推导(纯函数)

新增比例化布局类型与"比例 × 窗口矩形 → 像素格子 ROI"的纯函数推导。这是整条链路的几何基础,可完全独立单测。

**Files:**
- Modify: `core/src/recognition/roi.ts`(在文件末尾追加,不动现有导出)
- Test: `core/tests/recognition/pool_layout.test.ts`(新建)

**Interfaces:**
- Consumes:
  - `WindowRect` 形状 `{ x: number; y: number; width: number; height: number }`(此处在 `roi.ts` 内本地定义结构相同的入参类型 `ClientRect`,避免 core 依赖 main 包;字段名一致)。
  - `Rect`(已存在于 `roi.ts`:`{ x; y; w; h }`)作为像素 ROI 返回元素类型。
- Produces:
  - `interface PoolRowSpec { startXRatio: number; yRatio: number; cellRatio: number; gapRatio: number; count: number; zone: "ultimate" | "standard"; }`
  - `interface PoolLayout { rows: PoolRowSpec[]; }`
  - `interface ClientRect { x: number; y: number; width: number; height: number }`
  - `function poolCellRects(layout: PoolLayout, rect: ClientRect): Rect[]` —— 把每行每格的比例转成绝对像素 `Rect`(含窗口原点偏移 `rect.x`/`rect.y`),按"逐行、行内逐格"顺序铺平返回。格子是正方形:`w = h = round(cellRatio × rect.width)`。
  - `const POOL_LAYOUT_RATIO: PoolLayout` —— 标定常量(本任务先放可被几何测试验证的占位结构,真值在 Task 2 标定)。

- [ ] **Step 1: Write the failing test**

新建 `core/tests/recognition/pool_layout.test.ts`:

```ts
// core/tests/recognition/pool_layout.test.ts
import { describe, it, expect } from "vitest";
import { poolCellRects, type PoolLayout } from "../../src/recognition/roi";

describe("poolCellRects 比例→像素推导", () => {
  it("把单行比例按窗口矩形换算成绝对像素方格(含原点偏移)", () => {
    const layout: PoolLayout = {
      rows: [
        { startXRatio: 0.1, yRatio: 0.2, cellRatio: 0.05, gapRatio: 0.01, count: 3, zone: "standard" },
      ],
    };
    const rect = { x: 100, y: 50, width: 1000, height: 800 };
    const rects = poolCellRects(layout, rect);

    expect(rects.length).toBe(3);
    // 方格边长 = round(0.05 × 1000) = 50,宽=高
    expect(rects[0].w).toBe(50);
    expect(rects[0].h).toBe(50);
    // 第 0 格左上 = 原点偏移 + 比例像素:x = 100 + round(0.1×1000) = 200;y = 50 + round(0.2×800) = 210
    expect(rects[0].x).toBe(200);
    expect(rects[0].y).toBe(210);
    // 格间步距 = (cellRatio + gapRatio) × width = (0.05+0.01)×1000 = 60
    expect(rects[1].x).toBe(200 + 60);
    expect(rects[2].x).toBe(200 + 120);
    // 同一行 y 不变
    expect(rects[1].y).toBe(210);
  });

  it("多行铺平:先第0行所有格,再第1行所有格", () => {
    const layout: PoolLayout = {
      rows: [
        { startXRatio: 0.1, yRatio: 0.2, cellRatio: 0.05, gapRatio: 0.0, count: 2, zone: "ultimate" },
        { startXRatio: 0.1, yRatio: 0.4, cellRatio: 0.05, gapRatio: 0.0, count: 2, zone: "standard" },
      ],
    };
    const rect = { x: 0, y: 0, width: 1000, height: 1000 };
    const rects = poolCellRects(layout, rect);
    expect(rects.length).toBe(4);
    expect(rects[0].y).toBe(200); // 行0
    expect(rects[1].y).toBe(200); // 行0
    expect(rects[2].y).toBe(400); // 行1
    expect(rects[3].y).toBe(400); // 行1
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd core && npx vitest run tests/recognition/pool_layout.test.ts`
Expected: FAIL —— `poolCellRects`/`PoolLayout` 未从 `roi.ts` 导出(import 解析失败或运行时未定义)。

- [ ] **Step 3: Write minimal implementation**

在 `core/src/recognition/roi.ts` **末尾追加**(不改现有任何导出):

```ts
// ── 中央双区技能池:比例化布局(0..1 相对游戏客户区)+ 比例→像素推导 ──
// 真实技能池是 3D 透视梯形台,分两区,每行起点 x 与格子数可能不同,非规整矩形网格。
// 故按"一组行"建模,坐标全用相对比例,运行时 × 客户区矩形得真实像素。

/** 比例化的一行技能池格。所有字段是 0..1 的相对客户区比例。 */
export interface PoolRowSpec {
  startXRatio: number;             // 该行第一格左边缘 / 客户区宽
  yRatio: number;                  // 该行上边缘 / 客户区高
  cellRatio: number;               // 格子边长 / 客户区宽(方格,宽=高)
  gapRatio: number;                // 相邻格间距 / 客户区宽
  count: number;                   // 该行格子数
  zone: "ultimate" | "standard";   // 所属区
}
export interface PoolLayout { rows: PoolRowSpec[]; }

/** 运行时窗口客户区矩形(结构同 main 的 WindowRect;此处本地声明避免 core 依赖 main)。 */
export interface ClientRect { x: number; y: number; width: number; height: number }

/** 把比例布局按窗口客户区矩形换算成绝对像素方格,逐行逐格铺平返回。
 *  方格边长 = round(cellRatio × width),宽=高;含窗口原点偏移 rect.x/rect.y。 */
export function poolCellRects(layout: PoolLayout, rect: ClientRect): Rect[] {
  const out: Rect[] = [];
  for (const row of layout.rows) {
    const cell = Math.round(row.cellRatio * rect.width);
    const pitch = (row.cellRatio + row.gapRatio) * rect.width;
    const y = rect.y + Math.round(row.yRatio * rect.height);
    for (let c = 0; c < row.count; c++) {
      const x = rect.x + Math.round(row.startXRatio * rect.width + c * pitch);
      out.push({ x, y, w: cell, h: cell });
    }
  }
  return out;
}

// 标定常量:逐行比例值量自 1920×1080 真机截图。真值在标定任务填入;
// 先给一个结构合法的占位(单行),供几何纯函数测试通过,Task 2 用真值整体替换。
export const POOL_LAYOUT_RATIO: PoolLayout = {
  rows: [
    { startXRatio: 0.36, yRatio: 0.15, cellRatio: 0.042, gapRatio: 0.006, count: 5, zone: "ultimate" },
  ],
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd core && npx vitest run tests/recognition/pool_layout.test.ts`
Expected: PASS(2 个用例全绿)。

- [ ] **Step 5: Commit**

```bash
git add core/src/recognition/roi.ts core/tests/recognition/pool_layout.test.ts
git commit -m "feat(roi): add ratio-based pool layout model + ratio→pixel ROI derivation

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: 标定 `POOL_LAYOUT_RATIO`(从真机截图量比例)

把占位常量替换为量自 1920×1080 真机截图的真实双区比例。这一步是数据标定,无新逻辑;它影响真机能否过②与识别准确率,故单独成一任务以便复审"比例是否合理"。

**Files:**
- Modify: `core/src/recognition/roi.ts`(替换 `POOL_LAYOUT_RATIO` 常量体)
- Test: `core/tests/recognition/pool_layout.test.ts`(追加一个针对 `POOL_LAYOUT_RATIO` 的结构合法性断言)
- Reference(只读,辅助量值):`docs/screenshot/20260619152847_1.jpg`、`docs/screenshot/20260619153032_1.jpg`

**Interfaces:**
- Consumes:Task 1 的 `PoolRowSpec`/`PoolLayout`/`POOL_LAYOUT_RATIO`。
- Produces:标定后的 `POOL_LAYOUT_RATIO`(双区多行)。

> **标定方法(必须按真实截图,勿凭空):**
> 1. 打开 `docs/screenshot/20260619153032_1.jpg`(1920×1080)。把任一可见格子左上角像素坐标 `(px, py)` 与边长 `cw` 读出。
> 2. 比例 = 像素 / 客户区尺寸:`startXRatio = px/1920`,`yRatio = py/1080`,`cellRatio = cw/1920`,`gapRatio = (相邻格左缘差 − cw)/1920`。
> 3. 终极区约 2 行(每行约 5 格,偏窄、偏上);标准区约 4 行(每行约 7 格,偏宽、偏下,因 3D 透视下行越靠下越宽,逐行的 `startXRatio` 略减小、`cellRatio` 略增大)。
> 4. 下方占位值是从截图粗量的起点估计,**必须按真实截图逐行微调**后填入;真机若仍偏移,在真机验证阶段继续修。

- [ ] **Step 1: Write the failing test**

在 `core/tests/recognition/pool_layout.test.ts` 末尾追加(在最后一个 `});` 之前新增一个 `describe`):

```ts
import { POOL_LAYOUT_RATIO, poolCellRects } from "../../src/recognition/roi";

describe("POOL_LAYOUT_RATIO 标定常量结构", () => {
  it("含终极与标准两区,所有比例在 0..1,count 为正", () => {
    const zones = new Set(POOL_LAYOUT_RATIO.rows.map((r) => r.zone));
    expect(zones.has("ultimate")).toBe(true);
    expect(zones.has("standard")).toBe(true);
    for (const r of POOL_LAYOUT_RATIO.rows) {
      for (const v of [r.startXRatio, r.yRatio, r.cellRatio, r.gapRatio]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
      expect(r.count).toBeGreaterThan(0);
    }
  });

  it("在 1920×1080 下所有格子像素都落在画面内", () => {
    const rect = { x: 0, y: 0, width: 1920, height: 1080 };
    for (const c of poolCellRects(POOL_LAYOUT_RATIO, rect)) {
      expect(c.x).toBeGreaterThanOrEqual(0);
      expect(c.y).toBeGreaterThanOrEqual(0);
      expect(c.x + c.w).toBeLessThanOrEqual(1920);
      expect(c.y + c.h).toBeLessThanOrEqual(1080);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd core && npx vitest run tests/recognition/pool_layout.test.ts`
Expected: FAIL —— 第一个新用例失败:占位常量只有 `ultimate` 一行,`zones.has("standard")` 为 false。

- [ ] **Step 3: Write minimal implementation**

把 `core/src/recognition/roi.ts` 里的 `POOL_LAYOUT_RATIO` 整体替换为标定后的双区多行(下值为从截图粗量的起点,**实现期按上文标定方法对真实截图逐行核对微调**):

```ts
export const POOL_LAYOUT_RATIO: PoolLayout = {
  rows: [
    // 终极技能区(上,偏窄,约 2 行各 5 格)
    { startXRatio: 0.362, yRatio: 0.150, cellRatio: 0.044, gapRatio: 0.006, count: 5, zone: "ultimate" },
    { startXRatio: 0.360, yRatio: 0.205, cellRatio: 0.045, gapRatio: 0.006, count: 5, zone: "ultimate" },
    // 标准技能区(下,偏宽,约 4 行各 7 格;透视下越往下越宽,startX 略减、cell 略增)
    { startXRatio: 0.345, yRatio: 0.300, cellRatio: 0.046, gapRatio: 0.007, count: 7, zone: "standard" },
    { startXRatio: 0.340, yRatio: 0.380, cellRatio: 0.048, gapRatio: 0.007, count: 7, zone: "standard" },
    { startXRatio: 0.333, yRatio: 0.500, cellRatio: 0.050, gapRatio: 0.008, count: 7, zone: "standard" },
    { startXRatio: 0.326, yRatio: 0.620, cellRatio: 0.052, gapRatio: 0.008, count: 7, zone: "standard" },
  ],
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd core && npx vitest run tests/recognition/pool_layout.test.ts`
Expected: PASS(全部用例,包括 Task 1 的几何用例)。
> 若"落在画面内"用例失败,说明某行比例算出的格子越界,按报错的行收紧该行 `startXRatio`/`cellRatio`/`count`。

- [ ] **Step 5: Commit**

```bash
git add core/src/recognition/roi.ts core/tests/recognition/pool_layout.test.ts
git commit -m "feat(roi): calibrate POOL_LAYOUT_RATIO from 1080p real screenshots (dual zone)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `recognizePool` —— 按比例布局裁格识别、收集候选池

新增单一职责模块:输入帧 + 窗口矩形 + 索引,输出本局候选池 `valveId[]`。复用现有 `cropRaw`+`resizeGrayTo32`(裁格→32×32)与 `recognizeCell`(phash 最近邻),空格/未命中跳过。

**Files:**
- Create: `core/src/recognition/pool_recognize.ts`
- Test: `core/tests/recognition/pool_recognize.test.ts`(新建)

**Interfaces:**
- Consumes:
  - `GrayFrame`(`./grid`:`{ width; height; data: Uint8Array }`)
  - `ClientRect`、`PoolLayout`、`poolCellRects`(`./roi`,Task 1)
  - `cropRaw`(`./grid`)、`resizeGrayTo32`(`./resize`)
  - `recognizeCell`(`./recognize`:`(cellGray32: number[][], index: IndexEntry[], maxDistance?) => Match | null`)
  - `IndexEntry`(`./index_store`:`{ valveId; shortName; phash }`)
- Produces:
  - `function recognizePool(frame: GrayFrame, rect: ClientRect, index: IndexEntry[], layout?: PoolLayout, maxDistance?: number): number[]`
    返回去重后的命中 `valveId[]`(顺序按格子铺平顺序,首次出现保留)。`layout` 默认 `POOL_LAYOUT_RATIO`,`maxDistance` 默认 12(与 loop 现用阈值一致)。

- [ ] **Step 1: Write the failing test**

新建 `core/tests/recognition/pool_recognize.test.ts`。合成帧:把已知"纯色"sprite 贴进"比例 × rect 算出的格子像素位置",断言识别出对应 valveId(沿用 `recognize.test.ts` 的纯色→phash 思路,真实建小索引、不 mock)。

```ts
// core/tests/recognition/pool_recognize.test.ts
import { describe, it, expect } from "vitest";
import { recognizePool } from "../../src/recognition/pool_recognize";
import { poolCellRects, type PoolLayout } from "../../src/recognition/roi";
import type { GrayFrame } from "../../src/recognition/grid";
import type { IndexEntry } from "../../src/recognition/index_store";

// 纯色 v 的 32×32 cell 经 phashFromGray 得全 0 hash(与 recognize.test.ts 同理:
// 块均值 == 全局均值 → 每位 0)。故纯色 sprite 命中 phash 全 0 的模板。
const index: IndexEntry[] = [
  { valveId: 700, shortName: "solid", phash: "0000000000000000" },
  { valveId: 999, shortName: "faraway", phash: "ffffffffffffffff" },
];

function blankFrame(w: number, h: number): GrayFrame {
  return { width: w, height: h, data: new Uint8Array(w * h) }; // 全 0
}

/** 把整块矩形涂成纯色 v(模拟某格里有一个 sprite)。 */
function fillRect(f: GrayFrame, x: number, y: number, w: number, h: number, v: number): void {
  for (let yy = y; yy < y + h; yy++)
    for (let xx = x; xx < x + w; xx++)
      f.data[yy * f.width + xx] = v;
}

const layout: PoolLayout = {
  rows: [
    { startXRatio: 0.1, yRatio: 0.1, cellRatio: 0.05, gapRatio: 0.01, count: 2, zone: "ultimate" },
  ],
};
const rect = { x: 0, y: 0, width: 1920, height: 1080 };

describe("recognizePool", () => {
  it("命中贴进格子像素位的纯色 sprite,返回其 valveId", () => {
    const f = blankFrame(1920, 1080);
    // 全 0 背景本就会命中 valveId=700(纯色 0)。为证明它读的是"格子位置",
    // 只在第 0 格涂中灰 128(纯色 128 的 phash 也是全 0 → 命中 700),
    // 背景 0 也是纯色 → 同样命中 700。两者都应只产出 {700}(去重)。
    const cells = poolCellRects(layout, rect);
    fillRect(f, cells[0].x, cells[0].y, cells[0].w, cells[0].h, 128);
    const ids = recognizePool(f, rect, index, layout, 6);
    expect(ids).toContain(700);
    expect(ids).not.toContain(999); // 纯色 → 距 ffff 远 → 不命中
    // 去重:多格都命中 700,只出现一次
    expect(ids.filter((v) => v === 700).length).toBe(1);
  });

  it("maxDistance 过小且无近邻时返回空池", () => {
    const f = blankFrame(1920, 1080);
    const farIndex: IndexEntry[] = [{ valveId: 999, shortName: "faraway", phash: "ffffffffffffffff" }];
    // 纯色 cell → phash 全 0,距 ffff = 64,阈值 3 → 全部未命中
    const ids = recognizePool(f, rect, farIndex, layout, 3);
    expect(ids).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd core && npx vitest run tests/recognition/pool_recognize.test.ts`
Expected: FAIL —— `recognizePool` 模块不存在(import 解析失败)。

- [ ] **Step 3: Write minimal implementation**

新建 `core/src/recognition/pool_recognize.ts`:

```ts
// core/src/recognition/pool_recognize.ts
// 单一职责:按比例池布局裁格 → 复用 recognizeCell 识别 → 收集去重候选池 valveId[]。
// 不喂打分、不做状态机映射(本阶段范围)。空格/未命中跳过。
import { cropRaw, type GrayFrame } from "./grid";
import { resizeGrayTo32 } from "./resize";
import { poolCellRects, POOL_LAYOUT_RATIO, type PoolLayout, type ClientRect } from "./roi";
import { recognizeCell } from "./recognize";
import type { IndexEntry } from "./index_store";

/** 识别中央技能池,产出本局候选池(去重 valveId[],按格子铺平顺序,首次出现保留)。 */
export function recognizePool(
  frame: GrayFrame,
  rect: ClientRect,
  index: IndexEntry[],
  layout: PoolLayout = POOL_LAYOUT_RATIO,
  maxDistance = 12,
): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const cell of poolCellRects(layout, rect)) {
    const raw = cropRaw(frame, cell.x, cell.y, cell.w, cell.h); // 越界 clamp 已在 cropRaw 内
    const gray32 = resizeGrayTo32(raw);                          // 与建索引侧同核
    const match = recognizeCell(gray32, index, maxDistance);
    if (match === null) continue;                                // 空格/未命中跳过
    if (seen.has(match.valveId)) continue;
    seen.add(match.valveId);
    out.push(match.valveId);
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd core && npx vitest run tests/recognition/pool_recognize.test.ts`
Expected: PASS(2 个用例)。

- [ ] **Step 5: Commit**

```bash
git add core/src/recognition/pool_recognize.ts core/tests/recognition/pool_recognize.test.ts
git commit -m "feat(recognition): add recognizePool (ratio layout → candidate pool valveId[])

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `diffRois` 的 `anchors` 改用池区代表格(过②校验)

让 `②布局校验` 用"池区里必然有内容的代表格"作锚点(终极区首格、标准区某格),取代错位的旧 `pool`/`timer` 坐标。锚点同样由比例 × rect 推导,故 `diffRois` 需接收窗口矩形。`diff`(静止判据)保持现有 pool+slots 逻辑不变。

**Files:**
- Modify: `core/src/recognition/roi.ts`(`diffRois` 增加可选 `rect` 参数并改 `anchors` 来源)
- Test: `core/tests/recognition/roi.test.ts`(更新 `diffRois` 相关用例 + 新增 anchors-from-pool 用例)

**Interfaces:**
- Consumes:`poolCellRects`、`POOL_LAYOUT_RATIO`、`ClientRect`、`cropRaw`、`anchorVariance` 思路(测试侧用 `layout_guard`)。
- Produces:
  - `function diffRois(frame: GrayFrame, layout: DraftLayout, rect?: ClientRect): DiffRois`
    `anchors` 改为"池区代表格的原始 ROI"(终极区首格 + 标准区代表格)。未传 `rect` 时回退到旧 `[pool, timer]` 行为(保持现有测试与既有调用兼容)。

> **为何加可选 `rect` 而非直接改签名**:`roi.test.ts` 现有 `diffRois(frame, LAYOUT_1080P)` 调用与"timer 跳动不影响 diff"用例需继续通过;旧 anchors 行为在不传 rect 时保留,新行为在传 rect 时启用。loop(Task 5)会传 rect 走新行为。

- [ ] **Step 1: Write the failing test**

在 `core/tests/recognition/roi.test.ts` 末尾(最后一个 `});` 之前)追加 `describe`:

```ts
import { poolCellRects, POOL_LAYOUT_RATIO } from "../../src/recognition/roi";
import { isValidLayout } from "../../src/recognition/layout_guard";

describe("diffRois anchors 改用池区代表格", () => {
  // 造一帧:把每个池区格子像素位填成高方差棋盘 → 锚点应判"有内容"。
  function poolFilledFrame(): GrayFrame {
    const f = { width: 1920, height: 1080, data: new Uint8Array(1920 * 1080) };
    const rect = { x: 0, y: 0, width: 1920, height: 1080 };
    for (const c of poolCellRects(POOL_LAYOUT_RATIO, rect)) {
      for (let y = c.y; y < c.y + c.h; y++)
        for (let x = c.x; x < c.x + c.w; x++)
          f.data[y * f.width + x] = ((x + y) % 2) * 255; // 棋盘 → 高方差
    }
    return f;
  }

  it("传 rect 时 anchors 取自池区代表格,池有内容 → isValidLayout 通过", () => {
    const rect = { x: 0, y: 0, width: 1920, height: 1080 };
    const rois = diffRois(poolFilledFrame(), LAYOUT_1080P, rect);
    expect(rois.anchors.length).toBeGreaterThanOrEqual(2);
    expect(isValidLayout(rois.anchors)).toBe(true);
  });

  it("传 rect 但池区全空(纯色)→ 锚点方差不足 → isValidLayout 不通过", () => {
    const rect = { x: 0, y: 0, width: 1920, height: 1080 };
    const blank = { width: 1920, height: 1080, data: new Uint8Array(1920 * 1080) }; // 全 0
    const rois = diffRois(blank, LAYOUT_1080P, rect);
    expect(isValidLayout(rois.anchors)).toBe(false);
  });

  it("不传 rect 时回退旧行为:anchors = [pool, timer](向后兼容)", () => {
    const f = { width: 1920, height: 1080, data: new Uint8Array(1920 * 1080) };
    const rois = diffRois(f, LAYOUT_1080P);
    expect(rois.anchors.length).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd core && npx vitest run tests/recognition/roi.test.ts`
Expected: FAIL —— `diffRois` 当前签名只有两参,传第三参不影响 anchors;"传 rect 时通过"与"全空不通过"用例会因 anchors 仍是旧 `[pool, timer]`(对全 0 帧方差为 0)而失败。

- [ ] **Step 3: Write minimal implementation**

修改 `core/src/recognition/roi.ts` 的 `diffRois`。把 `import` 里补 `poolCellRects, POOL_LAYOUT_RATIO`(它们在同文件,无需 import,直接引用即可),并替换函数:

```ts
/** 门控用的原始(不缩放)ROI 块。
 *  - diff:静止判据(pool 左上 + 十行槽带),不含 timer。保持原逻辑。
 *  - anchors:锚点校验。传 rect 时取"池区代表格"(终极区首格 + 标准区代表格),
 *    这些位置在选取界面必有技能图标(高方差);不传 rect 回退旧 [pool, timer]。 */
export function diffRois(frame: GrayFrame, layout: DraftLayout, rect?: ClientRect): DiffRois {
  const pool = cropRaw(frame, layout.pool.x, layout.pool.y, 64, 64);
  const slotsW = layout.abilitySlots.x + layout.abilitySlots.cols *
    (layout.abilitySlots.cellW + layout.abilitySlots.gapX) - layout.heroSlot.x;
  const slots = cropRaw(frame, layout.heroSlot.x, layout.heroSlot.y, slotsW, 10 * layout.rowPitch);

  if (rect) {
    // 新:池区代表格作锚点。取终极区首格 + 标准区首格(铺平序列里两个稳妥点)。
    const cells = poolCellRects(POOL_LAYOUT_RATIO, rect);
    const ult = POOL_LAYOUT_RATIO.rows.findIndex((r) => r.zone === "ultimate");
    const std = POOL_LAYOUT_RATIO.rows.findIndex((r) => r.zone === "standard");
    // 把"第 ult 行第 0 格"与"第 std 行第 0 格"换算成铺平索引。
    const flatIndexOfRow = (rowIdx: number): number => {
      let n = 0;
      for (let i = 0; i < rowIdx; i++) n += POOL_LAYOUT_RATIO.rows[i].count;
      return n;
    };
    const anchorCells = [cells[flatIndexOfRow(ult)], cells[flatIndexOfRow(std)]]
      .filter((c): c is Rect => !!c);
    const anchors = anchorCells.map((c) => cropRaw(frame, c.x, c.y, c.w, c.h));
    return { diff: [pool, slots], anchors };
  }

  // 回退:旧 [pool, timer] 行为(向后兼容现有调用与测试)。
  const timer = cropRaw(frame, layout.timer.x, layout.timer.y, layout.timer.w, layout.timer.h);
  return { diff: [pool, slots], anchors: [pool, timer] };
}
```

> 注意:`diffRois` 在 `roi.ts` 里位于文件中部,而 `poolCellRects`/`POOL_LAYOUT_RATIO` 在 Task 1 追加到文件末尾。函数体内引用模块级 `const`/`function` 不受声明顺序影响(运行时已全部 hoist/求值),TypeScript 也能解析同模块符号,无需移动。

- [ ] **Step 4: Run test to verify it passes**

Run: `cd core && npx vitest run tests/recognition/roi.test.ts`
Expected: PASS(新增 3 用例 + 现有全部用例,含"timer 跳动不影响 diff"——因 diff 部分逻辑未改)。

- [ ] **Step 5: Commit**

```bash
git add core/src/recognition/roi.ts core/tests/recognition/roi.test.ts
git commit -m "feat(roi): diffRois anchors from pool representative cells when rect given

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: loop 接入 —— 用 rect 推导布局、过②、调 recognizePool、诊断打印

把窗口矩形经 `MonitorDeps.rect` 传入 `runMonitorLoop`;tick 中用它给 `diffRois` 传 rect 走新 anchors,过②后调 `recognizePool` 得候选池,诊断打印"识别到 N 个技能"。现有 `recognizeFrame`/状态机/`recommend` 流程保持不动(本阶段不喂候选池给打分)。

**Files:**
- Modify: `main/src/capture/loop.ts`
- Test: `main/tests/capture/loop_pool.test.ts`(新建;若 `main/tests/capture/` 不存在则一并创建目录)

**Interfaces:**
- Consumes:`recognizePool`(Task 3)、`diffRois(frame, layout, rect)`(Task 4)、`WindowRect`(`@ad/main/ffi/geometry`)。
- Produces:
  - `MonitorDeps` 新增字段 `rect: WindowRect`(启动时由 app 注入的游戏客户区矩形)。
  - 一个可独立测试的纯函数 `poolFromFrame(frame: GrayFrame, deps: MonitorDeps): number[]`(包装 `recognizePool`,把 `deps.rect`+`deps.index` 传入),便于在不跑 while 循环的前提下断言"给定帧 → 候选池"。

> **为何抽 `poolFromFrame`**:`runMonitorLoop` 是 `while(true)` 不可测;把"帧 → 候选池"抽成导出纯函数,既能单测,也让 tick 内调用一行清爽(与现有 `recognizeFrame` 抽法一致)。

- [ ] **Step 1: Write the failing test**

新建 `main/tests/capture/loop_pool.test.ts`:

```ts
// main/tests/capture/loop_pool.test.ts
import { describe, it, expect } from "vitest";
import { poolFromFrame, type MonitorDeps } from "../../src/capture/loop";
import { poolCellRects, POOL_LAYOUT_RATIO } from "@ad/core/recognition/roi";
import type { GrayFrame } from "@ad/core/recognition/grid";
import type { IndexEntry } from "@ad/core/recognition/index_store";

const index: IndexEntry[] = [{ valveId: 700, shortName: "solid", phash: "0000000000000000" }];

function depsWith(rect: { x: number; y: number; width: number; height: number }): MonitorDeps {
  // 仅填 poolFromFrame 用到的字段;其余用 null as any(本测试不触达)。
  return {
    index,
    rect,
    ref: null as unknown as MonitorDeps["ref"],
    pool: [],
    cfg: null as unknown as MonitorDeps["cfg"],
    onUpdate: () => {},
  };
}

describe("poolFromFrame", () => {
  it("用 deps.rect 推导池布局并识别出候选池 valveId[]", () => {
    const rect = { x: 0, y: 0, width: 1920, height: 1080 };
    const f: GrayFrame = { width: 1920, height: 1080, data: new Uint8Array(1920 * 1080) }; // 全 0 纯色 → 命中 700
    // sanity:布局确实算出了格子
    expect(poolCellRects(POOL_LAYOUT_RATIO, rect).length).toBeGreaterThan(0);
    const ids = poolFromFrame(f, depsWith(rect));
    expect(ids).toContain(700);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd main && npx vitest run tests/capture/loop_pool.test.ts`
Expected: FAIL —— `poolFromFrame` 未导出、`MonitorDeps` 无 `rect` 字段(类型错误 / 运行时未定义)。

> 若 `main/` 无独立 vitest 配置,改用仓库根 `npx vitest run main/tests/capture/loop_pool.test.ts`;以 `main/package.json` 里 test 脚本为准(执行前先看一眼 `main/package.json` 的 scripts 与是否有 `vitest.config.ts`)。

- [ ] **Step 3: Write minimal implementation**

修改 `main/src/capture/loop.ts`:

1) 顶部 import 增加(与现有 import 风格一致):

```ts
import { diffRois, slotRowCells, LAYOUT_1080P } from "@ad/core/recognition/roi";
import { recognizePool } from "@ad/core/recognition/pool_recognize";
import type { WindowRect } from "@ad/main/ffi/geometry";
```

> 现有第 4 行已 `import { LAYOUT_1080P, diffRois, slotRowCells } from "@ad/core/recognition/roi";`——把它替换成上面这条(同一行加 import 即可),并新增 `recognizePool` 与 `WindowRect` 两条 import。

2) `MonitorDeps` 增加 `rect` 字段:

```ts
export interface MonitorDeps {
  index: IndexEntry[];
  ref: ReferenceDb;
  pool: Candidate[];
  cfg: ScoringConfig;
  /** 游戏客户区矩形(启动时由 app 经 gameClientRect 读入,供比例池布局推导像素)。 */
  rect: WindowRect;
  onUpdate: (state: DraftState, activeRow: number, recs: ScoredCandidate[]) => void;
  log?: (msg: string) => void;
}
```

3) 新增导出纯函数(放在 `recognizeFrame` 附近):

```ts
/** 帧 → 本局候选池(用 deps.rect 把比例池布局推导成像素再识别)。抽成纯函数以便单测。 */
export function poolFromFrame(frame: GrayFrame, deps: MonitorDeps): number[] {
  return recognizePool(frame, deps.rect, deps.index, undefined, 12);
}
```

4) 在 `tick` 里把 `diffRois` 传 rect、过②后调 `poolFromFrame` 并诊断打印。改这两处:

把
```ts
    const rois = diffRois(frame, LAYOUT_1080P);
```
改为
```ts
    const rois = diffRois(frame, LAYOUT_1080P, deps.rect);
```

在 `②布局校验` 通过后(现有 `if (!isValidLayout(rois.anchors)) {...}` 之后、`const obs = recognizeFrame(...)` 之前)插入:

```ts
    const candidatePool = poolFromFrame(frame, deps);
    if (report) log(`[loop] 识别到 ${candidatePool.length} 个技能(候选池)`);
```

> 候选池本阶段只诊断打印,不接 `recommend`(范围红线)。`recognizeFrame`/状态机/`recommend` 现有流程整段保持不动。

- [ ] **Step 4: Run test to verify it passes**

Run: `cd main && npx vitest run tests/capture/loop_pool.test.ts`
Expected: PASS。
再跑类型检查确认 `MonitorDeps` 新字段不破坏既有引用:`cd main && npx tsc --noEmit`(预期此时会报 `app/src/main/index.ts` 未提供 `rect`——那是 Task 6 修;若 main 包 tsc 不含 app,则 main 包内应全绿)。

- [ ] **Step 5: Commit**

```bash
git add main/src/capture/loop.ts main/tests/capture/loop_pool.test.ts
git commit -m "feat(capture): derive pool layout from rect, recognize candidate pool, log N abilities

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: app 注入 rect 到 MonitorDeps

启动时已读到的 `gameClientRect(hwnd)` 放进 `startLiveLoop` 构造的 `MonitorDeps`。rect 在 `app.whenReady` 里读取,需把它传给 `startLiveLoop`。无游戏窗口/读不到 rect 时给安全回退(1920×1080@0,0)并诊断。

**Files:**
- Modify: `app/src/main/index.ts`

**Interfaces:**
- Consumes:`gameClientRect`(已 import)、`MonitorDeps.rect`(Task 5)、`WindowRect`。
- Produces:`startLiveLoop(onUpdate, rect)` 签名新增 `rect: WindowRect` 形参,塞进 `deps`。

- [ ] **Step 1: 手动验证当前类型缺口(无新测试,改后用 tsc 验证)**

本任务是平台壳接线,无纯逻辑可单测(koffi/Electron 不在 CI)。验证手段 = TypeScript 编译 + 真机 `.live.log`。先确认缺口:

Run: `cd app && npx tsc --noEmit`
Expected: 报错 —— `startLiveLoop` 构造的 `deps` 缺少 `MonitorDeps.rect` 必填字段(Task 5 引入)。

- [ ] **Step 2: 修改 `startLiveLoop` 接收并注入 rect**

把 `startLiveLoop` 签名与 `deps` 改为接收 rect。修改 `app/src/main/index.ts`:

签名:
```ts
function startLiveLoop(
  onUpdate: (state: DraftState, activeRow: number, recs: ScoredCandidate[]) => void,
  rect: WindowRect,
): () => void {
```

在 `const deps: MonitorDeps = {` 里加入 `rect`:
```ts
    const deps: MonitorDeps = {
      index,
      ref,
      pool: [],
      cfg: defaultScoringConfig(),
      rect, // 启动时读到的游戏客户区矩形,供比例池布局推导像素
      log: diag,
      onUpdate: (state, activeRow, recs) => {
        if (stopped) return;
        if (++updates <= 3) diag(`[live] update#${updates} activeRow=${activeRow} recs=${recs.length}`);
        onUpdate(state, activeRow, recs);
      },
    };
```

补 `WindowRect` 类型 import(与现有 `findGameWindow, gameClientRect` 同源模块):
```ts
import { findGameWindow, gameClientRect, type WindowRect } from "@ad/main/ffi/game_window";
```
> 若 `WindowRect` 实际从 `@ad/main/ffi/geometry` 导出(它定义在 geometry.ts),则改为从 geometry import:`import type { WindowRect } from "@ad/main/ffi/geometry";`。执行前确认 game_window.ts 是否 re-export;不确定就用 geometry 来源(定义处)。

- [ ] **Step 3: 把 rect 传给 `startLiveLoop`(经 LiveDeps)**

`startLiveLoop` 当前作为 `LiveDeps.runLoop` 传入(`const liveDeps: LiveDeps = { runLoop: startLiveLoop };`),而 `LiveDeps.runLoop` 签名只有 `onUpdate`。需在 `app.whenReady` 里把已读的 `rect` 闭包进去。

`rect` 当前在 `if (hwnd) { ... const rect = gameClientRect(hwnd); ... }` 块内是局部变量。把它提升到外层并加回退:

把
```ts
  const hwnd = findGameWindow();
  diag(`[live] findGameWindow -> ${hwnd ? "找到 Dota 2 窗口" : "未找到(游戏未运行?)"}`);
  if (hwnd) {
    const monitorSize = screen.getPrimaryDisplay().size;
    const rect = gameClientRect(hwnd);
    const isFull = !!rect && rect.width >= monitorSize.width && rect.height >= monitorSize.height;
    const mode = detectDisplayMode(hwnd, isFull);
    diag(`[live] 游戏窗口 rect=${rect ? `${rect.width}x${rect.height}@(${rect.x},${rect.y})` : "null"} mode=${mode}`);
    const guide = guideMessageFor(mode);
    if (guide) win.webContents.send("overlay:guide", guide); // renderer 显示引导(独占全屏)
    if (rect) { const b = rectToOverlayBounds(rect); win.setBounds(b); }
  }
```
改为
```ts
  const hwnd = findGameWindow();
  diag(`[live] findGameWindow -> ${hwnd ? "找到 Dota 2 窗口" : "未找到(游戏未运行?)"}`);
  // 比例池布局推导所需的客户区矩形;读不到时回退 1920×1080@(0,0)(诊断会标注)。
  let liveRect: WindowRect = { x: 0, y: 0, width: 1920, height: 1080 };
  if (hwnd) {
    const monitorSize = screen.getPrimaryDisplay().size;
    const rect = gameClientRect(hwnd);
    const isFull = !!rect && rect.width >= monitorSize.width && rect.height >= monitorSize.height;
    const mode = detectDisplayMode(hwnd, isFull);
    diag(`[live] 游戏窗口 rect=${rect ? `${rect.width}x${rect.height}@(${rect.x},${rect.y})` : "null"} mode=${mode}`);
    const guide = guideMessageFor(mode);
    if (guide) win.webContents.send("overlay:guide", guide); // renderer 显示引导(独占全屏)
    if (rect) { const b = rectToOverlayBounds(rect); win.setBounds(b); liveRect = rect; }
    else diag("[live] gameClientRect 读不到,池布局回退 1920×1080@(0,0)");
  } else {
    diag("[live] 无游戏窗口,池布局回退 1920×1080@(0,0)");
  }

  const liveDeps: LiveDeps = { runLoop: (onUpdate) => startLiveLoop(onUpdate, liveRect) };
```

并删除原先那行 `const liveDeps: LiveDeps = { runLoop: startLiveLoop };`(已被上面替换)。

- [ ] **Step 4: 验证类型编译通过**

Run: `cd app && npx tsc --noEmit`
Expected: PASS(无 `MonitorDeps.rect` 缺失报错;无 `WindowRect` 未定义报错)。

- [ ] **Step 5: Commit**

```bash
git add app/src/main/index.ts
git commit -m "feat(app): inject gameClientRect into MonitorDeps.rect for ratio pool layout

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: 全量回归 + 真机验证收尾

确认全部 core 测试绿、类型干净,并交付真机验证清单。真机验证(`.live.log`)由用户在 1920×1080 无边框 AD 界面跑。

**Files:**
- 无代码改动(纯验证;若回归暴露问题,回到对应 Task 修复并补测)。

- [ ] **Step 1: 跑全量 core 测试**

Run: `cd core && npm test`
Expected: 全绿,含本计划新增的 `pool_layout.test.ts`、`pool_recognize.test.ts` 与更新后的 `roi.test.ts`;现有识别/打分/状态机测试不回归。

- [ ] **Step 2: 跑 main 包测试(若有配置)**

Run: `cd main && npm test`(以 `main/package.json` scripts 为准;无独立配置则 `npx vitest run tests/capture/loop_pool.test.ts`)
Expected: `loop_pool.test.ts` 绿。

- [ ] **Step 3: 类型全检**

Run(各包根目录):`cd core && npx tsc --noEmit` 、 `cd main && npx tsc --noEmit` 、 `cd app && npx tsc --noEmit`
Expected: 三处均无报错。

- [ ] **Step 4: 真机验证清单(交用户跑)**

在 1920×1080 无边框 AD 选取界面执行 `npm run dev`,观察 `app/.live.log`:
- [ ] 出现 `[live] 游戏窗口 rect=1920x1080@(0,0)`(rect 读到且为满屏)。
- [ ] **不再**出现 `卡在②布局校验`。
- [ ] 出现 `识别到 N 个技能(候选池)`,N 接近池中实际可见技能数(参照 `20260619153032_1.jpg` 数可见格)。

> 若仍卡②或 N 明显偏低:说明 `POOL_LAYOUT_RATIO` 比例相对真机有整体偏移(rect 与实际画面区域不符,或逐行比例需再校)。回到 Task 2 按 `.live.log` 截屏微调比例,重跑。本风险 spec 已标注,只能真机收敛。

- [ ] **Step 5: Commit(若 Step 1-3 暴露并修了问题)**

```bash
# 仅当回归修复产生改动时提交;纯验证无改动则跳过。
git add -A
git commit -m "test: regression pass for pool ROI recalibration

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- §2 比例池模型(`PoolRowSpec`/`PoolLayout`/`POOL_LAYOUT_RATIO`)→ Task 1 + Task 2 ✅
- §2 比例→像素推导 → Task 1 `poolCellRects` ✅
- §3 ②校验改用池区代表格 anchors → Task 4 ✅
- §3 识别流程(逐格 recognizeCell → 候选池)→ Task 3 `recognizePool` ✅
- §3 ①frame-diff 保持 → Task 4 `diff` 部分未改,测试守住 ✅
- §3 诊断打印"识别到 N 个技能" → Task 5 ✅
- §4 `roi.ts` / `pool_recognize.ts`(新)/ `loop.ts` / `app/index.ts` 四处改动 → Task 1-2 / 3 / 5 / 6 ✅
- §4 rect 启动读一次 → Task 6(`liveRect` 启动读、闭包进 runLoop)✅
- §4 保留不动清单(recognizeCell/phash/toGrayFrame/FrameGate/isValidLayout/状态机/ffi)→ 各 Task 仅追加/包装,未改这些 ✅
- §4 测试(roi 纯函数单测、pool_recognize 合成帧)→ Task 1/2/3 ✅
- §5 后续观察 → 明确不实现,无任务(符合范围)✅

**Placeholder scan:** 无 "TBD/TODO/适当处理/类似 Task N";每个代码步骤含完整代码与可运行命令。`POOL_LAYOUT_RATIO` 真值在 Task 2 给出从截图粗量的起点 + 标定方法,非占位(并明确真机再收敛)。

**Type consistency:** `PoolRowSpec`/`PoolLayout`/`ClientRect`/`poolCellRects`/`recognizePool`/`poolFromFrame`/`MonitorDeps.rect` 在引入任务与消费任务间签名一致;`Rect`(`{x,y,w,h}`)与 `WindowRect`/`ClientRect`(`{x,y,width,height}`)区分清楚(像素格用 `Rect`,窗口矩形用 width/height)。`diffRois` 第三参 `rect?` 向后兼容现有两参调用。
