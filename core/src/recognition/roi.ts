// core/src/recognition/roi.ts
// 多 ROI 规格 + 裁剪。坐标对 1920x1080 手填;阶段 4 升级为按窗口尺寸推导。
// 英雄槽(长方形)与技能槽(正方形)物理解耦,避免对长方形头像做正方形裁切→形变→雪崩。
import { cropRaw, cropGrid, type GrayFrame, type GridSpec } from "./grid";
import { resizeGrayTo32 } from "./resize"; // 共享双线性缩放(阶段 1),与建索引侧同核

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

/** 门控用的原始(不缩放)ROI 块:池左上、十行槽带、计时器。 */
export function diffRois(frame: GrayFrame, layout: DraftLayout): DiffRois {
  const pool = cropRaw(frame, layout.pool.x, layout.pool.y, 64, 64);
  // 槽带覆盖英雄槽起点到 4 个技能槽末端,纵向覆盖十行。
  const slotsW = layout.abilitySlots.x + layout.abilitySlots.cols *
    (layout.abilitySlots.cellW + layout.abilitySlots.gapX) - layout.heroSlot.x;
  const slots = cropRaw(frame, layout.heroSlot.x, layout.heroSlot.y, slotsW, 10 * layout.rowPitch);
  const timer = cropRaw(frame, layout.timer.x, layout.timer.y, layout.timer.w, layout.timer.h);
  // diff:静止判据,不含 timer(timer 每秒跳动,混入会让 FrameGate 永不判定静止)。
  // anchors:锚点校验,pool + timer(两者结构都够丰富,可用方差判断是否被遮挡)。
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

// 标定常量:逐行比例值量自 1920×1080 真机截图(docs/screenshot/20260619152847_1.jpg、
// 20260619153032_1.jpg)。量法:在截图上逐格读左上角像素 (px,py) 与边长 cw,
// 比例 = 像素 / 客户区尺寸(startXRatio=px/1920, yRatio=py/1080, cellRatio=cw/1920,
// gapRatio=(相邻格左缘差-cw)/1920)。真机验证阶段若仍有偏移,继续按此法微调。
//
// 实测结构与占位假设不同:终极区每行实际 6 格(非 5);标准区每行实际 8 格
// (左 4 + 右 4,非 7——右组末格在部分帧上被"已选英雄头像"预览遮挡,但格位本身
// 仍是网格的一部分,故几何上仍按 8 格建模)。两区均随 3D 透视:标准区行越靠下,
// startXRatio 越小、cellRatio 略增大(梯形台往下变宽)。
export const POOL_LAYOUT_RATIO: PoolLayout = {
  rows: [
    // 终极技能区(上,偏窄,2 行各 6 格)
    { startXRatio: 0.3557, yRatio: 0.1509, cellRatio: 0.0339, gapRatio: 0.0182, count: 6, zone: "ultimate" },
    { startXRatio: 0.3563, yRatio: 0.2398, cellRatio: 0.0339, gapRatio: 0.0182, count: 6, zone: "ultimate" },
    // 标准技能区(下,偏宽,4 行各 8 格;透视下越往下越宽,startX 递减、cell 略增)
    { startXRatio: 0.3219, yRatio: 0.3176, cellRatio: 0.0323, gapRatio: 0.0172, count: 8, zone: "standard" },
    { startXRatio: 0.3167, yRatio: 0.3759, cellRatio: 0.0323, gapRatio: 0.0156, count: 8, zone: "standard" },
    { startXRatio: 0.2979, yRatio: 0.4370, cellRatio: 0.0328, gapRatio: 0.0141, count: 8, zone: "standard" },
    { startXRatio: 0.2927, yRatio: 0.5444, cellRatio: 0.0339, gapRatio: 0.0172, count: 8, zone: "standard" },
  ],
};
