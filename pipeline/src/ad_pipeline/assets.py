"""datdota CDN 参考图 URL 构造 + 下载清单。供阶段1模板匹配。"""
from pathlib import Path

_CDN = "https://cdn.datdota.com/images"


def ability_sprite_url(short_name: str) -> str:
    return f"{_CDN}/ability/{short_name}.png"


def hero_full_url(picture: str) -> str:
    return f"{_CDN}/heroes/{picture}_full.png"


def hero_mini_url(picture: str) -> str:
    return f"{_CDN}/miniheroes/{picture}.png"


def build_asset_manifest(abilities: list[dict], heroes: dict) -> list[dict]:
    """返回 [{kind, key, url, filename}]。英雄不走 ability sprite。"""
    manifest = []
    for a in abilities:
        if a["slot_type"] == "hero":
            continue  # 英雄伪技能由 heroes 段统一出图
        manifest.append({"kind": "ability", "key": a["shortName"],
                         "url": ability_sprite_url(a["shortName"]),
                         "filename": f"ability/{a['shortName']}.png"})
    for _hid, h in heroes.items():
        manifest.append({"kind": "hero", "key": h["picture"],
                         "url": hero_mini_url(h["picture"]),
                         "filename": f"hero/{h['picture']}.png"})
    return manifest


def download_manifest(manifest: list[dict], out_dir: Path, client) -> int:
    """实际下载。client.get_bytes(url)->bytes。返回写入数。仅 cli --download 调用。"""
    n = 0
    for m in manifest:
        dest = out_dir / m["filename"]
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(client.get_bytes(m["url"]))
        n += 1
    return n
