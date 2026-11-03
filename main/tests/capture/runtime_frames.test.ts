// main/tests/capture/runtime_frames.test.ts
// 用真机扫描时存下的运行时帧(app/.scan_frames/,不入库:含其他玩家名字)按时间顺序跑完整的
// scanPool,把 2026-10-27 逐帧目视核对过的结论写成断言。缺帧/缺 reference.db/缺模型就整体 skip。
// 注意:07:35:07–07:53:37 这几帧里,旧版悬浮窗(当时在右上角)盖住了右列第一张卡(行 5),
// 所以「我是谁」在这些帧里可能认不出——这正是面板挪到右下角的原因;断言里对这些帧放宽。
import { describe, it, expect, beforeAll } from "vitest";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { scanPool, type PoolScanResult } from "../../src/capture/scan_pool";
import { loadClassifier } from "@ad/core/recognition/classifier";
import { loadIndex } from "@ad/core/recognition/index_store";
import { PoolMemory } from "@ad/core/recognition/pool_memory";
import { portraitVariants } from "@ad/core/recognition/hero_portrait";
import { buildAbilityLookup } from "@ad/core/db/ability_lookup";
import { ReferenceDb } from "@ad/core/db/reference";
import { rgbFrameToGray, type RgbFrame } from "@ad/core/recognition/rgb";
import { readPool } from "@ad/core/recognition/pool_classify";
import { findActiveRow, findMyRow, readCardPicks } from "@ad/core/recognition/card_reading";
import { takenHeroPositions } from "@ad/core/recognition/hero_taken";
import { highlightOuter, HIGHLIGHT_THICKNESS } from "@ad/core/recognition/highlight";
import { heroCellRects } from "@ad/core/recognition/hero_layout";
import { poolSlots } from "@ad/core/recognition/pool_slots";
import { defaultScoringConfig } from "@ad/core/scoring/config";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const FRAMES = process.env.AD_SCAN_FRAMES_DIR ?? join(ROOT, "app", ".scan_frames");
const DB = process.env.AD_REFERENCE_DB ?? join(ROOT, "pipeline", "out", "reference.db");
const SEL = join(ROOT, "models", "templates", "sprites", "panorama", "images", "heroes", "selection");
const MODEL = join(ROOT, "models", "classifier", "ability_classifier_fp16.onnx");
const NAMES = join(ROOT, "models", "classifier", "class_names.json");
// pHash 索引:变体精灵这类「只有 2 格同英雄」的组要靠它看图核对(真实程序里也会加载)。
const INDEX = process.env.AD_PHASH_INDEX ?? join(ROOT, "models", "templates", "phash_index.json");

// 目视核对过的帧(按文件名里的时间);me/active: 0–4 左列,5–9 右列。
const EXPECT: Record<string, { taken: number[]; active: number | null; myPicks?: string[]; myHero?: string | null; me?: number }> = {
  "07-41-38": { taken: [], active: null, myPicks: [], myHero: null },
  "07-44-28": { taken: [1, 3, 11], active: null, myPicks: ["queenofpain_blink"], myHero: null },
  "07-44-40": { taken: [1, 3, 6, 7, 11], active: null, myPicks: ["queenofpain_blink"], myHero: "naga_siren" },
  "07-44-45": { taken: [1, 3, 6, 7, 11], active: 0, myPicks: ["queenofpain_blink"], myHero: "naga_siren" },
  "07-44-50": { taken: [1, 3, 6, 7, 11], active: null, myPicks: ["life_stealer_feast", "queenofpain_blink"], myHero: "naga_siren" },
  "07-45-01": { taken: [1, 3, 6, 7, 11], active: 1, myPicks: ["life_stealer_feast", "queenofpain_blink"], myHero: "naga_siren" },
  "07-47-05": { taken: [0, 1, 2, 3, 5, 6, 7, 8, 11], active: 0, myHero: "naga_siren" },
  "07-52-45": { taken: [], active: null, myPicks: [], myHero: null },
  "07-53-37": { taken: [3], active: 0, myHero: "morphling" },
  // 2026-11-03 坐左2(第 3 个选):01-10-52 是主菜单帧,不能进记忆。
  "01-12-31": { taken: [], active: 1, me: 1 },
  "01-15-48": { taken: [0, 1, 3, 4, 9, 10, 11], active: 4, me: 1 },
  // 2026-11-03 坐右1:选了 3 个普通技能,没选大招和英雄(Feast 落在坐标表标成「终极」的格里)。
  "00-51-39": { taken: [1, 3, 5, 8], active: 5, myHero: null, me: 5 },
  // 2026-10-28 两局自定义:第一局坐左1,第二局坐右4(行 8)。
  "05-31-14": { taken: [], active: null, myPicks: [], myHero: null, me: 0 },
  "05-32-43": { taken: [], active: null, myPicks: [], myHero: null, me: 8 },
  "05-32-55": { taken: [], active: null, myPicks: [], myHero: null, me: 8 },
};

const hasAssets = existsSync(FRAMES) && existsSync(DB) && existsSync(MODEL) && existsSync(SEL) && existsSync(INDEX) &&
  Object.keys(EXPECT).every((k) => readdirSync(FRAMES).some((f) => f.includes(`T${k}`)));

async function load(path: string): Promise<RgbFrame> {
  const { data, info } = await sharp(path).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8Array(data) };
}

describe.skipIf(!hasAssets)("运行时真帧:完整扫描流程(按时间顺序)", () => {
  const results = new Map<string, PoolScanResult>();
  let pictureOf = new Map<number, string>();

  beforeAll(async () => {
    const clf = await loadClassifier(MODEL, NAMES);
    const ref = new ReferenceDb(DB);
    const lookup = buildAbilityLookup(ref);
    pictureOf = new Map((ref.all("SELECT hero_id, picture FROM heroes") as { hero_id: number; picture: string }[])
      .map((r) => [r.hero_id, r.picture]));
    const cache = new Map<number, Float32Array[] | null>();
    const heroPortraits = async (id: number) => {
      if (!cache.has(id)) {
        const f = join(SEL, `npc_dota_hero_${pictureOf.get(id)}_png.png`);
        cache.set(id, existsSync(f) ? portraitVariants(await load(f)) : null);
      }
      return cache.get(id)!;
    };
    const index = loadIndex(INDEX);
    const memory = new PoolMemory();
    const rect = { x: 0, y: 0, width: 1920, height: 1080 };
    try {
      for (const f of readdirSync(FRAMES).filter((n) => n.endsWith(".png")).sort()) {
        const rgb = await load(join(FRAMES, f));
        const res = await scanPool({ rgb, gray: rgbFrameToGray(rgb) },
          { clf, lookup, ref, cfg: defaultScoringConfig(), rect, memory, index, heroPortraits });
        results.set(f.slice(16, 24), res);
      }
    } finally { ref.close(); }
  }, 300_000);

  it("把高亮框画满每一格(最坏情况),识别结果一格都不变", async () => {
    const clf = await loadClassifier(MODEL, NAMES);
    const rect = { x: 0, y: 0, width: 1920, height: 1080 };
    for (const k of ["07-41-38", "07-45-01", "07-47-05"]) {
      const clean = await load(join(FRAMES, readdirSync(FRAMES).find((f) => f.includes(`T${k}`))!));
      const boxed: RgbFrame = { ...clean, data: clean.data.slice() };
      for (const c of [...poolSlots(rect), ...heroCellRects(rect)]) {
        const o = highlightOuter(c, rect), t = HIGHLIGHT_THICKNESS;
        for (let y = o.y; y < o.y + o.h; y++) for (let x = o.x; x < o.x + o.w; x++) {
          const edge = x < o.x + t || x >= o.x + o.w - t || y < o.y + t || y >= o.y + o.h - t;
          if (edge) boxed.data.set([255, 210, 80], (y * 1920 + x) * 3);
        }
      }
      const pick = async (f: RgbFrame) => ({
        pool: (await readPool(f, rect, clf)).map((c) => [c.empty, c.guess]),
        cards: await readCardPicks(f, rect, clf),
        taken: [...takenHeroPositions(f, rect)],
        me: findMyRow(f, rect), active: findActiveRow(f, rect),
      });
      expect(await pick(boxed)).toEqual(await pick(clean));
    }
  }, 120_000);

  it("已被选走的英雄位置与画面一致,且不进推荐", () => {
    for (const [k, e] of Object.entries(EXPECT)) {
      const r = results.get(k)!;
      expect([k, r.takenHeroes]).toEqual([k, e.taken]);
    }
  });

  it("轮到谁(金色卡)与画面一致", () => {
    for (const [k, e] of Object.entries(EXPECT)) expect([k, results.get(k)!.activeRow]).toEqual([k, e.active]);
  });

  it("认出我坐哪(左1 = 行 0,右4 = 行 8);一局里认出过就记住", () => {
    for (const [k, e] of Object.entries(EXPECT)) expect([k, results.get(k)!.myRow]).toEqual([k, e.me ?? 0]);
  });

  it("我卡上已选的技能与画面一致,我的英雄选了才认、认了就对", () => {
    for (const [k, e] of Object.entries(EXPECT)) {
      const r = results.get(k)!;
      if (e.myPicks !== undefined) {
        const got = r.myPicks ? [...r.myPicks.normals, ...(r.myPicks.ultimate ? [r.myPicks.ultimate] : [])].sort() : [];
        expect([k, got]).toEqual([k, [...e.myPicks].sort()]);
      }
      if (e.myHero !== undefined) {
        const hero = r.me.hero === null ? null : pictureOf.get(-r.me.hero) ?? null;
        expect([k, hero]).toEqual([k, e.myHero]);
      }
    }
  });

  it("普通技能选满 3 个后不再推荐普通技能,只推大招和英雄(类型查技能本身,不看卡上哪一格)", () => {
    const r = results.get("00-51-39")!;
    expect([r.me.normals.length, r.me.ultimates.length]).toEqual([3, 0]);
    const types = new Set(r.recommendations.map((x) => x.candidate.slotType));
    expect(types.has("normal")).toBe(false);
    expect(types.has("ultimate")).toBe(true);
    expect(types.has("hero")).toBe(true);
  });

  it("主菜单帧不进记忆:这局的手数、选位、大招、英雄都不受影响", () => {
    expect(results.get("01-10-52")!.onDraftScreen).toBe(false);
    expect(results.get("01-12-31")!.pickIndex).toBe(3);
    expect(results.get("01-14-21")!.pickIndex).toBe(18);
    expect(results.get("01-15-03")!.pickIndex).toBe(23);
    expect(results.get("01-15-03")!.seat).toBe(3);
    const end = results.get("01-17-38")!;
    expect(end.me.ultimates.length).toBe(1);
    expect(pictureOf.get(-end.me.hero!)).toBe("queenofpain");
    expect(end.takenHeroes.length).toBe(10);
  });

  it("被选走的 Hoodwink 不再推荐", () => {
    const r = results.get("01-15-48")!;
    expect(r.takenHeroes).toContain(4);
    expect(r.heroes.map((h) => pictureOf.get(-h))).not.toContain("hoodwink");
  });

  it("第几手 = 已被选走的技能数 + 英雄数 + 1;选了英雄后不再推荐英雄", () => {
    expect(results.get("07-41-38")!.pickIndex).toBe(1);
    expect(results.get("07-44-28")!.pickIndex).toBe(19);
    // zigzag:坐第一个选的人依次是第 1、20、21、40、41 手(英雄也算一手)。轮到我时的三帧:
    expect(results.get("07-44-45")!.pickIndex).toBe(21);
    // 实际是第 40 手;这一帧旧版悬浮窗盖住了行 5 的卡,有 1 个技能当时没法在卡上确认,下一帧补上。
    expect(results.get("07-47-05")!.pickIndex).toBe(39);
    // 这一帧说明框盖住了几格,不能因此多算;此时我的第 41 手已选完,所以是第 42 手。
    expect(results.get("07-47-13")!.pickIndex).toBe(42);
    expect(results.get("07-47-13")!.seat).toBe(1);
    for (const k of ["07-44-40", "07-45-01", "07-47-05", "07-53-37"]) {
      expect([k, results.get(k)!.recommendations.some((x) => x.candidate.slotType === "hero")]).toEqual([k, false]);
    }
  });
});
