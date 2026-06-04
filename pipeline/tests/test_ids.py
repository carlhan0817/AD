from ad_pipeline.ids import is_hero_pseudo_ability, hero_id_from_ability_id, ability_id_for_hero


def test_negative_ability_id_is_hero_pseudo():
    assert is_hero_pseudo_ability(-1) is True
    assert is_hero_pseudo_ability(-25) is True


def test_positive_ability_id_is_real_ability():
    assert is_hero_pseudo_ability(5051) is False


def test_hero_id_round_trip():
    assert hero_id_from_ability_id(-25) == 25
    assert ability_id_for_hero(25) == -25


def test_hero_id_from_positive_raises():
    import pytest
    with pytest.raises(ValueError):
        hero_id_from_ability_id(5051)
