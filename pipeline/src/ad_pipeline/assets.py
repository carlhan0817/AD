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


def download_manifest(manifest: list[dict], out_dir: Path, client) -> dict:
    """实际下载。client.get_bytes(url)->bytes。

    单个 url 失败(404/超时/任何异常)不中断整体下载:捕获、记录、跳过,继续下一个。
    AD 的 abilities 表里有大量已废弃/未启用技能,其 sprite 在 CDN 上大概率 404,
    若不容错会让整个 build-index 因一张图崩掉。

    返回 {"downloaded": int, "failed": [{"key","url","reason"}, ...]}。
    """
    downloaded = 0
    failed: list[dict] = []
    for m in manifest:
        try:
            data = client.get_bytes(m["url"])
        except Exception as exc:  # noqa: BLE001 - 任何下载异常都不应中断整体流程
            print(f"[download_manifest] WARN skip {m['key']} ({m['url']}): {exc}")
            failed.append({"key": m["key"], "url": m["url"], "reason": str(exc)})
            continue
        dest = out_dir / m["filename"]
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(data)
        downloaded += 1
    return {"downloaded": downloaded, "failed": failed}
