// core/tests/recognition/screen_layout.test.ts
// 屏幕比例归类 + 按比例摆格子。上游数据(仓库根 layout_coordinates.json,源自 ability-draft-plus,ISC)
// 只用来核对「按高度缩放 + 水平居中」这套换算对不对,不要求和上游逐字相同。
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  classifyRatio, layoutTableFor, placeRect, screenLayoutFor, type RatioClass,
} from "../../src/recognition/screen_layout";
import { poolSlots, type PoolSlot } from "../../src/recognition/pool_slots";
import { heroCellRects } from "../../src/recognition/hero_layout";
import { playerCards, cardSlots, type PlayerCard } from "../../src/recognition/player_cards";
import type { ClientRect, Rect } from "../../src/recognition/roi";

const BEFORE = JSON.parse(readFileSync(
  fileURLToPath(new URL("./fixtures/layout_1080p_before.json", import.meta.url)), "utf8",
)) as Record<string, Record<string, unknown[]>>;

interface UpSlot { x: number; y: number; width: number; height: number; hero_order: number; ability_order?: number }
interface UpRes {
  heroes_params: { width: number; height: number };
  heroes_coords: { x: number; y: number; hero_order: number }[];
  ultimate_slots_coords: UpSlot[];
  standard_slots_coords: UpSlot[];
}
const UPSTREAM = (JSON.parse(readFileSync(
  fileURLToPath(new URL("../../../layout_coordinates.json", import.meta.url)), "utf8",
)) as { resolutions: Record<string, UpRes> }).resolutions;

const at = (width: number, height: number, x = 0, y = 0): ClientRect => ({ x, y, width, height });

/** 上游技能池按我们的格子顺序排好:终极按 hero_order 对应,标准按 (hero_order, ability_order) 对应
 *  (与 pool_slots.ts 注释一致:hero = 上游 hero_order,slot = ability_order,终极 slot=0)。 */
function upstreamPool(res: string, ours: PoolSlot[]): Rect[] {
  const u = UPSTREAM[res];
  return ours.map((s) => {
    const hit = s.zone === "ultimate"
      ? u.ultimate_slots_coords.find((c) => c.hero_order === s.hero)
      : u.standard_slots_coords.find((c) => c.hero_order === s.hero && c.ability_order === s.slot);
    if (!hit) throw new Error(`上游 ${res} 缺格 ${s.zone}/${s.hero}/${s.slot}`);
    return { x: hit.x, y: hit.y, w: hit.width, h: hit.height };
  });
}

function upstreamCards(res: string, ours: PlayerCard[]): Rect[] {
  const u = UPSTREAM[res];
  return ours.map((c) => {
    const hit = u.heroes_coords.find((h) => h.hero_order === c.row)!;
    return { x: hit.x, y: hit.y, w: u.heroes_params.width, h: u.heroes_params.height };
  });
}

/** 换算模型的误差:(我们@R − 上游@R) − (我们@1080 − 上游@1080) × (H/1080),取 x、y 两个方向的最大绝对值。
 *  1080p 上我们和上游本来就可能有固定差(真机修正),这个差按高度跟着缩放,不算误差。 */
function modelError(oursR: Rect[], upR: Rect[], ours1080: Rect[], up1080: Rect[], height: number): number[] {
  const k = height / 1080;
  return oursR.map((o, i) => Math.max(
    Math.abs((o.x - upR[i].x) - (ours1080[i].x - up1080[i].x) * k),
    Math.abs((o.y - upR[i].y) - (ours1080[i].y - up1080[i].y) * k),
  ));
}

describe("classifyRatio", () => {
  const cases: [number, number, RatioClass | null][] = [
    [1920, 1080, "16:9"], [2560, 1440, "16:9"], [3840, 2160, "16:9"], [1366, 768, "16:9"],
    [3440, 1440, "21:9"], [3840, 1600, "21:9"], [1834, 786, "21:9"],
    [1920, 1200, "16:10"], [1440, 900, "16:10"], [1280, 800, "16:10"], [1680, 1050, "16:10"],
    [1440, 960, "3:2"],
    [1280, 960, "4:3"], [1024, 768, "4:3"], [1440, 1080, "4:3"],
    [1280, 1024, "5:4"],
    [1600, 1024, null], [1500, 920, null], [5120, 1440, null], [600, 1000, null],
  ];
  for (const [w, h, cls] of cases) {
    it(`${w}×${h} → ${cls ?? "不支持"}`, () => {
      expect(classifyRatio(w, h)).toBe(cls);
    });
  }

  it("宽或高不是正数 → 不支持", () => {
    expect(classifyRatio(0, 1080)).toBeNull();
    expect(classifyRatio(1920, 0)).toBeNull();
  });
});

describe("layoutTableFor", () => {
  const all: RatioClass[] = ["16:9", "21:9", "16:10", "3:2", "4:3", "5:4"];
  it("每一类都是整套表:48 格池、12 英雄格、10 卡、40 已选格", () => {
    for (const cls of all) {
      const t = layoutTableFor(cls);
      expect(t.pool.length, cls).toBe(48);
      expect(t.heroes.length, cls).toBe(12);
      expect(t.cards.length, cls).toBe(10);
      expect(t.cardSlots.length, cls).toBe(40);
      expect(t.heroes.map((h) => h.order), cls).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    }
  });

  it("16:9、21:9 已核对(verified),其余四类是上游初值、未实测", () => {
    expect(layoutTableFor("16:9").verified).toBe(true);
    expect(layoutTableFor("21:9").verified).toBe(true);
    for (const cls of ["16:10", "3:2", "4:3", "5:4"] as RatioClass[]) expect(layoutTableFor(cls).verified).toBe(false);
  });

  it("基准尺寸:16:9 1920×1080,21:9 2560×1080,其余取上游对应分辨率", () => {
    const base = (c: RatioClass) => [layoutTableFor(c).baseWidth, layoutTableFor(c).baseHeight];
    expect(base("16:9")).toEqual([1920, 1080]);
    expect(base("21:9")).toEqual([2560, 1080]);
    expect(base("16:10")).toEqual([1920, 1200]);
    expect(base("3:2")).toEqual([1440, 960]);
    expect(base("4:3")).toEqual([1440, 1080]);
    expect(base("5:4")).toEqual([1280, 1024]);
  });

  it("21:9 的表 = 16:9 的表整体右移 320,y 和大小不变", () => {
    const a = layoutTableFor("16:9");
    const b = layoutTableFor("21:9");
    const groups = ["pool", "heroes", "cards", "cardSlots"] as const;
    for (const g of groups) {
      (b[g] as Rect[]).forEach((r, i) => {
        const o = (a[g] as Rect[])[i];
        expect({ ...r, x: r.x - 320 }, `${g}[${i}]`).toEqual(o);
      });
    }
  });
});

describe("placeRect / screenLayoutFor", () => {
  it("按高度缩放 + 水平居中 + 加原点", () => {
    const t = layoutTableFor("21:9"); // 基准 2560×1080
    // 3440×1440:缩放 4/3,x 偏移 (3440 − 2560×4/3)/2 = 13.33
    const r = placeRect({ x: 960, y: 540, w: 30, h: 60 }, t, at(3440, 1440, 100, 50));
    expect(r).toEqual({ x: 100 + Math.round(960 * 4 / 3 + 40 / 3), y: 50 + 720, w: 40, h: 80 });
  });

  it("16:9 近 1080p(±10px)恒等,不缩放", () => {
    const t = layoutTableFor("16:9");
    const src = { x: 693, y: 166, w: 53, h: 58 };
    expect(placeRect(src, t, at(1918, 1078))).toEqual(src);
    expect(placeRect(src, t, at(1928, 1088, 5, 7))).toEqual({ ...src, x: 698, y: 173 });
  });

  it("screenLayoutFor:支持的比例给出类别和表,不支持给 null", () => {
    expect(screenLayoutFor(at(2560, 1440))?.cls).toBe("16:9");
    expect(screenLayoutFor(at(1440, 900))?.table.baseHeight).toBe(1200);
    expect(screenLayoutFor(at(5120, 1440))).toBeNull();
  });
});

describe("四个位置函数:16:9 恒等(与改动前逐个相等)", () => {
  for (const size of ["1920x1080", "1918x1078"]) {
    const [w, h] = size.split("x").map(Number);
    it(size, () => {
      const r = at(w, h);
      expect(poolSlots(r)).toEqual(BEFORE[size].poolSlots);
      expect(heroCellRects(r)).toEqual(BEFORE[size].heroCellRects);
      expect(playerCards(r)).toEqual(BEFORE[size].playerCards);
      expect(cardSlots(r)).toEqual(BEFORE[size].cardSlots);
    });
  }
});

describe("非零原点(窗口模式客户区不在左上角)", () => {
  it("1440×900 客户区在 (240,90):每个位置 = 原点 (0,0) 的结果 + (240,90)", () => {
    const zero = at(1440, 900);
    const moved = at(1440, 900, 240, 90);
    const fns: ((r: ClientRect) => Rect[])[] = [poolSlots, heroCellRects, playerCards, cardSlots];
    for (const fn of fns) {
      const a = fn(zero);
      const b = fn(moved);
      expect(b).toEqual(a.map((r) => ({ ...r, x: r.x + 240, y: r.y + 90 })));
    }
  });
});

describe("不支持的比例:退回横纵各自拉伸(只为不崩)", () => {
  it("5120×1440 下技能池第一格 = 1080p 坐标按 宽/1920、高/1080 拉伸", () => {
    const s = poolSlots(at(5120, 1440))[0];
    expect(s).toMatchObject({ x: Math.round(693 * 5120 / 1920), y: Math.round(166 * 1440 / 1080), w: Math.round(53 * 5120 / 1920), h: Math.round(58 * 1440 / 1080) });
  });
});

/** 上游数据里自相矛盾的条目(上游是人工标的,个别格子标歪了),不拿来核对换算模型。每条都有同一份上游数据里的反证:
 *  - 2560×1440 标准区 英雄9第2格:x=1435,同分辨率镜像位置(英雄4第2格)和 3440×1440 的同一格都与公式差 ≤1,唯独它差 4。
 *  - 3440×1440 终极区 英雄1、英雄8:x 各差 7,夹在两侧格子之间的间距一边 133 一边 122(其它格都是 127–128),左右也不对称。
 *  - 3840×1600 标准区 英雄9第2格:x 差 37,明显手误。
 *  - 3440×1440 左列玩家卡第 1–4 行:左列行距 224、右列 216,同一画面左右两列行距不可能不同;右列与公式一致。
 *  - 3840×1600 玩家卡除第 0 张以外:行距 249、卡高 225,而上游自己的 1834×786(同为 21:9)行距 118、卡高 106,
 *    按高度折算是 240、216,和公式完全一致;两份上游 21:9 数据互相矛盾,以和公式一致的那份为准。 */
const UPSTREAM_OUTLIERS: Record<string, { pool?: string[]; cards?: number[] }> = {
  "2560x1440": { pool: ["standard/9/2"] },
  "3440x1440": { pool: ["ultimate/1/0", "ultimate/8/0"], cards: [1, 2, 3, 4] },
  "3840x1600": { pool: ["standard/9/2"], cards: [1, 2, 3, 4, 5, 6, 7, 8, 9] },
};
const poolKey = (s: PoolSlot) => `${s.zone}/${s.hero}/${s.slot}`;

describe("与上游数据核对换算模型", () => {
  const pool1080 = poolSlots(at(1920, 1080));
  const up1080 = upstreamPool("1920x1080", pool1080);

  function poolErrors(w: number, h: number): number[] {
    const res = `${w}x${h}`;
    const ours = poolSlots(at(w, h));
    const err = modelError(ours, upstreamPool(res, ours), pool1080, up1080, h);
    const skip = UPSTREAM_OUTLIERS[res]?.pool ?? [];
    return err.filter((_, i) => !skip.includes(poolKey(ours[i])));
  }

  for (const [w, h] of [[2560, 1440], [3840, 2160]]) {
    it(`16:9 ${w}×${h}:技能池逐格偏差 ≤ 3 像素`, () => {
      const err = poolErrors(w, h);
      expect(err.length).toBeGreaterThanOrEqual(47);
      expect(Math.max(...err)).toBeLessThanOrEqual(3);
    });
  }

  for (const [w, h] of [[3440, 1440], [3840, 1600], [1834, 786]]) {
    it(`21:9 ${w}×${h}:技能池逐格偏差 ≤ 4 像素`, () => {
      const err = poolErrors(w, h);
      expect(err.length).toBeGreaterThanOrEqual(46);
      expect(Math.max(...err)).toBeLessThanOrEqual(4);
    });
  }

  const cards1080 = playerCards(at(1920, 1080));
  const upCards1080 = upstreamCards("1920x1080", cards1080);
  for (const [w, h] of [[3440, 1440], [3840, 1600], [1834, 786]]) {
    it(`21:9 ${w}×${h}:玩家卡逐张偏差 ≤ 4 像素`, () => {
      const res = `${w}x${h}`;
      const ours = playerCards(at(w, h));
      const skip = UPSTREAM_OUTLIERS[res]?.cards ?? [];
      const err = modelError(ours, upstreamCards(res, ours), cards1080, upCards1080, h)
        .filter((_, i) => !skip.includes(ours[i].row));
      expect(err.length).toBeGreaterThanOrEqual(1);
      expect(Math.max(...err)).toBeLessThanOrEqual(4);
    });
  }

  it("排除的上游条目确实是离群的(防止排除表掩盖换算错误:它们偏差都 > 容差)", () => {
    for (const [res, ex] of Object.entries(UPSTREAM_OUTLIERS)) {
      const [w, h] = res.split("x").map(Number);
      const ours = poolSlots(at(w, h));
      const err = modelError(ours, upstreamPool(res, ours), pool1080, up1080, h);
      for (const k of ex.pool ?? []) expect(err[ours.findIndex((s) => poolKey(s) === k)], `${res} ${k}`).toBeGreaterThan(3);
      const cards = playerCards(at(w, h));
      const cerr = modelError(cards, upstreamCards(res, cards), cards1080, upCards1080, h);
      for (const row of ex.cards ?? []) expect(cerr[row], `${res} 卡 ${row}`).toBeGreaterThan(4);
    }
  });
});
