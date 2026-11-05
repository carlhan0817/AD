// core/src/autoscan/turn_lock.ts
// 轮到我时的推荐锁:本回合内推荐刷新一次后就锁住,免得鼠标晃动/读数抖动让推荐来回跳。
// 规则:首次读数就推;若首次不完整,允许之后第一次完整读数再推一次,然后锁死。
// 解锁:我的卡多一格(我选完了),或明确轮到别人。activeRow 读成 null 不解锁;myRow 为 null 不锁。
// 「hold」= 调用方这次别把推荐推给悬浮窗。

export interface TurnReading {
  myRow: number | null;
  activeRow: number | null;
  myPickCount: number;
  /** 没有没认出的池格,且我的卡没有没认出的格;由调用方算。 */
  complete: boolean;
}

export class TurnLock {
  private inTurn = false;
  /** 本回合是否已经推过一次(不管完整与否)。 */
  private pushed = false;
  /** 本回合是否已经推过完整读数(之后锁死)。 */
  private done = false;
  /** 本回合开始时我的卡数。 */
  private turnPick = 0;
  /** 我选完后屏幕可能还停在我这一行:等 activeRow 换到别的行之前不开新回合。 */
  private awaitLeave = false;

  decide(r: TurnReading, manual: boolean): "push" | "hold" {
    if (r.myRow === null) return "push";

    // 我选完了:结束本回合,屏幕没推进前一律推
    if (this.inTurn && r.myPickCount > this.turnPick) {
      this.endTurn();
      this.awaitLeave = true;
      return "push";
    }

    // 明确轮到别人:解锁,允许下次再轮到我时开新回合
    if (r.activeRow !== null && r.activeRow !== r.myRow) {
      this.endTurn();
      this.awaitLeave = false;
      return "push";
    }

    // activeRow 读成 null:既不开始也不结束回合
    if (r.activeRow === null) {
      return manual || !this.inTurn ? "push" : "hold";
    }

    // 到这里 activeRow === myRow
    if (this.awaitLeave) return "push";

    if (!this.inTurn) {
      this.inTurn = true;
      this.pushed = false;
      this.done = false;
      this.turnPick = r.myPickCount;
    }

    if (manual) {
      this.pushed = true;
      if (r.complete) this.done = true;
      return "push";
    }
    if (r.complete) {
      if (this.done) return "hold";
      this.done = true;
      this.pushed = true;
      return "push";
    }
    if (this.pushed) return "hold";
    this.pushed = true;
    return "push";
  }

  /** 新的一局开始时调用。 */
  reset(): void {
    this.endTurn();
    this.awaitLeave = false;
  }

  private endTurn(): void {
    this.inTurn = false;
    this.pushed = false;
    this.done = false;
    this.turnPick = 0;
  }
}
