// main/tests/capture/board_change_frames.test.ts
// 用真机运行时帧(app/.scan_frames/,不入库:含其他玩家名字)校准并验证「画面变化检测」。
// 「同一局面」不看日志,而是对每帧跑现成的 scanPool,比较第几手 + 48 格读数 + 被选走英雄。
// 缺帧/缺 reference.db/缺模型就整体 skip(写法照 runtime_frames.test.ts)。
import { describe, it, expect, beforeAll } from "vitest";
import { existsSync, readdirSync, mkdtempSync, copyFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { scanPool } from "../../src/capture/scan_pool";
import { loadClassifier } from "@ad/core/recognition/classifier";
import { loadIndex } from "@ad/core/recognition/index_store";
import { PoolMemory } from "@ad/core/recognition/pool_memory";
import { buildAbilityLookup } from "@ad/core/db/ability_lookup";
import { ReferenceDb } from "@ad/core/db/reference";
import { rgbFrameToGray, type RgbFrame } from "@ad/core/recognition/rgb";
import { defaultScoringConfig } from "@ad/core/scoring/config";
import { boardSignature, boardChanged, BOARD_CHANGE_THRESHOLD, type BoardSignature } from "@ad/core/autoscan/board_change";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const FRAMES = process.env.AD_SCAN_FRAMES_DIR ?? join(ROOT, "app", ".scan_frames");
const DB = process.env.AD_REFERENCE_DB ?? join(ROOT, "pipeline", "out", "reference.db");
const MODEL = join(ROOT, "models", "classifier", "ability_classifier_fp16.onnx");
const NAMES = join(ROOT, "models", "classifier", "class_names.json");
const INDEX = process.env.AD_PHASH_INDEX ?? join(ROOT, "models", "templates", "phash_index.json");

// 2026-11-05 07:48–07:56 UTC 并排存的「截图(奇数 n)+ 视频流帧(n+1)」同一时刻对。
const PAIR_RE = /^scan_2026-11-05T07-(4[89]|5[0-6])-.*Z_(\d+)\.png$/;

const hasAssets = existsSync(FRAMES) && existsSync(DB) && existsSync(MODEL) && existsSync(INDEX);

async function load(path: string): Promise<RgbFrame> {
  const { data, info } = await sharp(path).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8Array(data) };
}

/** 各区域(每 16 个值一块)平均绝对差的最大值——和 boardChanged 的判据同口径,用来量噪声与变化幅度。 */
function maxRegionDiff(a: BoardSignature, b: BoardSignature): number {
  let m = 0;
  for (let o = 0; o < a.cells.length; o += 16) {
    let d = 0;
    for (let k = 0; k < 16; k++) d += Math.abs(a.cells[o + k] - b.cells[o + k]);
    m = Math.max(m, d / 16);
  }
  return m;
}

interface Item { name: string; sig: BoardSignature; key: string; onDraft: boolean; pick: number }

describe.skipIf(!hasAssets)("运行时真帧:画面变化检测", () => {
  const items: Item[] = [];
  let tmpDir = "";

  beforeAll(async () => {
    const clf = await loadClassifier(MODEL, NAMES);
    // 拷一份到临时目录再开:ReferenceDb 在库目录旁建锁目录,和并行跑的 runtime_frames.test.ts 共用同一个会撞锁。
    tmpDir = mkdtempSync(join(tmpdir(), "ad-bc-"));
    const dbCopy = join(tmpDir, "reference.db");
    copyFileSync(DB, dbCopy);
    const ref = new ReferenceDb(dbCopy);
    const lookup = buildAbilityLookup(ref);
    const index = loadIndex(INDEX);
    const rect = { x: 0, y: 0, width: 1920, height: 1080 };
    try {
      for (const f of readdirSync(FRAMES).filter((n) => n.endsWith(".png")).sort()) {
        const rgb = await load(join(FRAMES, f));
        if (rgb.width !== 1920 && Math.abs(rgb.width - 1920) > 10) continue; // 只用 1080p 帧
        // 每帧独立记忆:「同一局面」只由这一帧自己的读数决定
        const res = await scanPool({ rgb, gray: rgbFrameToGray(rgb) },
          { clf, lookup, ref, cfg: defaultScoringConfig(), rect, memory: new PoolMemory(), index });
        const key = JSON.stringify([res.pickIndex, res.cells.map((c) => (c.empty ? "-" : c.name ?? "?")), res.takenHeroes]);
        items.push({ name: f, sig: boardSignature(rgb, rect), key, onDraft: res.onDraftScreen, pick: res.pickIndex });
      }
    } finally { ref.close(); rmSync(tmpDir, { recursive: true, force: true }); }
  }, 600_000);

  it("同一时刻的截图 vs 视频流帧(颜色偏差)不算变化,且噪声明显低于阈值", () => {
    const byN = new Map<number, Item>();
    for (const it of items) { const m = PAIR_RE.exec(it.name); if (m) byN.set(Number(m[2]), it); }
    let pairs = 0, worst = 0;
    for (const [n, a] of byN) {
      const b = byN.get(n + 1);
      if (n % 2 === 0 || !b) continue;
      // 07:48:22 那一对是进入选人界面的淡入动画(两帧画面本来就不同,流帧晚了一拍),不是选人局面,不参与。
      if (!a.onDraft || !b.onDraft) continue;
      pairs++;
      worst = Math.max(worst, maxRegionDiff(a.sig, b.sig));
      expect([a.name, boardChanged(a.sig, b.sig)]).toEqual([a.name, false]);
    }
    expect(pairs).toBeGreaterThanOrEqual(10);
    if (process.env.AD_BC_VERBOSE) console.log(`[board_change] 流/截图噪声最大区域差 = ${worst.toFixed(2)}(阈值 ${BOARD_CHANGE_THRESHOLD})`);
    expect(worst).toBeLessThan(BOARD_CHANGE_THRESHOLD / 2);
  });

  it("读数完全相同的相邻两帧不算变化;读数不同的相邻两帧算变化", () => {
    const draft = items.filter((i) => i.onDraft);
    let same = 0, diff = 0, minChange = Infinity, maxSame = 0;
    for (let i = 1; i < draft.length; i++) {
      const a = draft[i - 1], b = draft[i];
      const d = maxRegionDiff(a.sig, b.sig);
      if (a.key === b.key) {
        // 「轮到谁」的金色卡出现/消失时,金底会从卡上已选格的边缘透出来(区域差约 10–12),
        // 这是真实的画面变化(轮次换了),不当作「同一局面」。
        if ((a.sig.activeRow === null) !== (b.sig.activeRow === null)) continue;
        same++; maxSame = Math.max(maxSame, d);
        expect([a.name, b.name, boardChanged(a.sig, b.sig)]).toEqual([a.name, b.name, false]);
      } else {
        diff++; minChange = Math.min(minChange, d);
        expect([a.name, b.name, boardChanged(a.sig, b.sig)]).toEqual([a.name, b.name, true]);
      }
    }
    if (process.env.AD_BC_VERBOSE) console.log(`[board_change] 同局面 ${same} 对最大差 ${maxSame.toFixed(2)};不同局面 ${diff} 对最小差 ${minChange.toFixed(2)}`);
    expect(same).toBeGreaterThan(0);
    expect(diff).toBeGreaterThan(0);
  });
});
