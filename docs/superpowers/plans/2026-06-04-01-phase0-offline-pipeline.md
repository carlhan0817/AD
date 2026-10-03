# 阶段 0 · 离线数据/模型流水线 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: 用 superpowers:subagent-driven-development(推荐)或 superpowers:executing-plans 逐任务执行。步骤用 `- [ ]` 复选框跟踪。先读同目录 `...-00-project-structure-and-roadmap.md` §4(ID 模型)再开工。

**Goal:** 把 Windrun v2 API 数据采集、清洗、ID 对账后写入 SQLite 静态参考库,并下载 datdota CDN 参考图,产出 `pipeline/out/reference.db` 与 `pipeline/out/assets/`,供热路径只读消费。

**Architecture:** 纯 Python 包 `ad_pipeline`,分层为 client(网络)→ endpoints(解析)→ ids(映射)→ transform(清洗/对账)→ db(落库)→ assets(下载图)→ cli(编排)。网络逻辑与纯逻辑分离,纯逻辑用 `tests/fixtures/` 真实截断样本离线测。

**Tech Stack:** Python 3.11+、httpx、stdlib `sqlite3`、pytest、respx(mock httpx)。

---

## 文件结构

| 文件 | 职责 |
|---|---|
| `pipeline/pyproject.toml` | 包定义、依赖、pytest 配置 |
| `pipeline/src/ad_pipeline/windrun/client.py` | httpx 客户端:基址、503/Retry-After 重试、超时 |
| `pipeline/src/ad_pipeline/windrun/endpoints.py` | 各端点路径常量 + 取顶层 `data` 子树的解析函数 |
| `pipeline/src/ad_pipeline/ids.py` | abilityId↔valveId↔heroId 映射;`is_hero_pseudo_ability` |
| `pipeline/src/ad_pipeline/transform.py` | 清洗、`isUltimate` null 对账、分桶为可入库行 |
| `pipeline/src/ad_pipeline/db/schema.sql` | SQLite DDL |
| `pipeline/src/ad_pipeline/db/loader.py` | 建库 + 各表 upsert |
| `pipeline/src/ad_pipeline/assets.py` | 拼 CDN URL + 下载技能/英雄参考图 |
| `pipeline/src/ad_pipeline/cli.py` | `python -m ad_pipeline build` 编排全流程 |
| `pipeline/tests/fixtures/*.json` | 真实 API 截断样本 |
| `pipeline/tests/test_*.py` | 各模块测试 |

---

## Task 1: 工程骨架与依赖

**Files:**
- Create: `pipeline/pyproject.toml`
- Create: `pipeline/src/ad_pipeline/__init__.py`
- Create: `pipeline/tests/__init__.py`

- [ ] **Step 1: 写 pyproject.toml**

```toml
[project]
name = "ad-pipeline"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = ["httpx>=0.27"]

[project.optional-dependencies]
dev = ["pytest>=8", "respx>=0.21"]

[build-system]
requires = ["setuptools>=68"]
build-backend = "setuptools.build_meta"

[tool.setuptools.packages.find]
where = ["src"]

[tool.pytest.ini_options]
testpaths = ["tests"]
pythonpath = ["src"]
```

- [ ] **Step 2: 建空包文件**

`pipeline/src/ad_pipeline/__init__.py`:
```python
__all__ = []
```
`pipeline/tests/__init__.py`:(空文件)

- [ ] **Step 3: 安装并验证**

Run(在 `pipeline/` 下):`python -m pip install -e ".[dev]"`
Expected: 成功,无报错。

Run:`python -m pytest -q`
Expected: `no tests ran`(0 collected),退出码 5,确认 pytest 能启动。

- [ ] **Step 4: Commit**

```bash
git add pipeline/pyproject.toml pipeline/src/ad_pipeline/__init__.py pipeline/tests/__init__.py
git commit -m "chore(pipeline): scaffold ad_pipeline python package"
```

---

## Task 2: ID 映射核心(ids.py)

英雄在 abilities 表中是「负 valveId 伪技能」(`valveId = -heroId`)。统计端点的 `abilityId` 与 `valveId` 同空间(正=真实技能,负=英雄)。本任务把这条规则固化为纯函数。

**Files:**
- Create: `pipeline/src/ad_pipeline/ids.py`
- Test: `pipeline/tests/test_ids.py`

- [ ] **Step 1: 写失败测试**

```python
# pipeline/tests/test_ids.py
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
```

- [ ] **Step 2: 跑测试确认失败**

Run:`python -m pytest tests/test_ids.py -q`
Expected: FAIL,`ModuleNotFoundError: ad_pipeline.ids`。

- [ ] **Step 3: 最小实现**

```python
# pipeline/src/ad_pipeline/ids.py
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
```

- [ ] **Step 4: 跑测试确认通过**

Run:`python -m pytest tests/test_ids.py -q`
Expected: PASS(4 passed)。

- [ ] **Step 5: Commit**

```bash
git add pipeline/src/ad_pipeline/ids.py pipeline/tests/test_ids.py
git commit -m "feat(pipeline): add abilityId/valveId/heroId mapping"
```

---

## Task 3: 端点解析(endpoints.py)

只负责「给定一段已解析的 JSON dict,取出该端点有意义的子树」。不碰网络,可纯测。

**Files:**
- Create: `pipeline/src/ad_pipeline/windrun/__init__.py`(空)
- Create: `pipeline/src/ad_pipeline/windrun/endpoints.py`
- Create: `pipeline/tests/fixtures/static_abilities.json`
- Create: `pipeline/tests/fixtures/heroes.json`
- Test: `pipeline/tests/test_endpoints.py`

- [ ] **Step 1: 落 fixture 样本(真实截断)**

`pipeline/tests/fixtures/static_abilities.json`:
```json
{"data":[
 {"englishName":"Starstorm","hasScepter":false,"hasShard":false,"isUltimate":false,"ownerHeroId":9,"shortName":"mirana_starfall","tooltip":"...","valveId":5051},
 {"englishName":"Hero: Lina","hasScepter":null,"hasShard":null,"isUltimate":null,"ownerHeroId":null,"shortName":"lina","tooltip":null,"valveId":-25},
 {"englishName":"Hotfeet Hustle","hasScepter":false,"hasShard":false,"isUltimate":null,"ownerHeroId":null,"shortName":"largo_song_double_time","tooltip":"...","valveId":1664}
]}
```

`pipeline/tests/fixtures/heroes.json`:
```json
{"data":{"patches":{"overall":["7.41b"]},"heroStats":{
 "9":{"7.41b":{"wins":29743,"numGames":59581,"winrate":0.499202766}},
 "25":{"7.41b":{"wins":18920,"numGames":38613,"winrate":0.4899904177}}
}}}
```

- [ ] **Step 2: 写失败测试**

```python
# pipeline/tests/test_endpoints.py
import json, pathlib
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
```

- [ ] **Step 3: 跑测试确认失败**

Run:`python -m pytest tests/test_endpoints.py -q`
Expected: FAIL,`ModuleNotFoundError`。

- [ ] **Step 4: 最小实现**

```python
# pipeline/src/ad_pipeline/windrun/__init__.py
__all__ = []
```

```python
# pipeline/src/ad_pipeline/windrun/endpoints.py
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
```

- [ ] **Step 5: 跑测试确认通过**

Run:`python -m pytest tests/test_endpoints.py -q`
Expected: PASS(2 passed)。

- [ ] **Step 6: Commit**

```bash
git add pipeline/src/ad_pipeline/windrun/ pipeline/tests/test_endpoints.py pipeline/tests/fixtures/static_abilities.json pipeline/tests/fixtures/heroes.json
git commit -m "feat(pipeline): add endpoint parsers with real fixtures"
```

---

## Task 4: HTTP 客户端含 503/Retry-After 重试(client.py)

**Files:**
- Create: `pipeline/src/ad_pipeline/windrun/client.py`
- Test: `pipeline/tests/test_client.py`

- [ ] **Step 1: 写失败测试(用 respx mock httpx)**

```python
# pipeline/tests/test_client.py
import httpx, respx, pytest
from ad_pipeline.windrun.client import WindrunClient

BASE = "https://api.windrun.io/api/v2"

@respx.mock
def test_get_json_returns_parsed_body():
    respx.get(f"{BASE}/static/heroes").mock(
        return_value=httpx.Response(200, json={"data": {"1": {"id": 1}}})
    )
    c = WindrunClient()
    out = c.get_json("/static/heroes")
    assert out["data"]["1"]["id"] == 1

@respx.mock
def test_retries_on_503_then_succeeds():
    route = respx.get(f"{BASE}/abilities")
    route.side_effect = [
        httpx.Response(503, headers={"Retry-After": "0"}),
        httpx.Response(200, json={"data": {"ok": True}}),
    ]
    c = WindrunClient(max_retries=3)
    out = c.get_json("/abilities")
    assert out["data"]["ok"] is True
    assert route.call_count == 2

@respx.mock
def test_gives_up_after_max_retries():
    respx.get(f"{BASE}/abilities").mock(
        return_value=httpx.Response(503, headers={"Retry-After": "0"})
    )
    c = WindrunClient(max_retries=2)
    with pytest.raises(httpx.HTTPStatusError):
        c.get_json("/abilities")
```

- [ ] **Step 2: 跑测试确认失败**

Run:`python -m pytest tests/test_client.py -q`
Expected: FAIL,`ModuleNotFoundError`。

- [ ] **Step 3: 最小实现**

```python
# pipeline/src/ad_pipeline/windrun/client.py
"""Windrun v2 REST 客户端。处理 503 + Retry-After(计划书 §六)。"""
import time
import httpx

BASE_URL = "https://api.windrun.io/api/v2"

class WindrunClient:
    def __init__(self, base_url: str = BASE_URL, max_retries: int = 4,
                 timeout: float = 30.0, sleep=time.sleep):
        self._client = httpx.Client(base_url=base_url, timeout=timeout,
                                    headers={"Accept": "application/json"})
        self._max_retries = max_retries
        self._sleep = sleep

    def get_json(self, path: str) -> dict:
        last: httpx.Response | None = None
        for attempt in range(self._max_retries):
            resp = self._client.get(path)
            if resp.status_code == 503:
                last = resp
                retry_after = float(resp.headers.get("Retry-After", "1"))
                self._sleep(retry_after)
                continue
            resp.raise_for_status()
            return resp.json()
        assert last is not None
        last.raise_for_status()  # 抛出最终 503

    def close(self) -> None:
        self._client.close()
```

- [ ] **Step 4: 跑测试确认通过**

Run:`python -m pytest tests/test_client.py -q`
Expected: PASS(3 passed)。

- [ ] **Step 5: Commit**

```bash
git add pipeline/src/ad_pipeline/windrun/client.py pipeline/tests/test_client.py
git commit -m "feat(pipeline): windrun http client with 503/Retry-After handling"
```

---

## Task 5: 清洗与 isUltimate 对账(transform.py)

`isUltimate` 有 672 项为 null(含英雄伪技能 + 部分歌曲技能)。规则:英雄伪技能(负 valveId)归为 slot_type=`hero`;真实技能 `isUltimate=true` → `ultimate`,`false` → `normal`;真实技能 `isUltimate=null` → 标记 `slot_type='normal'` 但置 `needs_review=1`,**不静默默认**(计划书硬性要求)。

**Files:**
- Create: `pipeline/src/ad_pipeline/transform.py`
- Test: `pipeline/tests/test_transform.py`

- [ ] **Step 1: 写失败测试**

```python
# pipeline/tests/test_transform.py
from ad_pipeline.transform import classify_ability_rows

ROWS = [
    {"valveId":5051,"shortName":"mirana_starfall","englishName":"Starstorm",
     "isUltimate":False,"hasScepter":False,"hasShard":False,"ownerHeroId":9},
    {"valveId":-25,"shortName":"lina","englishName":"Hero: Lina",
     "isUltimate":None,"hasScepter":None,"hasShard":None,"ownerHeroId":None},
    {"valveId":1664,"shortName":"largo_song_double_time","englishName":"Hotfeet Hustle",
     "isUltimate":None,"hasScepter":False,"hasShard":False,"ownerHeroId":None},
    {"valveId":5048,"shortName":"mirana_arrow","englishName":"Sacred Arrow",
     "isUltimate":True,"hasScepter":True,"hasShard":False,"ownerHeroId":9},
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
```

- [ ] **Step 2: 跑测试确认失败**

Run:`python -m pytest tests/test_transform.py -q`
Expected: FAIL,`ModuleNotFoundError`。

- [ ] **Step 3: 最小实现**

```python
# pipeline/src/ad_pipeline/transform.py
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
```

- [ ] **Step 4: 跑测试确认通过**

Run:`python -m pytest tests/test_transform.py -q`
Expected: PASS(3 passed)。

- [ ] **Step 5: Commit**

```bash
git add pipeline/src/ad_pipeline/transform.py pipeline/tests/test_transform.py
git commit -m "feat(pipeline): classify ability slot_type with isUltimate null reconciliation"
```

---

## Task 6: SQLite schema + loader(db/)

**Files:**
- Create: `pipeline/src/ad_pipeline/db/__init__.py`(空)
- Create: `pipeline/src/ad_pipeline/db/schema.sql`
- Create: `pipeline/src/ad_pipeline/db/loader.py`
- Test: `pipeline/tests/test_loader.py`

- [ ] **Step 1: 写 schema.sql**

```sql
-- pipeline/src/ad_pipeline/db/schema.sql
CREATE TABLE IF NOT EXISTS heroes (
  hero_id     INTEGER PRIMARY KEY,
  short_name  TEXT NOT NULL,
  english_name TEXT NOT NULL,
  picture     TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS abilities (
  valve_id      INTEGER PRIMARY KEY,   -- 负=英雄伪技能(=-heroId)
  short_name    TEXT NOT NULL,
  english_name  TEXT NOT NULL,
  slot_type     TEXT NOT NULL CHECK (slot_type IN ('hero','normal','ultimate')),
  is_ultimate   INTEGER,               -- 原始 boolean|null:1/0/NULL
  has_scepter   INTEGER,
  has_shard     INTEGER,
  owner_hero_id INTEGER,
  needs_review  INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS ability_winrate (
  ability_id INTEGER PRIMARY KEY,      -- = valve_id 空间
  patch      TEXT NOT NULL,
  num_picks  INTEGER, wins INTEGER, winrate REAL,
  avg_pick_position REAL, pick_rate REAL
);
CREATE TABLE IF NOT EXISTS hero_winrate (
  hero_id INTEGER PRIMARY KEY,
  patch   TEXT NOT NULL,
  wins INTEGER, num_games INTEGER, winrate REAL
);
CREATE TABLE IF NOT EXISTS ability_pairs (
  ability_id_one INTEGER NOT NULL,
  ability_id_two INTEGER NOT NULL,
  num_picks INTEGER, wins INTEGER, winrate REAL,
  PRIMARY KEY (ability_id_one, ability_id_two)
);
CREATE TABLE IF NOT EXISTS ability_hero_attr (
  ability_id INTEGER NOT NULL,
  attr       TEXT NOT NULL,           -- str/agi/int/uni/ranged/melee
  winrate REAL, num_picks INTEGER,
  PRIMARY KEY (ability_id, attr)
);
CREATE TABLE IF NOT EXISTS ability_aghs (
  ability_id INTEGER PRIMARY KEY,
  scepter_gain REAL,   -- aghsScepter.winrate - noAghsScepter.winrate
  shard_gain   REAL    -- aghsShard.winrate   - noAghsShard.winrate
);
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY, value TEXT
);
```

- [ ] **Step 2: 写失败测试**

```python
# pipeline/tests/test_loader.py
import sqlite3
from ad_pipeline.db.loader import create_db, upsert_abilities, upsert_aghs

def test_create_db_has_tables(tmp_path):
    db = tmp_path / "ref.db"
    create_db(db)
    conn = sqlite3.connect(db)
    names = {r[0] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table'")}
    assert {"heroes","abilities","ability_winrate","hero_winrate",
            "ability_pairs","ability_hero_attr","ability_aghs"} <= names

def test_upsert_abilities_is_idempotent(tmp_path):
    db = tmp_path / "ref.db"; create_db(db)
    rows = [{"valveId":5051,"shortName":"mirana_starfall","englishName":"Starstorm",
             "slot_type":"normal","is_ultimate":False,"has_scepter":False,
             "has_shard":False,"owner_hero_id":9,"needs_review":0}]
    upsert_abilities(db, rows); upsert_abilities(db, rows)  # 跑两次
    conn = sqlite3.connect(db)
    assert conn.execute("SELECT COUNT(*) FROM abilities").fetchone()[0] == 1

def test_upsert_aghs_computes_gain(tmp_path):
    db = tmp_path / "ref.db"; create_db(db)
    raw = [{"abilityId":-155,
            "noAghsScepter":{"winrate":0.50},"aghsScepter":{"winrate":0.578},
            "noAghsShard":{"winrate":0.524},"aghsShard":{"winrate":0.571}}]
    upsert_aghs(db, raw)
    conn = sqlite3.connect(db)
    s = conn.execute("SELECT scepter_gain, shard_gain FROM ability_aghs WHERE ability_id=-155").fetchone()
    assert round(s[0], 3) == 0.078
    assert round(s[1], 3) == 0.047
```

- [ ] **Step 3: 跑测试确认失败**

Run:`python -m pytest tests/test_loader.py -q`
Expected: FAIL,`ModuleNotFoundError`。

- [ ] **Step 4: 最小实现**

```python
# pipeline/src/ad_pipeline/db/__init__.py
__all__ = []
```

```python
# pipeline/src/ad_pipeline/db/loader.py
"""建库 + upsert。SQLite,只读消费方为 TS core/。"""
import sqlite3
from pathlib import Path
from importlib import resources

def _schema_sql() -> str:
    return (Path(__file__).parent / "schema.sql").read_text(encoding="utf-8")

def create_db(db_path: Path) -> None:
    conn = sqlite3.connect(db_path)
    try:
        conn.executescript(_schema_sql())
        conn.commit()
    finally:
        conn.close()

def _conn(db_path: Path) -> sqlite3.Connection:
    c = sqlite3.connect(db_path)
    c.execute("PRAGMA foreign_keys=ON")
    return c

def upsert_abilities(db_path: Path, rows: list[dict]) -> None:
    conn = _conn(db_path)
    try:
        conn.executemany(
            """INSERT INTO abilities
               (valve_id, short_name, english_name, slot_type, is_ultimate,
                has_scepter, has_shard, owner_hero_id, needs_review)
               VALUES (:valveId,:shortName,:englishName,:slot_type,:is_ultimate,
                       :has_scepter,:has_shard,:owner_hero_id,:needs_review)
               ON CONFLICT(valve_id) DO UPDATE SET
                 short_name=excluded.short_name, english_name=excluded.english_name,
                 slot_type=excluded.slot_type, is_ultimate=excluded.is_ultimate,
                 has_scepter=excluded.has_scepter, has_shard=excluded.has_shard,
                 owner_hero_id=excluded.owner_hero_id, needs_review=excluded.needs_review""",
            rows)
        conn.commit()
    finally:
        conn.close()

def upsert_aghs(db_path: Path, raw_rows: list[dict]) -> None:
    rows = [{
        "ability_id": r["abilityId"],
        "scepter_gain": r["aghsScepter"]["winrate"] - r["noAghsScepter"]["winrate"],
        "shard_gain": r["aghsShard"]["winrate"] - r["noAghsShard"]["winrate"],
    } for r in raw_rows]
    conn = _conn(db_path)
    try:
        conn.executemany(
            """INSERT INTO ability_aghs (ability_id, scepter_gain, shard_gain)
               VALUES (:ability_id,:scepter_gain,:shard_gain)
               ON CONFLICT(ability_id) DO UPDATE SET
                 scepter_gain=excluded.scepter_gain, shard_gain=excluded.shard_gain""",
            rows)
        conn.commit()
    finally:
        conn.close()
```

- [ ] **Step 5: 跑测试确认通过**

Run:`python -m pytest tests/test_loader.py -q`
Expected: PASS(3 passed)。

- [ ] **Step 6: Commit**

```bash
git add pipeline/src/ad_pipeline/db/ pipeline/tests/test_loader.py
git commit -m "feat(pipeline): sqlite schema + abilities/aghs loaders"
```

---

## Task 7: 其余 loader(heroes / winrates / pairs / hero-attr)

补齐 Task 6 未覆盖的 upsert。

**Files:**
- Modify: `pipeline/src/ad_pipeline/db/loader.py`(追加 4 个函数)
- Test: `pipeline/tests/test_loader_rest.py`

- [ ] **Step 1: 写失败测试**

```python
# pipeline/tests/test_loader_rest.py
import sqlite3
from ad_pipeline.db.loader import (
    create_db, upsert_heroes, upsert_hero_winrates,
    upsert_ability_winrates, upsert_ability_pairs, upsert_ability_hero_attrs)

def test_upsert_heroes(tmp_path):
    db = tmp_path/"r.db"; create_db(db)
    upsert_heroes(db, {9:{"id":9,"shortName":"mirana","englishName":"Mirana","picture":"mirana"}})
    c = sqlite3.connect(db)
    assert c.execute("SELECT picture FROM heroes WHERE hero_id=9").fetchone()[0]=="mirana"

def test_upsert_hero_winrates(tmp_path):
    db = tmp_path/"r.db"; create_db(db)
    upsert_hero_winrates(db, {9:{"wins":1,"numGames":2,"winrate":0.5,"patch":"7.41b"}})
    c = sqlite3.connect(db)
    assert c.execute("SELECT num_games FROM hero_winrate WHERE hero_id=9").fetchone()[0]==2

def test_upsert_ability_winrates(tmp_path):
    db = tmp_path/"r.db"; create_db(db)
    upsert_ability_winrates(db, [{"abilityId":5051,"numPicks":100,"wins":55,
        "winrate":0.55,"avgPickPosition":8.4,"pickRate":0.95}], patch="7.41b")
    c = sqlite3.connect(db)
    assert c.execute("SELECT winrate FROM ability_winrate WHERE ability_id=5051").fetchone()[0]==0.55

def test_upsert_pairs_and_attrs(tmp_path):
    db = tmp_path/"r.db"; create_db(db)
    upsert_ability_pairs(db, [{"abilityIdOne":-23,"abilityIdTwo":5032,
        "numPicks":10,"wins":6,"winrate":0.6}])
    upsert_ability_hero_attrs(db, {"str":{5120:{"winrate":0.49,"numPicks":11481}}})
    c = sqlite3.connect(db)
    assert c.execute("SELECT winrate FROM ability_pairs WHERE ability_id_one=-23").fetchone()[0]==0.6
    assert c.execute("SELECT winrate FROM ability_hero_attr WHERE ability_id=5120 AND attr='str'").fetchone()[0]==0.49
```

- [ ] **Step 2: 跑测试确认失败**

Run:`python -m pytest tests/test_loader_rest.py -q`
Expected: FAIL,`ImportError`(函数不存在)。

- [ ] **Step 3: 追加实现到 loader.py**

```python
# 追加到 pipeline/src/ad_pipeline/db/loader.py 末尾

def upsert_heroes(db_path, heroes: dict) -> None:
    rows = [{"hero_id":h["id"],"short_name":h["shortName"],
             "english_name":h["englishName"],"picture":h["picture"]}
            for h in heroes.values()]
    conn = _conn(db_path)
    try:
        conn.executemany(
            """INSERT INTO heroes (hero_id, short_name, english_name, picture)
               VALUES (:hero_id,:short_name,:english_name,:picture)
               ON CONFLICT(hero_id) DO UPDATE SET
                 short_name=excluded.short_name, english_name=excluded.english_name,
                 picture=excluded.picture""", rows)
        conn.commit()
    finally:
        conn.close()

def upsert_hero_winrates(db_path, winrates: dict) -> None:
    rows = [{"hero_id":hid,"patch":r["patch"],"wins":r["wins"],
             "num_games":r["numGames"],"winrate":r["winrate"]}
            for hid, r in winrates.items()]
    conn = _conn(db_path)
    try:
        conn.executemany(
            """INSERT INTO hero_winrate (hero_id, patch, wins, num_games, winrate)
               VALUES (:hero_id,:patch,:wins,:num_games,:winrate)
               ON CONFLICT(hero_id) DO UPDATE SET
                 patch=excluded.patch, wins=excluded.wins,
                 num_games=excluded.num_games, winrate=excluded.winrate""", rows)
        conn.commit()
    finally:
        conn.close()

def upsert_ability_winrates(db_path, raw_rows: list[dict], patch: str) -> None:
    rows = [{"ability_id":r["abilityId"],"patch":patch,"num_picks":r["numPicks"],
             "wins":r["wins"],"winrate":r["winrate"],
             "avg_pick_position":r.get("avgPickPosition"),"pick_rate":r.get("pickRate")}
            for r in raw_rows]
    conn = _conn(db_path)
    try:
        conn.executemany(
            """INSERT INTO ability_winrate
               (ability_id, patch, num_picks, wins, winrate, avg_pick_position, pick_rate)
               VALUES (:ability_id,:patch,:num_picks,:wins,:winrate,:avg_pick_position,:pick_rate)
               ON CONFLICT(ability_id) DO UPDATE SET
                 patch=excluded.patch, num_picks=excluded.num_picks, wins=excluded.wins,
                 winrate=excluded.winrate, avg_pick_position=excluded.avg_pick_position,
                 pick_rate=excluded.pick_rate""", rows)
        conn.commit()
    finally:
        conn.close()

def upsert_ability_pairs(db_path, raw_rows: list[dict]) -> None:
    rows = [{"ability_id_one":r["abilityIdOne"],"ability_id_two":r["abilityIdTwo"],
             "num_picks":r["numPicks"],"wins":r["wins"],"winrate":r["winrate"]}
            for r in raw_rows]
    conn = _conn(db_path)
    try:
        conn.executemany(
            """INSERT INTO ability_pairs
               (ability_id_one, ability_id_two, num_picks, wins, winrate)
               VALUES (:ability_id_one,:ability_id_two,:num_picks,:wins,:winrate)
               ON CONFLICT(ability_id_one, ability_id_two) DO UPDATE SET
                 num_picks=excluded.num_picks, wins=excluded.wins, winrate=excluded.winrate""", rows)
        conn.commit()
    finally:
        conn.close()

def upsert_ability_hero_attrs(db_path, by_attr: dict) -> None:
    rows = []
    for attr, m in by_attr.items():
        for aid, r in m.items():
            rows.append({"ability_id":aid,"attr":attr,
                         "winrate":r["winrate"],"num_picks":r.get("numPicks")})
    conn = _conn(db_path)
    try:
        conn.executemany(
            """INSERT INTO ability_hero_attr (ability_id, attr, winrate, num_picks)
               VALUES (:ability_id,:attr,:winrate,:num_picks)
               ON CONFLICT(ability_id, attr) DO UPDATE SET
                 winrate=excluded.winrate, num_picks=excluded.num_picks""", rows)
        conn.commit()
    finally:
        conn.close()
```

- [ ] **Step 4: 跑测试确认通过**

Run:`python -m pytest tests/test_loader_rest.py -q`
Expected: PASS(4 passed)。

- [ ] **Step 5: Commit**

```bash
git add pipeline/src/ad_pipeline/db/loader.py pipeline/tests/test_loader_rest.py
git commit -m "feat(pipeline): loaders for heroes/winrates/pairs/hero-attrs"
```

---

## Task 8: CDN 参考图下载(assets.py)

为阶段 1 模板匹配备图。**默认 dry-run**:只生成 URL 清单,实际下载由显式标志触发,避免测试打真网。

**Files:**
- Create: `pipeline/src/ad_pipeline/assets.py`
- Test: `pipeline/tests/test_assets.py`

- [ ] **Step 1: 写失败测试**

```python
# pipeline/tests/test_assets.py
from ad_pipeline.assets import ability_sprite_url, hero_full_url, hero_mini_url, build_asset_manifest

def test_url_builders():
    assert ability_sprite_url("mirana_starfall") == \
        "https://cdn.datdota.com/images/ability/mirana_starfall.png"
    assert hero_full_url("mirana") == \
        "https://cdn.datdota.com/images/heroes/mirana_full.png"
    assert hero_mini_url("mirana") == \
        "https://cdn.datdota.com/images/miniheroes/mirana.png"

def test_manifest_covers_abilities_and_heroes():
    abilities = [{"shortName":"mirana_starfall","slot_type":"normal"},
                 {"shortName":"lina","slot_type":"hero"}]  # hero pseudo-ability
    heroes = {9:{"picture":"mirana"}}
    manifest = build_asset_manifest(abilities, heroes)
    urls = {m["url"] for m in manifest}
    # 真实技能 → ability sprite;英雄 → mini 头像;不为 hero 伪技能拼 ability sprite
    assert "https://cdn.datdota.com/images/ability/mirana_starfall.png" in urls
    assert "https://cdn.datdota.com/images/miniheroes/mirana.png" in urls
    assert "https://cdn.datdota.com/images/ability/lina.png" not in urls
```

- [ ] **Step 2: 跑测试确认失败**

Run:`python -m pytest tests/test_assets.py -q`
Expected: FAIL,`ModuleNotFoundError`。

- [ ] **Step 3: 最小实现**

```python
# pipeline/src/ad_pipeline/assets.py
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
        manifest.append({"kind":"ability","key":a["shortName"],
                         "url":ability_sprite_url(a["shortName"]),
                         "filename":f"ability/{a['shortName']}.png"})
    for hid, h in heroes.items():
        manifest.append({"kind":"hero","key":h["picture"],
                         "url":hero_mini_url(h["picture"]),
                         "filename":f"hero/{h['picture']}.png"})
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
```

- [ ] **Step 4: 跑测试确认通过**

Run:`python -m pytest tests/test_assets.py -q`
Expected: PASS(2 passed)。

- [ ] **Step 5: Commit**

```bash
git add pipeline/src/ad_pipeline/assets.py pipeline/tests/test_assets.py
git commit -m "feat(pipeline): datdota CDN asset url builders + manifest"
```

---

## Task 9: CLI 编排(cli.py)

把全流程串成 `python -m ad_pipeline build`。网络注入可替换的 client,使编排逻辑可测。

**Files:**
- Create: `pipeline/src/ad_pipeline/cli.py`
- Create: `pipeline/src/ad_pipeline/__main__.py`
- Test: `pipeline/tests/test_cli.py`

- [ ] **Step 1: 写失败测试(注入假 client,断言 DB 被填)**

```python
# pipeline/tests/test_cli.py
import json, pathlib, sqlite3
from ad_pipeline.cli import build

FIX = pathlib.Path(__file__).parent / "fixtures"

class FakeClient:
    """按 path 返回对应 fixture。"""
    _MAP = {
        "/static/abilities": "static_abilities.json",
        "/static/heroes": "static_heroes.json",
        "/heroes": "heroes.json",
        "/abilities": "abilities.json",
        "/ability-pairs": "ability_pairs.json",
        "/ability-hero-attributes": "ability_hero_attributes.json",
        "/ability-aghs": "ability_aghs.json",
    }
    def get_json(self, path):
        return json.loads((FIX / self._MAP[path]).read_text(encoding="utf-8"))
    def close(self): ...

def test_build_populates_db(tmp_path):
    db = tmp_path / "reference.db"
    build(db_path=db, client=FakeClient(), download_assets=False)
    conn = sqlite3.connect(db)
    assert conn.execute("SELECT COUNT(*) FROM abilities").fetchone()[0] >= 1
    assert conn.execute("SELECT COUNT(*) FROM heroes").fetchone()[0] >= 1
    assert conn.execute("SELECT COUNT(*) FROM ability_aghs").fetchone()[0] >= 1
    # meta 记录补丁
    assert conn.execute("SELECT value FROM meta WHERE key='patch'").fetchone()[0] == "7.41b"
```

需要补齐 fixtures(从真实 API 各截 2–3 条):`static_heroes.json`、`abilities.json`、`ability_pairs.json`、`ability_hero_attributes.json`、`ability_aghs.json`。最小形状示例:

`abilities.json`:
```json
{"data":{"patches":{"overall":["7.41b"]},"abilityStats":[
 {"abilityId":5051,"numPicks":100,"wins":55,"winrate":0.55,"avgPickPosition":8.4,"pickRate":0.95,"ownerHero":9}]}}
```
`static_heroes.json`:
```json
{"data":{"9":{"id":9,"englishName":"Mirana","shortName":"mirana","picture":"mirana","npc":"npc_dota_hero_mirana","cdota":"CDOTA_Unit_Hero_Mirana"}}}
```
`ability_pairs.json`:
```json
{"data":{"patches":{"overall":["7.41b"]},"abilityPairs":[
 {"abilityIdOne":-23,"abilityIdTwo":5032,"numPicks":100,"wins":51,"winrate":0.51}]}}
```
`ability_hero_attributes.json`:
```json
{"data":{"patches":{"overall":["7.41b"]},"abilityHeroAttributeStats":{
 "str":{"5120":{"abilityId":5120,"numPicks":11481,"wins":5636,"winrate":0.4908980054}}}}}
```
`ability_aghs.json`:
```json
{"data":{"patches":{"overall":["7.41b"]},"abilityAghs":[
 {"abilityId":-155,"totalGames":48813,
  "noAghsScepter":{"winrate":0.5034638246},"aghsScepter":{"winrate":0.5778933574},
  "noAghsShard":{"winrate":0.5242709224},"aghsShard":{"winrate":0.5707985144}}]}}
```

- [ ] **Step 2: 跑测试确认失败**

Run:`python -m pytest tests/test_cli.py -q`
Expected: FAIL,`ModuleNotFoundError: ad_pipeline.cli`。

- [ ] **Step 3: 最小实现**

```python
# pipeline/src/ad_pipeline/cli.py
"""编排:采集 → 解析 → 清洗 → 落库。`python -m ad_pipeline build`。"""
import argparse
from pathlib import Path
from .windrun.client import WindrunClient
from .windrun import endpoints as ep
from .transform import classify_ability_rows
from .db import loader

def build(db_path: Path, client, download_assets: bool = False) -> None:
    # download_assets 预留给阶段1的 build-index;阶段0 仅建 DB,此处不下载图。
    _ = download_assets
    raw_static_ab = client.get_json(ep.PATHS["static_abilities"])
    raw_static_he = client.get_json(ep.PATHS["static_heroes"])
    raw_he_wr     = client.get_json(ep.PATHS["hero_winrates"])
    raw_ab_wr     = client.get_json(ep.PATHS["ability_winrates"])
    raw_pairs     = client.get_json(ep.PATHS["ability_pairs"])
    raw_attrs     = client.get_json(ep.PATHS["ability_hero_attributes"])
    raw_aghs      = client.get_json(ep.PATHS["ability_aghs"])

    abilities = ep.parse_static_abilities(raw_static_ab)
    heroes    = ep.parse_static_heroes(raw_static_he)
    hero_wr   = ep.parse_hero_winrates(raw_he_wr)
    ab_wr     = ep.parse_ability_winrates(raw_ab_wr)
    pairs     = ep.parse_ability_pairs(raw_pairs)
    attrs     = ep.parse_ability_hero_attributes(raw_attrs)
    aghs      = ep.parse_ability_aghs(raw_aghs)
    patch     = raw_ab_wr["data"]["patches"]["overall"][0]

    loader.create_db(db_path)
    loader.upsert_abilities(db_path, classify_ability_rows(abilities))
    loader.upsert_heroes(db_path, heroes)
    loader.upsert_hero_winrates(db_path, hero_wr)
    loader.upsert_ability_winrates(db_path, ab_wr, patch=patch)
    loader.upsert_ability_pairs(db_path, pairs)
    loader.upsert_ability_hero_attrs(db_path, attrs)
    loader.upsert_aghs(db_path, aghs)
    _set_meta(db_path, "patch", patch)

def _set_meta(db_path: Path, key: str, value: str) -> None:
    import sqlite3
    conn = sqlite3.connect(db_path)
    try:
        conn.execute(
            "INSERT INTO meta (key,value) VALUES (?,?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value", (key, value))
        conn.commit()
    finally:
        conn.close()

def main(argv=None) -> int:
    p = argparse.ArgumentParser(prog="ad_pipeline")
    sub = p.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("build", help="build reference.db from Windrun API")
    b.add_argument("--out", type=Path, default=Path("out/reference.db"))
    b.add_argument("--download-assets", action="store_true")
    args = p.parse_args(argv)
    if args.cmd == "build":
        args.out.parent.mkdir(parents=True, exist_ok=True)
        client = WindrunClient()
        try:
            build(args.out, client, download_assets=args.download_assets)
        finally:
            client.close()
        print(f"built {args.out}")
    return 0
```

```python
# pipeline/src/ad_pipeline/__main__.py
import sys
from .cli import main
sys.exit(main())
```

- [ ] **Step 4: 跑测试确认通过**

Run:`python -m pytest tests/test_cli.py -q`
Expected: PASS(1 passed)。

- [ ] **Step 5: Commit**

```bash
git add pipeline/src/ad_pipeline/cli.py pipeline/src/ad_pipeline/__main__.py pipeline/tests/test_cli.py pipeline/tests/fixtures/
git commit -m "feat(pipeline): build CLI orchestrating full reference.db build"
```

---

## Task 10: 端到端冒烟(打真网,手动)+ 全量测试

**Files:**
- Create: `pipeline/tests/test_smoke_live.py`(标记 `@pytest.mark.live`,默认跳过)
- Modify: `pipeline/pyproject.toml`(注册 `live` marker)

- [ ] **Step 1: 注册 marker**

在 `[tool.pytest.ini_options]` 增加:
```toml
markers = ["live: hits the real Windrun API (skipped by default)"]
addopts = "-m 'not live'"
```

- [ ] **Step 2: 写 live 冒烟测试**

```python
# pipeline/tests/test_smoke_live.py
import pytest, sqlite3
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
```

- [ ] **Step 3: 跑默认套件(应跳过 live)**

Run:`python -m pytest -q`
Expected: 全部 PASS,live 测试 deselected。

- [ ] **Step 4: 手动跑 live 冒烟(需联网)**

Run:`python -m pytest -m live -q`
Expected: PASS。若遇 503,客户端自动重试通过。

- [ ] **Step 5: 手动跑真实构建并抽查**

Run:`python -m ad_pipeline build --out out/reference.db`
Expected: 打印 `built out/reference.db`。

Run(抽查神杖收益):
```bash
python -c "import sqlite3;c=sqlite3.connect('out/reference.db');print(c.execute('SELECT ability_id,scepter_gain FROM ability_aghs ORDER BY scepter_gain DESC LIMIT 3').fetchall())"
```
Expected: 输出 3 条按神杖收益降序的技能,scepter_gain 为正数(如 ~0.07)。

- [ ] **Step 6: Commit**

```bash
git add pipeline/tests/test_smoke_live.py pipeline/pyproject.toml
git commit -m "test(pipeline): live smoke build against real Windrun API"
```

---

## 阶段 0 验收清单(对应计划书 §十「阶段 0」)

- [ ] `python -m pytest -q` 全绿(离线套件,不打网)。
- [ ] `python -m ad_pipeline build --out out/reference.db` 一条命令从零重建 DB。
- [ ] 验收门:**能离线查询任一技能/英雄的胜率/搭配数据** —— Task 10 Step 5 抽查通过。
- [ ] ID 模型正确:负 abilityId 作为英雄、正为技能,pairs 中混合存在(`test_ids` + live 计数)。
- [ ] `isUltimate=null` 的真实技能均 `needs_review=1`,未被静默当普通技能。
- [ ] 神杖/蓝杖收益 = 有杖减无杖胜率差,已落 `ability_aghs`。
- [ ] `.gitignore` 含 `pipeline/out/`(产物不入库)。

> **下一步依赖:** `out/reference.db` → 阶段 3 打分内核(`core/` 只读);assets manifest + 下载 → 阶段 1 模板库。
