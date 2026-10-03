# 阶段 2–5 · 结构化提纲

> **状态:** 提纲已细化为可执行计划。各阶段的逐步 TDD 任务见同目录:
> - 阶段 2 → `2026-06-04-04-phase2-continuous-monitoring.md`
> - 阶段 3 → `2026-06-04-05-phase3-scoring-kernel.md`(打分机制可配置:信号注册表 + 权重 config)
> - 阶段 4 → `2026-06-04-06-phase4-overlay.md`
> - 阶段 5 → `2026-06-04-07-phase5-upgrades.md`(可选,触发条件明确)
>
> 本文件保留作为四阶段的总览索引。每条列出:目标、关键模块/文件、核心设计点、验收门(均对齐计划书 §四/§五/§十)。

---

## 阶段 2 · 持续监控(差异化 1)

**目标(计划书 §十):** 捕获循环 + 多 ROI(含 Active Picker)+ frame-diff 门控 + 草稿状态机(双重条件驱动 + 状态对账 + 槽位记账)+ 无效帧防护。全程自动追踪一局选取。

**归属:** `main/`(捕获、FFI)+ `core/`(状态机纯逻辑,Vitest 可测)+ `shared/types`。

**关键模块:**
- `main/src/capture/loop.ts` — 低 Hz 轮询捕获循环;生命周期 = 进入选取界面→全部选完。
- `core/src/recognition/frame_diff.ts` — **ROI 内**像素 hash 比对 + **真防抖(非节流)**:连续 N 帧静止才放行「最终稳定帧」,绝不喂动画中的半截帧(纯逻辑可测)。
- `core/src/recognition/roi.ts` — 多 ROI 规格:选取池(英雄+技能混合)/ 十行已选槽(**英雄槽长方形与技能槽正方形物理解耦**)/ 回合计时 / Active Picker 高亮框。复用阶段 1 `cropGrid`/`resizeGrayTo32`。
- `core/src/recognition/active_picker.ts` — Active Picker 探头:固定高亮色 + 颜色匹配,无需 NN;**输入 RGB 带强制 `channels===3`(`removeAlpha()`),杜绝 RGBA 偏移**(计划书 §四)。
- `core/src/recognition/layout_guard.ts` — 布局/遮挡校验:检测 UI 锚点(计时器、技能网格边框)是否可见;详情面板遮挡 → 判无效帧。
- `core/src/statemachine/draft.ts` — 草稿状态机(见下)。
- `shared/types/draft.ts` — `SlotType`、`PlayerState`(已选英雄/普通数/终极数/各类剩余配额)、`DraftState`、`ActivePicker`。

**核心设计点(计划书 §四,均须落测):**
1. **frame-diff 门控**:画面变才喂识别;ROI 内 diff 而非全屏;debounce 抵消 UI 动画。
2. **四层无效帧防护**:① ROI 内 diff;② 布局/遮挡校验,遮挡则保持上次有效状态;③ 时序一致性(连续 N 帧一致才提交);④ 状态机只接受合法单调转移(池只收缩、已选只增、落入合法槽位)。
3. **双重条件提交**:`Active Picker 指示轮到 A` 且 `A 行出现新技能` 两者一致才提交;冲突则不提交,走对账。
4. **状态对账(reconciliation)**:每个有效帧整帧重读 [当前活动玩家 + 十行槽位占用],与内存模型 diff 对账;可由任意一个好帧重建 → 丢帧不雪崩。
5. **逐玩家槽位记账**:1 英雄 + 3 普通 + 1 终极,英雄槽与技能槽分别计数;纯内存,对局结束销毁不落库。

**状态机测试要点(纯逻辑,无需截图):**
- 给定一串「(ActivePicker, 帧槽位快照)」序列,断言每人配额正确收敛。
- 注入「冲突帧」(新技能在 B 行但 UI 说轮到 A)→ 断言不提交。
- 注入「丢帧」(跳过若干转移)后给一个干净帧 → 断言从该帧重建到正确状态,顺位不反。
- 注入「详情面板遮挡帧」→ 断言保持上次有效状态。

**验收门(计划书 §十 阶段 2):**
- [ ] 全程自动追踪一局选取,状态正确收敛。
- [ ] 丢帧/卡顿后能从单个好帧自愈、顺位不错位。
- [ ] 点开技能/英雄详情不致污染状态。
- [ ] (**差异化 1 达成**)

---

## 阶段 3 · 打分内核(差异化 2、3)

**目标(计划书 §十):** 槽位硬过滤 + 条件化打分(搭配/神杖/截胡/队友)。推荐永远合法,排序在典型局面下合理。

**归属:** `core/src/scoring/`(纯 domain,Vitest 可测,零 Electron)。数据来自阶段 0 的 `reference.db`(只读)+ 阶段 2 状态机的实时 `DraftState`。

> **细化为动态 MCDM(对齐 `打分细则.md`):** 详见 `2026-06-04-05-phase3-scoring-kernel.md`。下列为索引摘要。

**关键模块:**
- `core/src/scoring/filter.ts` — **第 0 步槽位硬过滤**:依本人三类剩余配额裁剪混合候选池(英雄槽满剔所有英雄;普通满剔普通;终极满剔终极)。候选集是混合的(英雄/普通/终极可同时合法)。
- `core/src/scoring/signals/` — 五个信号(细则 §2,胜率类统一减 0.5 量纲):
  - `base.ts` — 单技能/英雄基础胜率 `WR-0.5`(`ability_winrate` / `hero_winrate`)。
  - `synergy.ts` — **平均协同** `(1/|M|)·Σ(WR(c,m)-0.5)`(`ability_pairs`;英雄=负 abilityId)。
  - `pos.ts` — **tanh 选取位置稀缺度** `tanh((P_curr-P_avg)/σ)`,有界 [-1,1]。
  - `aghs.ts` — 神杖增益 `S_aghs` + 魔晶增益 `S_shard`(`ability_aghs.scepter_gain / shard_gain`)。
  - 扩展位:`snipe`(截胡)、`teammate_protect`(队友保护)——后续按同一注册表 + 动态权重模式接入。
- `core/src/scoring/weights.ts` — **顺位时变动态权重** `w_i(P_curr)`(细则 §3):`f_front`/`f_back` + α/β,前置位放大 base、后置位满载 synergy 与提权 aghs。
- `core/src/scoring/score.ts` — 对维度无知的动态加权合成 `Σ w_i(P_curr)·S_i`,**跨类型统一比较**,降序取 **Top 3~4**。

**核心设计点(计划书 §五 + 细则):**
- 硬过滤先于一切打分 → 从根上杜绝「推荐你选不了的东西」。
- 打分须在每手约 5 秒窗口内完成,**确定性纯计算**;LLM 不进关键路径。
- **打分机制可配置**:信号是注册表、权重 = 基础 w⁰ + 动态系数 α/β/σ,可从 JSON 加载;离线流水线可回测(计划书 §六)。

**测试要点:**
- 硬过滤:构造「终极槽已满」状态 → 断言候选中无任何 ultimate;「只剩终极槽」→ 断言无 normal。
- 各信号纯函数:用 fixture DB 行断言数值。
- 合成排序:典型局面(已选某 combo 半成品)→ 断言补完件排在前。
- 跨类型:英雄与技能同时合法时,断言按统一价值分排序而非按类型。

**验收门(计划书 §十 阶段 3):**
- [ ] 推荐永远合法(不荐满员槽位类型)。
- [ ] 排序在典型局面下合理。
- [ ] (**差异化 2、3 达成**)

---

## 阶段 4 · Overlay

**目标(计划书 §十):** 窗口追踪 + 透明穿透 + 实时渲染。overlay 对齐游戏窗口,实时刷新无明显延迟。

**归属:** `main/`(窗口追踪、FFI、透明穿透)+ `renderer/`(React + shadcn/ui + Tailwind)+ Zustand 实时状态。

**关键模块:**
- `main/src/ffi/window_track.ts` — koffi(Win32 FFI)找游戏窗口、取其位置/尺寸(**x64 Windows only**)。
- `main/src/overlay/window.ts` — 透明、点击穿透的 Electron 叠层窗口;对齐到游戏窗口矩形。
- `renderer/src/store.ts` — Zustand 订阅状态机 + 打分输出,生命周期 = 一局。
- `renderer/src/Overlay.tsx` — 渲染候选排序、配额、推荐高亮。
- `renderer/src/ControlPanel.tsx` — 控制面板(共用窗口栈)。
- IPC:`main` ↔ `renderer` 传 `DraftState` + 打分结果。

**核心设计点:**
- overlay 与控制面板共用窗口(计划书 §三)。
- 分辨率/坐标映射:把阶段 1 手填的 GridSpec 升级为按游戏窗口尺寸推导。
- 性能预算:frame-diff 门控压测,避免持续烧 GPU(计划书 §九)。

**验收门(计划书 §十 阶段 4):**
- [ ] overlay 对齐游戏窗口。
- [ ] 实时刷新无明显延迟。

---

## 阶段 5 · 升级(可选)

**目标(计划书 §十):** NN 识别 / LLM 解释层。鲁棒性或可读性提升,且不拖慢关键路径。

**5a · NN 识别(计划书 §七 升级阶段):**
- `pipeline/`:收集/标注图标截图 → PyTorch/TF 训练分类器 → 导出 ONNX 到 `models/onnx/`。
- `main/`:ONNX Runtime + DirectML 独立 worker 线程加载,替换/兜底 pHash。
- 触发条件:pHash 在缩放/光照下遇鲁棒性瓶颈才上(不在关键路径)。
- 验收:鲁棒性提升,识别延迟仍在预算内。

**5b · LLM 解释层(计划书 §三/§五):**
- 只解释、不决策、不进排序关键路径;异步、惰性、grounded。
- 本地 Ollama 或云端小模型;输入为打分内核已产出的结构化理由。
- 验收:解释可读且 grounded(不臆造),不拖慢每手 5 秒窗口。

**验收门(计划书 §十 阶段 5):**
- [ ] 鲁棒性或可读性提升,且不拖慢关键路径。

---

## 跨阶段风险登记(计划书 §九,执行时持续跟踪)

- 识别层是最大自建成本(参考图维护、坐标映射)。
- x64 Windows only(koffi + Windows 截屏栈)。
- 管线活儿(分辨率/坐标映射、overlay 穿透、窗口追踪)占时间但不构成差异化。
- 持续监控性能预算:frame-diff 做不好持续烧 GPU,MVP 后专门压测。
- 数据时效:Windrun 按补丁变化,需刷新机制(阶段 0 的 `build` 可重跑;`meta.patch` 记录当前补丁)。
