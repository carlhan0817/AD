"""编排:采集 → 解析 → 清洗 → 落库。`python -m ad_pipeline build`。"""
import argparse
from pathlib import Path

from .windrun.client import WindrunClient
from .windrun import endpoints as ep
from .transform import classify_ability_rows
from .db import loader


def build(db_path: Path, client, download_assets: bool = False) -> None:
    # download_assets 预留给阶段1的 build-index;阶段0 仅建 DB,此处不下载图。
    _ = download_assets
    raw_static_ab = client.get_json(ep.PATHS["static_abilities"])
    raw_static_he = client.get_json(ep.PATHS["static_heroes"])
    raw_he_wr = client.get_json(ep.PATHS["hero_winrates"])
    raw_ab_wr = client.get_json(ep.PATHS["ability_winrates"])
    raw_pairs = client.get_json(ep.PATHS["ability_pairs"])
    raw_attrs = client.get_json(ep.PATHS["ability_hero_attributes"])
    raw_aghs = client.get_json(ep.PATHS["ability_aghs"])

    abilities = ep.parse_static_abilities(raw_static_ab)
    heroes = ep.parse_static_heroes(raw_static_he)
    hero_wr = ep.parse_hero_winrates(raw_he_wr)
    ab_wr = ep.parse_ability_winrates(raw_ab_wr)
    pairs = ep.parse_ability_pairs(raw_pairs)
    attrs = ep.parse_ability_hero_attributes(raw_attrs)
    aghs = ep.parse_ability_aghs(raw_aghs)
    patch = raw_ab_wr["data"]["patches"]["overall"][0]

    loader.create_db(db_path)
    loader.upsert_abilities(db_path, classify_ability_rows(abilities))
    loader.upsert_heroes(db_path, heroes)
    loader.upsert_hero_winrates(db_path, hero_wr)
    loader.upsert_ability_winrates(db_path, ab_wr, patch=patch)
    loader.upsert_ability_pairs(db_path, pairs)
    loader.upsert_ability_hero_attrs(db_path, attrs)
    loader.upsert_aghs(db_path, aghs)
    _set_meta(db_path, "patch", patch)


def _set_meta(db_path: Path, key: str, value: str) -> None:
    import sqlite3
    conn = sqlite3.connect(db_path)
    try:
        conn.execute(
            "INSERT INTO meta (key,value) VALUES (?,?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value", (key, value))
        conn.commit()
    finally:
        conn.close()


def main(argv=None) -> int:
    p = argparse.ArgumentParser(prog="ad_pipeline")
    sub = p.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("build", help="build reference.db from Windrun API")
    b.add_argument("--out", type=Path, default=Path("out/reference.db"))
    b.add_argument("--download-assets", action="store_true")
    args = p.parse_args(argv)
    if args.cmd == "build":
        args.out.parent.mkdir(parents=True, exist_ok=True)
        client = WindrunClient()
        try:
            build(args.out, client, download_assets=args.download_assets)
        finally:
            client.close()
        print(f"built {args.out}")
    return 0
