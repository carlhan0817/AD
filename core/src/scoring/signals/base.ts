// core/src/scoring/signals/base.ts
// 信号①:单技能/英雄基础胜率(细则 §2①)。S_base = WR(c) - 0.5。
// 配了 heroFit 且知道我的英雄时,技能改用「在我这类英雄上」的强度(见 strength.ts)。
import type { Signal } from "@ad/shared/types/scoring";
import { strength } from "../strength";

export const base: Signal = (ctx, candidate) => strength(ctx, candidate.valveId, ctx.me.hero);
