// core/src/recognition/screen_layout.ts
// 屏幕比例归类 + 按比例摆格子。
// 游戏客户区的宽高比先归到六类之一(16:9、21:9、16:10、3:2、4:3、5:4),每类一整套位置表
// (技能池 48 格、英雄格 12、玩家卡 10、卡上已选格 40),以该类的「基准尺寸」标出。
// 实际位置 = 基准位置 × (实际高 / 基准高),再水平居中,最后加客户区原点。
// - 16:9 的表就是 1080p 常量表(留在 pool_slots / hero_layout / player_cards 原文件,数值不改);
//   近 1080p(宽、高各在 ±10px 内,真机截屏常见的 1918×1078 一类)照旧不缩放。
// - 21:9 的表由 16:9 的表推出:基准 2560×1080,整体右移 320(上游 3440×1440、3840×1600 核对过)。
// - 16:10、3:2、4:3、5:4 的表是上游数据初值(screen_layout_tables.ts),未实测。
// 见 docs/superpowers/specs/2026-11-06-screen-ratios-design.md。
import type { Rect, ClientRect } from "./roi";
import { POOL_SLOTS_1080P, type PoolSlot } from "./pool_slots";
import { HERO_CELLS_1080P, type HeroCell } from "./hero_layout";
import { PLAYER_CARDS_1080P, CARD_SLOTS_1080P, type PlayerCard, type CardSlot } from "./player_cards";
import { LAYOUT_16_10, LAYOUT_3_2, LAYOUT_4_3, LAYOUT_5_4 } from "./screen_layout_tables";

export type RatioClass = "16:9" | "21:9" | "16:10" | "3:2" | "4:3" | "5:4";

export interface LayoutTable {
  baseWidth: number;
  baseHeight: number;
  /** 位置都是基准尺寸下、原点 (0,0) 的像素。 */
  pool: PoolSlot[];
  heroes: HeroCell[];
  cards: PlayerCard[];
  cardSlots: CardSlot[];
  /** 有没有用真机截图(或可靠数据)核对过。 */
  verified: boolean;
}

/** 每类可接受的宽高比范围。各类目标值 ±0.02;21:9 覆盖 2.33–2.40(带鱼屏有 1834×786、3440×1440、
 *  3840×1600 几种),同样两端各放 0.02。夹在两类之间的(如 1.5625、1.63)不归任何一类。
 *  注:用的是宽高比的绝对差 0.02,不是相对 2%——相对 2% 会把 1.63 归进 16:10(差 1.9%)。 */
const RATIO_BANDS: { cls: RatioClass; lo: number; hi: number }[] = [
  { cls: "16:9", lo: 16 / 9 - 0.02, hi: 16 / 9 + 0.02 },
  { cls: "21:9", lo: 2.33 - 0.02, hi: 2.40 + 0.02 },
  { cls: "16:10", lo: 1.6 - 0.02, hi: 1.6 + 0.02 },
  { cls: "3:2", lo: 1.5 - 0.02, hi: 1.5 + 0.02 },
  { cls: "4:3", lo: 4 / 3 - 0.02, hi: 4 / 3 + 0.02 },
  { cls: "5:4", lo: 1.25 - 0.02, hi: 1.25 + 0.02 },
];

/** 宽高比归类;离六类都太远(或宽高不是正数)返回 null =「不支持」。 */
export function classifyRatio(width: number, height: number): RatioClass | null {
  if (!(width > 0) || !(height > 0)) return null;
  const r = width / height;
  return RATIO_BANDS.find((b) => r >= b.lo && r <= b.hi)?.cls ?? null;
}

const shiftX = <T extends Rect>(rs: T[], dx: number): T[] => rs.map((r) => ({ ...r, x: r.x + dx }));

// 表在第一次用到时才建:pool_slots 等模块反过来也引用本模块,模块加载时直接读它们的常量会撞上循环引用。
let tables: Record<RatioClass, LayoutTable> | null = null;

function buildTables(): Record<RatioClass, LayoutTable> {
  const t169: LayoutTable = {
    baseWidth: 1920, baseHeight: 1080, verified: true,
    pool: POOL_SLOTS_1080P, heroes: HERO_CELLS_1080P, cards: PLAYER_CARDS_1080P, cardSlots: CARD_SLOTS_1080P,
  };
  const t219: LayoutTable = {
    baseWidth: 2560, baseHeight: 1080, verified: true,
    pool: shiftX(t169.pool, 320), heroes: shiftX(t169.heroes, 320),
    cards: shiftX(t169.cards, 320), cardSlots: shiftX(t169.cardSlots, 320),
  };
  return { "16:9": t169, "21:9": t219, "16:10": LAYOUT_16_10, "3:2": LAYOUT_3_2, "4:3": LAYOUT_4_3, "5:4": LAYOUT_5_4 };
}

export function layoutTableFor(cls: RatioClass): LayoutTable {
  tables ??= buildTables();
  return tables[cls];
}

/** 近 1080p:宽、高各在 ±10px 内。逐格识别对像素很敏感,~0.998 的缩放也会认错,所以这类尺寸不缩放。 */
function near1080p(rect: ClientRect): boolean {
  return Math.abs(rect.width - 1920) <= 10 && Math.abs(rect.height - 1080) <= 10;
}

/** 把基准表里的一个位置换算到实际客户区:按高度缩放 + 水平居中 + 加原点。16:9 且近 1080p 时恒等。 */
export function placeRect<T extends Rect>(r: T, table: LayoutTable, rect: ClientRect): T {
  const identity = table.baseWidth === 1920 && table.baseHeight === 1080 && near1080p(rect);
  const s = identity ? 1 : rect.height / table.baseHeight;
  const ox = identity ? 0 : (rect.width - table.baseWidth * s) / 2;
  return {
    ...r,
    x: rect.x + Math.round(r.x * s + ox),
    y: rect.y + Math.round(r.y * s),
    w: Math.round(r.w * s),
    h: Math.round(r.h * s),
  };
}

/** 按客户区宽高归类并取表;不支持的比例返回 null。 */
export function screenLayoutFor(rect: ClientRect): { cls: RatioClass; table: LayoutTable } | null {
  const cls = classifyRatio(rect.width, rect.height);
  return cls ? { cls, table: layoutTableFor(cls) } : null;
}

/** 不支持的比例时的退路:16:9 的表横纵各自拉伸(旧算法)。只为不崩,调用方不会用这个结果去认。 */
export function stretchRect<T extends Rect>(r: T, rect: ClientRect): T {
  const sx = near1080p(rect) ? 1 : rect.width / 1920;
  const sy = near1080p(rect) ? 1 : rect.height / 1080;
  return {
    ...r,
    x: rect.x + Math.round(r.x * sx),
    y: rect.y + Math.round(r.y * sy),
    w: Math.round(r.w * sx),
    h: Math.round(r.h * sy),
  };
}

/** 四个位置函数共用:支持的比例按表换算,不支持时退回拉伸。 */
export function placeGroup<K extends "pool" | "heroes" | "cards" | "cardSlots">(
  group: K, rect: ClientRect,
): LayoutTable[K] {
  const found = screenLayoutFor(rect);
  if (found) return found.table[group].map((r: Rect) => placeRect(r, found.table, rect)) as LayoutTable[K];
  return layoutTableFor("16:9")[group].map((r: Rect) => stretchRect(r, rect)) as LayoutTable[K];
}
