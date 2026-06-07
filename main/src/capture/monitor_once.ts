// main/src/capture/monitor_once.ts
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { loadIndex } from "@ad/core/recognition/index_store";
import { ReferenceDb } from "@ad/core/db/reference";
import { runMonitorLoop } from "./loop";

const HERE = dirname(fileURLToPath(import.meta.url));
const INDEX = resolve(HERE, "../../../models/templates/phash_index.json");
const DB = resolve(HERE, "../../../pipeline/out/reference.db");

const index = loadIndex(INDEX);
const ref = new ReferenceDb(DB);
runMonitorLoop({
  index,
  ref,
  onUpdate: (m) => {
    const s = m.state();
    console.log("activeRow=", s.activeRow);
    s.players.forEach((p) =>
      console.log(`row ${p.row}: hero=${p.hero} normals=${p.normals} ult=${p.ultimates}`));
  },
});
