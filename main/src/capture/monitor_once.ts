// main/src/capture/monitor_once.ts
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { loadIndex } from "@ad/core/recognition/index_store";
import { ReferenceDb } from "@ad/core/db/reference";
import { defaultScoringConfig } from "@ad/core/scoring/config";
import { runMonitorLoop } from "./loop";

const HERE = dirname(fileURLToPath(import.meta.url));
const INDEX = resolve(HERE, "../../../models/templates/phash_index.json");
const DB = resolve(HERE, "../../../pipeline/out/reference.db");

const index = loadIndex(INDEX);
const ref = new ReferenceDb(DB);
runMonitorLoop({
  index,
  ref,
  pool: [], // 手动冒烟脚本:候选池留空,仅观察识别/状态机输出,不验证打分
  cfg: defaultScoringConfig(),
  onUpdate: (state, activeRow, recs) => {
    console.log("activeRow=", activeRow);
    state.players.forEach((p) =>
      console.log(`row ${p.row}: hero=${p.hero} normals=${p.normals} ult=${p.ultimates}`));
    console.log("recommendations=", recs);
  },
});
