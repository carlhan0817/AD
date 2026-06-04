from ad_pipeline.assets import (
    ability_sprite_url, hero_full_url, hero_mini_url, build_asset_manifest)


def test_url_builders():
    assert ability_sprite_url("mirana_starfall") == \
        "https://cdn.datdota.com/images/ability/mirana_starfall.png"
    assert hero_full_url("mirana") == \
        "https://cdn.datdota.com/images/heroes/mirana_full.png"
    assert hero_mini_url("mirana") == \
        "https://cdn.datdota.com/images/miniheroes/mirana.png"


def test_manifest_covers_abilities_and_heroes():
    abilities = [{"shortName": "mirana_starfall", "slot_type": "normal"},
                 {"shortName": "lina", "slot_type": "hero"}]  # hero pseudo-ability
    heroes = {9: {"picture": "mirana"}}
    manifest = build_asset_manifest(abilities, heroes)
    urls = {m["url"] for m in manifest}
    # 真实技能 → ability sprite;英雄 → mini 头像;不为 hero 伪技能拼 ability sprite
    assert "https://cdn.datdota.com/images/ability/mirana_starfall.png" in urls
    assert "https://cdn.datdota.com/images/miniheroes/mirana.png" in urls
    assert "https://cdn.datdota.com/images/ability/lina.png" not in urls
