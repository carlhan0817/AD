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

  it("第几手 = 池里已变空的技能数 + 1;选了英雄后不再推荐英雄", () => {
    expect(results.get("07-41-38")!.pickIndex).toBe(1);
    expect(results.get("07-44-28")!.pickIndex).toBe(16);
    for (const k of ["07-44-40", "07-45-01", "07-47-05", "07-53-37"]) {
      expect([k, results.get(k)!.recommendations.some((x) => x.candidate.slotType === "hero")]).toEqual([k, false]);
    }
  });
});
