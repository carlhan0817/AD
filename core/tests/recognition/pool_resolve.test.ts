// core/tests/recognition/pool_resolve.test.ts
import { describe, it, expect } from "vitest";
import { resolvePool } from "../../src/recognition/pool_resolve";
import { PoolMemory, NEW_DRAFT_MISMATCH } from "../../src/recognition/pool_memory";
import type { CellRead } from "../../src/recognition/pool_classify";

// 技能名约定 "<英雄id>_<x>":所属英雄就是前缀数字。
const ownerOf = (name: string): number | null => {
  const n = Number(name.split("_")[0]);
  return Number.isNaN(n) ? null : n;
};

/** name=采信的名字;guess=最像的名字(不确定格 name 为 null 但 guess 有值)。 */
function cell(hero: number, slot: number, name: string | null, guess: string | null = name, empty = false): CellRead {
  return {
    slot: { x: 0, y: 0, w: 1, h: 1, zone: slot === 0 ? "ultimate" : "standard", hero, slot },
    empty, name, guess, confidence: name !== null ? 1 : guess !== null ? 0.6 : 0,
  };
}
const EMPTY = (hero: number, slot: number) => cell(hero, slot, null, null, true);

describe("resolvePool — 救回不确定的格", () => {
  it("最像的答案属于本组英雄 → 采信", () => {
    // 组由 3 个普通技能认定为 7;终极格不确定但最像 7_x → 救回
    const r = resolvePool([cell(0, 0, null, "7_x"), cell(0, 1, "7_a"), cell(0, 2, "7_b"), cell(0, 3, "7_c")], { ownerOf });
    expect(r.cells[0].name).toBe("7_x");
  });

  it("最像的答案是外人、也没有第二意见 → 保持不确定", () => {
    const r = resolvePool([cell(0, 0, null, "99_u"), cell(0, 1, "7_a"), cell(0, 2, "7_b"), cell(0, 3, "7_c")], { ownerOf });
    expect(r.cells[0].name).toBeNull();
  });

  it("外人格(别的英雄填进来的技能)与第二意见一致 → 采信", () => {
    const r = resolvePool(
      [cell(0, 0, null, "99_u"), cell(0, 1, "7_a"), cell(0, 2, "7_b"), cell(0, 3, "7_c")],
      { ownerOf, secondOpinion: (i) => (i === 0 ? "99_u" : null) },
    );
    expect(r.cells[0].name).toBe("99_u");
  });

  it("第二意见与最像的答案不同 → 不采信", () => {
    const r = resolvePool(
      [cell(0, 0, null, "99_u"), cell(0, 1, "7_a"), cell(0, 2, "7_b"), cell(0, 3, "7_c")],
      { ownerOf, secondOpinion: () => "55_u" },
    );
    expect(r.cells[0].name).toBeNull();
  });

  it("已采信的格与空格不动", () => {
    const r = resolvePool(
      [EMPTY(0, 0), cell(0, 1, "7_a"), cell(0, 2, "7_b"), cell(0, 3, "7_c")],
      { ownerOf, secondOpinion: () => "1_z" },
    );
    expect(r.cells.map((c) => c.name)).toEqual([null, "7_a", "7_b", "7_c"]);
    expect(r.cells[0].empty).toBe(true);
  });

  it("救回后重新分组:第二意见救回一格,让该组凑够 3 个普通技能", () => {
    const r = resolvePool(
      [cell(0, 0, "99_u"), cell(0, 1, "7_a"), cell(0, 2, "7_b"), cell(0, 3, null, "7_c")],
      { ownerOf, secondOpinion: (i) => (i === 3 ? "7_c" : null) },
    );
    expect([r.groups[0].heroId, r.groups[0].rule]).toEqual([7, "three_standard"]);
  });
});

describe("resolvePool — 只有 2 格同英雄时的图像核对", () => {
  const morph = [cell(8, 0, "66_u"), cell(8, 1, "10_waveform"), cell(8, 2, "10_adaptive"), cell(8, 3, "55_x")];

  it("核对通过 → 认定,规则标 image_verified", () => {
    const seen: [number, number][] = [];
    const r = resolvePool(morph, { ownerOf, verifyHero: (pos, id) => { seen.push([pos, id]); return true; } });
    expect([r.groups[0].heroId, r.groups[0].rule]).toEqual([10, "image_verified"]);
    expect(seen).toEqual([[8, 10]]); // 只核对这一个候选
  });

  it("核对不通过 → 不认定", () => {
    const r = resolvePool(morph, { ownerOf, verifyHero: () => false });
    expect([r.groups[0].heroId, r.groups[0].rule]).toEqual([null, "needs_image_check"]);
  });

  it("没提供核对手段 → 不认定;已认定的组不会去核对", () => {
    expect(resolvePool(morph, { ownerOf }).groups[0].heroId).toBeNull();
    let called = 0;
    resolvePool([cell(0, 0, "7_u"), cell(0, 1, "7_a"), cell(0, 2, "7_b"), cell(0, 3, "7_c")],
      { ownerOf, verifyHero: () => { called++; return true; } });
    expect(called).toBe(0);
  });
});

describe("PoolMemory — 满池认一次并记住", () => {
  const full = () => resolvePool(
    [cell(0, 0, "7_u"), cell(0, 1, "7_a"), cell(0, 2, "7_b"), cell(0, 3, null, "99_x")], { ownerOf });

  it("第一次扫描:记下名字、英雄、是否还在池里", () => {
    const s = new PoolMemory().observe(full());
    expect(s.names).toEqual(["7_u", "7_a", "7_b", null]);
    expect(s.available).toEqual([true, true, true, true]);
    expect(s.heroes.get(0)).toBe(7);
    expect(s.reset).toBe(false);
  });

  it("后来某格变空(被选走):名字保留,available 变 false", () => {
    const m = new PoolMemory();
    m.observe(full());
    const s = m.observe(resolvePool(
      [cell(0, 0, "7_u"), EMPTY(0, 1), cell(0, 2, "7_b"), cell(0, 3, null, "99_x")], { ownerOf }));
    expect(s.names[1]).toBe("7_a");
    expect(s.available[1]).toBe(false);
  });

  it("之前没认出来的格,后来认出来了 → 补上", () => {
    const m = new PoolMemory();
    m.observe(full());
    const s = m.observe(resolvePool(
      [cell(0, 0, "7_u"), cell(0, 1, "7_a"), cell(0, 2, "7_b"), cell(0, 3, "99_x")], { ownerOf }));
    expect(s.names[3]).toBe("99_x");
  });

  it("已认出来的格不被后来的(零星)不同读数改掉;英雄也不被改掉", () => {
    const m = new PoolMemory();
    m.observe(full());
    const s = m.observe(resolvePool(
      [cell(0, 0, "7_u"), cell(0, 1, "55_zzz"), EMPTY(0, 2), EMPTY(0, 3)], { ownerOf }));
    expect(s.names[1]).toBe("7_a");
    expect(s.heroes.get(0)).toBe(7);
    expect(s.reset).toBe(false);
  });

  it(`认出来的格有 ${NEW_DRAFT_MISMATCH} 个以上和记忆不同 → 判为新的一局,清空重记`, () => {
    const m = new PoolMemory();
    const draft = (h: number) => resolvePool([
      cell(0, 0, `${h}_u`), cell(0, 1, `${h}_a`), cell(0, 2, `${h}_b`), cell(0, 3, `${h}_c`),
    ], { ownerOf });
    m.observe(draft(7));
    const s = m.observe(draft(8));
    expect(s.reset).toBe(true);
    expect(s.names).toEqual(["8_u", "8_a", "8_b", "8_c"]);
    expect(s.heroes.get(0)).toBe(8);
  });
});
