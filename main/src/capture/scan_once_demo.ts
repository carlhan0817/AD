// main/src/capture/scan_once_demo.ts
// 临时诊断:app 启动后跑一次 scanOnce 并把结果打到日志,验证识别+打分闭环。
// 验证完连同 index.ts 里的调用一起删除。
import { scanOnce, type ScanDeps } from "./scan_once";
import { captureScreenGrayFrame } from "./screen_source";
import { loadIndex } from "@ad/core/recognition/index_store";
import { ReferenceDb } from "@ad/core/db/reference";
import { defaultScoringConfig } from "@ad/core/scoring/config";
import type { WindowRect } from "../ffi/geometry";

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
