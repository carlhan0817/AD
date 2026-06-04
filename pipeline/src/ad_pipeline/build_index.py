"""下载/读取参考图 → pHash → phash_index.json。"""
import json
from pathlib import Path

from .imageio import to_gray32
from .phash import phash_from_gray


def build_index_from_files(entries: list[dict], out_path: Path) -> None:
    """entries: [{valveId, shortName, path}]。写 [{valveId, shortName, phash}]。"""
    index = []
    for e in entries:
        index.append({"valveId": e["valveId"], "shortName": e["shortName"],
                      "phash": phash_from_gray(to_gray32(Path(e["path"])))})
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(index, ensure_ascii=False), encoding="utf-8")
