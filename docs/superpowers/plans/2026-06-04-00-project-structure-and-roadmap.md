# AD 选取助手 · 项目结构与路线总览

> **For agentic workers:** 这是总览文档,不含可执行任务。逐阶段实现请按编号读取同目录下的 `2026-06-04-0X-*.md` 计划文件,并用 superpowers:subagent-driven-development 或 superpowers:executing-plans 逐任务执行(任务用 `- [ ]` 复选框跟踪)。

**Goal:** 在 Windows 上构建一个 Dota 2 Ability Draft 选取助手,采用「Python 离线数据/模型流水线 + TypeScript/Electron 实时热路径」双层架构,实现持续监控 + 条件化打分 + 槽位约束感知。

**本轮计划深度:** 阶段 0(离线地基)与阶段 1(识别 MVP)做到逐步 TDD 级细化;阶段 2–5 仅给结构化提纲(见 `...-03-phases-2-5-outline.md`),待 0/1 落地后再细化。

---

## 1. 路线图(对应计划书 §十)

| 阶段 | 目标 | 验收 | 本轮细化程度 |
|---|---|---|---|
| 0 · 离线地基 | Windrun 采集 → SQLite,ID 映射打通 | 能离线查询任一技能/英雄的胜率/搭配/神杖数据 | **完整 TDD 任务**(`...-01`) |
| 1 · 识别 MVP | 模板匹配 + 单 ROI + 截屏跑通 | 给定一帧能正确识别池中图标 | **完整 TDD 任务**(`...-02`) |
| 2 · 持续监控 | 捕获循环 + 多 ROI + frame-diff + 状态机 | 全程自动追踪一局,丢帧自愈,详情面板不污染 | 提纲(`...-03`) |
| 3 · 打分内核 | 槽位硬过滤 + 条件化打分 | 推荐永远合法,排序合理 | 提纲(`...-03`) |
| 4 · Overlay | 窗口追踪 + 透明穿透 + 实时渲染 | overlay 对齐窗口,无明显延迟 | 提纲(`...-03`) |
| 5 · 升级(可选) | NN 识别 / LLM 解释层 | 鲁棒性/可读性提升,不拖慢关键路径 | 提纲(`...-03`) |

> MVP 边界在阶段 2–3 交界。阶段 0、1 是其全部前置依赖。

---

## 2. 仓库结构(计划书 §八:纯领域核心,零 Electron 依赖)

```
AD/
├─ pipeline/                    # 阶段 0:Python 离线流水线(独立于 TS 工程)
│  ├─ pyproject.toml
│  ├─ src/ad_pipeline/
│  │  ├─ __init__.py
│  │  ├─ windrun/
│  │  │  ├─ client.py          # REST 客户端:503/Retry-After、分页、重试
│  │  │  └─ endpoints.py       # 各端点的 URL 与解析(static/abilities 等)
│  │  ├─ ids.py                # abilityId/valveId/heroId 映射核心(见 §4)
│  │  ├─ transform.py          # 清洗、isUltimate null 对账、分桶
│  │  ├─ db/
│  │  │  ├─ schema.sql         # SQLite 静态参考库 DDL
│  │  │  └─ loader.py          # upsert 各表
│  │  ├─ assets.py             # datdota CDN 参考图下载(阶段 1 消费)
│  │  └─ cli.py                # `python -m ad_pipeline ...` 入口
│  ├─ tests/
│  │  ├─ fixtures/             # 截断的真实 API JSON 样本(离线测试用)
│  │  └─ test_*.py
│  └─ out/                     # 产物:reference.db、assets/(.gitignore)
│
├─ core/                        # 阶段 3:纯领域逻辑(TS),Vitest 可测,零 Electron
│  ├─ src/{db,scoring,statemachine}/
│  └─ tests/
├─ main/                        # 阶段 2、4:Electron 主进程、捕获、FFI、窗口追踪
│  └─ src/{capture,recognition,ffi}/
├─ renderer/                    # 阶段 4:React overlay 与控制面板
├─ shared/                      # 跨 main/renderer/core 的类型定义
│  └─ types/                    # SlotType、DraftState、Candidate、Score 等
│
├─ models/                      # 阶段 1/5:识别参考库与(可选)ONNX
│  ├─ templates/               # 阶段 1:phash 索引 + 参考 sprite
│  └─ onnx/                    # 阶段 5:导出的分类器
│
├─ docs/superpowers/plans/      # 本目录:计划文档
├─ electron.vite.config.ts      # 阶段 2+
├─ package.json
└─ README.md
```

**边界规则:** `pipeline/`(Python)与 TS 工程之间只有两条静态产物边界:`pipeline/out/reference.db`(→ `core/` 只读消费)与 `models/templates/*`(→ `main/` 识别消费)。实时草稿状态**绝不进库**。

---

## 3. 技术选型(计划书 §三,锁定不变)

| 层 | 选型 |
|---|---|
| 桌面框架 | Electron + electron-vite |
| 前端 UI | React + shadcn/ui + Tailwind |
| 实时状态 | Zustand(纯内存,生命周期=一局) |
| ML 推理 | ONNX Runtime + DirectML(独立 worker) |
| 屏幕捕获 | `screenshot-desktop` 起步,后评估 DXGI |
| FFI / overlay 穿透 | koffi(→ **x64 Windows only**) |
| 数据库 | SQLite(better-sqlite3)+ Drizzle ORM(TS 侧只读) |
| 离线流水线 | Python 3.11+,httpx,SQLite(stdlib `sqlite3`) |
| 测试/打包 | Vitest + Playwright + electron-builder;Python 侧 pytest |

---

## 4. ID 模型(已对真实 API 探测确认 —— 全系统关键)

探测 `api.windrun.io/api/v2/` 得到的事实,所有阶段共用:

- **`static/abilities`** 是数组,每项有 `valveId`、`shortName`、`englishName`、`isUltimate`、`hasScepter`、`hasShard`、`ownerHeroId`、`tooltip`。共 ~3173 项。
- **英雄在 abilities 表中以「负 valveId」的伪技能存在**:`valveId = -heroId`。例:`-1` = "Hero: Anti-Mage"(shortName `antimage`),`-25` = "Hero: Lina"。这些项 `isUltimate/hasScepter/hasShard` 均为 `null`,`ownerHeroId` 为 `null`。
- **`static/heroes`** 是以 heroId 为键的 map:`{ "1": {id, englishName, shortName, picture, npc, cdota} }`。`picture` 用于拼 CDN。
- **统计端点统一用 `abilityId`,且 `abilityId == valveId`**:
  - 正数 `abilityId` = 真实技能(= 其 `valveId`)。
  - 负数 `abilityId` = 英雄伪技能(= `-heroId`)。
  - 因此 `ability-pairs` 里 `{abilityIdOne:-23, abilityIdTwo:5032}` = 「英雄23 × 技能5032」的协同 —— 计划书所说的「英雄+技能混合池」正是 Windrun 的原生建模。
- **`isUltimate` 有 672 项为 `null`**(含全部英雄伪技能 + 部分如 Largo 歌曲技能)。**离线侧必须对账标记**,热路径不可默认当普通技能(计划书 §一/§六硬性要求)。
- **CDN 参考图**(均已验证返回 200):
  - 技能:`https://cdn.datdota.com/images/ability/{shortName}.png`
  - 英雄全身:`https://cdn.datdota.com/images/heroes/{picture}_full.png`
  - 英雄头像:`https://cdn.datdota.com/images/miniheroes/{picture}.png`

各统计端点响应形状(阶段 0 任务依赖):

| 端点 | 顶层路径 | 形状 |
|---|---|---|
| `/static/abilities` | `data` | 数组 |
| `/static/heroes` | `data` | map(heroId→obj) |
| `/heroes` | `data.heroStats[heroId][patch]` | `{wins,numGames,winrate}`;补丁见 `data.patches.overall` |
| `/abilities` | `data.abilityStats` | 数组,元素含 `abilityId,numPicks,wins,winrate,avgPickPosition,pickRate,ownerHero` |
| `/ability-pairs` | `data.abilityPairs` | 数组,`{abilityIdOne,abilityIdTwo,numPicks,wins,winrate}` |
| `/ability-hero-attributes` | `data.abilityHeroAttributeStats[attr][abilityId]` | 按属性(str/agi/int/all)分组的 map,值含 `winrate` 等 |
| `/ability-aghs` | `data.abilityAghs` | 数组,`{abilityId,totalGames,noAghsScepter{winrate},aghsScepter{winrate},noAghsShard{winrate},aghsShard{winrate}}`,~636 项 |

> 所有端点当前补丁为 `7.41b`。服务端重算时返回 `503 + Retry-After`(计划书 §六),客户端需处理。

---

## 5. 执行顺序与依赖

```
阶段0 (pipeline/out/reference.db + assets/)
   │  静态产物边界①:reference.db
   ├──────────────► 阶段3 打分内核(core/ 读 DB)
   │  静态产物边界②:models/templates/
   └──────────────► 阶段1 识别 MVP ──► 阶段2 持续监控 ──► 阶段4 Overlay
```

阶段 0 必须先完成:阶段 1 的模板库来自阶段 0 下载的 CDN 参考图,阶段 3 的打分数据来自阶段 0 的 DB。

---

## 6. 全局验收门(每阶段通用)

每个阶段计划文件末尾都有「阶段验收清单」。通用门槛:

- **测试先行**:每个功能任务先写失败测试,再实现到通过(TDD)。
- **离线可测**:网络相关逻辑用 `tests/fixtures/` 的真实截断样本测,不在 CI 打真网。
- **频繁提交**:每个任务一个 commit。
- **产物可复现**:`python -m ad_pipeline build` 一条命令能从零重建 `reference.db`。
