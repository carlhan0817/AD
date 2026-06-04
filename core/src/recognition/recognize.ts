import { phashFromGray } from "./phash";
import { nearest, type IndexEntry, type Match } from "./index_store";

export function recognizeCell(
  cellGray32: number[][], index: IndexEntry[], maxDistance = 10,
): Match | null {
  return nearest(index, phashFromGray(cellGray32), maxDistance);
}
