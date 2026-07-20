// core/src/recognition/roi.ts
// 多 ROI 规格 + 裁剪。坐标对 1920x1080 手填;阶段 4 升级为按窗口尺寸推导。
// 英雄槽(长方形)与技能槽(正方形)物理解耦,避免对长方形头像做正方形裁切→形变→雪崩。
import { cropRaw, cropGrid, type GrayFrame, type GridSpec } from "./grid";
import { resizeGrayTo32 } from "./resize"; // 共享双线性缩放(阶段 1),与建索引侧同核
import { POOL_CELLS_1080P } from "./pool_layout_1080p"; // 逐格绝对坐标(取代比例模型)

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

/** diffRois 的具名返回结构,解耦「静止判据」与「锚点校验」两种用途:
 *  - diff: 喂 FrameGate.shouldProcess 的稳定判据块。**不含 timer**——
 *    timer 是回合倒计时,每秒跳动,若混入静止判据会导致画面永远「在动」、永不放行稳定帧。
 *  - anchors: 喂 isValidLayout 的 UI 锚点块(校验是否被遮挡层挡住)。timer 区域本身
 *    结构丰富(数字+背景),适合当锚点,这个用途保留。 */
export interface DiffRois {
  diff: number[][][];
  anchors: number[][][];
}

/** 门控用的原始(不缩放)ROI 块。
 *  - 传 rect 时(真机路径):diff 与 anchors 都取"池区代表格"(终极区首格 + 标准区首格)。
 *    池区是静态技能图标:静止判据不会被右列玩家卡倒计时徽章/中央倒计时跳动打断(那是
 *    ①永久卡住的真机根因),锚点校验也因这些格必有高方差图标而能过②。
 *  - 不传 rect 时(旧路径/向后兼容):diff = [pool, slots](不含 timer),anchors = [pool, timer]。 */
export function diffRois(frame: GrayFrame, layout: DraftLayout, rect?: ClientRect): DiffRois {
  const pool = cropRaw(frame, layout.pool.x, layout.pool.y, 64, 64);
  const slotsW = layout.abilitySlots.x + layout.abilitySlots.cols *
    (layout.abilitySlots.cellW + layout.abilitySlots.gapX) - layout.heroSlot.x;
  const slots = cropRaw(frame, layout.heroSlot.x, layout.heroSlot.y, slotsW, 10 * layout.rowPitch);

  // timer 块两条分支都可能用到(rect 分支的兜底 + 无 rect 分支),提前算一次。
  const timer = cropRaw(frame, layout.timer.x, layout.timer.y, layout.timer.w, layout.timer.h);

  if (rect) {
    // 新:池区代表格,diff(静止判据)与 anchors(锚点校验)同源。
    // 取第一个终极区格 + 第一个标准区格(铺平序列里两个稳妥的「必有图标」点)。
    const cells = poolCellRects(POOL_LAYOUT_RATIO, rect);
    const zones = poolCellZones(); // 与 cells 一一对应
    const ultIdx = zones.indexOf("ultimate");
    const stdIdx = zones.indexOf("standard");
    const poolRepCells = [cells[ultIdx], cells[stdIdx]]
      .filter((c): c is Rect => !!c);
    // 防御性护栏:代表格若 < 2(例如未来误删某个 zone 导致 findIndex 返回 -1,
    // 或退化 rect 导致取不到代表格),绝不能让 anchors 缩短到 0/1——
    // isValidLayout 的 anchorRois.every(...) 对空数组会「真值通过」,会让②门槛在
    // 全黑/被遮挡画面上静默放行。此时 diff 与 anchors 都回退旧坐标,保底至少 2 块。
    // Defensive guard: if pool reps are insufficient (<2), never let anchors
    // shrink to 0/1 — isValidLayout's `.every()` is vacuously true on an empty
    // array, which would silently pass the ②-gate on a blank/occluded screen.
    if (poolRepCells.length < 2) {
      return { diff: [pool, slots], anchors: [pool, timer] };
    }
    // diff 改读池区代表格(静态技能图标,不跳动)。真机回归:旧 diff 压在占位 slots 带
    // (x≈1300,覆盖右列玩家卡每格倒计时徽章),那些数字每秒跳 → diff hash 每帧变 →
    // FrameGate 永远凑不齐连续静止帧 → ①永久卡住。改读池区后,选取界面静止时 diff 稳定,
    // ①能正常放行。timer/中央倒计时不在池区代表格内,天然不干扰。
    const poolBlocks = poolRepCells.map((c) => cropRaw(frame, c.x, c.y, c.w, c.h));
    return { diff: poolBlocks, anchors: poolBlocks };
  }

  // 回退:旧 [pool, timer] 行为(向后兼容现有调用与测试)。
  return { diff: [pool, slots], anchors: [pool, timer] };
}

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

/** 全局平移校正(1080p 像素)。JSON 坐标系原点与 gameClientRect 客户区原点可能差一个固定偏移
 *  (如 JSON 含标题栏/边框而客户区不含)→ 所有框整体偏移。真机量「框中心 vs 图标中心」后填此值。
 *  框偏图标右下 → 需向左上平移 → dx/dy 取负。0 表示未校正。按 rect 等比缩放后再应用。 */
// 真机重标(2026-06-21,基于真游戏帧 .frame_dump_0.pgm + pHash 距离实测,而非目视):
// 关键教训——目视画框对齐 ≠ pHash 最优。在真帧上跑 48 格最近邻距离对比三种 offset:
//   OLD(-9,-6): mean=18.5 d<=10 命中 0/48   ← 之前那帧是编辑器,量反了
//   (+6,+6)   : mean=17.9 d<=10 命中 0/48   ← 目视"更贴",但 pHash 反而更差
//   (0,0)     : mean=9.2  d<=10 命中 33/48  ← 原始 POOL_CELLS_1080P 坐标本就近乎精准
// 故正确值是【不加偏移】。pHash 才是识别真正用的度量,以它为准(目视画框对齐反而会误导)。
// 对齐后该帧 48 格在阈值 20 下全部正确识别(识别阈值见 main/src/capture/loop.ts 的
// RECOGNIZE_MAX_DISTANCE)。
export const POOL_OFFSET_1080P = { dx: 0, dy: 0 };

/** 池布局推导:返回技能池 48 格的绝对像素 ROI(逐行逐格铺平)。
 *  改用逐格绝对坐标(POOL_CELLS_1080P)而非「行+比例+统一步距」——池是 3D 透视梯形台,
 *  每格 w/h/间距都不同,统一步距会累积发散(真机画框已证实)。逐格坐标无累积误差。
 *  非 1920×1080 时按 rect 尺寸等比缩放(width/1920, height/1080);1080p 下为恒等。
 *  再叠加 POOL_OFFSET_1080P 全局平移(校正 JSON 坐标系与客户区原点差)。
 *  `layout` 形参保留以兼容现有调用签名,实际坐标来自 POOL_CELLS_1080P,不再依赖比例模型。
 *
 *  ⚠️ 已知待核实隐患(2026-07-20,hero-cell-recognition 计划期间发现,未在该计划范围内修复):
 *  英雄格识别(hero_layout.ts 的 heroCellRects)曾因同类无条件等比缩放,在真机截屏(常见
 *  1918×1078 一类,非真实异分辨率,是同一 1080p 显示器的 capture-crop/DPI 伪影)上产生
 *  约 1-2px 漂移,导致约一半格识别到错误英雄——pHash 逐格识别对像素极敏感,微小缩放足以
 *  致命。此函数的缩放逻辑与修复前的 heroCellRects 完全同构,是否有相同隐患**未经验证**
 *  ("48/48 verified" 的判据帧尺寸未被断言,不确定是否为真实 1918×1078 截屏)。
 *  修复前(参考 hero_layout.ts 的 near1080p 容差处理)不要假设本函数在真机截屏上无偏差。 */
export function poolCellRects(_layout: PoolLayout, rect: ClientRect): Rect[] {
  const sx = rect.width / 1920;
  const sy = rect.height / 1080;
  const ox = POOL_OFFSET_1080P.dx * sx;
  const oy = POOL_OFFSET_1080P.dy * sy;
  return POOL_CELLS_1080P.map((c) => ({
    x: rect.x + Math.round(c.x * sx + ox),
    y: rect.y + Math.round(c.y * sy + oy),
    w: Math.round(c.w * sx),
    h: Math.round(c.h * sy),
  }));
}

/** 池区代表格的 zone 序列(与 poolCellRects 返回顺序一一对应),供锚点/分区判断。 */
export function poolCellZones(): ("ultimate" | "standard")[] {
  return POOL_CELLS_1080P.map((c) => c.zone);
}

// 标定常量:逐行比例值量自 1920×1080 真机截图(docs/screenshot/20260619152847_1.jpg、
// 20260619153032_1.jpg)。量法:在截图上逐格读左上角像素 (px,py) 与边长 cw,
// 比例 = 像素 / 客户区尺寸(startXRatio=px/1920, yRatio=py/1080, cellRatio=cw/1920,
// gapRatio=(相邻格左缘差-cw)/1920)。真机验证阶段若仍有偏移,继续按此法微调。
//
// 实测结构与占位假设不同:终极区每行实际 6 格(非 5);标准区每行实际 8 格
// (左 4 + 右 4,非 7——右组末格在部分帧上被"已选英雄头像"预览遮挡,但格位本身
// 仍是网格的一部分,故几何上仍按 8 格建模)。两区均随 3D 透视:标准区行越靠下,
// startXRatio 越小、cellRatio 略增大(梯形台往下变宽)。
// 重标定 v3(2026-06-21 真机画框第2轮):v2 框「偏右下 + 偏大」,即起点偏右下、cell 偏大、
// 步距偏大 → 整体右下 + 越往右下越发散(标准区右下角飘到玩家卡)。本轮:起点左上移、cell 缩小。
// v2 框#0 实测 (686,156,88×88) 偏右下偏大 → cell 88→78、起点 x/y 各左上移。标准区发散更重,
// cell 收更多、步距随之变小。量自 docs/screenshot/20260619153032_1.jpg,靠 overlay 画框继续迭代收敛。
export const POOL_LAYOUT_RATIO: PoolLayout = {
  rows: [
    // 终极技能区(上,2 行各 6 格)。起点左上移(0.3573→0.349, y 0.1444→0.137),cell 缩(0.0458→0.0406)。
    { startXRatio: 0.3490, yRatio: 0.1370, cellRatio: 0.0406, gapRatio: 0.0016, count: 6, zone: "ultimate" },
    { startXRatio: 0.3490, yRatio: 0.2222, cellRatio: 0.0406, gapRatio: 0.0016, count: 6, zone: "ultimate" },
    // 标准技能区(下,4 行各 8 格;透视下越往下越宽,startX 递减、cell 略增)。起点左上移、cell 缩。
    { startXRatio: 0.3100, yRatio: 0.3130, cellRatio: 0.0417, gapRatio: 0.0000, count: 8, zone: "standard" },
    { startXRatio: 0.3036, yRatio: 0.3900, cellRatio: 0.0427, gapRatio: 0.0000, count: 8, zone: "standard" },
    { startXRatio: 0.2927, yRatio: 0.4950, cellRatio: 0.0438, gapRatio: 0.0000, count: 8, zone: "standard" },
    { startXRatio: 0.2823, yRatio: 0.5960, cellRatio: 0.0448, gapRatio: 0.0000, count: 8, zone: "standard" },
  ],
};
