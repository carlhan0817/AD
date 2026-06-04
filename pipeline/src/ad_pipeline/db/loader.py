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
