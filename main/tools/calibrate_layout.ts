// main/tools/calibrate_layout.ts
// 开发工具:在一张真机帧上,检查某个客户区矩形下各组格子(技能池 / 英雄格 / 玩家卡 / 卡上已选格)
// 摆得准不准。从当前位置出发,每组单独搜一个整体平移(±20px)和缩放(±5%,绕该组中心),
// 让分类器在「有图标的格」上的把握之和最高;判空结果必须和当前位置一致(不许靠把格子挪到空处刷分)。
//   技能池、卡上已选格:分类器把握之和(同 readPool / readCardPicks 的裁法)。
//   英雄格:不走分类器,用 pHash 最近邻距离之和(越小越好,不做逐格 refine)。
//   玩家卡:本人卡绿框占比(myOutlineFraction)的最大值。
// 用法(仓库根目录):npx vite-node main/tools/calibrate_layout.ts <帧.png> <x> <y> <w> <h> [组,组...]
// 1920×1080 帧 + 0 0 1920 1080 应报平移 0、缩放 1.00(健全性检查)。
// 帧来自 app/.scan_frames(含玩家名,只留本地,不进仓库)。
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { CLASSIFIER_INPUT_SIZE, loadClassifier, type Classifier } from "../../core/src/recognition/classifier";
import { CLASS_NAME_FIXES, ML_CONFIDENCE } from "../../core/src/recognition/pool_classify";
import { cropResizeRgb, isEmptyCell, meanChroma, rgbFrameToGray, type RgbFrame } from "../../core/src/recognition/rgb";
import { poolSlots } from "../../core/src/recognition/pool_slots";
import { heroCellRects } from "../../core/src/recognition/hero_layout";
import { cardSlots, playerCards } from "../../core/src/recognition/player_cards";
import { myOutlineFraction } from "../../core/src/recognition/card_reading";
import { loadIndex, nearest, type IndexEntry } from "../../core/src/recognition/index_store";
import { cropRaw, type GrayFrame } from "../../core/src/recognition/grid";
import { resizeGrayTo32 } from "../../core/src/recognition/resize";
import { phashFromGray } from "../../core/src/recognition/phash";
import { HERO_COLORED_MIN_CHROMA } from "../../core/src/recognition/hero_taken";
import type { Rect, ClientRect } from "../../core/src/recognition/roi";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const MODEL = join(ROOT, "models", "classifier", "ability_classifier_fp16.onnx");
const NAMES = join(ROOT, "models", "classifier", "class_names.json");
const INDEX = join(ROOT, "models", "templates", "phash_index.json");

type Group = "pool" | "heroes" | "cards" | "cardSlots";
const GROUPS: Group[] = ["pool", "heroes", "cards", "cardSlots"];

export interface Transform { dx: number; dy: number; s: number; }

/** 一组格子整体变换:绕该组外接框中心缩放 s,再平移 (dx, dy)。 */
export function transformGroup<T extends Rect>(rs: T[], t: Transform): T[] {
  if (t.dx === 0 && t.dy === 0 && t.s === 1) return rs;
  const x0 = Math.min(...rs.map((r) => r.x)), x1 = Math.max(...rs.map((r) => r.x + r.w));
  const y0 = Math.min(...rs.map((r) => r.y)), y1 = Math.max(...rs.map((r) => r.y + r.h));
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  return rs.map((r) => ({
    ...r,
    x: Math.round(cx + (r.x - cx) * t.s) + t.dx,
    y: Math.round(cy + (r.y - cy) * t.s) + t.dy,
    w: Math.round(r.w * t.s),
    h: Math.round(r.h * t.s),
  }));
}

export interface CellScore { i: number; empty: boolean; name: string | null; confidence: number; }
export interface GroupScore { score: number; cells: CellScore[]; emptyKey: string; }

/** 技能格(池 / 卡上已选格):判空同 readPool,有图标的格送分类器,分数 = 把握之和。 */
async function scoreIcons(frame: RgbFrame, rects: Rect[], clf: Classifier): Promise<GroupScore> {
  const crops = rects.map((r) => cropResizeRgb(frame, r.x, r.y, r.w, r.h, CLASSIFIER_INPUT_SIZE));
  const live = crops.map((c, i) => (isEmptyCell(c) ? -1 : i)).filter((i) => i >= 0);
  const bytes = CLASSIFIER_INPUT_SIZE * CLASSIFIER_INPUT_SIZE * 3;
  const batch = new Uint8Array(live.length * bytes);
  live.forEach((i, k) => batch.set(crops[i], k * bytes));
  const preds = await clf.classify(batch);
  const cells: CellScore[] = rects.map((_r, i) => ({ i, empty: true, name: null, confidence: 0 }));
  live.forEach((i, k) => {
    cells[i] = { i, empty: false, name: CLASS_NAME_FIXES[preds[k].name] ?? preds[k].name, confidence: preds[k].confidence };
  });
  return { score: cells.reduce((n, c) => n + c.confidence, 0), cells, emptyKey: cells.map((c) => (c.empty ? "0" : "1")).join("") };
}

/** 英雄格:只看彩色(没被选走)的格,分数 = −pHash 最近邻距离之和。 */
function scoreHeroes(frame: RgbFrame, gray: GrayFrame, rects: Rect[], index: IndexEntry[]): GroupScore {
  const cells: CellScore[] = rects.map((r, i) => {
    const tile = cropResizeRgb(frame, r.x, r.y, r.w, r.h, 96);
    if (meanChroma(tile) < HERO_COLORED_MIN_CHROMA) return { i, empty: true, name: null, confidence: 0 };
    const m = nearest(index, phashFromGray(resizeGrayTo32(cropRaw(gray, r.x, r.y, r.w, r.h))), 1024);
    return { i, empty: false, name: m?.shortName ?? null, confidence: m === null ? 64 : m.distance };
  });
  const live = cells.filter((c) => !c.empty);
  return { score: -live.reduce((n, c) => n + c.confidence, 0), cells, emptyKey: cells.map((c) => (c.empty ? "0" : "1")).join("") };
}

/** 玩家卡:绿框占比最高的那张(本人)。 */
function scoreCards(frame: RgbFrame, rects: ReturnType<typeof playerCards>): GroupScore {
  const cells: CellScore[] = rects.map((c, i) => ({ i, empty: false, name: null, confidence: myOutlineFraction(frame, c) }));
  return { score: Math.max(...cells.map((c) => c.confidence)), cells, emptyKey: "" };
}

export interface Calibration {
  group: Group;
  base: GroupScore;
  /** 在峰值 tol 以内、离原位置最近的变换(= 该不该改位置的结论)。 */
  best: Transform; bestScore: GroupScore;
  /** 原始峰值(仅供参考)。 */
  peak: Transform; peakScore: GroupScore;
}

export async function calibrateGroup(
  group: Group, frame: RgbFrame, rect: ClientRect, clf: Classifier, index: IndexEntry[],
  range = 20, scaleRange = 0.05,
): Promise<Calibration> {
  const gray = rgbFrameToGray(frame);
  const placed: Rect[] = group === "pool" ? poolSlots(rect) : group === "heroes" ? heroCellRects(rect)
    : group === "cards" ? playerCards(rect) : cardSlots(rect);
  const score = async (t: Transform): Promise<GroupScore> => {
    const rs = transformGroup(placed, t);
    if (group === "heroes") return scoreHeroes(frame, gray, rs, index);
    if (group === "cards") return scoreCards(frame, rs as ReturnType<typeof playerCards>);
    return scoreIcons(frame, rs, clf);
  };
  const base = await score({ dx: 0, dy: 0, s: 1 });
  const tried: { t: Transform; r: GroupScore }[] = [{ t: { dx: 0, dy: 0, s: 1 }, r: base }];
  const tryT = async (t: Transform) => {
    if (tried.some((x) => x.t.dx === t.dx && x.t.dy === t.dy && x.t.s === t.s)) return;
    const r = await score(t);
    if (group !== "cards" && r.emptyKey !== base.emptyKey) return; // 判空必须不变
    tried.push({ t, r });
  };
  const peak = () => tried.reduce((a, b) => (b.r.score > a.r.score ? b : a));
  // 粗搜:缩放 1,平移步长 2。
  for (let dy = -range; dy <= range; dy += 2) for (let dx = -range; dx <= range; dx += 2) await tryT({ dx, dy, s: 1 });
  // 细搜:在粗搜最优附近 ±2px 步长 1,缩放 ±scaleRange 步长 0.01。
  const c0 = peak().t;
  const steps = Math.round(scaleRange / 0.01);
  for (let k = -steps; k <= steps; k++) {
    const s = Math.round((1 + k * 0.01) * 100) / 100;
    for (let dy = c0.dy - 2; dy <= c0.dy + 2; dy++) for (let dx = c0.dx - 2; dx <= c0.dx + 2; dx++) await tryT({ dx, dy, s });
  }
  // 分数在峰值附近是一片平台(把握饱和在 ~1.0、pHash 有 ±2 的抖动),只认「明显更好」:
  // 在峰值 tol 以内的候选里取离原位置最近的。tol:技能格 max(0.5, 0.02×格数),英雄格 3×格数,玩家卡 0.05。
  const live = base.cells.filter((c) => !c.empty).length;
  const tol = group === "heroes" ? 3 * live : group === "cards" ? 0.05 : Math.max(0.5, 0.02 * live);
  const top = peak();
  const dist = (x: Transform) => Math.abs(x.dx) + Math.abs(x.dy) + Math.abs(x.s - 1) * 100;
  const pick = tried.filter((x) => x.r.score >= top.r.score - tol).reduce((a, b) => (dist(b.t) < dist(a.t) ? b : a));
  return { group, base, best: pick.t, bestScore: pick.r, peak: top.t, peakScore: top.r };
}

async function loadFrame(path: string): Promise<RgbFrame> {
  const { data, info } = await sharp(path).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8Array(data) };
}

function describe(c: Calibration): string {
  const unknown = (g: GroupScore) => g.cells.filter((x) => !x.empty && x.confidence < ML_CONFIDENCE).length;
  const live = c.base.cells.filter((x) => !x.empty).length;
  const lines = [`[${c.group}] 平移 (${c.best.dx},${c.best.dy}) 缩放 ${c.best.s.toFixed(2)};分数 ${c.base.score.toFixed(3)} → ${c.bestScore.score.toFixed(3)}`
    + `(峰值 (${c.peak.dx},${c.peak.dy}) ×${c.peak.s.toFixed(2)} = ${c.peakScore.score.toFixed(3)})`];
  if (c.group === "pool" || c.group === "cardSlots") {
    lines.push(`  有图标 ${live} 格;把握不到 ${ML_CONFIDENCE}:${unknown(c.base)} → ${unknown(c.bestScore)}(峰值处 ${unknown(c.peakScore)})`);
    for (const x of c.base.cells) {
      if (x.empty || x.confidence >= ML_CONFIDENCE) continue;
      const after = c.bestScore.cells[x.i];
      const pk = c.peakScore.cells[x.i];
      lines.push(`    格 ${x.i}: ${x.name} ${x.confidence.toFixed(3)} → ${after.name} ${after.confidence.toFixed(3)}(峰值处 ${pk.name} ${pk.confidence.toFixed(3)})`);
    }
  } else if (c.group === "heroes") {
    lines.push(`  彩色 ${live} 格;pHash 距离 ${c.base.cells.filter((x) => !x.empty).map((x) => x.confidence).join(",")} → ${c.bestScore.cells.filter((x) => !x.empty).map((x) => x.confidence).join(",")}`);
  } else {
    lines.push(`  绿框占比 ${c.base.cells.map((x) => x.confidence.toFixed(2)).join(",")}`);
  }
  return lines.join("\n");
}

async function main() {
  const [file, xs, ys, ws, hs, gs] = process.argv.slice(2);
  if (!file || hs === undefined) {
    console.error("用法:npx vite-node main/tools/calibrate_layout.ts <帧.png> <x> <y> <w> <h> [pool,heroes,cards,cardSlots]");
    process.exit(2);
  }
  for (const p of [MODEL, NAMES, INDEX]) if (!existsSync(p)) throw new Error(`缺 ${p}`);
  const rect: ClientRect = { x: +xs, y: +ys, width: +ws, height: +hs };
  const groups = gs ? (gs.split(",") as Group[]) : GROUPS;
  const frame = await loadFrame(file);
  const clf = await loadClassifier(MODEL, NAMES);
  const index = loadIndex(INDEX);
  for (const g of groups) console.log(describe(await calibrateGroup(g, frame, rect, clf, index)));
}

main().catch((e) => { console.error(e); process.exit(1); });
