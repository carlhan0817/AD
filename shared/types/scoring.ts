// shared/types/scoring.ts
// 打分领域类型(动态 MCDM)。权威规格见 docs/.../打分细则.md。
import type { PlayerState, SlotType } from "./draft";

/** 一个候选(英雄伪技能用负 valveId,真实技能用正)。 */
export interface Candidate {
  valveId: number;
  slotType: SlotType;
}

/** 单技能/英雄的胜率数据行(来自 ability_winrate / hero_winrate)。 */
export interface WinrateRow {
  winrate: number | null;
  avgPickPosition: number | null;
}

/** 神杖/魔晶升级后的独立胜率(来自 ability_aghs)。已是相对基础胜率的「收益差」。 */
export interface AghsRow {
  scepterGain: number | null; // WR_aghs - WR_base
  shardGain: number | null;   // WR_shard - WR_base
  /** 技能有没有神杖/魔晶升级;false 时增益只是「买得起的局本来就优势」,不算绑定。英雄没有这个标记。 */
  hasScepter?: boolean;
  hasShard?: boolean;
}

/** 打分上下文:本人状态 + 已查好的只读数据,注入给各 signal。signal 不碰 DB。 */
export interface ScoringContext {
  /** 当前活动玩家(本人)状态。 */
  me: PlayerState;
  /** 全局第几手(1..50:10 人 × 5 轮,zigzag 顺序,英雄也算一手);未知为 null。 */
  pickIndex: number | null;
  /** 本人的选位(第一轮第几个选,1..10);未知为 null/不给。 */
  seat?: number | null;
  /** 技能 → 同类技能(valveId),搭配数据缺失时用来估分;不给则缺数据按 0 算。 */
  similar?: ReadonlyMap<number, readonly number[]>;
  /** 搭配数据缺失时的估分比例;不给则缺数据按 0 算。 */
  pairFallback?: PairFallback;
  /** valveId → 胜率行。 */
  winrate: Map<number, WinrateRow>;
  /** "a|b"(a<b 的 valveId 对,字符串键)→ pair 胜率。 */
  pairWinrate: Map<string, number>;
  /** valveId → 神杖/魔晶收益。 */
  aghs: Map<number, AghsRow>;
}

/** SignalId:对齐 打分细则.md §2 的五个信号。可扩展。 */
export type SignalId =
  | "base"     // 单技能/英雄基础胜率
  | "synergy"  // 平均协同
  | "pos"      // tanh 选取位置稀缺度
  | "aghs"     // 神杖增益
  | "shard"    // 魔晶增益
  // 扩展位(后续按同一注册表模式接入,不改 score()):
  | "snipe"
  | "teammate_protect";

/** 一个打分维度:纯函数,返回该候选在该维度的**原始分**(未加权)。 */
export type Signal = (ctx: ScoringContext, candidate: Candidate) => number;

/** 搭配数据缺失时,用「单技能强度」和「同类技能的搭配」按这个比例估分。 */
export interface PairFallback {
  single: number;
  similar: number;
}

/** 神杖/魔晶绑定的参数。几乎所有技能买了神杖胜率都更高(买得起的局本来就优势),所以要减基准。 */
export interface AghsBinding {
  aghsBaseline: number;
  shardBaseline: number;
  /** 超出基准多少算「绑定」,用来数已选件里有几个绑定的。 */
  bindMin: number;
  aghsStackBonus: number;
  shardStackBonus: number;
  stackCap: number;
}

/** 打分配置:基础权重 w⁰ + 动态调节系数。可由 JSON 加载(细则 §3「参数推荐配置」)。 */
export interface ScoringConfig {
  /** 各维度基础权重 w_i⁰。缺省/0 = 关闭该维度。 */
  baseWeights: Partial<Record<SignalId, number>>;
  /** 前置位对高胜率单核的激进提权(默认 0.5)。 */
  alpha: number;
  /** 后置位对神杖流体系的激进提权(默认 0.4)。 */
  beta: number;
  /** pos 信号 tanh 平滑因子 σ(默认 10)。 */
  sigma: number;
  /** 第一轮的玩家数(f_front/f_back 的边界窗;默认 10)。 */
  firstRoundSize: number;
  /** 最终返回的 Top-K(默认 4,即 3~4)。 */
  topK: number;
  /** 按轮次(1..5)的权重表:单技能/英雄逐轮递减,搭配逐轮上升。给了就取代 alpha/beta 的动态规则。 */
  roundWeights?: { base: number[]; synergy: number[]; aghs?: number[]; shard?: number[] };
  /** 神杖/魔晶绑定:给了 aghsBinding 就按「超出基准的增益 × 叠加」算,否则用原始增益。 */
  aghsBinding?: AghsBinding;
  /** 选位修正(预留,默认 0):第一个选时 base 权重乘 (1+该值),第十个选时不变,中间线性。 */
  seatBaseBonus?: number;
  /** 搭配数据缺失时的估分比例。 */
  pairFallback?: PairFallback;
}

/** 打分结果。breakdown 保留各维度贡献(w·S),供 overlay/解释层 grounded 展示。 */
export interface ScoredCandidate {
  candidate: Candidate;
  score: number;
  breakdown: Partial<Record<SignalId, number>>;
}
