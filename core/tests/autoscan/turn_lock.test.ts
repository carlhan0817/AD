import { describe, it, expect } from "vitest";
import { TurnLock, type TurnReading } from "../../src/autoscan/turn_lock";

const r = (activeRow: number | null, complete: boolean, myPickCount = 3, myRow: number | null = 2): TurnReading => ({
  myRow,
  activeRow,
  myPickCount,
  complete,
});

describe("TurnLock", () => {
  it("myRow 为 null 总是 push", () => {
    const t = new TurnLock();
    expect(t.decide(r(2, true, 3, null), false)).toBe("push");
    expect(t.decide(r(2, true, 3, null), false)).toBe("push");
  });

  it("没轮到我就推", () => {
    const t = new TurnLock();
    expect(t.decide(r(5, true), false)).toBe("push");
    expect(t.decide(r(5, true), false)).toBe("push");
  });

  it("轮到我首次完整 push,之后同回合 hold", () => {
    const t = new TurnLock();
    expect(t.decide(r(2, true), false)).toBe("push");
    expect(t.decide(r(2, true), false)).toBe("hold");
    expect(t.decide(r(2, false), false)).toBe("hold");
  });

  it("首次不完整 push,再不完整 hold,完整 push,再完整 hold", () => {
    const t = new TurnLock();
    expect(t.decide(r(2, false), false)).toBe("push");
    expect(t.decide(r(2, false), false)).toBe("hold");
    expect(t.decide(r(2, true), false)).toBe("push");
    expect(t.decide(r(2, true), false)).toBe("hold");
  });

  it("activeRow 读成 null 不解锁", () => {
    const t = new TurnLock();
    t.decide(r(2, true), false);
    expect(t.decide(r(null, true), false)).toBe("hold");
    expect(t.decide(r(2, true), false)).toBe("hold");
  });

  it("连选两手(蛇形头尾座位):activeRow 一直是我,选数增加即开新回合", () => {
    const t = new TurnLock();
    expect(t.decide(r(2, true, 3), false)).toBe("push");
    expect(t.decide(r(2, true, 3), false)).toBe("hold");
    expect(t.decide(r(2, true, 4), false)).toBe("push");
    expect(t.decide(r(2, true, 4), false)).toBe("hold");
    expect(t.decide(r(2, true, 5), false)).toBe("push");
  });

  it("选数增加时 activeRow 为 null:push,之后轮到我开新回合", () => {
    const t = new TurnLock();
    t.decide(r(2, true, 3), false);
    expect(t.decide(r(null, true, 4), false)).toBe("push");
    expect(t.decide(r(2, true, 4), false)).toBe("push");
    expect(t.decide(r(2, true, 4), false)).toBe("hold");
  });

  it("activeRow 变成别人解锁,再轮到我是新回合", () => {
    const t = new TurnLock();
    t.decide(r(2, true), false);
    expect(t.decide(r(2, true), false)).toBe("hold");
    expect(t.decide(r(3, true), false)).toBe("push");
    expect(t.decide(r(2, true), false)).toBe("push");
    expect(t.decide(r(2, true), false)).toBe("hold");
  });

  it("manual 在锁住时 push,之后同回合自动 hold", () => {
    const t = new TurnLock();
    t.decide(r(2, true), false);
    expect(t.decide(r(2, true), true)).toBe("push");
    expect(t.decide(r(2, true), false)).toBe("hold");
  });

  it("manual 完整读数算本回合完整读数", () => {
    const t = new TurnLock();
    expect(t.decide(r(2, true), true)).toBe("push");
    expect(t.decide(r(2, true), false)).toBe("hold");
  });

  it("manual 不完整时保留一次纠正机会", () => {
    const t = new TurnLock();
    expect(t.decide(r(2, false), true)).toBe("push");
    expect(t.decide(r(2, false), false)).toBe("hold");
    expect(t.decide(r(2, true), false)).toBe("push");
    expect(t.decide(r(2, true), false)).toBe("hold");
  });

  it("reset 后等同全新", () => {
    const t = new TurnLock();
    t.decide(r(2, true), false);
    expect(t.decide(r(2, true), false)).toBe("hold");
    t.reset();
    expect(t.decide(r(2, true), false)).toBe("push");
  });

  describe("事件(写日志用:锁住 / 解锁)", () => {
    it("新的一手 → 锁住 → 轮到别人解锁", () => {
      const t = new TurnLock();
      expect(t.decide(r(2, true), false)).toBe("push");
      expect(t.lastEvents).toEqual(["new-turn"]);
      expect(t.decide(r(2, true), false)).toBe("hold");
      expect(t.lastEvents).toEqual(["locked"]);
      expect(t.decide(r(2, true), false)).toBe("hold");
      expect(t.lastEvents).toEqual([]); // 锁住只报一次
      expect(t.decide(r(3, true), false)).toBe("push");
      expect(t.lastEvents).toEqual(["unlocked-other-turn"]);
      expect(t.decide(r(3, true), false)).toBe("push");
      expect(t.lastEvents).toEqual([]); // 本来就没锁,不再报解锁
    });

    it("首次不完整 → 补刷一次(correction)", () => {
      const t = new TurnLock();
      t.decide(r(2, false), false);
      expect(t.lastEvents).toEqual(["new-turn"]);
      t.decide(r(2, false), false);
      expect(t.lastEvents).toEqual(["locked"]);
      expect(t.decide(r(2, true), false)).toBe("push");
      expect(t.lastEvents).toEqual(["correction"]);
    });

    it("轮到别人时我的选数增加:push,报「我选完了」解锁", () => {
      const t = new TurnLock();
      t.decide(r(2, true, 3), false);
      t.decide(r(2, true, 3), false);
      expect(t.decide(r(7, true, 4), false)).toBe("push");
      expect(t.lastEvents).toEqual(["unlocked-my-pick"]);
    });

    it("选完后新的一手首次不完整:push、hold、push(补刷)", () => {
      const t = new TurnLock();
      t.decide(r(2, true, 3), false);
      expect(t.decide(r(2, false, 4), false)).toBe("push");
      expect(t.lastEvents).toEqual(["unlocked-my-pick", "new-turn"]);
      expect(t.decide(r(2, false, 4), false)).toBe("hold");
      expect(t.decide(r(2, true, 4), false)).toBe("push");
      expect(t.lastEvents).toEqual(["correction"]);
      expect(t.decide(r(2, true, 4), false)).toBe("hold");
    });
  });

  it("回合中途 myRow 变了(上一次认错了座位):当作新回合", () => {
    const t = new TurnLock();
    t.decide(r(2, true, 3, 2), false);
    expect(t.decide(r(2, true, 3, 2), false)).toBe("hold");
    expect(t.decide(r(4, true, 3, 4), false)).toBe("push");
    expect(t.lastEvents).toEqual(["new-turn"]);
    expect(t.decide(r(4, true, 3, 4), false)).toBe("hold");
  });

  it("manual 时 activeRow 读成 null:push", () => {
    const t = new TurnLock();
    t.decide(r(2, true), false);
    expect(t.decide(r(null, true), true)).toBe("push");
  });
});
