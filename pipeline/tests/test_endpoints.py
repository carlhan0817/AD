import json
import pathlib

from ad_pipeline.windrun import endpoints

FIX = pathlib.Path(__file__).parent / "fixtures"


def _load(name):
    return json.loads((FIX / name).read_text(encoding="utf-8"))


def test_parse_static_abilities_returns_list():
    rows = endpoints.parse_static_abilities(_load("static_abilities.json"))
    assert isinstance(rows, list) and len(rows) == 3
    assert rows[0]["valveId"] == 5051


def test_parse_hero_winrates_flattens_patch():
    out = endpoints.parse_hero_winrates(_load("heroes.json"))
    # {heroId: {wins, numGames, winrate, patch}}
    assert out[9]["winrate"] == 0.499202766
    assert out[9]["patch"] == "7.41b"
    assert out[25]["numGames"] == 38613
