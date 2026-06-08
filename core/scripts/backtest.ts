// core/scripts/backtest.ts
// 手动回测:对同一批局面跑两套 config,对比 top-3 命中率,证明「参数可改 → 排序可变」。
// 用法:npx tsx core/scripts/backtest.ts <reference.db> <cases.json>
import { readFileSync } from "node:fs";
import { recommend } from "../src/scoring/recommend";
import { defaultScoringConfig, loadScoringConfig } from "../src/scoring/config";
import { hitRateAtK, type BacktestCase } from "../src/scoring/backtest";

const [dbPath, casesPath] = process.argv.slice(2);
const raw = JSON.parse(readFileSync(casesPath, "utf-8")) as Array<{
  pool: { valveId: number; slotType: "hero" | "normal" | "ultimate" }[];
  me: { row: number; hero: number | null; normals: number[]; ultimates: number[] };
  pickIndex: number | null;
  actualPick: number;
}>;

function run(label: string, json?: string) {
  const cfg = json ? loadScoringConfig(json) : defaultScoringConfig();
  const cases: BacktestCase[] = raw.map((c) => ({
    actualPick: c.actualPick,
    ranked: recommend(c.pool, c.me, c.pickIndex, dbPath, cfg),
  }));
  console.log(`${label}: hit@3 = ${hitRateAtK(cases, 3).toFixed(3)}`);
}

run("default");
// 调 α/β/σ 与权重,观察命中率变化:
run("front-aggressive", '{"alpha":1.0,"beta":0.2,"baseWeights":{"base":2,"synergy":1,"aghs":0.8,"shard":0.5,"pos":0.6}}');
