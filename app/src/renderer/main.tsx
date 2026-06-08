// app/src/renderer/main.tsx
import { createRoot } from "react-dom/client";
import { Overlay } from "@ad/renderer/Overlay";
import { useOverlayStore } from "@ad/renderer/store";

// IPC → store:每收到一帧 snapshot,交给 store(内部按 version 丢弃过期帧)。
window.adOverlay.onSnapshot((snap) => useOverlayStore.getState().applySnapshot(snap));

const root = createRoot(document.getElementById("root")!);
root.render(<Overlay />);
