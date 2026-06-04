import { describe, it, expect } from "vitest";
import { loadIndex, nearest } from "../../src/recognition/index_store";
import { fileURLToPath } from "node:url";

const fixture = fileURLToPath(new URL("../fixtures/phash_index.json", import.meta.url));

describe("index_store", () => {
  it("loads entries", () => {
    expect(loadIndex(fixture).length).toBe(3);
  });

  it("nearest returns exact match at distance 0", () => {
    const idx = loadIndex(fixture);
    const hit = nearest(idx, "0000000000000000");
    expect(hit?.valveId).toBe(-9);
    expect(hit?.distance).toBe(0);
  });

  it("nearest respects maxDistance, returns null when too far", () => {
    const idx = loadIndex(fixture);
    // 与三者都很远的哈希
    const hit = nearest(idx, "0f0f0f0f0f0f0f0f", 4);
    expect(hit).toBeNull();
  });
});
