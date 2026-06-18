# AD 助手 — 合规验证流程(Compliance Verification Checklist)

> 版本:2026-06-09(Phase 5 更新:加入实现状态维度)
> 配套:`technical-behavior-and-anticheat.md`
> 原则:每个验证项要么证明**功能可用**,要么证明**合规红线未被越界**。红线项(标 🚫)只要有一条失败,该构建**不得合并、不得分发**。

## 实现状态标签(三态模型)

每个验证项前缀一个状态标签,三态语义如下:

- **[PASS]** — 已验证。该项有可重复执行的验证手段(自动化脚本或已完成的人工验证),且验证结果为通过。
- **[IMPL·待冒烟]** — 代码已实装,但**真机行为验证尚未执行**(需要在 x64 Windows 上运行无边框 Dota2 才能验证,无法在 CI / 无真实游戏环境下完成)。代码存在 ≠ 行为已验证,因此不得标 PASS。
- **[N/A]** — 该能力尚未实现,允许存在;不构成合并阻断。

> A1/A2/A3 的 [PASS] 由自动化 grep 守门脚本 `scripts/compliance-scan.ps1`(`npm run compliance`)保障,并由 `ReadonlyGameHwnd` / `OwnOverlayHwnd` 两个 branded 类型在类型层固化"只读游戏 hwnd、写操作仅限自身 overlay hwnd"的约束(详见 Task 1/3/7)。其余行为类项目即便代码已完整实现(Task 2/3/4/5/6/7/8/9/10),仍需在真实无边框 Dota2 环境下人工冒烟后才能从 [IMPL·待冒烟] 转为 [PASS]。

---

## 阶段 A — 静态验证(代码层,不需运行游戏)

> 目的:在代码里堵死"对游戏做写操作"的可能,把红线变成可 grep 的硬约束。

### A1. 🚫 koffi 写操作不得指向 Dota2 HWND
- [PASS] grep 全仓所有 `SetWindowPos` / `SetWindowLong` / `SetWindowLongPtr` / `SetWindowDisplayAffinity` / `SendMessage` / `PostMessage` / `ShowWindow` / `MoveWindow` 调用。
- [PASS] 逐个确认其 HWND 入参来源是**自身 overlay 窗口**(如 `overlayWindow.getNativeWindowHandle()`),**不是** `FindWindowW` 的返回值。
- [PASS] 验证手段:Dota2 的 hwnd 变量在代码中只流向 `GetClientRect`/`ClientToScreen`/只读的 `GetWindowLong`,never 流向上述写 API。
- **判定**:有任何一处游戏 hwnd 流向写 API → **FAIL,阻断合并**。
- **验证依据**:`scripts/compliance-scan.ps1`(`npm run compliance`)自动 grep 守门,已运行并输出 "compliance scan clean";并由 `ReadonlyGameHwnd` branded 类型在类型层禁止游戏 hwnd 被传入写 API(Task 1/3/7)。

### A2. 🚫 无进程注入 / 内存访问 / 渲染 hook
- [PASS] grep:`ReadProcessMemory` / `WriteProcessMemory` / `OpenProcess`(带写权限)/ `CreateRemoteThread` / `SetWindowsHookEx` / `Present` / `SwapBuffers` / `d3d` hook 相关。
- [PASS] 期望:**零命中**(`OpenProcess` 若用于只读查询需单独审,默认不应出现)。
- **判定**:命中任一 → **FAIL**。
- **验证依据**:`scripts/compliance-scan.ps1` 已运行确认零命中(Task 1)。

### A3. 🚫 零输入:不向游戏模拟键鼠
- [PASS] grep:`SendInput` / `keybd_event` / `mouse_event` / `PostMessage(WM_KEY*/WM_*BUTTON*)`。
- [PASS] 期望:零命中(热键若有,须为 Electron `globalShortcut`,不得为 `SetWindowsHookEx` 全局钩子)。
- **判定**:命中模拟输入 → **FAIL**。
- **验证依据**:`scripts/compliance-scan.ps1` 已运行确认零命中(Task 1)。

### A4. 不修改游戏文件
- [IMPL·待冒烟] 确认无任何代码写入 Dota2 安装目录 / 配置文件路径。当前不在 `compliance-scan.ps1` 的自动 grep 范围内,属人工代码审查结论,尚未纳入自动化守门,建议后续补入扫描脚本后转 [PASS]。

---

## 阶段 B — 运行时行为验证(无边框窗口,运行基准)

> 环境:Dota2 设为**无边框窗口**,1920×1080。在 Demo/练习模式或 AD 自定义局做,**不在天梯/匹配局测**。

### B1. 截屏链路(Electron `desktopCapturer`,必要时升级 DXGI)
- [IMPL·待冒烟] DXGI/`desktopCapturer` 能在无边框下抓到**非黑屏**的游戏画面帧。代码已实装(Task 6,`screen_source` 接入 `desktopCapturer`)。**真机冒烟未做**:需在无边框 Dota2 + Electron 实跑下确认抓帧非黑屏、尺寸与显示器匹配。
- [IMPL·待冒烟] 用进程监视工具(Process Explorer / Process Monitor)确认助手进程**未对 dota2.exe 调用 OpenProcess/ReadProcessMemory**——截屏全程不接触游戏进程。代码路径不接触游戏进程(Task 6),**工具实测未做**。

### B2. 窗口定位(koffi 只读)
- [IMPL·待冒烟] overlay 能正确盖在游戏客户区上(位置/尺寸对齐)。代码已实装(Task 3 只读 `game_window.ts` + Task 10 接线)。**真机冒烟未做**(需无边框 Dota2 实测对齐)。
- [IMPL·待冒烟] 🚫 用工具(如 API Monitor)确认助手对 Dota2 hwnd **只发生读调用**(`GetClientRect`/`ClientToScreen`),**无任何写调用**。静态层面已由 `ReadonlyGameHwnd` branded 类型 + `compliance-scan.ps1` 保证(Task 1/3,对应 A1/A2 已 PASS);**API Monitor 真机实测未做**。

### B3. overlay 显示与穿透
- [IMPL·待冒烟] overlay 透明、点击穿透:鼠标点 overlay 区域,操作落到游戏而非 overlay。代码已实装(Task 7 `setIgnoreMouseEvents(true,{forward:true})` + Task 8 接线)。**真机冒烟未做**(`npm run dev` 实跑确认)。
- [IMPL·待冒烟] overlay 始终在游戏画面之上可见(`screen-saver` 层级生效)。代码已实装(Task 7/8 `setAlwaysOnTop(true,'screen-saver')`)。**真机冒烟未做**。
- [PASS] 🚫 确认 overlay 的 `SetWindowPos`/`SetWindowLong` 只对自身 HWND 生效(配合 A1)。由 `OwnOverlayHwnd` branded 类型 + `compliance-scan.ps1` 静态保证,扫描已确认写操作仅限 `overlay_window_ctl.ts` 对自身 hwnd(Task 1/7)。

### B4. 识别 + 打分
- [IMPL·待冒烟] 识别结果与真实选取界面一致(对照 `real-draft-layout` 布局)。代码已实装(Task 9 实时快照接线 + Task 10 识别/打分接线)。**真机冒烟未做**(需真实 AD 局对照识别结果)。
- [IMPL·待冒烟] 数据查询全程离线/本地,无对游戏进程的访问。代码路径为本地查询(Task 10),**真机实测确认未做**。

---

## 阶段 C — 独占全屏的"不越界"验证

> 目的:证明遇到独占全屏时,助手**走引导路径,而非技术强攻**。

### C1. 显示模式检测为只读
- [IMPL·待冒烟] 将 Dota2 切到真·独占全屏。
- [IMPL·待冒烟] 助手能检测出"当前为独占全屏"。代码已实装(Task 4 显示模式分类器 + Task 5/10 接线)。**真机冒烟未做**(需真实切独占全屏触发检测)。
- [PASS] 🚫 确认检测逻辑只用**只读** API(只读 `GetWindowLong` 查样式 / 显示器与 DWM 状态查询),**不调用任何写 API 去改游戏窗口**。由 `compliance-scan.ps1` 静态确认检测路径无写 API 调用(Task 1/4)。

### C2. 引导而非强攻
- [IMPL·待冒烟] 检测到独占全屏后,助手弹出**温和提示**:"请将显示模式改为无边框窗口"。代码已实装(Task 4/5 分类与提示文案 + Task 10 `overlay:guide` IPC 接线)。**真机冒烟未做**;另注:`overlay:guide` 当前已发送但 renderer 尚未消费展示(见 progress.md T10 follow-up),冒烟前需先补上消费端才能验证 UI 真正弹出。
- [PASS] 🚫 助手**不尝试**用 `SetWindowLong` 把 Dota2 改成无边框 / 剥夺独占属性。由 `compliance-scan.ps1` 静态确认全仓无此类写操作指向游戏 hwnd(Task 1)。
- [IMPL·待冒烟] 观察一段时间:游戏**无撕裂、无黑屏、无崩溃**(若强攻会出现这些)。需真机长时间运行观察,**未做**。

---

## 阶段 D — 稳定性 & 痕迹验证

### D1. 不引发游戏崩溃
- [IMPL·待冒烟] 助手运行下完整跑一局 AD,游戏全程稳定,无 Crash Dump 产生。整条管线代码已实装(Task 6/7/8/9/10 接线完成),**完整真机跑一局的稳定性冒烟未做**。
- [IMPL·待冒烟] (因为崩溃 Dump 回传 Valve 是人工审查触发源,这一项是合规相关而不仅是质量项。)

### D2. 资源占用合理
- [IMPL·待冒烟] `desktopCapturer`/DXGI 截屏帧率/CPU/GPU 占用在可接受范围,不拖累游戏。截屏链路已实装(Task 6),**真机资源占用实测未做**。

---

## 阶段 E — 政策面复核(非技术,需人工)

> ⚠️ 技术全绿 ≠ 政策允许。以下需由你对照官方条款人工判断,工具无法替代。
> 注:本阶段为非技术的人工政策判断,不属于"代码实现状态",因此不套用三态实现状态标签;以下沿用原始 `- [ ]` 待办形式,需人工逐条勾选完成。

- [ ] 查阅 Valve/Dota2 **当前**关于第三方覆盖工具 / VAC 的官方表述,确认无明确禁止此类读屏 overlay。
- [ ] 评估"提供游戏内得不到的信息优势"这一**竞技公平**维度,确认可接受的使用边界(如仅 AD 模式、仅信息展示)。
- [ ] 记录核对日期与官方条款版本(规则会变,需定期复核)。

---

## 合并门禁(Gate)

- **合并门禁 = 无 🚫 项停留 FAIL**;**已实现且可自动验证的 🚫 项(A1/A2/A3,由 `compliance-scan.ps1` 守门)必须 PASS**;**[IMPL·待冒烟] 表示代码已实装、等真机冒烟**;**[N/A] 表示该能力尚未实现,允许存在**。
- **[IMPL·待冒烟] 不阻断代码合并**——它代表代码已落地且静态合规检查(阶段 A)已过,只是行为尚未在真机上跑过。可以合并到主干继续推进后续开发。
- 但**面向用户发布 / 真机验收**前,所有 [IMPL·待冒烟] 项必须在真实无边框 Dota2(x64 Windows)环境下完成人工冒烟并转为 [PASS],方可视为"该版本已验证可用"。仍停留 [IMPL·待冒烟] 的版本不得对外宣称"已验证合规"。
- 阶段 A 应纳入 CI 或 commit 前固定步骤(grep 类检查可脚本化,即 `npm run compliance`)。
- 阶段 E 至少在每次面向用户分发前复核一次。
