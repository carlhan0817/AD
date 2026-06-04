"""各端点路径 + 从已解析 JSON 取有意义子树。形状见 plans/...-00 §4。"""

PATHS = {
    "static_abilities": "/static/abilities",
    "static_heroes": "/static/heroes",
    "hero_winrates": "/heroes",
    "ability_winrates": "/abilities",
    "ability_pairs": "/ability-pairs",
    "ability_hero_attributes": "/ability-hero-attributes",
    "ability_aghs": "/ability-aghs",
}


def _overall_patch(payload: dict) -> str:
    return payload["data"]["patches"]["overall"][0]


def parse_static_abilities(payload: dict) -> list[dict]:
    return payload["data"]


def parse_static_heroes(payload: dict) -> dict:
    # {heroId(int): {id, englishName, shortName, picture, ...}}
    return {int(k): v for k, v in payload["data"].items()}


def parse_hero_winrates(payload: dict) -> dict:
    patch = _overall_patch(payload)
    out = {}
    for hero_id, by_patch in payload["data"]["heroStats"].items():
        rec = by_patch[patch]
        out[int(hero_id)] = {**rec, "patch": patch}
    return out


def parse_ability_winrates(payload: dict) -> list[dict]:
    return payload["data"]["abilityStats"]


def parse_ability_pairs(payload: dict) -> list[dict]:
    return payload["data"]["abilityPairs"]


def parse_ability_hero_attributes(payload: dict) -> dict:
    # {attr: {abilityId(int): {winrate, ...}}}; attrs: str/agi/int/uni/ranged/melee
    raw = payload["data"]["abilityHeroAttributeStats"]
    return {attr: {int(aid): rec for aid, rec in m.items()} for attr, m in raw.items()}


def parse_ability_aghs(payload: dict) -> list[dict]:
    return payload["data"]["abilityAghs"]
