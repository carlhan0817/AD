// main/tests/capture/ratio_frames.test.ts
// 非 1920×1080 窗口(窗口模式)下的真机帧:整局按时间顺序跑 scanPool,确认是选人界面、认不出的格不超过标定后的数。
// 帧在 app/.scan_frames/game_<时间>/(含玩家名,只留本地,不进仓库);程序只保留最近几局的文件夹,
// 缺哪一局就跳过哪一局(可用 AD_SCAN_FRAMES_DIR 指向别处的备份)。缺 reference.db/模型整体 skip。
// 客户区矩形是在帧上量出来的(Dota 窗口外有 1px 浅色边,客户区右、下各有 9px 黑边在客户区外)。
// 设 AD_RATIO_REPORT=1 会逐帧打印读数(标定时用)。
import { describe, it, expect, beforeAll } from "vitest";
import { existsSync, readdirSync, mkdtempSync, copyFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { scanPool, type PoolScanResult } from "../../src/capture/scan_pool";
import { loadClassifier, type Classifier } from "@ad/core/recognition/classifier";
import { loadIndex, type IndexEntry } from "@ad/core/recognition/index_store";
import { PoolMemory } from "@ad/core/recognition/pool_memory";
import { portraitVariants } from "@ad/core/recognition/hero_portrait";
import { buildAbilityLookup, type AbilityInfo } from "@ad/core/db/ability_lookup";
import { ReferenceDb } from "@ad/core/db/reference";
import { rgbFrameToGray, type RgbFrame } from "@ad/core/recognition/rgb";
import { defaultScoringConfig } from "@ad/core/scoring/config";
import type { ClientRect } from "@ad/core/recognition/roi";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const FRAMES = process.env.AD_SCAN_FRAMES_DIR ?? join(ROOT, "app", ".scan_frames");
const DB = process.env.AD_REFERENCE_DB ?? join(ROOT, "pipeline", "out", "reference.db");
const SEL = join(ROOT, "models", "templates", "sprites", "panorama", "images", "heroes", "selection");
const MODEL = join(ROOT, "models", "classifier", "ability_classifier_fp16.onnx");
const NAMES = join(ROOT, "models", "classifier", "class_names.json");
const INDEX = process.env.AD_PHASH_INDEX ?? join(ROOT, "models", "templates", "phash_index.json");
const REPORT = process.env.AD_RATIO_REPORT === "1";

interface Game {
  folder: string;
  label: string;
  rect: ClientRect;
  /** 这些帧不是选人界面(文件名带 not_draft),不扫。 */
  skip?: RegExp;
  /** 每帧允许的认不出格数(默认 0);例外逐帧写明。 */
  maxUnknown?: number;
  unknownExceptions?: Record<string, number>;
  /** 目视核对过的「我」坐的行(0–4 左列,5–9 右列);没核对过就不写。 */
  me?: number;
  /** 目视核对过的帧:我卡上已选的技能、我选的英雄(selection 立绘名)。 */
  checked?: Record<string, { myPicks: string[]; myHero: string | null }>;
}

const GAMES: Game[] = [
  // 2026-11-08 用户在 1920×1080(125% 缩放)显示器上把 Dota 开成窗口。位置经 main/tools/calibrate_layout.ts 核对:
  // 各组最优平移都在 0–1px、缩放 1.00,不需要修正;认不出的格是小尺寸下分类器把握不够(±1px 就会换答案),
  // 不是位置偏了。下面的上限就是现在的结果,变多说明退步。
  { folder: "game_2026-11-08T06-58-18-936Z", label: "16:9 1366×768", rect: { x: 277, y: 156, width: 1366, height: 768 },
    maxUnknown: 5, me: 7 },
  { folder: "game_2026-11-08T07-02-33-438Z", label: "16:9 1360×768", rect: { x: 280, y: 156, width: 1360, height: 768 },
    maxUnknown: 1, unknownExceptions: { "001_hotkey_turn_unknown.png": 2 }, me: 5 },
  { folder: "game_2026-11-08T07-09-02-382Z", label: "16:9 1280×720", rect: { x: 320, y: 180, width: 1280, height: 720 },
    // 前几帧 6 格,之后有的格被选走 / 被分组救回,降到 5、4。
    // 我先选了英雄(Night Stalker,第 2 手),第一个技能到第 20 手才选,所以卡上前面一直是空的——不是没读出来。
    checked: {
      "010_auto_turn_R4.png": { myPicks: [], myHero: "night_stalker" },
      "023_auto_turn_L1.png": { myPicks: ["shredder_reactive_armor"], myHero: "night_stalker" },
    },
    maxUnknown: 4, me: 0, unknownExceptions: {
      "001_auto_turn_unknown.png": 6, "002_auto_turn_unknown.png": 6, "003_auto_preview_L1.png": 6,
      "004_auto_turn_R1.png": 6, "005_auto_turn_L2.png": 6, "006_auto_turn_R2.png": 5, "007_auto_turn_L3.png": 5,
      "008_auto_turn_R3.png": 5, "009_auto_turn_L4.png": 5, "010_auto_turn_R4.png": 5, "011_auto_turn_L5.png": 5,
      "012_auto_turn_R5.png": 5, "013_auto_turn_unknown.png": 5, "014_auto_turn_L5.png": 5, "015_auto_turn_R4.png": 5,
    } },
  // 21:9 只有开局前的两帧(倒计时,还没人选),玩家卡上的已选格没覆盖到。
  { folder: "game_2026-11-08T07-17-31-261Z", label: "21:9 1834×786", rect: { x: 43, y: 147, width: 1834, height: 786 },
    maxUnknown: 0, me: 0 },
  // 4:3 用的是上游数据推出的表;每帧固定 3 格认不出(把握 0.52–0.83),工具显示不是位置偏。
  { folder: "game_2026-11-08T07-20-55-823Z", label: "4:3 1400×1050", rect: { x: 260, y: 15, width: 1400, height: 1050 },
    maxUnknown: 3, me: 0 },
];

const hasAssets = existsSync(FRAMES) && existsSync(DB) && existsSync(MODEL) && existsSync(SEL) && existsSync(INDEX);

async function load(path: string): Promise<RgbFrame> {
  const { data, info } = await sharp(path).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8Array(data) };
}

interface Ctx { clf: Classifier; ref: ReferenceDb; lookup: Map<string, AbilityInfo>; index: IndexEntry[];
  heroPortraits: (id: number) => Promise<Float32Array[] | null>; }

async function scanGame(g: Game, ctx: Ctx): Promise<Map<string, PoolScanResult>> {
  const dir = join(FRAMES, g.folder);
  const memory = new PoolMemory();
  const out = new Map<string, PoolScanResult>();
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".png") && !(g.skip ?? /not_draft/).test(n)).sort()) {
    const rgb = await load(join(dir, f));
    const res = await scanPool({ rgb, gray: rgbFrameToGray(rgb) },
      { clf: ctx.clf, lookup: ctx.lookup, ref: ctx.ref, cfg: defaultScoringConfig(), rect: g.rect, memory, index: ctx.index,
        heroPortraits: ctx.heroPortraits });
    out.set(f, res);
    if (REPORT) {
      const unk = res.cells.filter((c) => !c.empty && c.name === null).map((c) => `${c.guess}:${c.confidence.toFixed(2)}`);
      const picks = res.myPicks ? [...res.myPicks.normals, ...(res.myPicks.ultimate ? [res.myPicks.ultimate] : [])] : null;
      console.log(`[${g.label}] ${f} draft=${res.onDraftScreen} unknown=${res.unknownCells} [${unk.join(" ")}] `
        + `heroes=${res.snapshot.heroes.size}/${[...res.snapshot.heroes.values()].filter((v) => v !== null).length} taken=${res.takenHeroes.join(",")} `
        + `me=${res.myRow} active=${res.activeRow} seat=${res.seat} pick=${res.pickIndex} myPicks=${picks?.join(",")} unk=${res.myPicks?.unknown}`);
    }
  }
  return out;
}

const present = GAMES.filter((g) => existsSync(join(FRAMES, g.folder)));

describe.skipIf(!hasAssets || present.length === 0)("窗口模式真帧:非 1080p 尺寸整局扫描", () => {
  const results = new Map<string, Map<string, PoolScanResult>>();
  let pictureOf = new Map<number, string>();

  beforeAll(async () => {
    const clf = await loadClassifier(MODEL, NAMES);
    // 用库的副本:几个真帧测试文件并行跑时,同一个 reference.db 的锁目录会互相撞(EBUSY / database is locked)。
    const tmpDir = mkdtempSync(join(tmpdir(), "ad-ratio-"));
    const dbCopy = join(tmpDir, "reference.db");
    copyFileSync(DB, dbCopy);
    const ref = new ReferenceDb(dbCopy);
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
    try {
      for (const g of present) results.set(g.folder, await scanGame(g, { clf, ref, lookup, index, heroPortraits }));
    } finally { ref.close(); rmSync(tmpDir, { recursive: true, force: true }); }
  }, 900_000);

  it.each(present.map((g) => [g.label, g] as const))("%s:每帧都是选人界面,认不出的格不超过标定结果", (_l, g) => {
    for (const [f, r] of results.get(g.folder)!) {
      expect([f, r.onDraftScreen]).toEqual([f, true]);
      const max = g.unknownExceptions?.[f] ?? g.maxUnknown ?? 0;
      expect([f, r.unknownCells <= max]).toEqual([f, true]);
    }
  });

  it.each(present.filter((g) => g.me !== undefined).map((g) => [g.label, g] as const))("%s:认出我坐哪(目视核对过)", (_l, g) => {
    for (const [f, r] of results.get(g.folder)!) expect([f, r.myRow]).toEqual([f, g.me]);
  });

  it.each(present.filter((g) => g.checked !== undefined).map((g) => [g.label, g] as const))("%s:我卡上已选的技能、我的英雄(目视核对过)", (_l, g) => {
    for (const [f, e] of Object.entries(g.checked!)) {
      const r = results.get(g.folder)!.get(f)!;
      const got = r.myPicks ? [...r.myPicks.normals, ...(r.myPicks.ultimate ? [r.myPicks.ultimate] : [])].sort() : [];
      expect([f, got]).toEqual([f, [...e.myPicks].sort()]);
      expect([f, r.me.hero === null ? null : pictureOf.get(-r.me.hero) ?? null]).toEqual([f, e.myHero]);
    }
  });
});
