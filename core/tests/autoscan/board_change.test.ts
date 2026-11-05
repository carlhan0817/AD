// core/tests/autoscan/board_change.test.ts
import { describe, it, expect } from "vitest";
import { boardSignature, boardChanged, SettleGate, type BoardSignature } from "../../src/autoscan/board_change";
import { poolSlots } from "../../src/recognition/pool_slots";
import { heroCellRects } from "../../src/recognition/hero_layout";
import { cardSlots, playerCards } from "../../src/recognition/player_cards";
import type { RgbFrame } from "../../src/recognition/rgb";

const RECT = { x: 0, y: 0, width: 1920, height: 1080 };

/** 灰底帧(不是金色,不会被当成「轮到谁」)。 */
function gray(v = 128): RgbFrame {
  return { width: 1920, height: 1080, data: new Uint8Array(1920 * 1080 * 3).fill(v) };
}
function paint(f: RgbFrame, x0: number, y0: number, x1: number, y1: number, rgb: number[]) {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) f.data.set(rgb, (y * f.width + x) * 3);
}
function sigWith(row: number | null, base?: BoardSignature): BoardSignature {
  const b = base ?? boardSignature(gray(), RECT);
  return { cells: b.cells, activeRow: row };
}

describe("boardChanged", () => {
  it("同一个签名不算变化", () => {
    const s = boardSignature(gray(), RECT);
    expect(boardChanged(s, s)).toBe(false);
  });

  it("池格被涂黑(被选走)算变化", () => {
    const a = boardSignature(gray(), RECT);
    const f = gray();
    const c = poolSlots(RECT)[20];
    paint(f, c.x, c.y, c.x + c.w, c.y + c.h, [0, 0, 0]);
    expect(boardChanged(a, boardSignature(f, RECT))).toBe(true);
  });

  it("英雄格和卡上已选格变化也算", () => {
    const a = boardSignature(gray(), RECT);
    for (const c of [heroCellRects(RECT)[3], cardSlots(RECT)[5]]) {
      const f = gray();
      paint(f, c.x, c.y, c.x + c.w, c.y + c.h, [0, 0, 0]);
      expect(boardChanged(a, boardSignature(f, RECT))).toBe(true);
    }
  });

  it("只改倒计时和卡上徽章(识别区域之外)不算变化", () => {
    const a = boardSignature(gray(), RECT);
    const f = gray();
    // 中央倒计时:池区上方
    paint(f, 880, 20, 1040, 120, [255, 255, 255]);
    // 每张玩家卡里不属于任何识别格的像素(徽章、名字、边框一带)
    const regions = [...poolSlots(RECT), ...heroCellRects(RECT), ...cardSlots(RECT)];
    let painted = 0;
    for (const card of playerCards(RECT)) {
      for (let y = card.y; y < card.y + card.h; y++) for (let x = card.x; x < card.x + card.w; x++) {
        if (regions.some((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h)) continue;
        f.data.set([60, 60, 200], (y * f.width + x) * 3);
        painted++;
      }
    }
    expect(painted).toBeGreaterThan(1000);
    const b = boardSignature(f, RECT);
    expect(boardChanged(a, b)).toBe(false);
  });

  it("卡上已选格出现图标算变化,只是金色卡底出现/消失不算", () => {
    const base = gray(0);
    const slot = cardSlots(RECT)[5];
    const withIcon = gray(0);
    paint(withIcon, slot.x, slot.y, slot.x + slot.w, slot.y + slot.h, [200, 180, 60]);
    expect(boardChanged(boardSignature(base, RECT), boardSignature(withIcon, RECT))).toBe(true);
    // 金卡时空格里透出的暖色(真机约 (16,13,4),原本接近黑)
    const gold = gray(0);
    paint(gold, slot.x, slot.y, slot.x + slot.w, slot.y + slot.h, [16, 13, 4]);
    expect(boardChanged(boardSignature(base, RECT), boardSignature(gold, RECT))).toBe(false);
  });

  it("activeRow:3→4 算变化;3→null 不算", () => {
    expect(boardChanged(sigWith(3), sigWith(4))).toBe(true);
    expect(boardChanged(sigWith(3), sigWith(null))).toBe(false);
    expect(boardChanged(sigWith(null), sigWith(3))).toBe(false);
  });
});

describe("SettleGate(放行原因 first / settled / timeout)", () => {
  const A = sigWith(null);
  const f = gray();
  const c = poolSlots(RECT)[0];
  paint(f, c.x, c.y, c.x + c.w, c.y + c.h, [0, 0, 0]);
  const B = boardSignature(f, RECT);
  const f2 = gray();
  const c2 = poolSlots(RECT)[1];
  paint(f2, c2.x, c2.y, c2.x + c2.w, c2.y + c2.h, [0, 0, 0]);
  const C = boardSignature(f2, RECT);

  it("首帧放行,没变化不再放行", () => {
    const g = new SettleGate();
    expect(g.push(A, 0)).toBe("first");
    expect(g.push(A, 1000)).toBeNull();
  });

  it("变化后同一签名连续再推 2 次,第 2 次放行,且只放行一次", () => {
    const g = new SettleGate();
    g.push(A, 0);
    expect(g.push(B, 1000)).toBeNull();
    expect(g.push(B, 2000)).toBeNull();
    expect(g.push(B, 3000)).toBe("settled");
    expect(g.push(B, 4000)).toBeNull();
    expect(g.push(B, 5000)).toBeNull();
  });

  it("一直在变:从变化开始满 3000ms 放行并重新计时", () => {
    const g = new SettleGate();
    g.push(A, 0);
    expect(g.push(B, 0)).toBeNull();   // 变化开始于 now=0
    expect(g.push(C, 1000)).toBeNull();
    expect(g.push(B, 2000)).toBeNull();
    expect(g.push(C, 3000)).toBe("timeout");
    // 重新计时:再变一次要从这之后再等 3000
    expect(g.push(B, 3500)).toBeNull();
    expect(g.push(C, 5000)).toBeNull();
    expect(g.push(B, 5900)).toBeNull();
    expect(g.push(C, 6000)).toBe("timeout");
  });

  it("超时放行后画面静止,再放行一次(读最终局面),之后不再放行", () => {
    const g = new SettleGate();
    g.push(A, 0);
    expect(g.push(B, 0)).toBeNull();
    expect(g.push(C, 1500)).toBeNull();
    expect(g.push(B, 3000)).toBe("timeout");   // 超时强制放行
    expect(g.push(B, 4000)).toBeNull();
    expect(g.push(B, 5000)).toBe("settled");   // 静止 2 帧,再放行一次
    expect(g.push(B, 6000)).toBeNull();
    expect(g.push(B, 7000)).toBeNull();
  });

  it("放行后又一段新变化,静止后再放行一次", () => {
    const g = new SettleGate();
    g.push(A, 0);
    g.push(B, 1000); g.push(B, 2000); g.push(B, 3000);
    expect(g.push(C, 4000)).toBeNull();
    expect(g.push(C, 5000)).toBeNull();
    expect(g.push(C, 6000)).toBe("settled");
  });
});
