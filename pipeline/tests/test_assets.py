from ad_pipeline.assets import (
    ability_sprite_url, hero_full_url, hero_mini_url, build_asset_manifest,
    download_manifest)


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


class _FlakyClient:
    """get_bytes 对指定 url 抛异常(模拟 404/超时),其余正常返回固定字节。"""

    def __init__(self, bad_urls):
        self._bad_urls = set(bad_urls)

    def get_bytes(self, url):
        if url in self._bad_urls:
            raise RuntimeError(f"boom: {url}")
        return b"fake-bytes"


def test_download_manifest_skips_failed_url_without_raising(tmp_path):
    manifest = [
        {"kind": "ability", "key": "mirana_starfall",
         "url": "https://cdn.datdota.com/images/ability/mirana_starfall.png",
         "filename": "ability/mirana_starfall.png"},
        {"kind": "ability", "key": "dead_ability",
         "url": "https://cdn.datdota.com/images/ability/dead_ability.png",
         "filename": "ability/dead_ability.png"},
        {"kind": "hero", "key": "mirana",
         "url": "https://cdn.datdota.com/images/miniheroes/mirana.png",
         "filename": "hero/mirana.png"},
    ]
    client = _FlakyClient(bad_urls={"https://cdn.datdota.com/images/ability/dead_ability.png"})

    result = download_manifest(manifest, tmp_path, client)

    assert result["downloaded"] == 2
    assert len(result["failed"]) == 1
    assert result["failed"][0]["url"] == \
        "https://cdn.datdota.com/images/ability/dead_ability.png"
    assert result["failed"][0]["key"] == "dead_ability"
    # 成功的两项确实落盘,失败项未落盘
    assert (tmp_path / "ability" / "mirana_starfall.png").exists()
    assert (tmp_path / "hero" / "mirana.png").exists()
    assert not (tmp_path / "ability" / "dead_ability.png").exists()
