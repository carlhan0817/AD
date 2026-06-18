"""编排:采集 → 解析 → 清洗 → 落库。`python -m ad_pipeline build`。"""
import argparse
from pathlib import Path

from .windrun.client import WindrunClient
from .windrun import endpoints as ep
from .transform import classify_ability_rows
from .db import loader
from . import assets
from .build_index import build_index_from_files


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


def _read_index_entries(db_path: Path, sprites_dir: Path,
                         winrate_only: bool = False) -> tuple[list[dict], list[dict]]:
    """从 reference.db 读 abilities+heroes,拼出 build_index 用的 entries。

    abilities 中真实技能 → ability sprite(正 valveId);英雄行(slot_type='hero',
    负 valveId)→ mini 头像;valveId 与 sprite 文件名一一对应(见 assets.build_asset_manifest)。

    winrate_only=True 时,abilities 只取在 ability_winrate 表里有记录的子集
    (reference.db 里大量 valve_id 是已废弃/未启用技能,AD 模式不会出现,且其 sprite
    在 CDN 上大概率 404)。英雄始终全量保留。
    """
    import sqlite3
    conn = sqlite3.connect(db_path)
    try:
        if winrate_only:
            ability_sql = ("SELECT short_name, slot_type FROM abilities "
                           "WHERE valve_id IN (SELECT ability_id FROM ability_winrate)")
        else:
            ability_sql = "SELECT short_name, slot_type FROM abilities"
        abilities = [
            {"shortName": sn, "slot_type": st}
            for sn, st in conn.execute(ability_sql)
        ]
        # valveId 按 short_name 反查(英雄行用负 valveId)
        valve_by_short = {
            sn: vid for sn, vid in conn.execute("SELECT short_name, valve_id FROM abilities")
        }
        heroes = {
            hid: {"picture": pic, "valve_id": -hid}
            for hid, pic in conn.execute("SELECT hero_id, picture FROM heroes")
        }
    finally:
        conn.close()

    manifest = assets.build_asset_manifest(abilities, heroes)
    entries = []
    for m in manifest:
        if m["kind"] == "ability":
            valve_id = valve_by_short[m["key"]]
        else:  # hero:key=picture,valveId = -heroId
            valve_id = next(h["valve_id"] for h in heroes.values() if h["picture"] == m["key"])
        entries.append({"valveId": valve_id, "shortName": m["key"],
                        "path": str(sprites_dir / m["filename"])})
    return entries, manifest


def build_index_command(db_path: Path, sprites_dir: Path, index_out: Path, client,
                         winrate_only: bool = False) -> dict:
    entries, manifest = _read_index_entries(db_path, sprites_dir, winrate_only=winrate_only)
    download_result = assets.download_manifest(manifest, sprites_dir, client)
    index = build_index_from_files(entries, index_out)
    summary = {"downloaded": download_result["downloaded"],
               "failed": len(download_result["failed"]),
               "indexed": len(index)}
    print(f"download: {summary['downloaded']} ok, {summary['failed']} failed; "
          f"index: {summary['indexed']} entries written")
    return summary


def main(argv=None) -> int:
    p = argparse.ArgumentParser(prog="ad_pipeline")
    sub = p.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("build", help="build reference.db from Windrun API")
    b.add_argument("--out", type=Path, default=Path("out/reference.db"))
    b.add_argument("--download-assets", action="store_true")

    bi = sub.add_parser("build-index", help="download sprites + build phash index")
    bi.add_argument("--db", type=Path, default=Path("out/reference.db"))
    bi.add_argument("--sprites", type=Path, default=Path("../models/templates/sprites"))
    bi.add_argument("--index-out", type=Path, default=Path("../models/templates/phash_index.json"))
    bi.add_argument("--winrate-only", action="store_true",
                     help="只下载/索引有胜率数据的技能子集(+全部英雄),跳过废弃技能")

    args = p.parse_args(argv)
    if args.cmd == "build":
        args.out.parent.mkdir(parents=True, exist_ok=True)
        client = WindrunClient()
        try:
            build(args.out, client, download_assets=args.download_assets)
        finally:
            client.close()
        print(f"built {args.out}")
    elif args.cmd == "build-index":
        client = WindrunClient()
        try:
            build_index_command(args.db, args.sprites, args.index_out, client,
                                 winrate_only=args.winrate_only)
        finally:
            client.close()
        print(f"built index {args.index_out}")
    return 0
