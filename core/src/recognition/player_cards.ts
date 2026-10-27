// core/src/recognition/player_cards.ts
// 左右两列 10 张玩家卡(行 0–4 左列自上而下,5–9 右列)的位置,以及每张卡上 4 个已选技能格
// (3 个普通 + 1 个终极)的位置。坐标取自仓库根 layout_coordinates.json(源自
// Tiarin-Hino/ability-draft-plus,ISC)的 heroes_coords / selected_abilities_coords,
// 抄成常量表(运行时不读文件,打包进 Electron 后路径会失效)。
import type { Rect, ClientRect } from "./roi";

export interface PlayerCard extends Rect { row: number; }
export interface CardSlot extends Rect { row: number; ultimate: boolean; }

export const PLAYER_CARDS_1080P: PlayerCard[] = [
  { x: 140, y: 146, w: 320, h: 146, row: 0 },
  { x: 140, y: 308, w: 320, h: 146, row: 1 },
  { x: 140, y: 470, w: 320, h: 146, row: 2 },
  { x: 140, y: 632, w: 320, h: 146, row: 3 },
  { x: 140, y: 794, w: 320, h: 146, row: 4 },
  { x: 1460, y: 146, w: 320, h: 146, row: 5 },
  { x: 1460, y: 308, w: 320, h: 146, row: 6 },
  { x: 1460, y: 470, w: 320, h: 146, row: 7 },
  { x: 1460, y: 632, w: 320, h: 146, row: 8 },
  { x: 1460, y: 794, w: 320, h: 146, row: 9 },
];

export const CARD_SLOTS_1080P: CardSlot[] = [
  { x: 216, y: 237, w: 55, h: 55, row: 0, ultimate: false },
  { x: 277, y: 237, w: 55, h: 55, row: 0, ultimate: false },
  { x: 338, y: 237, w: 55, h: 55, row: 0, ultimate: false },
  { x: 398, y: 237, w: 55, h: 55, row: 0, ultimate: true },
  { x: 216, y: 405, w: 55, h: 55, row: 1, ultimate: false },
  { x: 277, y: 405, w: 55, h: 55, row: 1, ultimate: false },
  { x: 338, y: 405, w: 55, h: 55, row: 1, ultimate: false },
  { x: 398, y: 405, w: 55, h: 55, row: 1, ultimate: true },
  { x: 216, y: 573, w: 55, h: 55, row: 2, ultimate: false },
  { x: 277, y: 573, w: 55, h: 55, row: 2, ultimate: false },
  { x: 338, y: 573, w: 55, h: 55, row: 2, ultimate: false },
  { x: 398, y: 573, w: 55, h: 55, row: 2, ultimate: true },
  { x: 216, y: 741, w: 55, h: 55, row: 3, ultimate: false },
  { x: 277, y: 741, w: 55, h: 55, row: 3, ultimate: false },
  { x: 338, y: 741, w: 55, h: 55, row: 3, ultimate: false },
  { x: 398, y: 741, w: 55, h: 55, row: 3, ultimate: true },
  { x: 216, y: 909, w: 55, h: 55, row: 4, ultimate: false },
  { x: 277, y: 909, w: 55, h: 55, row: 4, ultimate: false },
  { x: 338, y: 909, w: 55, h: 55, row: 4, ultimate: false },
  { x: 398, y: 909, w: 55, h: 55, row: 4, ultimate: true },
  { x: 1649, y: 237, w: 55, h: 55, row: 5, ultimate: false },
  { x: 1589, y: 237, w: 55, h: 55, row: 5, ultimate: false },
  { x: 1528, y: 237, w: 55, h: 55, row: 5, ultimate: false },
  { x: 1467, y: 237, w: 55, h: 55, row: 5, ultimate: true },
  { x: 1649, y: 405, w: 55, h: 55, row: 6, ultimate: false },
  { x: 1589, y: 405, w: 55, h: 55, row: 6, ultimate: false },
  { x: 1528, y: 405, w: 55, h: 55, row: 6, ultimate: false },
  { x: 1467, y: 405, w: 55, h: 55, row: 6, ultimate: true },
  { x: 1649, y: 573, w: 55, h: 55, row: 7, ultimate: false },
  { x: 1589, y: 573, w: 55, h: 55, row: 7, ultimate: false },
  { x: 1528, y: 573, w: 55, h: 55, row: 7, ultimate: false },
  { x: 1467, y: 573, w: 55, h: 55, row: 7, ultimate: true },
  { x: 1649, y: 741, w: 55, h: 55, row: 8, ultimate: false },
  { x: 1589, y: 741, w: 55, h: 55, row: 8, ultimate: false },
  { x: 1528, y: 741, w: 55, h: 55, row: 8, ultimate: false },
  { x: 1467, y: 741, w: 55, h: 55, row: 8, ultimate: true },
  { x: 1649, y: 909, w: 55, h: 55, row: 9, ultimate: false },
  { x: 1589, y: 909, w: 55, h: 55, row: 9, ultimate: false },
  { x: 1528, y: 909, w: 55, h: 55, row: 9, ultimate: false },
  { x: 1467, y: 909, w: 55, h: 55, row: 9, ultimate: true },
];

function scaleFor(rect: ClientRect): { sx: number; sy: number } {
  // 近 1080p(±10px,真机截屏常见的 1918×1078 一类)按恒等处理,与 poolSlots/heroCellRects 同规则。
  const near1080p = Math.abs(rect.width - 1920) <= 10 && Math.abs(rect.height - 1080) <= 10;
  return near1080p ? { sx: 1, sy: 1 } : { sx: rect.width / 1920, sy: rect.height / 1080 };
}

function place<T extends Rect>(r: T, rect: ClientRect): T {
  const { sx, sy } = scaleFor(rect);
  return { ...r, x: rect.x + Math.round(r.x * sx), y: rect.y + Math.round(r.y * sy), w: Math.round(r.w * sx), h: Math.round(r.h * sy) };
}

export function playerCards(rect: ClientRect): PlayerCard[] {
  return PLAYER_CARDS_1080P.map((c) => place(c, rect));
}

export function cardSlots(rect: ClientRect): CardSlot[] {
  return CARD_SLOTS_1080P.map((s) => place(s, rect));
}
