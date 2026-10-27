// main/src/capture/scan_pool.ts
// 手动扫一次(新识别层):一帧 → 判空 + 分类器认 48 格 → 按组定英雄、救回不确定格
// → 并入本局记忆(已认出的不再改)→ 还在池里的技能 + 认定的英雄 → 打分排名。
// 取代 scan_once.ts 的 pHash 识别;同样有意绕过 runMonitorLoop 的 4 道门(手动是过渡形态)。
// 见 docs/superpowers/plans/2026-10-03-recognition-rework.md。
import { readPool } from "@ad/core/recognition/pool_classify";
import { resolvePool, type PoolReading } from "@ad/core/recognition/pool_resolve";
import { phashSecondOpinion } from "@ad/core/recognition/pool_second_opinion";
import { verifyHeroCandidate } from "@ad/core/recognition/hero_recognize";
import { recommend } from "@ad/core/scoring/recommend";
import type { PoolMemory, PoolSnapshot } from "@ad/core/recognition/pool_memory";
import type { Classifier } from "@ad/core/recognition/classifier";
import type { RgbFrame } from "@ad/core/recognition/rgb";
import type { GrayFrame } from "@ad/core/recognition/grid";
import type { IndexEntry } from "@ad/core/recognition/index_store";
import type { AbilityInfo } from "@ad/core/db/ability_lookup";
import type { Queryable } from "@ad/shared/types/db";
import type { Candidate, ScoredCandidate, ScoringConfig } from "@ad/shared/types/scoring";
import type { PlayerState } from "@ad/shared/types/draft";
import type { WindowRect } from "../ffi/geometry";

// 无上下文纯池排名(同 scan_once.ts):还不知道「我是谁、第几手」,me 空、pickIndex 未知。
const EMPTY_ME: PlayerState = { row: 0, hero: null, normals: [], ultimates: [] };

export interface PoolScanDeps {
  clf: Classifier;
  /** 技能 shortName → valveId/槽位/所属英雄(buildAbilityLookup)。 */
  lookup: Map<string, AbilityInfo>;
  /** 打分用的只读查询(ReferenceDb)。 */
  ref: Queryable;
  cfg: ScoringConfig;
  /** 游戏客户区矩形。 */
  rect: WindowRect;
  /** 本局记忆;同一局的多次扫描共用同一个。 */
  memory: PoolMemory;
  /** pHash 索引(可不给):有则启用「第二意见」与英雄模型图像核对。 */
  index?: IndexEntry[];
}

export interface PoolScanResult {
  snapshot: PoolSnapshot;
  /** 本次扫描的 48 格读数与 12 组定英雄结果(未并入记忆前),供日志核对。 */
  cells: PoolReading["cells"];
  groups: PoolReading["groups"];
  /** 还在池里的技能 valveId(去重,格子顺序)。 */
  pool: number[];
  /** 认定的 12 个英雄模型(负 valveId = -hero_id;未认定的不在内)。 */
  heroes: number[];
  /** 有图标但没认出来的格数(下次扫描会再试)。 */
  unknownCells: number;
  recommendations: ScoredCandidate[];
}

export async function scanPool(
  frames: { rgb: RgbFrame; gray: GrayFrame }, deps: PoolScanDeps,
): Promise<PoolScanResult> {
  const cells = await readPool(frames.rgb, deps.rect, deps.clf);
  const index = deps.index;
  const reading = resolvePool(cells, {
    ownerOf: (name) => deps.lookup.get(name)?.heroId ?? null,
    secondOpinion: index ? phashSecondOpinion(frames.gray, deps.rect, index) : undefined,
    verifyHero: index
      ? (heroPos, heroId) => verifyHeroCandidate(frames.gray, deps.rect, heroPos, -heroId, index)
      : undefined,
  });
  const snapshot = deps.memory.observe(reading);

  const pool: number[] = [];
  const candidates: Candidate[] = [];
  const seen = new Set<number>();
  snapshot.names.forEach((name, i) => {
    if (name === null || !snapshot.available[i]) return;
    const info = deps.lookup.get(name);
    if (info === undefined || seen.has(info.valveId)) return; // 名单里有、库里没有的技能不进打分
    seen.add(info.valveId);
    pool.push(info.valveId);
    candidates.push({ valveId: info.valveId, slotType: info.slotType });
  });
  // 英雄模型也是可选项(负 valveId)。模型是否已被别人选走目前看不出来,先全部当可选。
  const heroes: number[] = [];
  for (const heroId of snapshot.heroes.values()) {
    if (heroId === null || heroes.includes(-heroId)) continue;
    heroes.push(-heroId);
    candidates.push({ valveId: -heroId, slotType: "hero" });
  }
  const unknownCells = snapshot.names.filter((n, i) => n === null && snapshot.available[i]).length;
  const recommendations = recommend(candidates, EMPTY_ME, null, deps.ref, deps.cfg);
  return { snapshot, cells: reading.cells, groups: reading.groups, pool, heroes, unknownCells, recommendations };
}
