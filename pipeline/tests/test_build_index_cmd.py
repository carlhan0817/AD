import json
import sqlite3

from PIL import Image

from ad_pipeline.db.loader import create_db, upsert_abilities, upsert_heroes
from ad_pipeline.cli import build_index_command


class FakeClient:
    """get_bytes 返回一张小 PNG 的字节;按 URL 区分技能/英雄无所谓,内容确定即可。"""

    def __init__(self):
        import io
        buf = io.BytesIO()
        Image.new("RGB", (32, 32), (123, 45, 67)).save(buf, format="PNG")
        self._png = buf.getvalue()

    def get_bytes(self, url):
        return self._png

    def close(self):
        ...


def test_build_index_command_writes_index(tmp_path):
    db = tmp_path / "reference.db"
    create_db(db)
    upsert_abilities(db, [{
        "valveId": 5051, "shortName": "mirana_starfall", "englishName": "Starstorm",
        "slot_type": "normal", "is_ultimate": False, "has_scepter": False,
        "has_shard": False, "owner_hero_id": 9, "needs_review": 0,
    }, {
        "valveId": -9, "shortName": "mirana", "englishName": "Hero: Mirana",
        "slot_type": "hero", "is_ultimate": None, "has_scepter": None,
        "has_shard": None, "owner_hero_id": None, "needs_review": 0,
    }])
    upsert_heroes(db, {9: {"id": 9, "shortName": "mirana",
                          "englishName": "Mirana", "picture": "mirana"}})

    sprites = tmp_path / "sprites"
    index_out = tmp_path / "phash_index.json"
    build_index_command(db, sprites, index_out, FakeClient())

    data = json.loads(index_out.read_text(encoding="utf-8"))
    by_id = {e["valveId"]: e for e in data}
    # 真实技能(正 valveId)+ 英雄(负 valveId)都进了索引
    assert 5051 in by_id and -9 in by_id
    assert all(len(e["phash"]) == 16 for e in data)
    # sprite 文件实际落盘
    assert (sprites / "ability" / "mirana_starfall.png").exists()
    assert (sprites / "hero" / "mirana.png").exists()
