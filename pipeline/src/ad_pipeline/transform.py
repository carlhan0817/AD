"""清洗 static/abilities 为入库行,并对账 isUltimate null。"""
from .ids import is_hero_pseudo_ability


def classify_ability_rows(raw_rows: list[dict]) -> list[dict]:
    out = []
    for r in raw_rows:
        vid = r["valveId"]
        if is_hero_pseudo_ability(vid):
            slot_type, needs_review = "hero", 0
        elif r["isUltimate"] is True:
            slot_type, needs_review = "ultimate", 0
        elif r["isUltimate"] is False:
            slot_type, needs_review = "normal", 0
        else:  # 真实技能但 isUltimate=null:暂归普通,标记复核
            slot_type, needs_review = "normal", 1
        out.append({
            "valveId": vid,
            "shortName": r["shortName"],
            "englishName": r["englishName"],
            "slot_type": slot_type,
            "is_ultimate": r["isUltimate"],
            "has_scepter": bool(r["hasScepter"]) if r["hasScepter"] is not None else None,
            "has_shard": bool(r["hasShard"]) if r["hasShard"] is not None else None,
            "owner_hero_id": r["ownerHeroId"],
            "needs_review": needs_review,
        })
    return out
