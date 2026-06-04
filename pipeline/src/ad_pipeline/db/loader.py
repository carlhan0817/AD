"""建库 + upsert。SQLite,只读消费方为 TS core/。"""
import sqlite3
from pathlib import Path


def _schema_sql() -> str:
    return (Path(__file__).parent / "schema.sql").read_text(encoding="utf-8")


def create_db(db_path: Path) -> None:
    conn = sqlite3.connect(db_path)
    try:
        conn.executescript(_schema_sql())
        conn.commit()
    finally:
        conn.close()


def _conn(db_path: Path) -> sqlite3.Connection:
    c = sqlite3.connect(db_path)
    c.execute("PRAGMA foreign_keys=ON")
    return c


def upsert_abilities(db_path: Path, rows: list[dict]) -> None:
    conn = _conn(db_path)
    try:
        conn.executemany(
            """INSERT INTO abilities
               (valve_id, short_name, english_name, slot_type, is_ultimate,
                has_scepter, has_shard, owner_hero_id, needs_review)
               VALUES (:valveId,:shortName,:englishName,:slot_type,:is_ultimate,
                       :has_scepter,:has_shard,:owner_hero_id,:needs_review)
               ON CONFLICT(valve_id) DO UPDATE SET
                 short_name=excluded.short_name, english_name=excluded.english_name,
                 slot_type=excluded.slot_type, is_ultimate=excluded.is_ultimate,
                 has_scepter=excluded.has_scepter, has_shard=excluded.has_shard,
                 owner_hero_id=excluded.owner_hero_id, needs_review=excluded.needs_review""",
            rows)
        conn.commit()
    finally:
        conn.close()


def upsert_aghs(db_path: Path, raw_rows: list[dict]) -> None:
    rows = [{
        "ability_id": r["abilityId"],
        "scepter_gain": r["aghsScepter"]["winrate"] - r["noAghsScepter"]["winrate"],
        "shard_gain": r["aghsShard"]["winrate"] - r["noAghsShard"]["winrate"],
    } for r in raw_rows]
    conn = _conn(db_path)
    try:
        conn.executemany(
            """INSERT INTO ability_aghs (ability_id, scepter_gain, shard_gain)
               VALUES (:ability_id,:scepter_gain,:shard_gain)
               ON CONFLICT(ability_id) DO UPDATE SET
                 scepter_gain=excluded.scepter_gain, shard_gain=excluded.shard_gain""",
            rows)
        conn.commit()
    finally:
        conn.close()


def upsert_heroes(db_path: Path, heroes: dict) -> None:
    rows = [{"hero_id": h["id"], "short_name": h["shortName"],
             "english_name": h["englishName"], "picture": h["picture"]}
            for h in heroes.values()]
    conn = _conn(db_path)
    try:
        conn.executemany(
            """INSERT INTO heroes (hero_id, short_name, english_name, picture)
               VALUES (:hero_id,:short_name,:english_name,:picture)
               ON CONFLICT(hero_id) DO UPDATE SET
                 short_name=excluded.short_name, english_name=excluded.english_name,
                 picture=excluded.picture""", rows)
        conn.commit()
    finally:
        conn.close()


def upsert_hero_winrates(db_path: Path, winrates: dict) -> None:
    rows = [{"hero_id": hid, "patch": r["patch"], "wins": r["wins"],
             "num_games": r["numGames"], "winrate": r["winrate"]}
            for hid, r in winrates.items()]
    conn = _conn(db_path)
    try:
        conn.executemany(
            """INSERT INTO hero_winrate (hero_id, patch, wins, num_games, winrate)
               VALUES (:hero_id,:patch,:wins,:num_games,:winrate)
               ON CONFLICT(hero_id) DO UPDATE SET
                 patch=excluded.patch, wins=excluded.wins,
                 num_games=excluded.num_games, winrate=excluded.winrate""", rows)
        conn.commit()
    finally:
        conn.close()


def upsert_ability_winrates(db_path: Path, raw_rows: list[dict], patch: str) -> None:
    rows = [{"ability_id": r["abilityId"], "patch": patch, "num_picks": r["numPicks"],
             "wins": r["wins"], "winrate": r["winrate"],
             "avg_pick_position": r.get("avgPickPosition"), "pick_rate": r.get("pickRate")}
            for r in raw_rows]
    conn = _conn(db_path)
    try:
        conn.executemany(
            """INSERT INTO ability_winrate
               (ability_id, patch, num_picks, wins, winrate, avg_pick_position, pick_rate)
               VALUES (:ability_id,:patch,:num_picks,:wins,:winrate,:avg_pick_position,:pick_rate)
               ON CONFLICT(ability_id) DO UPDATE SET
                 patch=excluded.patch, num_picks=excluded.num_picks, wins=excluded.wins,
                 winrate=excluded.winrate, avg_pick_position=excluded.avg_pick_position,
                 pick_rate=excluded.pick_rate""", rows)
        conn.commit()
    finally:
        conn.close()


def upsert_ability_pairs(db_path: Path, raw_rows: list[dict]) -> None:
    rows = [{"ability_id_one": r["abilityIdOne"], "ability_id_two": r["abilityIdTwo"],
             "num_picks": r["numPicks"], "wins": r["wins"], "winrate": r["winrate"]}
            for r in raw_rows]
    conn = _conn(db_path)
    try:
        conn.executemany(
            """INSERT INTO ability_pairs
               (ability_id_one, ability_id_two, num_picks, wins, winrate)
               VALUES (:ability_id_one,:ability_id_two,:num_picks,:wins,:winrate)
               ON CONFLICT(ability_id_one, ability_id_two) DO UPDATE SET
                 num_picks=excluded.num_picks, wins=excluded.wins, winrate=excluded.winrate""", rows)
        conn.commit()
    finally:
        conn.close()


def upsert_ability_hero_attrs(db_path: Path, by_attr: dict) -> None:
    rows = []
    for attr, m in by_attr.items():
        for aid, r in m.items():
            rows.append({"ability_id": aid, "attr": attr,
                         "winrate": r["winrate"], "num_picks": r.get("numPicks")})
    conn = _conn(db_path)
    try:
        conn.executemany(
            """INSERT INTO ability_hero_attr (ability_id, attr, winrate, num_picks)
               VALUES (:ability_id,:attr,:winrate,:num_picks)
               ON CONFLICT(ability_id, attr) DO UPDATE SET
                 winrate=excluded.winrate, num_picks=excluded.num_picks""", rows)
        conn.commit()
    finally:
        conn.close()
