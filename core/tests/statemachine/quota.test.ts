// core/tests/statemachine/quota.test.ts
import { describe, it, expect } from "vitest";
import { remainingQuota, isFull, emptyPlayer } from "../../src/statemachine/quota";
import type { PlayerState } from "@ad/shared/types/draft";

describe("quota", () => {
  it("empty player has full remaining quota", () => {
    const p = emptyPlayer(0);
    expect(remainingQuota(p)).toEqual({ hero: 1, normal: 3, ultimate: 1 });
  });

  it("counts used slots toward remaining", () => {
    const p: PlayerState = { row: 0, hero: -9, normals: [5051, 5048], ultimates: [] };
    expect(remainingQuota(p)).toEqual({ hero: 0, normal: 1, ultimate: 1 });
  });

  it("isFull true only when all three quotas exhausted", () => {
    const partial: PlayerState = { row: 0, hero: -9, normals: [1, 2, 3], ultimates: [] };
    const full: PlayerState = { row: 0, hero: -9, normals: [1, 2, 3], ultimates: [99] };
    expect(isFull(partial)).toBe(false);
    expect(isFull(full)).toBe(true);
  });
});
