// core/tests/recognition/pool_truth.test.ts
// 拿 14 张真选取截图对「标准答案表」(fixtures/pool_ground_truth.json)。
// 截图未入库(公开仓库 + 含他人玩家名 + 19MB):默认找仓库根 docs/screenshot,
// 也可用环境变量 AD_SCREENSHOT_DIR 指到别处;找不到就 skip。本机验收用,不是 CI 检查。
import { describe, it, expect, beforeAll } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { loadClassifier, type Classifier } from "../../src/recognition/classifier";
import { readPool, type CellRead } from "../../src/recognition/pool_classify";
import { rgbFrameToGray, type RgbFrame } from "../../src/recognition/rgb";
import type { GrayFrame } from "../../src/recognition/grid";
import { resolvePool } from "../../src/recognition/pool_resolve";
import { PoolMemory } from "../../src/recognition/pool_memory";
import { phashSecondOpinion } from "../../src/recognition/pool_second_opinion";
import { verifyHeroCandidate } from "../../src/recognition/hero_recognize";
import { loadIndex } from "../../src/recognition/index_store";
import { groupHeroes } from "../../src/recognition/pool_heroes";
import { buildAbilityLookup } from "../../src/db/ability_lookup";
import { ReferenceDb } from "../../src/db/reference";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const SHOTS = process.env.AD_SCREENSHOT_DIR ?? join(ROOT, "docs", "screenshot");
const MODEL = join(ROOT, "models", "classifier", "ability_classifier_fp16.onnx");
const NAMES = join(ROOT, "models", "classifier", "class_names.json");

interface TruthCell { zone: string; hero: number; slot: number; ability: string | null; }
interface TruthFrame { file: string; width: number; height: number; cells: TruthCell[]; }
const truth = (JSON.parse(readFileSync(
  fileURLToPath(new URL("./fixtures/pool_ground_truth.json", import.meta.url)), "utf-8",
)) as { frames: TruthFrame[] }).frames;

// reference.db 是流水线产物(未入库):默认 pipeline/out/reference.db,或 AD_REFERENCE_DB。
const DB = process.env.AD_REFERENCE_DB ?? join(ROOT, "pipeline", "out", "reference.db");
interface HeroTruthCell { order: number; valveId: number | null; shortName: string | null; }
const heroTruth = JSON.parse(readFileSync(
  fileURLToPath(new URL("./fixtures/hero_ground_truth.json", import.meta.url)), "utf-8",
)) as Record<string, { file: string; cells: HeroTruthCell[] }>;

// pHash 索引也是流水线产物(未入库):默认 models/templates/phash_index.json,或 AD_PHASH_INDEX。
const INDEX = process.env.AD_PHASH_INDEX ?? join(ROOT, "models", "templates", "phash_index.json");

const hasShots = truth.every((f) => existsSync(join(SHOTS, f.file)));

async function loadRgb(path: string): Promise<RgbFrame> {
  const { data, info } = await sharp(path).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8Array(data) };
}

describe.skipIf(!hasShots)("技能池识别 vs 标准答案(14 张真帧)", () => {
  const reads: { frame: TruthFrame; cells: CellRead[]; gray: GrayFrame }[] = [];

  beforeAll(async () => {
    const clf: Classifier = await loadClassifier(MODEL, NAMES);
    for (const frame of truth) {
      const rgb = await loadRgb(join(SHOTS, frame.file));
      const rect = { x: 0, y: 0, width: rgb.width, height: rgb.height };
      reads.push({ frame, cells: await readPool(rgb, rect, clf), gray: rgbFrameToGray(rgb) });
    }
  }, 120_000);

  it("格子顺序与答案表一致(zone/hero/slot)", () => {
    for (const { frame, cells } of reads) {
      cells.forEach((c, i) => {
        const t = frame.cells[i];
        expect([c.slot.zone, c.slot.hero, c.slot.slot]).toEqual([t.zone, t.hero, t.slot]);
      });
    }
  });

  it("判空:79 个空格全部标空,593 个有图标的格一个不误标", () => {
    let empty = 0, live = 0;
    const wrong: string[] = [];
    for (const { frame, cells } of reads) {
      cells.forEach((c, i) => {
        const shouldBeEmpty = frame.cells[i].ability === null;
        if (c.empty !== shouldBeEmpty) wrong.push(`${frame.file}#${i}`);
        if (c.empty) empty++; else live++;
      });
    }
    expect(wrong).toEqual([]);
    expect([empty, live]).toEqual([79, 593]);
  });

  it("识别:有图标的格最像的答案全对;直接采信(≥0.9)的不少于 585 格且无一认错", () => {
    let accepted = 0;
    const wrongGuess: string[] = [], wrongAccepted: string[] = [];
    for (const { frame, cells } of reads) {
      cells.forEach((c, i) => {
        const t = frame.cells[i].ability;
        if (t === null) return;
        if (c.guess !== t) wrongGuess.push(`${frame.file}#${i}: ${c.guess}(${c.confidence.toFixed(2)}) ≠ ${t}`);
        if (c.name !== null) { accepted++; if (c.name !== t) wrongAccepted.push(`${frame.file}#${i}`); }
      });
    }
    // eslint-disable-next-line no-console
    console.log(`采信 ${accepted}/593;最像但不对 ${wrongGuess.length} 格`);
    expect(wrongAccepted).toEqual([]);
    expect(wrongGuess).toEqual([]);
    expect(accepted).toBeGreaterThanOrEqual(585);
  });

  describe.skipIf(!existsSync(DB))("按组定英雄(需要 reference.db)", () => {
    // 旧的 hero_ground_truth.json(英雄格 pHash 自举出来的答案)与分组结果有 20/45 格不同。
    // 2026-10-03 抽 8 格目视核对:8 格都是分组结果对、旧答案错。故这里不拿旧答案当判据,只统计差异。
    it("135 个完整的组全部认定英雄", () => {
      const ref = new ReferenceDb(DB);
      try {
        const lookup = buildAbilityLookup(ref);
        const ownerOf = (n: string) => lookup.get(n)?.heroId ?? null;
        let complete = 0, differsFromOld = 0, comparedWithOld = 0;
        const rules: Record<string, number> = {};
        const undecided: string[] = [];
        for (const { frame, cells } of reads) {
          const old = Object.values(heroTruth).find((h) => h.file === frame.file);
          for (const g of groupHeroes(cells, ownerOf)) {
            if (g.cells.some((c) => c.empty)) continue; // 只验满员组;残缺组靠 PoolMemory 记住的结果
            complete++;
            rules[g.rule] = (rules[g.rule] ?? 0) + 1;
            if (g.heroId === null) { undecided.push(`${frame.file} hero${g.hero} ${g.rule}`); continue; }
            const t = old?.cells.find((c) => c.order === g.hero);
            if (t === undefined || t.valveId === null) continue;
            comparedWithOld++;
            if (-t.valveId !== g.heroId) differsFromOld++;
          }
        }
        // eslint-disable-next-line no-console
        console.log(`满员组 ${complete};规则分布 ${JSON.stringify(rules)};与旧英雄答案不同 ${differsFromOld}/${comparedWithOld}`);
        expect(complete).toBe(135);
        expect(undecided).toEqual([]);
      } finally { ref.close(); }
    });
  });

  it("记住不改:按时间顺序喂 14 帧,同一局里认出来的格之后不再变,被选走的格名字还在", () => {
    const memory = new PoolMemory();
    const ownerOf = () => null; // 这条只看技能名的记忆,不涉及英雄
    let resets = 0, keptAfterPicked = 0, prev: (string | null)[] = [];
    const changed: string[] = [], wrong: string[] = [];
    for (const { frame, cells } of reads) {
      const snap = memory.observe(resolvePool(cells, { ownerOf }));
      if (snap.reset) { resets++; prev = []; }
      snap.names.forEach((n, i) => {
        if (prev[i] != null && n !== prev[i]) changed.push(`${frame.file}#${i}`);
        const t = frame.cells[i].ability;
        if (n !== null && t !== null && n !== t) wrong.push(`${frame.file}#${i}: 记住 ${n},答案 ${t}`);
        if (n !== null && !snap.available[i]) keptAfterPicked++;
      });
      prev = snap.names;
    }
    // eslint-disable-next-line no-console
    console.log(`判为新一局 ${resets} 次;被选走后仍记得名字的格次 ${keptAfterPicked}`);
    expect(changed).toEqual([]);
    expect(wrong).toEqual([]);
    expect(keptAfterPicked).toBeGreaterThan(0);
  });

  describe.skipIf(!existsSync(INDEX))("旧办法当第二意见 / 英雄模型核对(需要 phash_index.json)", () => {
    it("第二意见:有图标的格里,与答案一致的不少于 530/593", () => {
      const index = loadIndex(INDEX);
      let agree = 0;
      for (const { frame, cells, gray } of reads) {
        const second = phashSecondOpinion(gray, { x: 0, y: 0, width: gray.width, height: gray.height }, index);
        cells.forEach((c, i) => { if (!c.empty && second(i) === frame.cells[i].ability) agree++; });
      }
      // eslint-disable-next-line no-console
      console.log(`第二意见与答案一致 ${agree}/593`);
      expect(agree).toBeGreaterThanOrEqual(530);
    });

    it.skipIf(!existsSync(DB))("英雄模型核对:4 帧 48 个真英雄,通过不少于 42 个(偏弱的核对,见 HERO_VERIFY_MAX_DISTANCE)", () => {
      const index = loadIndex(INDEX);
      const ref = new ReferenceDb(DB);
      try {
        const lookup = buildAbilityLookup(ref);
        const ownerOf = (n: string) => lookup.get(n)?.heroId ?? null;
        let pass = 0, total = 0;
        for (const { frame, cells, gray } of reads) {
          if (!Object.values(heroTruth).some((h) => h.file === frame.file)) continue;
          const rect = { x: 0, y: 0, width: gray.width, height: gray.height };
          for (const g of groupHeroes(cells, ownerOf)) {
            if (g.heroId === null) continue;
            total++;
            if (verifyHeroCandidate(gray, rect, g.hero, -g.heroId, index)) pass++;
          }
        }
        expect(total).toBe(48);
        expect(pass).toBeGreaterThanOrEqual(42);
      } finally { ref.close(); }
    }, 120_000);
  });
});
