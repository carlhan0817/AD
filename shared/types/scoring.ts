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
}

/** 打分上下文:本人状态 + 已查好的只读数据,注入给各 signal。signal 不碰 DB。 */
export interface ScoringContext {
  /** 当前活动玩家(本人)状态。 */
  me: PlayerState;
  /** 本人当前绝对选取顺位 P_curr(全局第几手,1..40);未知为 null。 */
  pickIndex: number | null;
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
}

/** 打分结果。breakdown 保留各维度贡献(w·S),供 overlay/解释层 grounded 展示。 */
export interface ScoredCandidate {
  candidate: Candidate;
  score: number;
  breakdown: Partial<Record<SignalId, number>>;
}
