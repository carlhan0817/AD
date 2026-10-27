// core/tests/recognition/pool_heroes.test.ts
import { describe, it, expect } from "vitest";
import { groupHeroes } from "../../src/recognition/pool_heroes";
import type { CellRead } from "../../src/recognition/pool_classify";

// 技能名约定 "<英雄id>_<x>":所属英雄就是前缀数字。
const ownerOf = (name: string): number | null => {
  const n = Number(name.split("_")[0]);
  return Number.isNaN(n) ? null : n;
};

function cell(hero: number, slot: number, name: string | null, empty = false): CellRead {
  return {
    slot: { x: 0, y: 0, w: 1, h: 1, zone: slot === 0 ? "ultimate" : "standard", hero, slot },
    empty, name, guess: name, confidence: name === null ? 0 : 1,
  };
}
/** 一组:3 个普通格 + 1 个终极格。 */
function group(hero: number, s1: string | null, s2: string | null, s3: string | null, ult: string | null): CellRead[] {
  return [cell(hero, 0, ult), cell(hero, 1, s1), cell(hero, 2, s2), cell(hero, 3, s3)];
}

describe("groupHeroes", () => {
  it("4 格同英雄 → three_standard", () => {
    const [g] = groupHeroes(group(0, "7_a", "7_b", "7_c", "7_u"), ownerOf);
    expect([g.heroId, g.rule]).toEqual([7, "three_standard"]);
  });

  it("少终极的英雄(终极格是外人)→ 仍由 3 个普通技能认定", () => {
    const [g] = groupHeroes(group(3, "86_a", "86_b", "86_c", "99_u"), ownerOf);
    expect([g.heroId, g.rule]).toEqual([86, "three_standard"]);
  });

  it("少 1 个普通技能的英雄:2 普通 + 终极同英雄 → two_standard_plus_ultimate", () => {
    const [g] = groupHeroes(group(5, "76_a", "76_b", "94_x", "76_u"), ownerOf);
    expect([g.heroId, g.rule]).toEqual([76, "two_standard_plus_ultimate"]);
  });

  it("morphling:2 个本人技能 + 2 个外人 → 不直接认定,给出候选待图像核对", () => {
    const [g] = groupHeroes(group(8, "10_waveform", "10_adaptive", "55_x", "66_u"), ownerOf);
    expect(g.heroId).toBeNull();
    expect([g.candidate, g.rule]).toEqual([10, "needs_image_check"]);
  });

  it("morphling 的两个外人恰好同英雄(2 比 2)→ 仍不直接认定,候选是普通格占多的那个", () => {
    const [g] = groupHeroes(group(8, "10_waveform", "10_adaptive", "55_x", "55_u"), ownerOf);
    expect(g.heroId).toBeNull();
    expect([g.candidate, g.rule]).toEqual([10, "needs_image_check"]);
  });

  it("1 普通 + 终极同英雄 → 只有 2 格,待核对", () => {
    const [g] = groupHeroes(group(1, "7_a", null, null, "7_u"), ownerOf);
    expect([g.heroId, g.candidate, g.rule]).toEqual([null, 7, "needs_image_check"]);
  });

  it("没认出来的格(name=null)不参与投票;凑不齐 2 格 → unknown", () => {
    const [g] = groupHeroes(group(2, "7_a", null, null, null), ownerOf);
    expect([g.heroId, g.candidate, g.rule]).toEqual([null, null, "unknown"]);
  });

  it("查不到所属英雄的技能不参与投票", () => {
    const [g] = groupHeroes(group(2, "7_a", "7_b", "nobody", "7_u"), ownerOf);
    expect([g.heroId, g.rule]).toEqual([7, "two_standard_plus_ultimate"]);
  });

  it("48 格 → 12 组,按位置编号升序,组内普通格在前终极在后", () => {
    const cells: CellRead[] = [];
    for (let h = 11; h >= 0; h--) cells.push(...group(h, `${h + 1}_a`, `${h + 1}_b`, `${h + 1}_c`, `${h + 1}_u`));
    const groups = groupHeroes(cells, ownerOf);
    expect(groups.map((g) => g.hero)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(groups.map((g) => g.heroId)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(groups[0].cells.map((c) => c.slot.slot)).toEqual([1, 2, 3, 0]);
  });
});
