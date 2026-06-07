// core/tests/statemachine/types.test.ts
import { describe, it, expect } from "vitest";
import { QUOTA, type DraftState } from "@ad/shared/types/draft";

describe("draft types", () => {
  it("QUOTA encodes 1 hero + 3 normal + 1 ultimate", () => {
    expect(QUOTA).toEqual({ hero: 1, normal: 3, ultimate: 1 });
  });
  it("DraftState shape is usable", () => {
    const s: DraftState = { players: [], activeRow: null };
    expect(s.activeRow).toBeNull();
  });
});
