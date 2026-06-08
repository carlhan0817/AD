// core/src/scoring/signals/pos.ts
// 信号③:tanh 选取位置稀缺度(细则 §2③)。S_pos = tanh((P_curr - P_avg)/σ),有界 [-1,1]。
// σ 经工厂注入(从 config.sigma),便于回测改 σ 而不改信号。
import type { Signal } from "@ad/shared/types/scoring";

export function makePosSignal(sigma: number): Signal {
  return (ctx, candidate) => {
    if (ctx.pickIndex === null) return 0;
    const row = ctx.winrate.get(candidate.valveId);
    if (!row || row.avgPickPosition === null) return 0;
    return Math.tanh((ctx.pickIndex - row.avgPickPosition) / sigma);
  };
}
