// renderer/src/Overlay.tsx
import { useOverlayStore } from "./store";
import { toViewModel } from "./view_model";

export function Overlay() {
  const snapshot = useOverlayStore((s) => s.snapshot);
  if (!snapshot) return null;
  const vm = toViewModel(snapshot);
  return (
    <div className="pointer-events-none fixed inset-0 p-4 text-sm text-white">
      <div className="mb-2">
        剩余:英雄 {vm.remaining.hero} · 普通 {vm.remaining.normal} · 终极 {vm.remaining.ultimate}
      </div>
      <ul>
        {vm.rows.map((r) => (
          <li key={r.valveId} className={r.highlighted ? "font-bold text-yellow-300" : ""}>
            {r.valveId} ({r.slotType}) — {r.scoreText} · {r.topSignal ?? "—"}
          </li>
        ))}
      </ul>
    </div>
  );
}
