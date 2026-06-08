// renderer/src/store.ts
// Zustand:订阅 overlay snapshot,生命周期 = 一局。版本号丢弃过期帧。
import { create } from "zustand";
import type { OverlaySnapshot } from "@ad/shared/types/ipc";

interface OverlayState {
  snapshot: OverlaySnapshot | null;
  applySnapshot: (snap: OverlaySnapshot) => void;
  reset: () => void;
}

export const useOverlayStore = create<OverlayState>((set, get) => ({
  snapshot: null,
  applySnapshot: (snap) => {
    const cur = get().snapshot;
    if (cur && snap.version <= cur.version) return; // 过期/重复帧丢弃
    set({ snapshot: snap });
  },
  reset: () => set({ snapshot: null }),
}));
