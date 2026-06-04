import screenshot from "screenshot-desktop";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { toGrayFrame } from "./decode";
import { cropGrid, type GridSpec } from "@ad/core/recognition/grid";
import { loadIndex } from "@ad/core/recognition/index_store";
import { recognizeCell } from "@ad/core/recognition/recognize";

// 索引路径相对于本脚本文件解析(不依赖 CWD),否则从仓库根运行会找不到。
// main/src/recognize_once.ts → 仓库根 → models/templates/phash_index.json
const HERE = dirname(fileURLToPath(import.meta.url));
const INDEX_PATH = resolve(HERE, "../../models/templates/phash_index.json");

// 1920x1080 选取池标定值(阶段2 做分辨率映射前先手填)
const POOL: GridSpec = { x: 480, y: 200, cellW: 64, cellH: 64, gapX: 8, gapY: 8, rows: 4, cols: 12 };

async function run() {
  const png = await screenshot({ format: "png" });
  const frame = await toGrayFrame(png);
  const index = loadIndex(INDEX_PATH);
  const cells = cropGrid(frame, POOL);
  cells.forEach((cell, i) => {
    const m = recognizeCell(cell, index, 12);
    console.log(`cell ${i}: ${m ? `${m.shortName} (d=${m.distance})` : "—"}`);
  });
}
run();
