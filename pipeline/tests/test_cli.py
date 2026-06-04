import json
import pathlib
import sqlite3

from ad_pipeline.cli import build

FIX = pathlib.Path(__file__).parent / "fixtures"


class FakeClient:
    """按 path 返回对应 fixture。"""
    _MAP = {
        "/static/abilities": "static_abilities.json",
        "/static/heroes": "static_heroes.json",
        "/heroes": "heroes.json",
        "/abilities": "abilities.json",
        "/ability-pairs": "ability_pairs.json",
        "/ability-hero-attributes": "ability_hero_attributes.json",
        "/ability-aghs": "ability_aghs.json",
    }

    def get_json(self, path):
        return json.loads((FIX / self._MAP[path]).read_text(encoding="utf-8"))

    def close(self):
        ...


def test_build_populates_db(tmp_path):
    db = tmp_path / "reference.db"
    build(db_path=db, client=FakeClient(), download_assets=False)
    conn = sqlite3.connect(db)
    assert conn.execute("SELECT COUNT(*) FROM abilities").fetchone()[0] >= 1
    assert conn.execute("SELECT COUNT(*) FROM heroes").fetchone()[0] >= 1
    assert conn.execute("SELECT COUNT(*) FROM ability_aghs").fetchone()[0] >= 1
    # meta 记录补丁
    assert conn.execute("SELECT value FROM meta WHERE key='patch'").fetchone()[0] == "7.41b"
