// app/src/renderer/env.d.ts
import type { OverlaySnapshot } from "@ad/shared/types/ipc";

declare global {
  interface Window {
    adOverlay: {
      onSnapshot: (cb: (snap: OverlaySnapshot) => void) => void;
    };
  }
}
export {};
