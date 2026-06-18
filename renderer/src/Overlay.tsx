// renderer/src/Overlay.tsx
import { useOverlayStore } from "./store";
import { toViewModel } from "./view_model";

export function Overlay() {
  const snapshot = useOverlayStore((s) => s.snapshot);
  // 无数据时不再隐身:画一个可见占位,证明 overlay 已置顶/穿透/未崩游戏。
  // (看不见的 overlay 等同于启动失败,用户无从判断窗口是否在跑。)
  if (!snapshot) {
    return (
      <div className="pointer-events-none fixed inset-0 p-4">
        <div className="fixed right-4 top-4 rounded border border-yellow-300/60 bg-black/55 px-3 py-2 text-sm text-yellow-200">
          AD 助手 · 等待数据
          <div className="mt-1 text-xs text-white/60">overlay 已就绪(置顶 · 点击穿透)</div>
        </div>
      </div>
    );
  }
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
