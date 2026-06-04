import { readFileSync } from "node:fs";
import { hamming } from "./phash";

export interface IndexEntry { valveId: number; shortName: string; phash: string; }
export interface Match { valveId: number; shortName: string; distance: number; }

export function loadIndex(path: string): IndexEntry[] {
  return JSON.parse(readFileSync(path, "utf-8")) as IndexEntry[];
}

export function nearest(
  index: IndexEntry[], queryPhash: string, maxDistance = 10,
): Match | null {
  let best: Match | null = null;
  for (const e of index) {
    const d = hamming(queryPhash, e.phash);
    if (best === null || d < best.distance) {
      best = { valveId: e.valveId, shortName: e.shortName, distance: d };
    }
  }
  if (best === null || best.distance > maxDistance) return null;
  return best;
}
