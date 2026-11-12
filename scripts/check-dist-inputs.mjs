// 打包前检查:安装包要带的文件都在不在。reference.db 和图标不是每台机器都有
// (reference.db 是流水线产物,不入库),缺了就停下并说明怎么补,免得打出一个不能用的安装包。
import { existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const needed = [
  ["pipeline/out/reference.db", "先在 pipeline/ 下运行 python -m ad_pipeline build 生成"],
  ["models/classifier/ability_classifier_fp16.onnx", "仓库自带,检查是否完整检出"],
  ["models/classifier/class_names.json", "仓库自带,检查是否完整检出"],
  ["models/tags/ability_tags.json", "仓库自带,检查是否完整检出"],
  ["scoring_config.json", "仓库自带,检查是否完整检出"],
  ["LICENSE", "仓库自带,检查是否完整检出"],
  ["app/packaging/icon.png", "仓库自带,检查是否完整检出"],
];
const missing = needed.filter(([f]) => !existsSync(join(root, f)));
if (missing.length > 0) {
  for (const [f, how] of missing) console.error(`缺少 ${f}:${how}`);
  process.exit(1);
}
const db = statSync(join(root, "pipeline/out/reference.db"));
console.log(`打包用的 reference.db:${(db.size / 1024).toFixed(0)} KB,生成于 ${db.mtime.toISOString().slice(0, 10)}`);
