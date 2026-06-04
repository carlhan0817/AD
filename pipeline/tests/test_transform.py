from ad_pipeline.transform import classify_ability_rows

ROWS = [
    {"valveId": 5051, "shortName": "mirana_starfall", "englishName": "Starstorm",
     "isUltimate": False, "hasScepter": False, "hasShard": False, "ownerHeroId": 9},
    {"valveId": -25, "shortName": "lina", "englishName": "Hero: Lina",
     "isUltimate": None, "hasScepter": None, "hasShard": None, "ownerHeroId": None},
    {"valveId": 1664, "shortName": "largo_song_double_time", "englishName": "Hotfeet Hustle",
     "isUltimate": None, "hasScepter": False, "hasShard": False, "ownerHeroId": None},
    {"valveId": 5048, "shortName": "mirana_arrow", "englishName": "Sacred Arrow",
     "isUltimate": True, "hasScepter": True, "hasShard": False, "ownerHeroId": 9},
]


def test_hero_pseudo_ability_classified_as_hero():
    rows = {r["valveId"]: r for r in classify_ability_rows(ROWS)}
    assert rows[-25]["slot_type"] == "hero"
    assert rows[-25]["needs_review"] == 0


def test_real_ultimate_and_normal():
    rows = {r["valveId"]: r for r in classify_ability_rows(ROWS)}
    assert rows[5048]["slot_type"] == "ultimate"
    assert rows[5051]["slot_type"] == "normal"


def test_null_isultimate_real_ability_flagged_for_review():
    rows = {r["valveId"]: r for r in classify_ability_rows(ROWS)}
    assert rows[1664]["slot_type"] == "normal"
    assert rows[1664]["needs_review"] == 1
