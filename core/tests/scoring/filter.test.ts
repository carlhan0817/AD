// core/tests/scoring/filter.test.ts
import { describe, it, expect } from "vitest";
import { hardFilter } from "../../src/scoring/filter";
import type { Candidate } from "@ad/shared/types/scoring";
import type { PlayerState } from "@ad/shared/types/draft";

const POOL: Candidate[] = [
  { valveId: -9, slotType: "hero" },
  { valveId: -7, slotType: "hero" },
  { valveId: 5051, slotType: "normal" },
  { valveId: 5052, slotType: "normal" },
  { valveId: 6001, slotType: "ultimate" },
];

describe("hardFilter", () => {
  it("keeps all types when nothing is full", () => {
    const me: PlayerState = { row: 0, hero: null, normals: [], ultimates: [] };
    expect(hardFilter(POOL, me).map((c) => c.valveId).sort()).toEqual([-9, -7, 5051, 5052, 6001].sort());
  });

  it("drops all heroes when hero slot is full", () => {
    const me: PlayerState = { row: 0, hero: -9, normals: [], ultimates: [] };
    const kept = hardFilter(POOL, me);
    expect(kept.some((c) => c.slotType === "hero")).toBe(false);
    expect(kept.some((c) => c.slotType === "normal")).toBe(true);
  });

  it("drops all normals when 3 normals taken; keeps mixed legal rest", () => {
    const me: PlayerState = { row: 0, hero: -9, normals: [1, 2, 3], ultimates: [] };
    const kept = hardFilter(POOL, me);
    expect(kept.every((c) => c.slotType === "ultimate")).toBe(true);
  });

  it("drops ultimates when ultimate slot full", () => {
    const me: PlayerState = { row: 0, hero: null, normals: [], ultimates: [6001] };
    expect(hardFilter(POOL, me).some((c) => c.slotType === "ultimate")).toBe(false);
  });
});
