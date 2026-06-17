# AD 助手 — 合规验证流程(Compliance Verification Checklist)

> 版本:2026-06-09
> 配套:`technical-behavior-and-anticheat.md`
> 原则:每个验证项要么证明**功能可用**,要么证明**合规红线未被越界**。红线项(标 🚫)只要有一条失败,该构建**不得合并、不得分发**。

---

## 阶段 A — 静态验证(代码层,不需运行游戏)

> 目的:在代码里堵死"对游戏做写操作"的可能,把红线变成可 grep 的硬约束。

### A1. 🚫 koffi 写操作不得指向 Dota2 HWND
- [ ] grep 全仓所有 `SetWindowPos` / `SetWindowLong` / `SetWindowLongPtr` / `SetWindowDisplayAffinity` / `SendMessage` / `PostMessage` / `ShowWindow` / `MoveWindow` 调用。
- [ ] 逐个确认其 HWND 入参来源是**自身 overlay 窗口**(如 `overlayWindow.getNativeWindowHandle()`),**不是** `FindWindowW` 的返回值。
- [ ] 验证手段:Dota2 的 hwnd 变量在代码中只流向 `GetClientRect`/`ClientToScreen`/只读的 `GetWindowLong`,never 流向上述写 API。
- **判定**:有任何一处游戏 hwnd 流向写 API → **FAIL,阻断合并**。

### A2. 🚫 无进程注入 / 内存访问 / 渲染 hook
- [ ] grep:`ReadProcessMemory` / `WriteProcessMemory` / `OpenProcess`(带写权限)/ `CreateRemoteThread` / `SetWindowsHookEx` / `Present` / `SwapBuffers` / `d3d` hook 相关。
- [ ] 期望:**零命中**(`OpenProcess` 若用于只读查询需单独审,默认不应出现)。
- **判定**:命中任一 → **FAIL**。

### A3. 🚫 零输入:不向游戏模拟键鼠
- [ ] grep:`SendInput` / `keybd_event` / `mouse_event` / `PostMessage(WM_KEY*/WM_*BUTTON*)`。
- [ ] 期望:零命中(热键若有,须为 Electron `globalShortcut`,不得为 `SetWindowsHookEx` 全局钩子)。
- **判定**:命中模拟输入 → **FAIL**。

### A4. 不修改游戏文件
- [ ] 确认无任何代码写入 Dota2 安装目录 / 配置文件路径。

---

## 阶段 B — 运行时行为验证(无边框窗口,运行基准)

> 环境:Dota2 设为**无边框窗口**,1920×1080。在 Demo/练习模式或 AD 自定义局做,**不在天梯/匹配局测**。

### B1. 截屏链路(DXGI)
- [ ] DXGI 能在无边框下抓到**非黑屏**的游戏画面帧。
- [ ] 用进程监视工具(Process Explorer / Process Monitor)确认助手进程**未对 dota2.exe 调用 OpenProcess/ReadProcessMemory**——截屏全程不接触游戏进程。

### B2. 窗口定位(koffi 只读)
- [ ] overlay 能正确盖在游戏客户区上(位置/尺寸对齐)。
- [ ] 🚫 用工具(如 API Monitor)确认助手对 Dota2 hwnd **只发生读调用**(`GetClientRect`/`ClientToScreen`),**无任何写调用**。

### B3. overlay 显示与穿透
- [ ] overlay 透明、点击穿透:鼠标点 overlay 区域,操作落到游戏而非 overlay。
- [ ] overlay 始终在游戏画面之上可见(`screen-saver` 层级生效)。
- [ ] 🚫 确认 overlay 的 `SetWindowPos`/`SetWindowLong` 只对自身 HWND 生效(配合 A1)。

### B4. 识别 + 打分
- [ ] 识别结果与真实选取界面一致(对照 `real-draft-layout` 布局)。
- [ ] 数据查询全程离线/本地,无对游戏进程的访问。

---

## 阶段 C — 独占全屏的"不越界"验证

> 目的:证明遇到独占全屏时,助手**走引导路径,而非技术强攻**。

### C1. 显示模式检测为只读
- [ ] 将 Dota2 切到真·独占全屏。
- [ ] 助手能检测出"当前为独占全屏"。
- [ ] 🚫 确认检测逻辑只用**只读** API(只读 `GetWindowLong` 查样式 / 显示器与 DWM 状态查询),**不调用任何写 API 去改游戏窗口**。

### C2. 引导而非强攻
- [ ] 检测到独占全屏后,助手弹出**温和提示**:"请将显示模式改为无边框窗口"。
- [ ] 🚫 助手**不尝试**用 `SetWindowLong` 把 Dota2 改成无边框 / 剥夺独占属性。
- [ ] 观察一段时间:游戏**无撕裂、无黑屏、无崩溃**(若强攻会出现这些)。

---

## 阶段 D — 稳定性 & 痕迹验证

### D1. 不引发游戏崩溃
- [ ] 助手运行下完整跑一局 AD,游戏全程稳定,无 Crash Dump 产生。
- [ ] (因为崩溃 Dump 回传 Valve 是人工审查触发源,这一项是合规相关而不仅是质量项。)

### D2. 资源占用合理
- [ ] DXGI 截屏帧率/CPU/GPU 占用在可接受范围,不拖累游戏。

---

## 阶段 E — 政策面复核(非技术,需人工)

> ⚠️ 技术全绿 ≠ 政策允许。以下需由你对照官方条款人工判断,工具无法替代。

- [ ] 查阅 Valve/Dota2 **当前**关于第三方覆盖工具 / VAC 的官方表述,确认无明确禁止此类读屏 overlay。
- [ ] 评估"提供游戏内得不到的信息优势"这一**竞技公平**维度,确认可接受的使用边界(如仅 AD 模式、仅信息展示)。
- [ ] 记录核对日期与官方条款版本(规则会变,需定期复核)。

---

## 合并门禁(Gate)

- **所有 🚫 红线项必须 PASS** → 否则禁止合并/分发。
- 阶段 A 应纳入 CI 或 commit 前固定步骤(grep 类检查可脚本化)。
- 阶段 E 至少在每次面向用户分发前复核一次。
