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
