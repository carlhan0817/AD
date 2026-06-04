import sqlite3

import pytest

from ad_pipeline.cli import build
from ad_pipeline.windrun.client import WindrunClient


@pytest.mark.live
def test_full_build_against_real_api(tmp_path):
    db = tmp_path / "reference.db"
    client = WindrunClient()
    try:
        build(db, client)
    finally:
        client.close()
    conn = sqlite3.connect(db)
    # 验收门:计划书 §十「能离线查询任一技能/英雄的胜率/搭配数据」
    assert conn.execute("SELECT COUNT(*) FROM abilities").fetchone()[0] > 2000
    assert conn.execute("SELECT COUNT(*) FROM heroes").fetchone()[0] > 100
    assert conn.execute("SELECT COUNT(*) FROM ability_pairs").fetchone()[0] > 100
    # 任取一技能能联到胜率
    row = conn.execute(
        """SELECT a.short_name, w.winrate
           FROM abilities a JOIN ability_winrate w ON a.valve_id = w.ability_id
           WHERE a.slot_type='normal' LIMIT 1""").fetchone()
    assert row is not None and 0 < row[1] < 1
