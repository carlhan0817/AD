// renderer/src/ControlPanel.tsx
import { useState } from "react";
import { defaultScoringConfig } from "@ad/core/scoring/config";
import { configToControls, controlsToConfig, type ConfigControls } from "./config_controls";

declare global {
  interface Window { ad?: { setConfig: (cfg: unknown) => void } }
}

export function ControlPanel() {
  const [controls, setControls] = useState<ConfigControls>(() => configToControls(defaultScoringConfig()));
  const push = (next: ConfigControls) => {
    setControls(next);
    window.ad?.setConfig(controlsToConfig(next)); // 回传 main(preload 暴露)
  };
  const setWeight = (i: number, weight: number) =>
    push({ ...controls, weights: controls.weights.map((w, j) => (j === i ? { ...w, weight } : w)) });
  return (
    <div className="p-4 space-y-2">
      {controls.weights.map((w, i) => (
        <label key={w.id} className="flex items-center gap-2">
          <span className="w-28">{w.id}</span>
          <input type="range" min={0} max={5} step={0.1} value={w.weight}
                 onChange={(e) => setWeight(i, Number(e.target.value))} />
          <span>{w.weight.toFixed(1)}</span>
        </label>
      ))}
      <label className="flex items-center gap-2">
        <span className="w-28">α 前置激进</span>
        <input type="range" min={0} max={2} step={0.1} value={controls.alpha}
               onChange={(e) => push({ ...controls, alpha: Number(e.target.value) })} />
        <span>{controls.alpha.toFixed(1)}</span>
      </label>
      <label className="flex items-center gap-2">
        <span className="w-28">β 后置激进</span>
        <input type="range" min={0} max={2} step={0.1} value={controls.beta}
               onChange={(e) => push({ ...controls, beta: Number(e.target.value) })} />
        <span>{controls.beta.toFixed(1)}</span>
      </label>
    </div>
  );
}
