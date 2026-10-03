// main/src/capture/scan_once_demo.ts
// 临时诊断:app 启动后跑一次 scanOnce 并把结果打到日志,验证识别+打分闭环。
// 验证完连同 index.ts 里的调用一起删除。
import { scanOnce, type ScanDeps } from "./scan_once";
import { captureScreenGrayFrame } from "./screen_source";
import { loadIndex, nearest, type IndexEntry } from "@ad/core/recognition/index_store";
import { ReferenceDb } from "@ad/core/db/reference";
import { defaultScoringConfig } from "@ad/core/scoring/config";
import { poolCellRects, poolCellZones, POOL_LAYOUT_RATIO } from "@ad/core/recognition/roi";
import { cropRaw, type GrayFrame } from "@ad/core/recognition/grid";
import { resizeGrayTo32 } from "@ad/core/recognition/resize";
import { phashFromGray } from "@ad/core/recognition/phash";
import type { WindowRect } from "../ffi/geometry";

// ── 临时诊断:dump scanOnce 实际吃进去的帧 + 前 8 格真实最近邻 distance。
// 用来区分根因:抓的是不是选取界面(看 PGM/亮度)、坐标对不对(看 distance)。排查完连同 demo 删。
function dumpScanFrame(frame: GrayFrame, rect: WindowRect, index: IndexEntry[], log: (m: string) => void): void {
  // 1. 整帧灰度存 PGM(P5),供离线肉眼确认抓的是不是选取界面。
  const header = Buffer.from(`P5\n${frame.width} ${frame.height}\n255\n`, "ascii");
  const path = `${process.cwd()}/.scan_once_frame.pgm`;
  let sum = 0, n = 0;
  for (let i = 0; i < frame.data.length; i += 64) { sum += frame.data[i]; n++; }
  const avg = (sum / n).toFixed(1);
  try {
    const fs = require("node:fs"); // eslint-disable-line @typescript-eslint/no-var-requires
    fs.writeFileSync(path, Buffer.concat([header, Buffer.from(frame.data)]));
    log(`[scan-diag] 帧 ${frame.width}x${frame.height} 平均亮度=${avg} → ${path}`);
  } catch (e) { log(`[scan-diag] dump 失败: ${e}`); }
  // 2. 全格逐格真实最近邻(大阈值 1024 只为读出真实距离,不门控),保留 格号/zone/distance
  //    对应关系——recognizePool 去重+跳未命中后会丢失这个,这里不去重不跳过,供定位:
  //    英雄(负id)落在哪些格? distance 整体分布? 是坐标裁到两侧英雄位还是技能格误配?
  const cells = poolCellRects(POOL_LAYOUT_RATIO, rect);
  const zones = poolCellZones();
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    const gray32 = resizeGrayTo32(cropRaw(frame, c.x, c.y, c.w, c.h));
    const m = nearest(index, phashFromGray(gray32), 1024);
    const hit = m ? `${m.shortName}(${m.valveId}) d=${m.distance}` : "无";
    const flag = m && m.valveId < 0 ? " ⟵英雄" : "";
    log(`[scan-cell] #${String(i).padStart(2)} ${zones[i]?.padEnd(8)} @(${c.x},${c.y},${c.w}x${c.h}) → ${hit}${flag}`);
  }
}

/** 跑一次手动扫描并把可读结果交给 log。indexPath/dbPath 由调用方(index.ts)按已有逻辑解析。 */
export async function runScanOnceDemo(
  indexPath: string,
  dbPath: string,
  rect: WindowRect,
  log: (msg: string) => void,
): Promise<void> {
  let ref: ReferenceDb | null = null;
  try {
    const index = loadIndex(indexPath);
    ref = new ReferenceDb(dbPath);
    const deps: ScanDeps = { index, ref, cfg: defaultScoringConfig(), rect };
    // valveId → shortName 用 index(IndexEntry 自带 shortName),ReferenceDb 无此方法。
    const nameOf = new Map(index.map((e) => [e.valveId, e.shortName]));
    const frame = await captureScreenGrayFrame();
    dumpScanFrame(frame, rect, index, log); // 临时诊断:看抓到的帧 + 逐格 distance
    const res = scanOnce(frame, deps);
    const names = res.pool.map((v) => `${v}:${nameOf.get(v) ?? "?"}`).join(", ");
    log(`[scan-once] 识别到 ${res.pool.length} 个技能: [${names}]`);
    log(`[scan-once] 推荐 Top-${res.recommendations.length}:`);
    res.recommendations.forEach((r, i) => {
      const bd = Object.entries(r.breakdown).map(([k, v]) => `${k}:${(v as number).toFixed(2)}`).join(", ");
      log(`[scan-once]   #${i + 1} valveId=${r.candidate.valveId} score=${r.score.toFixed(3)} {${bd}}`);
    });
  } catch (err) {
    log(`[scan-once] 失败: ${err}`);
  } finally {
    try { ref?.close(); } catch { /* 忽略关闭期错误 */ }
  }
}
