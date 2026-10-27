// core/src/recognition/pool_slots.ts
// 技能池 48 格的「位置 → 属于哪个英雄」对应表(1920×1080)。
// 一个英雄的 4 格分在两处:3 个普通技能在标准区、与该英雄模型同一行并紧挨模型;
// 1 个终极技能在上方单独的终极区,靠本表的 hero 编号对应(终极区右半边顺序是反的)。
// hero = 英雄位置编号(左列自上而下 0,1,2,3,4,10;右列 5,6,7,8,9,11),
// slot = 该英雄的第几个普通技能(1..3),终极为 0。
// 坐标取自仓库根 layout_coordinates.json(源自 Tiarin-Hino/ability-draft-plus,ISC)的
// ultimate_slots_coords / standard_slots_coords,原样未调——分类器对 1–2px 偏移不敏感
// (14 张真帧验证,含 1918×1078 截图)。与 POOL_CELLS_1080P(为 pHash 逐格微调过)是两套表。
import type { Rect, ClientRect } from "./roi";

export interface PoolSlot extends Rect {
  zone: "ultimate" | "standard";
  hero: number;
  slot: number;
}

export const POOL_SLOTS_1080P: PoolSlot[] = [
  { x: 693, y: 166, w: 53, h: 58, zone: "ultimate", hero: 0, slot: 0 },
  { x: 788, y: 166, w: 56, h: 58, zone: "ultimate", hero: 1, slot: 0 },
  { x: 884, y: 166, w: 57, h: 58, zone: "ultimate", hero: 2, slot: 0 },
  { x: 980, y: 166, w: 57, h: 58, zone: "ultimate", hero: 7, slot: 0 },
  { x: 1078, y: 166, w: 56, h: 58, zone: "ultimate", hero: 6, slot: 0 },
  { x: 1175, y: 166, w: 53, h: 58, zone: "ultimate", hero: 5, slot: 0 },
  { x: 699, y: 264, w: 52, h: 56, zone: "ultimate", hero: 3, slot: 0 },
  { x: 792, y: 264, w: 54, h: 56, zone: "ultimate", hero: 4, slot: 0 },
  { x: 886, y: 264, w: 55, h: 56, zone: "ultimate", hero: 10, slot: 0 },
  { x: 980, y: 264, w: 55, h: 56, zone: "ultimate", hero: 11, slot: 0 },
  { x: 1075, y: 264, w: 54, h: 56, zone: "ultimate", hero: 9, slot: 0 },
  { x: 1170, y: 264, w: 52, h: 56, zone: "ultimate", hero: 8, slot: 0 },
  { x: 731, y: 344, w: 47, h: 42, zone: "standard", hero: 0, slot: 1 },
  { x: 808, y: 344, w: 48, h: 42, zone: "standard", hero: 0, slot: 2 },
  { x: 884, y: 344, w: 50, h: 42, zone: "standard", hero: 0, slot: 3 },
  { x: 987, y: 344, w: 50, h: 42, zone: "standard", hero: 5, slot: 1 },
  { x: 1065, y: 344, w: 48, h: 42, zone: "standard", hero: 5, slot: 2 },
  { x: 1143, y: 344, w: 47, h: 42, zone: "standard", hero: 5, slot: 3 },
  { x: 725, y: 409, w: 48, h: 45, zone: "standard", hero: 1, slot: 1 },
  { x: 804, y: 409, w: 49, h: 45, zone: "standard", hero: 1, slot: 2 },
  { x: 882, y: 409, w: 51, h: 45, zone: "standard", hero: 1, slot: 3 },
  { x: 988, y: 409, w: 51, h: 45, zone: "standard", hero: 6, slot: 1 },
  { x: 1068, y: 409, w: 49, h: 45, zone: "standard", hero: 6, slot: 2 },
  { x: 1148, y: 409, w: 48, h: 45, zone: "standard", hero: 6, slot: 3 },
  { x: 718, y: 478, w: 49, h: 47, zone: "standard", hero: 2, slot: 1 },
  { x: 799, y: 478, w: 51, h: 47, zone: "standard", hero: 2, slot: 2 },
  { x: 880, y: 478, w: 53, h: 47, zone: "standard", hero: 2, slot: 3 },
  { x: 989, y: 478, w: 53, h: 47, zone: "standard", hero: 7, slot: 1 },
  { x: 1071, y: 478, w: 51, h: 47, zone: "standard", hero: 7, slot: 2 },
  { x: 1153, y: 478, w: 49, h: 47, zone: "standard", hero: 7, slot: 3 },
  { x: 707, y: 593, w: 49, h: 51, zone: "standard", hero: 3, slot: 1 },
  { x: 792, y: 593, w: 52, h: 51, zone: "standard", hero: 3, slot: 2 },
  { x: 877, y: 593, w: 54, h: 51, zone: "standard", hero: 3, slot: 3 },
  { x: 990, y: 593, w: 54, h: 51, zone: "standard", hero: 8, slot: 1 },
  { x: 1076, y: 593, w: 52, h: 51, zone: "standard", hero: 8, slot: 2 },
  { x: 1163, y: 593, w: 49, h: 51, zone: "standard", hero: 8, slot: 3 },
  { x: 700, y: 672, w: 52, h: 55, zone: "standard", hero: 4, slot: 1 },
  { x: 787, y: 672, w: 54, h: 55, zone: "standard", hero: 4, slot: 2 },
  { x: 874, y: 672, w: 57, h: 55, zone: "standard", hero: 4, slot: 3 },
  { x: 991, y: 672, w: 57, h: 55, zone: "standard", hero: 9, slot: 1 },
  { x: 1079, y: 672, w: 54, h: 55, zone: "standard", hero: 9, slot: 2 },
  { x: 1169, y: 672, w: 52, h: 55, zone: "standard", hero: 9, slot: 3 },
  { x: 691, y: 757, w: 55, h: 58, zone: "standard", hero: 10, slot: 1 },
  { x: 781, y: 757, w: 57, h: 58, zone: "standard", hero: 10, slot: 2 },
  { x: 872, y: 757, w: 58, h: 58, zone: "standard", hero: 10, slot: 3 },
  { x: 992, y: 757, w: 58, h: 58, zone: "standard", hero: 11, slot: 1 },
  { x: 1083, y: 757, w: 57, h: 58, zone: "standard", hero: 11, slot: 2 },
  { x: 1176, y: 757, w: 55, h: 58, zone: "standard", hero: 11, slot: 3 },
];

/** 按游戏客户区矩形给出 48 格的像素位置(顺序同 POOL_SLOTS_1080P:先 12 终极,后 36 标准)。
 *  近 1080p(±10px,真机截屏常见的 1918×1078 一类)按恒等处理不缩放,与 heroCellRects 同规则。 */
export function poolSlots(rect: ClientRect): PoolSlot[] {
  const near1080p = Math.abs(rect.width - 1920) <= 10 && Math.abs(rect.height - 1080) <= 10;
  const sx = near1080p ? 1 : rect.width / 1920;
  const sy = near1080p ? 1 : rect.height / 1080;
  return POOL_SLOTS_1080P.map((s) => ({
    ...s,
    x: rect.x + Math.round(s.x * sx),
    y: rect.y + Math.round(s.y * sy),
    w: Math.round(s.w * sx),
    h: Math.round(s.h * sy),
  }));
}
