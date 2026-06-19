# AD 中央技能池 ROI 重标定(比例化)+ 候选池识别 — 设计

> 状态:已与用户分节确认,待用户复审 spec。
> 背景:Phase 5 真机已把识别链路跑到第二道门,卡在 `②布局校验`——`LAYOUT_1080P`
> 是占位的"十行 4×12 单网格"假设,与真实 AD 选取界面完全不符(见
> `docs/screenshot/2026-06-08-real-draft-layout-notes.md` 与多张 1920×1080 真机截图)。
> 本设计只覆盖"让②过 + 识别出中央池技能(候选池)"这一最小范围。

## 1. 范围与成功标准

**做什么**:把识别布局从错误的"十行 4×12 单网格"改成贴合真实 AD 界面的**中央双区技能池**模型(上"终极技能"区 + 下"标准技能"区),让识别链路越过 `②布局校验`,并识别出池中所有技能,产出**本局候选池**(`valveId[]`)。

**不做**(明确留后续阶段,不在本 spec):
- 用户绿框卡片检测(判断"我是哪队第几位")
- ActivePicker 白/金交替闪框检测(当前轮到谁选)
- 左右两列玩家卡片(各 5)识别 + 状态机两列映射
- 把候选池接进 `recommend`(本 spec 只产出候选池,不喂打分)

**成功标准**:`npm run dev` 在 1920×1080 无边框 AD 选取界面运行,`app/.live.log` 显示:
- 不再出现 `卡在②布局校验`
- 出现 `识别到 N 个技能`,N 接近池中实际可见技能数

## 2. 布局模型(核心改动)

真实技能池是 3D 透视梯形台,分两区,**每行起点 x 与格子数可能不同**,不是规整矩形网格。
故技能池建模为**一组"行"**,坐标全部用**相对比例(0..1,相对游戏客户区)**,运行时按实际窗口尺寸推导像素:

```ts
// 比例坐标:相对游戏客户区宽/高(0..1)。运行时 × gameClientRect 得真实像素。
interface PoolRowSpec {
  startXRatio: number;             // 该行第一格左边缘 / 客户区宽
  yRatio: number;                  // 该行上边缘 / 客户区高
  cellRatio: number;               // 格子边长 / 客户区宽(方格)
  gapRatio: number;                // 相邻格间距 / 客户区宽
  count: number;                   // 该行格子数
  zone: "ultimate" | "standard";   // 所属区
}
interface PoolLayout { rows: PoolRowSpec[]; }
```

- **标定来源**:用户提供的 1920×1080 真机截图(`docs/screenshot/2026061915*.jpg` 等),逐行量出比例值,写成常量 `POOL_LAYOUT_RATIO`。
- **运行时推导**:`gameClientRect`(koffi 已读到,如 `1920x1080@(0,0)`)→ 每格真实像素 ROI = `ratio × {clientWidth | clientHeight}`。
- **多分辨率适配**:坐标比例化后,16:9 的其它分辨率(1440p/4K)在"AD 界面整体等比缩放"假设下自动适配。
- **诚实标注的局限**:
  - 等比缩放假设**仅在 1920×1080 真机验证**;其它 16:9 分辨率的等比假设**未经真机验证**,留后续用户在对应分辨率下验证。
  - **非 16:9**(21:9 / 16:10 等)明确**超出本范围**——这些比例下 AD 界面是居中、拉伸还是锁边距均未知,需另行实测多机截图,本 spec 不处理。

## 3. ②布局校验过关方式 + 识别流程

**②布局校验(`isValidLayout`)如何过**:它检查锚点 ROI 方差 ≥ `MIN_ANCHOR_VARIANCE`(=50)。
改用**池区里必然有内容的代表格**作锚点(如终极区首格、标准区某格)——选取界面这些位置必有技能图标(高方差)。
`diffRois` 返回的 `anchors` 同步改为这些新池区代表格(不再用错位的旧 `pool`/`timer` 坐标)。

**识别流程**(复用现有识别算法,不改):
```
按 PoolLayout 逐行逐格(由比例 × rect 推导像素)裁 ROI
  → 每格 recognizeCell(cell, index, 阈值)
  → 命中 valveId 的格子收集 → 本局候选池 valveId[]
```
- 复用现有 636 模板 phash 索引、`recognizeCell`、灰度链(`toGrayFrame` 601 契约)——均已验证,不动。
- 空格/未命中跳过(池中部分位置可能为空/已选走变暗)。

**①frame-diff 门控**:保持现有逻辑(timer 已从静止判据移除,见提交 `14d6c24`);静止判据 `diff` ROI 改用新池区。

**诊断**:复用现有 `[loop]` 节流日志,新增打印"识别到 N 个技能"到 `app/.live.log`。

## 4. 代码结构与影响面

| 文件 | 改动 |
|---|---|
| `core/src/recognition/roi.ts` | 新增 `PoolRowSpec`/`PoolLayout` 比例模型 + `POOL_LAYOUT_RATIO` 标定常量;新增"比例→像素 ROI"推导(纯函数);`diffRois` 的 `anchors` 改用池区代表格 |
| `core/src/recognition/pool_recognize.ts`(新) | `recognizePool(frame, rect, index, ref) → valveId[]`:按比例布局裁格、识别、收集候选池。单一职责、可独立测试 |
| `main/src/capture/loop.ts` | tick 中:用 `gameClientRect` 的 rect 推导像素布局;②校验用新 anchors;调 `recognizePool` 得候选池;诊断打印"识别到 N 技能"。需新增把窗口 `rect` 从 `MonitorDeps` 传入 |
| `app/src/main/index.ts` | 把 `gameClientRect(hwnd)` 的 rect 放进 `MonitorDeps`(loop 推导比例布局所需) |

**rect 更新策略**:本范围内**启动时读一次** `gameClientRect` 即可(无边框全屏窗口运行期尺寸/位置稳定)。运行期窗口移动/改尺寸的动态重读,留后续(若真机发现窗口会动再补)。

**保留不动**:`recognizeCell`、phash 索引、`toGrayFrame`、`FrameGate`、`isValidLayout` 算法本身、状态机、所有 ffi/koffi/合规/DB 代码。

**测试(TDD,core 可测)**:
- `roi.ts` 比例→像素推导:纯函数单测(给 rect + 比例 → 断言像素 ROI 正确)。
- `pool_recognize`:合成帧测试——把已知 sprite 贴进"比例 × rect 算出的格子像素位置"→ 断言识别出对应 `valveId` 集合(与现有 `pipeline_integration.test.ts` 同思路,真实建小索引、不 mock)。
- 真机验证(`.live.log` 显示识别到 N 技能、不卡②)留用户跑。

**风险(只能真机验证,spec 标注)**:
- `gameClientRect` 读到的 rect 与实际游戏画面区域若有偏差(多显示器、任务栏、DPI 边界),比例推导会整体偏移 → 识别失败。本次在用户单显示器 1920×1080 无边框下验证;其它环境未知。
- 池区代表格选点若恰好落在空格,②校验方差可能不足 → 需选"必有内容"的稳妥锚点位置,实现期按真实截图确认。

## 5. 为后续阶段保留的观察(不在本范围实现,记此备用)

来自真机截图交叉确认,供下一阶段(用户位置 / ActivePicker / 两列映射)直接使用:
- **玩家两列各 5**:左列 + 右列,每列 5 张卡片;队伍颜色(红/绿)随局而变,不可硬编码颜色到队伍。
- **绿色加粗边框卡片 = 用户自己**(在左端或右端某行)→ 定位用户所属列(哪一方)+ 行(第几位)。这是"我是哪队第几位"的权威视觉源。
- **白/金交替闪烁边框 = 当前正在选技能的玩家(ActivePicker)**,与"用户自己"是**不同**的高亮,勿混。
- 中央顶部大数字(如"即将轮到你:57")= 全局倒计时 / 顺位提示。
- 每张玩家卡片:左 = 英雄头像位 + 名牌,右 = 4 个技能槽。
- 关联记忆:[[real-draft-layout-correction]]、[[phase4-mock-shell-status]]。
