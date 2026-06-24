// main/src/capture/scan_once.ts
// 手动单帧扫描:截屏后的一帧 → 识别 48 格技能池 → 桥接 Candidate → 打分排名。
// 有意绕过 runMonitorLoop 的 4 道连续监控门(①frame-diff ②layout_guard ③状态机 ④activeRow)。
// 手动是过渡形态,产品终态回连续监控时那 4 门重新启用(故 runMonitorLoop/layout_guard 保留不删)。
// 见 docs/superpowers/specs/2026-06-24-scan-once-core-design.md。
import { recognizePool } from "@ad/core/recognition/pool_recognize";
import { POOL_LAYOUT_RATIO } from "@ad/core/recognition/roi";
import { recommend } from "@ad/core/scoring/recommend";
import type { IndexEntry } from "@ad/core/recognition/index_store";
import type { GrayFrame } from "@ad/core/recognition/grid";
import type { ReferenceDb } from "@ad/core/db/reference";
import type { Candidate, ScoredCandidate, ScoringConfig } from "@ad/shared/types/scoring";
import type { PlayerState } from "@ad/shared/types/draft";
import type { WindowRect } from "../ffi/geometry";

// 识别命中阈值:与 runMonitorLoop 一致(真机标定 48/48,见 loop.ts 的 RECOGNIZE_MAX_DISTANCE)。
const RECOGNIZE_MAX_DISTANCE = 20;

// 无上下文纯池排名:还没人选技能 → me 空、pickIndex 未知。
// base/aghs/shard(看技能自身)信号照常;synergy(依赖已选)/pos(依赖 pickIndex)退化。
// 净结果 = 这局池子里单看技能客观强度的排序。上下文是后续增量(灌真实 me/pickIndex,函数不改)。
const EMPTY_ME: PlayerState = { row: 0, hero: null, normals: [], ultimates: [] };

export interface ScanResult {
  /** 识别到的候选池 valveId[](去重,铺平序)。 */
  pool: number[];
  /** 打分后 Top-K(按 score 降序)。 */
  recommendations: ScoredCandidate[];
}

export interface ScanDeps {
  index: IndexEntry[];
  ref: ReferenceDb;
  cfg: ScoringConfig;
  /** 游戏客户区矩形,供比例池布局推导像素。 */
  rect: WindowRect;
}

/** 单帧扫描:识别技能池 → 桥接 Candidate → 无上下文打分。不经过任何门。 */
export function scanOnce(frame: GrayFrame, deps: ScanDeps): ScanResult {
  // 1. 识别 48 格池(复用,已验证 48/48)。
  const pool = recognizePool(
    frame, deps.rect, deps.index, POOL_LAYOUT_RATIO, RECOGNIZE_MAX_DISTANCE,
  );
  // 2. 桥接:valveId[] → Candidate[]。recognizePool 不给 slotType,用 ref 现补。
  //    slotType 查不到的(理论上不该发生,识别出的 valveId 必在库)直接跳过,不进打分。
  const candidates: Candidate[] = [];
  for (const valveId of pool) {
    const slotType = deps.ref.slotType(valveId);
    if (slotType === null) continue;
    candidates.push({ valveId, slotType });
  }
  // 3. 打分(空 me / pickIndex=null = 无上下文纯池排名)。
  const recommendations = recommend(candidates, EMPTY_ME, null, deps.ref, deps.cfg);
  return { pool, recommendations };
}
