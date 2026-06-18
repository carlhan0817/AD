"""下载/读取参考图 → pHash → phash_index.json。"""
import json
from pathlib import Path

from .imageio import to_gray32
from .phash import phash_from_gray


def build_index_from_files(entries: list[dict], out_path: Path) -> list[dict]:
    """entries: [{valveId, shortName, path}]。写 [{valveId, shortName, phash}]。

    单 entry 读图/算 phash 失败(常见原因:sprite 未下载成功,文件不存在或损坏)
    不中断整体建索引:捕获、打印 warning、跳过该项,继续下一个。
    返回写入的 index 列表(供调用方汇总计数)。
    """
    index = []
    for e in entries:
        try:
            gray = to_gray32(Path(e["path"]))
        except Exception as exc:  # noqa: BLE001 - 单图失败不应中断整体建索引
            print(f"[build_index_from_files] WARN skip {e['shortName']} ({e['path']}): {exc}")
            continue
        index.append({"valveId": e["valveId"], "shortName": e["shortName"],
                      "phash": phash_from_gray(gray)})
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(index, ensure_ascii=False), encoding="utf-8")
    return index
