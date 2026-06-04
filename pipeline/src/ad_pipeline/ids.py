"""abilityId / valveId / heroId 映射。

事实(已对真实 API 探测确认):
- 统计端点的 abilityId 与 static/abilities 的 valveId 同空间。
- 正数 = 真实技能。负数 = 英雄伪技能,abilityId = -heroId。
"""


def is_hero_pseudo_ability(ability_id: int) -> bool:
    return ability_id < 0


def hero_id_from_ability_id(ability_id: int) -> int:
    if ability_id >= 0:
        raise ValueError(f"{ability_id} is a real ability, not a hero pseudo-ability")
    return -ability_id


def ability_id_for_hero(hero_id: int) -> int:
    return -hero_id
