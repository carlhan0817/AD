import json
import sqlite3

from PIL import Image

from ad_pipeline.db.loader import create_db, upsert_abilities, upsert_heroes
from ad_pipeline.cli import build_index_command, _read_index_entries


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


def _seed_selection(selection_dir, picture="mirana", color=(10, 200, 30)):
    selection_dir.mkdir(parents=True, exist_ok=True)
    p = selection_dir / f"npc_dota_hero_{picture}_png.png"
    Image.new("RGB", (71, 94), color).save(p)
    return p


def test_build_index_command_writes_index(tmp_path):
    db = tmp_path / "reference.db"
    _seed_mirana_db(db)

    sprites = tmp_path / "sprites"
    selection = tmp_path / "selection"
    _seed_selection(selection)
    index_out = tmp_path / "phash_index.json"
    build_index_command(db, sprites, index_out, FakeClient(), selection_dir=selection)

    data = json.loads(index_out.read_text(encoding="utf-8"))
    by_id = {e["valveId"]: e for e in data}
    # 真实技能(正 valveId)+ 英雄(负 valveId)都进了索引
    assert 5051 in by_id and -9 in by_id
    assert all(len(e["phash"]) == 16 for e in data)
    # 技能 sprite 下载落盘;英雄走本地 selection(不下载到 hero/)
    assert (sprites / "ability" / "mirana_starfall.png").exists()
    assert not (sprites / "hero" / "mirana.png").exists()


def _seed_mirana_db(db):
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


def test_hero_entry_path_points_to_local_selection_dir(tmp_path):
    """英雄图源改为本地 selection 立绘:entry.path 指向
    <selection_dir>/npc_dota_hero_<picture>_png.png,而非下载的 hero sprite。"""
    db = tmp_path / "reference.db"
    _seed_mirana_db(db)

    sprites = tmp_path / "sprites"
    selection = tmp_path / "selection"
    selection.mkdir()
    sel_file = selection / "npc_dota_hero_mirana_png.png"
    Image.new("RGB", (71, 94), (10, 200, 30)).save(sel_file)

    entries, manifest = _read_index_entries(db, sprites, selection_dir=selection)
    by_id = {e["valveId"]: e for e in entries}

    # 英雄(负 valveId)path 指向本地 selection 文件
    assert by_id[-9]["path"] == str(sel_file)
    # 英雄不再进下载 manifest(本地已有,无需下载)
    assert all(m["kind"] != "hero" for m in manifest)
    # 技能仍走原下载路径
    assert by_id[5051]["path"] == str(sprites / "ability" / "mirana_starfall.png")


def test_build_index_command_hashes_hero_from_selection_image(tmp_path):
    """端到端:英雄 pHash 来自 selection 立绘(而非下载的 mini 头像)。"""
    db = tmp_path / "reference.db"
    _seed_mirana_db(db)

    sprites = tmp_path / "sprites"
    selection = tmp_path / "selection"
    selection.mkdir()
    Image.new("RGB", (71, 94), (10, 200, 30)).save(
        selection / "npc_dota_hero_mirana_png.png")

    index_out = tmp_path / "phash_index.json"
    build_index_command(db, sprites, index_out, FakeClient(), selection_dir=selection)

    data = json.loads(index_out.read_text(encoding="utf-8"))
    by_id = {e["valveId"]: e for e in data}
    assert -9 in by_id and len(by_id[-9]["phash"]) == 16
    # 英雄图源本地,不应尝试下载到 hero/ 目录
    assert not (sprites / "hero" / "mirana.png").exists()


def test_build_index_command_winrate_only_excludes_abilities_without_winrate(tmp_path):
    db = tmp_path / "reference.db"
    create_db(db)
    upsert_abilities(db, [{
        "valveId": 5051, "shortName": "mirana_starfall", "englishName": "Starstorm",
        "slot_type": "normal", "is_ultimate": False, "has_scepter": False,
        "has_shard": False, "owner_hero_id": 9, "needs_review": 0,
    }, {
        "valveId": 6051, "shortName": "dead_ability", "englishName": "Dead Ability",
        "slot_type": "normal", "is_ultimate": False, "has_scepter": False,
        "has_shard": False, "owner_hero_id": None, "needs_review": 0,
    }, {
        "valveId": -9, "shortName": "mirana", "englishName": "Hero: Mirana",
        "slot_type": "hero", "is_ultimate": None, "has_scepter": None,
        "has_shard": None, "owner_hero_id": None, "needs_review": 0,
    }])
    upsert_heroes(db, {9: {"id": 9, "shortName": "mirana",
                          "englishName": "Mirana", "picture": "mirana"}})
    # 只给 mirana_starfall (valve_id 5051) 写胜率行;dead_ability (6051) 没有
    conn = sqlite3.connect(db)
    conn.execute(
        "INSERT INTO ability_winrate (ability_id, patch, num_picks, wins, winrate) "
        "VALUES (5051, '7.36', 100, 50, 0.5)")
    conn.commit()
    conn.close()

    sprites = tmp_path / "sprites"
    selection = tmp_path / "selection"
    _seed_selection(selection)
    index_out = tmp_path / "phash_index.json"
    build_index_command(db, sprites, index_out, FakeClient(),
                        winrate_only=True, selection_dir=selection)

    data = json.loads(index_out.read_text(encoding="utf-8"))
    by_id = {e["valveId"]: e for e in data}
    # 有胜率的技能 + 全部英雄都进索引;无胜率的技能被排除
    assert 5051 in by_id
    assert -9 in by_id
    assert 6051 not in by_id
