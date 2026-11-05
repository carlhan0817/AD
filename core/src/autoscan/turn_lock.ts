// core/src/autoscan/turn_lock.ts
// 轮到我时的推荐锁:本回合内推荐刷新一次后就锁住,免得鼠标晃动/读数抖动让推荐来回跳。
// 规则:首次读数就推;若首次不完整,允许之后第一次完整读数再推一次,然后锁死。
// 解锁:我的卡多一格(我选完了),或明确轮到别人。activeRow 读成 null 不解锁;myRow 为 null 不锁。
// 回合按「开始时我坐的行」记:myRow 中途变了(之前认错了座位)就当新回合。
// 「hold」= 调用方这次别把推荐推给悬浮窗。每次 decide 后 lastEvents 给出这次发生的状态变化(写日志用)。

export interface TurnReading {
  myRow: number | null;
  activeRow: number | null;
  myPickCount: number;
  /** 没有没认出的池格,且我的卡没有没认出的格;由调用方算。 */
  complete: boolean;
}

/** new-turn 轮到我的新一手(推);correction 首次不完整,补推一次完整的;locked 本回合第一次不推;
 *  unlocked-my-pick 我的卡多了一格,结束回合;unlocked-other-turn 明确轮到别人,结束回合。 */
export type TurnEvent = "new-turn" | "correction" | "locked" | "unlocked-my-pick" | "unlocked-other-turn";

export class TurnLock {
  private inTurn = false;
  /** 本回合是否已经推过一次(不管完整与否)。 */
  private pushed = false;
  /** 本回合是否已经推过完整读数(之后锁死)。 */
  private done = false;
  /** 本回合是否已经 hold 过(「锁住」只报一次)。 */
  private held = false;
  /** 本回合开始时我的卡数。 */
  private turnPick = 0;
  /** 本回合开始时我坐的行。 */
  private turnRow: number | null = null;
  private events: TurnEvent[] = [];

  /** 最近一次 decide 发生的事件(按发生顺序;没有为空)。 */
  get lastEvents(): readonly TurnEvent[] { return this.events; }

  decide(r: TurnReading, manual: boolean): "push" | "hold" {
    this.events = [];
    if (r.myRow === null) return "push";

    // 座位读数变了:之前的回合是按错的座位记的,作废(不算解锁事件)
    if (this.inTurn && r.myRow !== this.turnRow) this.endTurn();

    // 我选完了:结束本回合。选人是蛇形的,头尾座位会连选两手,activeRow 一直是我,
    // 所以不等换人——往下走,若 activeRow 仍是我,这一读数就以新的选人数为基线开新回合(首次推)
    if (this.inTurn && r.myPickCount > this.turnPick) {
      this.endTurn();
      this.events.push("unlocked-my-pick");
    }

    // 明确轮到别人:解锁,允许下次再轮到我时开新回合
    if (r.activeRow !== null && r.activeRow !== r.myRow) {
      if (this.inTurn) this.events.push("unlocked-other-turn");
      this.endTurn();
      return "push";
    }

    // activeRow 读成 null:既不开始也不结束回合
    if (r.activeRow === null) {
      return manual || !this.inTurn ? "push" : this.hold();
    }

    // 到这里 activeRow === myRow
    if (!this.inTurn) {
      this.inTurn = true;
      this.pushed = false;
      this.done = false;
      this.held = false;
      this.turnPick = r.myPickCount;
      this.turnRow = r.myRow;
      this.events.push("new-turn");
    }

    if (manual) {
      this.pushed = true;
      if (r.complete) this.done = true;
      return "push";
    }
    if (r.complete) {
      if (this.done) return this.hold();
      if (this.pushed) this.events.push("correction");
      this.done = true;
      this.pushed = true;
      return "push";
    }
    if (this.pushed) return this.hold();
    this.pushed = true;
    return "push";
  }

  /** 新的一局开始时调用。 */
  reset(): void {
    this.endTurn();
    this.events = [];
  }

  private hold(): "hold" {
    if (!this.held) { this.held = true; this.events.push("locked"); }
    return "hold";
  }

  private endTurn(): void {
    this.inTurn = false;
    this.pushed = false;
    this.done = false;
    this.held = false;
    this.turnPick = 0;
    this.turnRow = null;
  }
}
