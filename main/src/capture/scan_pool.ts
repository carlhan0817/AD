// main/src/capture/scan_pool.ts
// 手动扫一次(新识别层):一帧 → 判空 + 分类器认 48 格 → 按组定英雄、救回不确定格
// → 并入本局记忆(已认出的不再改)→ 读玩家卡(我是谁、我已选了什么、我的英雄)
// → 还在池里的技能 + 还能选的英雄 → 按「我」的上下文打分排名。
// 取代 scan_once.ts 的 pHash 识别;同样有意绕过 runMonitorLoop 的 4 道门(手动是过渡形态)。
// 见 docs/superpowers/plans/2026-10-03-recognition-rework.md。
import { readPool } from "@ad/core/recognition/pool_classify";
import { resolvePool, type PoolReading } from "@ad/core/recognition/pool_resolve";
import { phashSecondOpinion } from "@ad/core/recognition/pool_second_opinion";
import { verifyHeroCandidate } from "@ad/core/recognition/hero_recognize";
import { takenHeroPositions } from "@ad/core/recognition/hero_taken";
import { findActiveRow, findMyRow, readCardPicks, type CardPicks } from "@ad/core/recognition/card_reading";
import { identifyPortrait } from "@ad/core/recognition/hero_portrait";
import { playerCards } from "@ad/core/recognition/player_cards";
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

// 打分规则里的「第几手」只数技能(1..40,见 打分细则 §2③),= 池里已变空的技能格数 + 1。
const MAX_ABILITY_PICKS = 40;

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
  /** 某英雄选取立绘的比对变体(portraitVariants);给了才认「我」卡上的英雄。 */
  heroPortraits?: (heroId: number) => Promise<Float32Array[] | null>;
}

export interface PoolScanResult {
  snapshot: PoolSnapshot;
  /** 本次扫描的 48 格读数与 12 组定英雄结果(未并入记忆前),供日志核对。 */
  cells: PoolReading["cells"];
  groups: PoolReading["groups"];
  /** 还在池里的技能 valveId(去重,格子顺序)。 */
  pool: number[];
  /** 还能选的英雄模型(负 valveId = -hero_id;未认定的、已被选走的不在内)。 */
  heroes: number[];
  /** 已被选走的英雄位置编号。 */
  takenHeroes: number[];
  /** 有图标但没认出来的格数(下次扫描会再试)。 */
  unknownCells: number;
  /** 「我」坐的行(0–4 左列,5–9 右列);认不出为 null,此时按没选过任何东西的玩家推荐。 */
  myRow: number | null;
  /** 现在轮到哪一行(金色卡);看不出为 null。 */
  activeRow: number | null;
  /** 打分用的「我」:已选英雄与技能(valveId)。 */
  me: PlayerState;
  /** 我卡上读到的技能名(给日志看)。 */
  myPicks: CardPicks | null;
  /** 第几手(只数技能,1..40)。 */
  pickIndex: number;
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
    // 记忆里已经认定过这个位置的英雄,就直接拿来对,不再做慢的图像核对
    // (真机:选到一半时每次扫描会多花 ~0.9 秒在这上面)。
    verifyHero: (heroPos, heroId) => {
      // 只在「对得上」时走捷径:对不上可能是换了一局、记忆还是上一局的,这时照常做图像核对。
      if (deps.memory.knownHero(heroPos) === heroId) return true;
      return index ? verifyHeroCandidate(frames.gray, deps.rect, heroPos, -heroId, index) : false;
    },
  });
  const snapshot = deps.memory.observe(reading, takenHeroPositions(frames.rgb, deps.rect));

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
  // 英雄模型也是可选项(负 valveId);已被选走的模型格会变灰,不再推荐。
  const takenHeroes = snapshot.takenHeroes;
  const heroes: number[] = [];
  for (const [heroPos, heroId] of snapshot.heroes) {
    if (heroId === null || takenHeroes.has(heroPos) || heroes.includes(-heroId)) continue;
    heroes.push(-heroId);
    candidates.push({ valveId: -heroId, slotType: "hero" });
  }
  const unknownCells = snapshot.names.filter((n, i) => n === null && snapshot.available[i]).length;

  // 「我」:坐哪一行(白色标题),卡上已选了什么,选了哪个英雄。一局里认出过就记住。
  deps.memory.rememberMyRow(findMyRow(frames.rgb, deps.rect));
  const myRow = deps.memory.myRow;
  const activeRow = findActiveRow(frames.rgb, deps.rect);
  let myPicks: CardPicks | null = null;
  const me: PlayerState = { row: myRow ?? 0, hero: null, normals: [], ultimates: [] };
  if (myRow !== null) {
    const allowed = new Set(snapshot.names.filter((n): n is string => n !== null));
    myPicks = (await readCardPicks(frames.rgb, deps.rect, deps.clf, allowed))[myRow];
    for (const n of myPicks.normals) { const v = deps.lookup.get(n)?.valveId; if (v !== undefined) me.normals.push(v); }
    if (myPicks.ultimate !== null) { const v = deps.lookup.get(myPicks.ultimate)?.valveId; if (v !== undefined) me.ultimates.push(v); }
    if (deps.memory.myHeroId === null && deps.heroPortraits !== undefined && takenHeroes.size > 0) {
      // 只在本局已被选走的英雄里找(我的英雄一定在其中)。
      const candidates = new Map<number, Float32Array[]>();
      for (const pos of takenHeroes) {
        const id = snapshot.heroes.get(pos);
        if (id == null) continue;
        const v = await deps.heroPortraits(id);
        if (v !== null) candidates.set(id, v);
      }
      if (candidates.size > 0) deps.memory.rememberMyHero(identifyPortrait(frames.rgb, playerCards(deps.rect)[myRow], candidates).heroId);
    }
    if (deps.memory.myHeroId !== null) me.hero = -deps.memory.myHeroId;
  }
  const abilitiesGone = snapshot.names.filter((n, i) => n !== null && !snapshot.available[i]).length;
  const pickIndex = Math.min(MAX_ABILITY_PICKS, abilitiesGone + 1);
  // 认出了「我」才用上下文(已选技能、配额、第几手);认不出时 pickIndex 也不用,免得按错的人推荐。
  // 技能与英雄分开排:英雄在数据里没有「平均第几手被选走」,选位信号对英雄恒为 0,
  // 而前几手时技能的选位信号是负的——混在一起排,第 1 手会全是英雄(真机帧实测)。
  // 所以技能取前 topK−1 个,英雄(还没选英雄时)单独给最好的 1 个,排在最后。
  const pi = myRow === null ? null : pickIndex;
  const bestHero = recommend(candidates.filter((c) => c.slotType === "hero"), me, pi, deps.ref, deps.cfg).slice(0, 1);
  const abilityCount = Math.max(1, deps.cfg.topK - bestHero.length);
  const abilityRecs = recommend(candidates.filter((c) => c.slotType !== "hero"), me, pi, deps.ref, { ...deps.cfg, topK: abilityCount });
  const recommendations = [...abilityRecs, ...bestHero];
  return {
    snapshot, cells: reading.cells, groups: reading.groups, pool, heroes,
    takenHeroes: [...takenHeroes].sort((a, b) => a - b), unknownCells,
    myRow, activeRow, me, myPicks, pickIndex, recommendations,
  };
}
