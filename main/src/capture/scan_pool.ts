// main/src/capture/scan_pool.ts
// 手动扫一次(新识别层):一帧 → 判空 + 分类器认 48 格 → 按组定英雄、救回不确定格
// → 并入本局记忆(已认出的不再改)→ 读玩家卡(我是谁、我已选了什么、我的英雄)
// → 还在池里的技能 + 还能选的英雄 → 按「我」的上下文打分排名。
// 有意绕过 runMonitorLoop 的 4 道门(手动是过渡形态,门控代码保留给以后的自动扫描)。
// 见 docs/superpowers/plans/2026-10-03-recognition-rework.md。
import { readPool } from "@ad/core/recognition/pool_classify";
import { resolvePool, type PoolReading } from "@ad/core/recognition/pool_resolve";
import { phashSecondOpinion } from "@ad/core/recognition/pool_second_opinion";
import { verifyHeroCandidate } from "@ad/core/recognition/hero_recognize";
import { readHeroTiles, type HeroTiles } from "@ad/core/recognition/hero_taken";
import { findActiveRow, findMyRow, readCardPicks, type CardPicks } from "@ad/core/recognition/card_reading";
import { identifyPortrait } from "@ad/core/recognition/hero_portrait";
import { playerCards } from "@ad/core/recognition/player_cards";
import { screenLayoutFor } from "@ad/core/recognition/screen_layout";
import { highlightsFor } from "@ad/core/recognition/highlight";
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
import type { Highlight } from "@ad/shared/types/ipc";
import type { WindowRect } from "../ffi/geometry";

// 选人界面判定:主菜单、加载画面这类帧绝不能进本局记忆(真机:一张主菜单帧留下 20 个假空格,
// 还把真实技能的名字占住了)。三条都满足才算选人界面:
//   - 有图标的格里,至少一半认得出。50 帧实测:选人界面最低 0.77(说明框盖住几格),主菜单 0.07;
//   - 空格数和卡上已选技能数差得不多。选人界面上两者相等或只差说明框盖住的几格(这条是兜底,
//     主菜单的差距只有 6,挡不住它);
//   - 找得到我的绿色外框,或者这局已经认出过我(主菜单找不到)。
// 选到最后池子只剩几格时,说明框可能把识别率压到一半以下,这一帧会被跳过;再扫一次就好,不会写坏记忆。
const DRAFT_MIN_READ_SHARE = 0.5;
const DRAFT_MAX_EMPTY_CARD_GAP = 8;

// 10 人 × 5 轮 = 50 手,zigzag 顺序,英雄也算一手(真机:坐第一个选的人依次是第 1、20、21、40、41 手)。
const TOTAL_PICKS = 50;

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
  /** 技能 → 同类技能(buildSimilarMap),搭配数据缺失时用。 */
  similar?: ReadonlyMap<number, readonly number[]>;
  /** 某英雄选取立绘的比对变体(portraitVariants);给了才认「我」卡上的英雄。 */
  heroPortraits?: (heroId: number) => Promise<Float32Array[] | null>;
}

export interface PoolScanResult {
  /** 这一帧是不是选人界面;不是的话什么都没写进记忆,其余字段都是空的。 */
  onDraftScreen: boolean;
  /** 客户区宽高比不在六类支持范围内:这次没扫(onDraftScreen 也是 false),带上实际宽高给提示和日志用。 */
  unsupportedRatio?: { width: number; height: number };
  /** 每个英雄格的饱和度/标准差(日志用)。 */
  heroTileStats: HeroTiles["stats"];
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
  /** 推荐在技能池上对应的格子。 */
  highlights: Highlight[];
  /** 第几手(1..50,英雄也算)。 */
  pickIndex: number;
  /** 我的选位(第一轮第几个选,1..10);还没轮到过我时不知道,为 null。 */
  seat: number | null;
  recommendations: ScoredCandidate[];
}

export async function scanPool(
  frames: { rgb: RgbFrame; gray: GrayFrame }, deps: PoolScanDeps,
): Promise<PoolScanResult> {
  // 比例不支持:什么都不读、不碰分类器、不碰记忆(窗口被拖成怪比例的那一次也一样)。
  if (screenLayoutFor(deps.rect) === null) {
    return {
      onDraftScreen: false, unsupportedRatio: { width: deps.rect.width, height: deps.rect.height }, heroTileStats: [],
      snapshot: { names: [], available: [], heroes: new Map(), takenHeroes: new Set(), reset: false },
      cells: [], groups: [], pool: [], heroes: [], takenHeroes: [], unknownCells: 0,
      myRow: deps.memory.myRow, activeRow: null, me: { row: deps.memory.myRow ?? 0, hero: null, normals: [], ultimates: [] },
      myPicks: null, highlights: [], pickIndex: 1, seat: deps.memory.mySeat, recommendations: [],
    };
  }
  const cells = await readPool(frames.rgb, deps.rect, deps.clf);
  const cards = await readCardPicks(frames.rgb, deps.rect, deps.clf);
  const tiles = readHeroTiles(frames.rgb, deps.rect);
  const live = cells.filter((c) => !c.empty);
  const read = live.filter((c) => c.name !== null).length;
  const onCard = cards.reduce((n, c) => n + c.normals.length + (c.ultimate === null ? 0 : 1) + c.unknown, 0);
  const seenMe = findMyRow(frames.rgb, deps.rect);
  const onDraftScreen = live.length > 0 && read / live.length >= DRAFT_MIN_READ_SHARE
    && Math.abs(cells.length - live.length - onCard) <= DRAFT_MAX_EMPTY_CARD_GAP
    && (seenMe !== null || deps.memory.myRow !== null);
  if (!onDraftScreen) {
    return {
      onDraftScreen, heroTileStats: tiles.stats,
      snapshot: { names: [], available: [], heroes: new Map(), takenHeroes: new Set(), reset: false },
      cells: [], groups: [], pool: [], heroes: [], takenHeroes: [], unknownCells: 0,
      myRow: deps.memory.myRow, activeRow: null, me: { row: deps.memory.myRow ?? 0, hero: null, normals: [], ultimates: [] },
      myPicks: null, highlights: [], pickIndex: 1, seat: deps.memory.mySeat, recommendations: [],
    };
  }
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
  // 卡上有的技能才算确实被选走(说明框盖住的格子也会显得空)。
  const onCards = new Set(cards.flatMap((c) => [...c.normals, ...(c.ultimate ? [c.ultimate] : [])]));
  const snapshot = deps.memory.observe(reading, tiles.taken, (n) => onCards.has(n), tiles.colored);

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
  deps.memory.rememberMyRow(seenMe);
  const myRow = deps.memory.myRow;
  const activeRow = findActiveRow(frames.rgb, deps.rect);
  let myPicks: CardPicks | null = null;
  const me: PlayerState = { row: myRow ?? 0, hero: null, normals: [], ultimates: [] };
  if (myRow !== null) {
    // 只采信本局池子里出现过的技能。
    const inPool = new Set(snapshot.names.filter((n): n is string => n !== null));
    const raw = cards[myRow];
    // 类型查技能本身,不看它落在卡上哪一格(见 CardPicks 的注释)。
    const onMyCard = [...raw.normals, ...(raw.ultimate !== null ? [raw.ultimate] : [])];
    const known = onMyCard.filter((n) => inPool.has(n) && deps.lookup.has(n));
    const normals = known.filter((n) => deps.lookup.get(n)!.slotType === "normal");
    const ultimates = known.filter((n) => deps.lookup.get(n)!.slotType === "ultimate");
    myPicks = { ...raw, normals, ultimate: ultimates[0] ?? null, unknown: raw.unknown + onMyCard.length - known.length };
    me.normals.push(...normals.map((n) => deps.lookup.get(n)!.valveId));
    me.ultimates.push(...ultimates.map((n) => deps.lookup.get(n)!.valveId));
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
  const abilitiesGone = snapshot.available.filter((v) => !v).length;
  const pickIndex = Math.min(TOTAL_PICKS, abilitiesGone + takenHeroes.size + 1);
  // 轮到我的时候才知道我的选位:奇数轮正序,偶数轮倒序(zigzag)。
  if (activeRow !== null && activeRow === myRow) {
    const round = Math.ceil(pickIndex / 10), inRound = pickIndex - (round - 1) * 10;
    deps.memory.rememberMySeat(round % 2 === 1 ? inRound : 11 - inRound);
  }
  const seat = deps.memory.mySeat;
  // 认出了「我」才用上下文(已选技能、配额、第几手);认不出时 pickIndex 也不用,免得按错的人推荐。
  // 技能与英雄分开取:技能取前 topK−1 个,英雄(还没选英雄时)取最好的 1 个,再合起来按分数排,
  // 这样分类需求把英雄抬高时,英雄也能排第一。
  const pi = myRow === null ? null : pickIndex;
  const extras = { seat, similar: deps.similar };
  const bestHero = recommend(candidates.filter((c) => c.slotType === "hero"), me, pi, deps.ref, deps.cfg, extras).slice(0, 1);
  const abilityCount = Math.max(1, deps.cfg.topK - bestHero.length);
  const abilityRecs = recommend(candidates.filter((c) => c.slotType !== "hero"), me, pi, deps.ref, { ...deps.cfg, topK: abilityCount }, extras);
  const recommendations = [...abilityRecs, ...bestHero].sort((a, b) => b.score - a.score);
  const highlights = highlightsFor(
    recommendations.map((r) => r.candidate.valveId), deps.rect,
    (id) => {
      const i = snapshot.names.findIndex((n, k) => snapshot.available[k] && n !== null && deps.lookup.get(n)?.valveId === id);
      return i < 0 ? null : i;
    },
    (id) => {
      for (const [pos, heroId] of snapshot.heroes) if (heroId === -id) return pos;
      return null;
    },
  );
  return {
    onDraftScreen, heroTileStats: tiles.stats, highlights, snapshot, cells: reading.cells, groups: reading.groups, pool, heroes,
    takenHeroes: [...takenHeroes].sort((a, b) => a - b), unknownCells,
    myRow, activeRow, me, myPicks, pickIndex, seat, recommendations,
  };
}
