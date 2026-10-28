// core/tests/recognition/card_reading.test.ts
import { describe, it, expect } from "vitest";
import { findMyRow, findActiveRow, readCardPicks } from "../../src/recognition/card_reading";
import { playerCards, cardSlots } from "../../src/recognition/player_cards";
import { identifyPortrait, portraitRegion, portraitVariants } from "../../src/recognition/hero_portrait";
import type { Classifier, Prediction } from "../../src/recognition/classifier";
import type { RgbFrame } from "../../src/recognition/rgb";

const RECT = { x: 0, y: 0, width: 1920, height: 1080 };
const blank = (): RgbFrame => ({ width: 1920, height: 1080, data: new Uint8Array(1920 * 1080 * 3) });
function fill(f: RgbFrame, x0: number, y0: number, x1: number, y1: number, px: (x: number, y: number) => number[]) {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) f.data.set(px(x, y), (y * f.width + x) * 3);
}
const card = (row: number) => playerCards(RECT)[row];
/** 在某张卡朝外的那条边上画一道外框(左列卡画左边缘,右列卡画右边缘)。 */
function outline(f: RgbFrame, row: number, color = [20, 114, 0]) {
  const c = card(row), left = row < 5;
  const x0 = left ? c.x : c.x + c.w - 6;
  fill(f, x0, c.y + 10, x0 + 4, c.y + 136, () => color);
}

describe("findMyRow", () => {
  it("左列:左边缘有亮绿外框的那张就是我", () => {
    const f = blank(); outline(f, 0, [86, 253, 0]);
    expect(findMyRow(f, RECT)).toBe(0);
  });
  it("右列:右边缘有暗绿外框的那张就是我(右4 = 行 8)", () => {
    const f = blank(); outline(f, 8);
    expect(findMyRow(f, RECT)).toBe(8);
  });
  it("没有外框,或两张都有 → 认不出", () => {
    expect(findMyRow(blank(), RECT)).toBeNull();
    const f = blank(); outline(f, 1); outline(f, 6);
    expect(findMyRow(f, RECT)).toBeNull();
  });
  it("队友卡边缘那种暗绿底色不算外框", () => {
    const f = blank(); outline(f, 2, [4, 44, 2]);
    expect(findMyRow(f, RECT)).toBeNull();
  });
});

describe("findActiveRow", () => {
  const gold = (f: RgbFrame, row: number) => { const c = card(row); fill(f, c.x, c.y + 55, c.x + 320, c.y + 90, () => [106, 95, 55]); };
  it("唯一一张金色底的卡 → 轮到它", () => {
    const f = blank(); gold(f, 3);
    expect(findActiveRow(f, RECT)).toBe(3);
  });
  it("没有或不止一张 → 看不出", () => {
    expect(findActiveRow(blank(), RECT)).toBeNull();
    const f = blank(); gold(f, 3); gold(f, 8);
    expect(findActiveRow(f, RECT)).toBeNull();
  });
});

describe("readCardPicks", () => {
  /** 画上图标(高对比棋盘)的格子;其余格纯黑 = 空。 */
  const withIcons = (idx: number[]) => {
    const f = blank(); const slots = cardSlots(RECT);
    for (const i of idx) { const s = slots[i]; fill(f, s.x, s.y, s.x + s.w, s.y + s.h, (x, y) => ((x >> 2) + (y >> 2)) % 2 ? [255, 200, 0] : [0, 0, 80]); }
    return f;
  };
  /** 假分类器:按送进来的顺序依次给出名字与把握。 */
  const fake = (answers: [string, number][]): Classifier => ({
    classNames: [],
    classify: async (rgb) => {
      const n = rgb.length / (96 * 96 * 3);
      return answers.slice(0, n).map(([name, confidence]): Prediction => ({ name, confidence, runnerUp: "x", runnerUpConfidence: 0 }));
    },
  });
  const slots = cardSlots(RECT);
  const idxOf = (row: number, k: number) => slots.findIndex((s, i) => s.row === row && slots.slice(0, i).filter((t) => t.row === row).length === k);

  it("按行归档:普通格进 normals,终极格进 ultimate;空格不认", async () => {
    const used = [idxOf(2, 0), idxOf(2, 3), idxOf(6, 1)];
    const res = await readCardPicks(withIcons(used), RECT, fake([["a", 0.99], ["u", 0.99], ["b", 0.99]]));
    expect(res[2]).toEqual({ row: 2, normals: ["a"], ultimate: "u", unknown: 0 });
    expect(res[6].normals).toEqual(["b"]);
    expect(res.filter((r) => r.normals.length || r.ultimate).length).toBe(2);
  });
  it("把握不够,或不在本局池子里的名字 → 记为没认出", async () => {
    const used = [idxOf(0, 0), idxOf(0, 1)];
    const res = await readCardPicks(withIcons(used), RECT, fake([["a", 0.5], ["zzz", 0.99]]), new Set(["a", "b"]));
    expect(res[0]).toEqual({ row: 0, normals: [], ultimate: null, unknown: 2 });
  });
});

describe("identifyPortrait", () => {
  // 两张假「立绘」:横条纹和竖条纹;卡上头像画成横条纹。
  const art = (horizontal: boolean): RgbFrame => {
    const f: RgbFrame = { width: 142, height: 188, data: new Uint8Array(142 * 188 * 3) };
    fill(f, 0, 0, 142, 188, (x, y) => (((horizontal ? y : x) >> 3) % 2 ? [230, 180, 90] : [20, 30, 60]));
    return f;
  };
  const cands = new Map([[1, portraitVariants(art(true))], [2, portraitVariants(art(false))]]);
  it("认出最像的那个英雄", () => {
    const f = blank(); const r = portraitRegion(card(0));
    fill(f, r.x, r.y, r.x + r.w, r.y + r.h, (_x, y) => (((y - r.y) >> 3) % 2 ? [230, 180, 90] : [20, 30, 60]));
    expect(identifyPortrait(f, card(0), cands).heroId).toBe(1);
  });
  it("不像任何候选(比如还是空卡)→ null", () => {
    expect(identifyPortrait(blank(), card(0), cands).heroId).toBeNull();
  });
});
