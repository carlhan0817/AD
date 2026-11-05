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

  it("myPickCount 增加解锁(push),且屏幕没推进时仍 push,直到换人再回来", () => {
    const t = new TurnLock();
    t.decide(r(2, true, 3), false);
    expect(t.decide(r(2, true, 4), false)).toBe("push");
    // 屏幕还没推进:activeRow 仍是我
    expect(t.decide(r(2, true, 4), false)).toBe("push");
    expect(t.decide(r(2, true, 5), false)).toBe("push");
    expect(t.decide(r(null, true, 5), false)).toBe("push");
    // 换到别人再回来才算新回合
    expect(t.decide(r(3, true, 5), false)).toBe("push");
    expect(t.decide(r(2, true, 5), false)).toBe("push");
    expect(t.decide(r(2, true, 5), false)).toBe("hold");
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
});
