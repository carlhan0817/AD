# 标准池两端 12 英雄格识别 设计

日期:2026-07-07
状态:已批准设计,待写实现计划

## 目标

识别 Ability Draft 选取界面中**标准技能池左右两端各 6 个、共 12 个英雄格**(玩家可选的英雄
立绘),产出本局英雄候选集合(valveId[],负值,可反查 heroes 表)。

非目标(YAGNI):
- ❌ 玩家卡头像(左右两列各 5,共 10,对应 `heroes_coords`)——那是已入座玩家的已选英雄,
  与本次的池两端 12 英雄格(`models_coords`)不同,别混。
- ❌ 有上下文打分 / 状态机映射(本阶段只产出候选集合)。
- ❌ 真机实时集成的性能调优(首帧定位+缓存)——留作接入后的独立迭代。

## 背景与关键决策(均有 4 帧真机实测支撑)

真机帧:`docs/screenshot/` 的 143121 / 151032 / 153748 / 153844(均 1918×1078,即 1080p),
每帧 12 英雄格 ground truth 已知。

### 图源:selection 立绘(已定论)
英雄识别基准用 `models/templates/sprites/panorama/images/heroes/selection/npc_dota_hero_<picture>_png.png`
(选取界面正脸立绘),不是原来的 mini 小地图头像。命名转换:去 `npc_dota_hero_` 前缀 + `_png`
后缀 = DB picture 值,127/127 命中。这批图全不透明,直接走技能同款 `.convert("L")`→resize32→pHash,
无需 alpha 合成。已改 [pipeline/src/ad_pipeline/cli.py](../../../pipeline/src/ad_pipeline/cli.py)
`_read_index_entries`(英雄走本地 selection,不下载),已重建 phash_index(技能条目不变、
英雄 127 全变、互不重复)。整图入索引,**不裁剪**。

### 坐标来源:layout_coordinates.json 的 models_coords(已定论)
仓库根 [layout_coordinates.json](../../../layout_coordinates.json) 是 28 分辨率权威坐标表。
`resolutions["<W>x<H>"].models_coords` 就是这 12 个英雄格:逐格 `{x,y,width,height,hero_order}`,
width/height 49→56 逐格增(自带透视)。左 `MC[0..5]`(hero_order 0-4,10),右 `MC[6..11]`
(hero_order 5-9,11)。

### 定位:固定坐标 + 每格小范围微调(已定论,实测)
坐标系是固定的(不是逐帧漂移——早前该误判源于当时无 models_coords、拿手标粗坐标去套)。实测:
- models_coords 直接用:16/48
- + 统一 dy=-4(全 4 帧一致 → 证明只差原点校正):33/48
- + 每格统一 pad:最高 36/48(75%)——**纯固定坐标不够**
- **models_coords + dy=-4 + 每格 ±6px/pad 微调 → 48/48 rank-0**

结论:每格微调是**必需**,不是可选。但 models_coords 是极好的起点,微调范围极小(±6px + pad),
搜索空间比"整列盲搜"小一两个数量级,真机可接受(首帧定位 + 缓存)。

## 架构

复用技能池的固定坐标识别路线([poolCellRects](../../../core/src/recognition/roi.ts) →
[recognizePool](../../../core/src/recognition/pool_recognize.ts)),坐标来源换成 models_coords,
并在每格加一层小范围 refine。

数据流:
```
frame(灰度) + rect(客户区) + resolution
  → heroCellRects(resolution)            从 models_coords 取 12 格 + HERO_OFFSET(dy≈-4)
  → 每格 refineHeroCell(frame, cell)     ±6px/pad 小窗口搜 pHash 最近邻
  → recognizeCell(gray32, index, thr)    英雄档阈值 HERO_MAX_DISTANCE≈26
  → 空格(未命中)跳过 + 集合去重
  → number[]  本局英雄 valveId[](负值)
```

## 组件划分

### 1. `core/src/recognition/hero_layout.ts`(新)—— 坐标提供
- `loadModelsCoords(resolution)`:从 layout_coordinates.json 取对应分辨率的 `models_coords`(12 个)。
- `HERO_OFFSET_1080P = { dx: 0, dy: -4 }`:全局原点校正(类 [POOL_OFFSET_1080P](../../../core/src/recognition/roi.ts))。
- `heroCellRects(resolution)`:返回 12 个 `Rect`(models_coords + offset)。
- 分辨率不在表中 → 回退:用 1080p 坐标按 rect 等比缩放(与 poolCellRects 一致),记日志。
- **接口**:入分辨率(或 rect),出 12 个 Rect。不碰识别,不碰帧。

### 2. `core/src/recognition/hero_recognize.ts`(新)—— 微调 + 识别
- `refineHeroCell(frame, rect)`:以 rect 为中心,±6px(dx/dy)+ pad 小窗口,取 pHash 最近邻
  距离最小的框,返回其 gray32。
- `recognizeHeroes(frame, resolution, index, maxDistance=HERO_MAX_DISTANCE)`:遍历 12 格 →
  refine → recognizeCell → 空格跳过 → 集合去重返回 valveId[]。
- 仿 [recognizePool](../../../core/src/recognition/pool_recognize.ts) 的空格跳过 + 去重结构。
- `HERO_MAX_DISTANCE ≈ 26`(英雄档,比技能档 20 略宽:英雄真机距离普遍 14-24)。

### 3. 接入(main)——本阶段可选,先离线跑通
在 [loop.ts](../../../main/src/capture/loop.ts) / scan_once 的现有识别旁加英雄格识别,
产出并入观测。接入与真机性能(首帧定位+缓存)作为独立后续,不阻塞离线验证。

## 错误处理 / 边界
- 分辨率不在 28 表中 → 1080p 等比缩放回退 + 日志。
- 空格(顶部未排满)→ 距离过阈值自动跳过,天然处理行错位/空位。
- 越界坐标 → cropRaw 已 clamp。
- refine 窗口不能过大(否则相邻格互相污染)——固定 ±6px。

## 测试(TDD)
- **Fixture**:4 帧真机图 + 各 12 英雄 ground truth,放 `core/tests/fixtures/`(帧可能较大,
  确认仓库策略;必要时存 gray32 预处理数据而非原图)。
- **红→绿**:
  1. `heroCellRects(1080p)` 返回 12 个 Rect,坐标匹配 models_coords + offset(纯几何,快)。
  2. `recognizeHeroes` 对 4 帧,返回的 valveId 集合 ⊇ 各帧真实英雄集合(阈值 48/48,已实测可达)。
- 先写测试(红),再实现坐标+refine+识别(绿)。

## 已知取舍
- refine 每格 ±6px 有计算成本;真机靠"首帧定位+缓存后续微调"摊薄(本阶段不实现,离线验证不受影响)。
- HERO_OFFSET / pad / 阈值这几个常量以 4 帧实测标定,后续更多帧或更多分辨率可能需微调。
