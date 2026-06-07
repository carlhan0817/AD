// core/src/statemachine/quota.ts
import { QUOTA, type PlayerState } from "@ad/shared/types/draft";

export interface RemainingQuota { hero: number; normal: number; ultimate: number; }

export function emptyPlayer(row: number): PlayerState {
  return { row, hero: null, normals: [], ultimates: [] };
}

export function remainingQuota(p: PlayerState): RemainingQuota {
  return {
    hero: QUOTA.hero - (p.hero === null ? 0 : 1),
    normal: QUOTA.normal - p.normals.length,
    ultimate: QUOTA.ultimate - p.ultimates.length,
  };
}

export function isFull(p: PlayerState): boolean {
  const r = remainingQuota(p);
  return r.hero === 0 && r.normal === 0 && r.ultimate === 0;
}
