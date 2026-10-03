// app/src/renderer/main.tsx
import { createRoot } from "react-dom/client";
import { Overlay } from "@ad/renderer/Overlay";
import { useOverlayStore } from "@ad/renderer/store";

// IPC → store:每收到一帧 snapshot,交给 store(内部按 version 丢弃过期帧)。
window.adOverlay.onSnapshot((snap) => useOverlayStore.getState().applySnapshot(snap));

// ── 临时诊断:把标定的池格坐标画成边框,供肉眼对齐真机界面。排查完连同 onDebugCells/preload/main 一起删除。
type DebugCell = { x: number; y: number; w: number; h: number; zone: string };
function renderDebugCells(cells: DebugCell[]): void {
  const old = document.getElementById("ad-debug-cells");
  if (old) old.remove();
  const layer = document.createElement("div");
  layer.id = "ad-debug-cells";
  layer.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:99999;";
  for (const c of cells) {
    const color = c.zone === "ultimate" ? "#3ba3ff" : c.zone === "standard" ? "#ffd23b" : "#ff3b3b";
    const box = document.createElement("div");
    box.style.cssText =
      `position:absolute;left:${c.x}px;top:${c.y}px;width:${c.w}px;height:${c.h}px;` +
      `border:2px solid ${color};box-sizing:border-box;`;
    layer.appendChild(box);
    // 框中心十字标记:供肉眼读「框中心 vs 图标中心」的偏移量(校正全局平移用)。
    const cx = c.x + c.w / 2, cy = c.y + c.h / 2;
    const cross = document.createElement("div");
    cross.style.cssText =
      `position:absolute;left:${cx - 6}px;top:${cy}px;width:12px;height:0;` +
      `border-top:1px solid #ff00ff;`;
    const crossV = document.createElement("div");
    crossV.style.cssText =
      `position:absolute;left:${cx}px;top:${cy - 6}px;width:0;height:12px;` +
      `border-left:1px solid #ff00ff;`;
    layer.appendChild(cross);
    layer.appendChild(crossV);
  }
  document.body.appendChild(layer);
}
(window.adOverlay as unknown as { onDebugCells: (cb: (cells: DebugCell[]) => void) => void })
  .onDebugCells(renderDebugCells);

const root = createRoot(document.getElementById("root")!);
root.render(<Overlay />);
