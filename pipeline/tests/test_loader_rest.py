import sqlite3

from ad_pipeline.db.loader import (
    create_db, upsert_heroes, upsert_hero_winrates,
    upsert_ability_winrates, upsert_ability_pairs, upsert_ability_hero_attrs)


def test_upsert_heroes(tmp_path):
    db = tmp_path / "r.db"
    create_db(db)
    upsert_heroes(db, {9: {"id": 9, "shortName": "mirana", "englishName": "Mirana", "picture": "mirana"}})
    c = sqlite3.connect(db)
    assert c.execute("SELECT picture FROM heroes WHERE hero_id=9").fetchone()[0] == "mirana"


def test_upsert_hero_winrates(tmp_path):
    db = tmp_path / "r.db"
    create_db(db)
    upsert_hero_winrates(db, {9: {"wins": 1, "numGames": 2, "winrate": 0.5, "patch": "7.41b"}})
    c = sqlite3.connect(db)
    assert c.execute("SELECT num_games FROM hero_winrate WHERE hero_id=9").fetchone()[0] == 2


def test_upsert_ability_winrates(tmp_path):
    db = tmp_path / "r.db"
    create_db(db)
    upsert_ability_winrates(db, [{"abilityId": 5051, "numPicks": 100, "wins": 55,
        "winrate": 0.55, "avgPickPosition": 8.4, "pickRate": 0.95}], patch="7.41b")
    c = sqlite3.connect(db)
    assert c.execute("SELECT winrate FROM ability_winrate WHERE ability_id=5051").fetchone()[0] == 0.55


def test_upsert_pairs_and_attrs(tmp_path):
    db = tmp_path / "r.db"
    create_db(db)
    upsert_ability_pairs(db, [{"abilityIdOne": -23, "abilityIdTwo": 5032,
        "numPicks": 10, "wins": 6, "winrate": 0.6}])
    upsert_ability_hero_attrs(db, {"str": {5120: {"winrate": 0.49, "numPicks": 11481}}})
    c = sqlite3.connect(db)
    assert c.execute("SELECT winrate FROM ability_pairs WHERE ability_id_one=-23").fetchone()[0] == 0.6
    assert c.execute(
        "SELECT winrate FROM ability_hero_attr WHERE ability_id=5120 AND attr='str'").fetchone()[0] == 0.49
