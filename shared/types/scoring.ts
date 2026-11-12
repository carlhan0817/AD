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
  /** 多大比例的对局里它被人选走(0..1);没有数据为空。 */
  pickRate?: number | null;
}

/** 英雄的主属性和近战/远程(来自 models/heroes/hero_attrs.json)。 */
export interface HeroAttr {
  attr: "str" | "agi" | "int" | "uni";
  ranged: boolean;
}

/** 某技能在某一类英雄上的胜率(来自 ability_hero_attr)。 */
export interface AttrWinrate { winrate: number; picks: number; }

/** 单技能强度按我的英雄修正:技能在「近战/远程」和「主属性」这两类英雄上的胜率,
 *  各自与总体胜率的差,按样本量打折后按比例加到单技能强度上。 */
export interface HeroFit { range: number; attr: number; shrinkN: number; }

/** 搭配按「增益」算:组合胜率 − 两个单件应有的胜率,再按样本量打折(样本数 / (样本数 + shrinkN))。 */
export interface SynergyLift { shrinkN: number; }

/** 向前看:候选和池里还在的某一件有强组合时,按「那一件能留到我下一手的概率」给候选加分。
 *  discount 是整体折扣(下一手不一定真会拿它);sigma 是「一件东西大概在第几手被选走」的离散程度。 */
export interface ComboLookahead { discount: number; sigma: number; }

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
  /** 搭配分只取已选里最配的几件求平均;不给则对全部已选求平均。 */
  synergyTopN?: number;
  /** valveId → 胜率行。 */
  winrate: Map<number, WinrateRow>;
  /** "a|b"(a<b 的 valveId 对,字符串键)→ pair 胜率。 */
  pairWinrate: Map<string, number>;
  /** valveId → 神杖/魔晶收益。 */
  aghs: Map<number, AghsRow>;
  /** "a|b" → 这个组合的样本数(搭配按增益算时用来打折)。 */
  pairPicks?: Map<string, number>;
  /** 技能 valveId → 各类英雄(melee/ranged/str/agi/int/uni)上的胜率。 */
  attrWinrate?: Map<number, Record<string, AttrWinrate>>;
  /** 英雄 valveId(负数)→ 主属性和近战/远程。 */
  heroAttrs?: ReadonlyMap<number, HeroAttr>;
  /** 给了就按我的英雄修正单技能强度。 */
  heroFit?: HeroFit;
  /** 给了就按增益算搭配。 */
  synergyLift?: SynergyLift;
  /** 给了(且有 pool)就向前看池里的组合。 */
  comboLookahead?: ComboLookahead;
  /** 池里还在的全部候选(英雄和技能都算),向前看用。 */
  pool?: readonly Candidate[];
}

/** SignalId:对齐 打分细则.md §2 的五个信号。可扩展。 */
export type SignalId =
  | "base"     // 单技能/英雄基础胜率
  | "synergy"  // 平均协同
  | "pos"      // tanh 选取位置稀缺度
  | "aghs"     // 神杖增益
  | "shard"    // 魔晶增益
  | "need"     // 分类需求:还没选的类型(英雄/大招)逐轮加分
  | "combo"    // 向前看:和池里还在的另一件的组合
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
  /** 分类需求:某类型还有配额时,第 1~5 轮加的分。配额满的类型在硬过滤里已剔除。 */
  categoryNeed?: Record<SlotType, number[]>;
  /** 神杖/魔晶绑定:给了 aghsBinding 就按「超出基准的增益 × 叠加」算,否则用原始增益。 */
  aghsBinding?: AghsBinding;
  /** 选位修正(预留,默认 0):第一个选时 base 权重乘 (1+该值),第十个选时不变,中间线性。 */
  seatBaseBonus?: number;
  /** 搭配数据缺失时的估分比例。 */
  pairFallback?: PairFallback;
  /** 搭配分只取已选里最配的几件求平均(默认 2):配得差的已选件不再稀释配得好的。 */
  synergyTopN?: number;
  /** 单技能强度按我的英雄修正;不给就不修正。 */
  heroFit?: HeroFit;
  /** 搭配按增益算(并把最配的几件相加而不是求平均);不给就用原始搭配胜率。 */
  synergyLift?: SynergyLift;
  /** 向前看池里的组合;不给就不看。要配合 baseWeights.combo 才生效。 */
  comboLookahead?: ComboLookahead;
}

/** 打分结果。breakdown 保留各维度贡献(w·S),供 overlay/解释层 grounded 展示。 */
export interface ScoredCandidate {
  candidate: Candidate;
  score: number;
  breakdown: Partial<Record<SignalId, number>>;
}
