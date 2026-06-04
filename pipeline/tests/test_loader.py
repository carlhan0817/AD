import sqlite3

from ad_pipeline.db.loader import create_db, upsert_abilities, upsert_aghs


def test_create_db_has_tables(tmp_path):
    db = tmp_path / "ref.db"
    create_db(db)
    conn = sqlite3.connect(db)
    names = {r[0] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table'")}
    assert {"heroes", "abilities", "ability_winrate", "hero_winrate",
            "ability_pairs", "ability_hero_attr", "ability_aghs"} <= names


def test_upsert_abilities_is_idempotent(tmp_path):
    db = tmp_path / "ref.db"
    create_db(db)
    rows = [{"valveId": 5051, "shortName": "mirana_starfall", "englishName": "Starstorm",
             "slot_type": "normal", "is_ultimate": False, "has_scepter": False,
             "has_shard": False, "owner_hero_id": 9, "needs_review": 0}]
    upsert_abilities(db, rows)
    upsert_abilities(db, rows)  # 跑两次
    conn = sqlite3.connect(db)
    assert conn.execute("SELECT COUNT(*) FROM abilities").fetchone()[0] == 1


def test_upsert_aghs_computes_gain(tmp_path):
    db = tmp_path / "ref.db"
    create_db(db)
    raw = [{"abilityId": -155,
            "noAghsScepter": {"winrate": 0.50}, "aghsScepter": {"winrate": 0.578},
            "noAghsShard": {"winrate": 0.524}, "aghsShard": {"winrate": 0.571}}]
    upsert_aghs(db, raw)
    conn = sqlite3.connect(db)
    s = conn.execute(
        "SELECT scepter_gain, shard_gain FROM ability_aghs WHERE ability_id=-155").fetchone()
    assert round(s[0], 3) == 0.078
    assert round(s[1], 3) == 0.047
