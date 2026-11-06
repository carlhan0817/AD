# 屏幕比例适配 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标:** 16:9 任意大小、21:9、16:10、3:2、4:3、5:4 的游戏窗口都能认准、框画对;不支持的比例不乱认并明确提示。

**做法:** 新增「比例归类 + 每类一张位置表 + 按高度缩放、水平居中」的换算层。现有四个取位置的函数(`poolSlots`、`heroCellRects`、`playerCards`、`cardSlots`)签名不变,内部改走换算层,所以识别、变化检测、推荐框这些调用方都不用改。分两批合并:第一批是换算层 + 16:9 + 21:9 + 不支持提示 + README;第二批等用户截图后标定其余四类。

**技术栈:** TypeScript · Vitest · Electron

**设计文档:** [docs/superpowers/specs/2026-11-06-screen-ratios-design.md](../specs/2026-11-06-screen-ratios-design.md)(实现者两份都要读)

## 全局约束

- 六类比例:16:9(1.778)、21:9(取 2.370,覆盖 2.33–2.40)、16:10(1.600)、3:2(1.500)、4:3(1.333)、5:4(1.250)。实际宽高比与某类相差 2% 以内才归入该类,否则「不支持」。
- 实际位置 = 该类基准位置 × (实际高度 / 基准高度),再水平居中:x 偏移 = (实际宽 − 基准宽 × 缩放) / 2,y 不加偏移;最后加客户区原点 (rect.x, rect.y)。
- 16:9 的表就是现在的 1080p 表,数值不改;「近 1080p(宽、高各在 ±10 像素内)按原样不缩放」的规则保留。
- 21:9 的表由 16:9 的表按公式推出(基准 2560×1080,即 1080p 表整体右移 320)。
- 不改识别方法与阈值,不改打分;早期连续监控的 `layout_derive.ts`、`roi.ts`(`poolCellRects`/`diffRois`)不在范围内。
- 不支持的比例:不扫描、不写记忆;悬浮窗提示「当前屏幕比例暂不支持,请看项目主页」;日志记一行实际宽高和比例。
- 截图含其他玩家名字,只留本地,不进仓库(测试照 `main/tests/capture/runtime_frames.test.ts` 的方式读本地帧,缺帧就跳过)。

## 重点审查

1. 1920×1080 的结果一字不差(现有真机帧回归必须照常通过)——任务 1 的「16:9 恒等」测试 + 任务 2 跑全部现有测试。
2. 窗口模式下客户区比显示器小、且不在 (0,0)——任务 1 测试带非零原点;任务 5 真机核对。
3. 比例刚好落在两类中间(如 1.56、1.63)——任务 1 测试判为不支持。
4. 窗口在扫描中途被拖成不支持的比例——任务 3 测试:那一次扫描返回「不支持」,不写记忆。
5. 极小窗口(1280×720 以下)分类器认不准——任务 4 用 1280×720 真机帧测,认不准就如实报告,不擅自改识别。

---

### 任务 1:比例归类与换算层(`core/src/recognition/screen_layout.ts`)

**文件:**
- 新建:`core/src/recognition/screen_layout.ts`、`core/tests/recognition/screen_layout.test.ts`
- 修改:`core/src/recognition/pool_slots.ts`、`hero_layout.ts`、`player_cards.ts`(四个函数改走换算层;1080p 常量表留在原文件)

**接口(产出):**
- `type RatioClass = "16:9" | "21:9" | "16:10" | "3:2" | "4:3" | "5:4"`
- `interface LayoutTable { baseWidth: number; baseHeight: number; pool: PoolSlot[]; heroes: HeroCell[]; cards: PlayerCard[]; cardSlots: CardSlot[]; verified: boolean }`(位置都是基准尺寸下、原点 (0,0) 的像素;`verified` 表示有真机截图验证过)
- `classifyRatio(width: number, height: number): RatioClass | null`
- `layoutTableFor(cls: RatioClass): LayoutTable`
- `placeRect<T extends Rect>(r: T, table: LayoutTable, rect: ClientRect): T`(按高度缩放 + 水平居中 + 加原点;16:9 且近 1080p 时恒等)
- `screenLayoutFor(rect: ClientRect): { cls: RatioClass; table: LayoutTable } | null`
- 四个现有函数签名不变;比例不支持时退回旧的「横纵各自拉伸」(只为不崩;不支持时调用方不会用到结果,见任务 3)。
- 这一任务里 16:10、3:2、4:3、5:4 的表先用上游 `layout_coordinates.json` 对应分辨率(1920×1200、1440×960、1440×1080、1280×1024)转换,`verified: false`;英雄格沿用 1080p 的 dy=-4 修正。16:9 与 21:9 `verified: true`(21:9 是公式推导,由上游数据核对,任务 2 里 README 仍写「未实测」)。

- [ ] **步骤 1:写失败的测试。**
  - `classifyRatio`:1920×1080、2560×1440、3840×2160、1366×768 → "16:9";3440×1440、3840×1600、1834×786 → "21:9";1920×1200、1440×900、1280×800、1680×1050 → "16:10";1440×960 → "3:2";1280×960、1024×768、1440×1080 → "4:3";1280×1024 → "5:4";1600×1024(1.5625)、1500×920(1.630)、5120×1440(3.56)、600×1000 → null。
  - 16:9 恒等:`poolSlots`/`heroCellRects`/`playerCards`/`cardSlots` 在 `{x:0,y:0,width:1920,height:1080}` 和 `{x:0,y:0,width:1918,height:1078}` 下与本任务改动前逐个相等(先在改动前把结果存成测试里的期望值)。
  - 非零原点:客户区 `{x:240,y:90,width:1440,height:900}` 时,每个位置 = 原点 (0,0) 时的结果 + (240,90)。
  - 2K、4K:`poolSlots` 在 2560×1440、3840×2160 下与上游 `layout_coordinates.json` 的 `ultimate_slots_coords` + `standard_slots_coords` 逐格相差 ≤ 3 像素(按我们的格子顺序对齐上游的 hero_order/ability_order)。
  - 21:9:`poolSlots`、`playerCards` 在 3440×1440、3840×1600 下与上游对应数据逐个相差 ≤ 4 像素。
- [ ] **步骤 2:** `cd core && npx vitest run tests/recognition/screen_layout.test.ts`,预期失败(模块不存在)。
- [ ] **步骤 3:实现。** 上游表转成我们的格子顺序的映射要和 `pool_slots.ts` 现有注释里写的对应关系一致。
- [ ] **步骤 4:** 本测试通过;`npm run test:core`、`npm run test:main`(含本地真机帧回归)全过。
- [ ] **步骤 5:提交** `feat(layout): classify screen ratio and place cells per ratio`

---

### 任务 2:推荐框跟着走 + README「支持的屏幕」

**文件:**
- 修改:`core/src/recognition/highlight.ts`(`highlightOuter` 的缩放改按 `screenLayoutFor(rect)` 的高度缩放;不支持时按高度/1080)
- 修改:`core/tests/recognition/highlight.test.ts`(若不存在则新建)
- 修改:`README.md`、`README.zh-CN.md`

- [ ] **步骤 1:写失败的测试。** `highlightOuter` 在 3440×1440(21:9)下外扩 = round(8 × 1440/1080) = 11;在 1920×1080 下仍是 8。
- [ ] **步骤 2:** 运行确认失败;**步骤 3:** 实现;**步骤 4:** `npm run test:core` 全过。
- [ ] **步骤 5:README。** 中英文各加一节「支持的屏幕 / Supported screens」:列出六类比例与常见分辨率举例(16:9:1366×768、1920×1080、2560×1440、3840×2160;21:9:2560×1080、3440×1440;16:10:1440×900、1920×1200、2560×1600;3:2:1440×960;4:3:1024×768、1280×960;5:4:1280×1024);标明哪些「已实测」(本任务时只有 16:9 的 1920×1080),哪些「按公式/上游数据支持,未实测」;写明不支持:比例不在列表(相差超过 2%)、独占全屏、Dota 不在主显示器。
- [ ] **步骤 6:提交** `feat(layout): scale highlight boxes by height, document supported screens`

---

### 任务 3:不支持的比例——不扫、提示、记日志

**文件:**
- 修改:`main/src/capture/scan_pool.ts`(开头先 `screenLayoutFor(deps.rect)`;null 时立即返回,`onDraftScreen: false` 并带 `unsupportedRatio: { width, height }`,不碰记忆)
- 修改:`app/src/main/index.ts`(扫描结果带 `unsupportedRatio` 时:悬浮窗推只有提示文字的快照「当前屏幕比例暂不支持,请看项目主页」,日志 `[scan] 屏幕比例 1.63(1500×920)暂不支持,这次不扫描`;同一尺寸只记一次日志)
- 测试:`main/tests/capture/scan_pool.test.ts`

**接口:** `PoolScanResult` 加可选字段 `unsupportedRatio?: { width: number; height: number }`。

- [ ] **步骤 1:写失败的测试。** `scanPool` 传 `rect` 1500×920:返回 `onDraftScreen === false`、`unsupportedRatio` 等于 `{ width: 1500, height: 920 }`、`memory` 状态与调用前相同、分类器没被调用(用会抛错的假分类器)。再用同一个 memory 传 1920×1080 的真帧(若有本地帧)照常工作。
- [ ] **步骤 2:** 运行确认失败;**步骤 3:** 实现;**步骤 4:** `npm run test:ts` 全过,`cd app && npx tsc --noEmit -p .` 无错误,`npm run compliance` 通过。
- [ ] **步骤 5:提交** `feat(layout): skip and explain unsupported screen ratios`

**第一批到此结束:** 推送到分支,不合并 main,等任务 4、5。

---

### 任务 4:用用户截图标定 16:10、3:2、4:3、5:4(需用户先截图)

**前置(用户操作):** Dota 窗口模式,依次开 1440×900(或 1280×800)、1440×960、1280×960(或 1024×768)、1280×1024(开不出跳过)、1280×720,每种进自定义 AD 选人界面,开局和中途各按一次 `Ctrl+Shift+S`。开发版会把帧存到 `app/.scan_frames/game_*/NNN_hotkey_*.png`。用户告诉控制者每个尺寸对应哪些帧。

**文件:**
- 新建:`main/tools/calibrate_layout.ts`(开发用工具,不进程序;用仓库已有的 `npx vite-node main/tools/calibrate_layout.ts <帧路径> <比例类>` 运行,和 main 的测试共用路径别名):输入一张帧和比例类,从当前表出发,对技能池、英雄格、玩家卡、已选格四组分别搜整体平移(±20 像素)和缩放(±5%),以「分类器对非空格的置信度之和最高、空格判空不变」为准;输出新的基准表和每组改了多少。
- 修改:`core/src/recognition/screen_layout.ts`(写入标定后的表,`verified: true`)
- 新建:`main/tests/capture/ratio_frames.test.ts`(本地帧回归,缺帧跳过)

- [ ] **步骤 1:** 写标定工具,在现有 1920×1080 真帧上跑一次:结果应是「16:9 表不用改」(平移 0、缩放 1.00),以此证明工具可信。
- [ ] **步骤 2:** 对每个尺寸的帧跑工具,更新表。以识别结果为准,不以目测对齐为准。
- [ ] **步骤 3:写真机帧回归测试。** 每个尺寸的每张帧:`scanPool` 的 `onDraftScreen === true`,`unknownCells === 0`(说明框盖住的格子除外,在测试里列明),`myRow` 与 `activeRow` 和用户报的一致。1280×720 若分类器认不准,测试先标 `todo` 并在报告里写明认错几格,不改识别。
- [ ] **步骤 4:** `npm run test:ts` 全过;README 里把实测过的尺寸改成「已实测」。
- [ ] **步骤 5:提交** `feat(layout): calibrate 16:10, 3:2, 4:3, 5:4 from real frames`

---

### 任务 5:真机验收(用户操作)

- [ ] 1440×900(16:10)窗口模式打一局 AD,全程不按热键:每手自动识别、推荐框画在对的格子上、日志没有「不是选人界面」的误判。
- [ ] 1280×960(4:3)同上。
- [ ] 把窗口拖成奇怪比例(如 1500×920)一次:悬浮窗出现「当前屏幕比例暂不支持」提示,日志有对应一行,拖回正常比例后恢复扫描。
- [ ] 全部通过后推送并合并到 main。
