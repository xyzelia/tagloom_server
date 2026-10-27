// 词库 v4 的建表语句，与 doc/CATALOG_DB.md 第 3 节一致。只有基础数据，不含检索用的派生数据。
export const SCHEMA_VERSION = 4

export const SCHEMA_SQL = `
PRAGMA user_version = ${SCHEMA_VERSION};

CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;

CREATE TABLE category (
  path     TEXT PRIMARY KEY,
  label_en TEXT NOT NULL DEFAULT '',
  label_ja TEXT NOT NULL DEFAULT '',
  label_zh TEXT NOT NULL DEFAULT ''
) WITHOUT ROWID;

CREATE TABLE tag (
  name          TEXT PRIMARY KEY,
  source_key    TEXT NOT NULL,
  category_path TEXT REFERENCES category(path),
  label_en      TEXT NOT NULL DEFAULT '',
  label_ja      TEXT NOT NULL DEFAULT '',
  label_zh      TEXT NOT NULL DEFAULT '',
  post_count    INTEGER NOT NULL DEFAULT 0 CHECK (post_count >= 0),
  restricted    INTEGER NOT NULL DEFAULT 0 CHECK (restricted IN (0, 1)),
  type          INTEGER CHECK (type IN (0, 1, 3, 4, 5)),
  zh            TEXT NOT NULL DEFAULT '',
  count         INTEGER CHECK (count >= 0),
  notes         TEXT NOT NULL DEFAULT ''
) WITHOUT ROWID;

CREATE TABLE tag_alias (
  name   TEXT NOT NULL REFERENCES tag(name),
  term   TEXT NOT NULL,
  source INTEGER NOT NULL,
  PRIMARY KEY (name, term, source)
) WITHOUT ROWID;

CREATE TABLE tag_source (
  name       TEXT NOT NULL REFERENCES tag(name),
  source     INTEGER NOT NULL,
  source_key TEXT NOT NULL,
  PRIMARY KEY (name, source)
) WITHOUT ROWID;

CREATE TABLE import_log (
  seq          INTEGER NOT NULL,
  path         TEXT NOT NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('tags-tree', 'csv')),
  name         TEXT NOT NULL,
  repository   TEXT NOT NULL DEFAULT '',
  revision     TEXT NOT NULL DEFAULT '',
  dirty        INTEGER NOT NULL DEFAULT 0,
  license      TEXT NOT NULL DEFAULT '',
  data_version TEXT NOT NULL DEFAULT '',
  imported_at  TEXT NOT NULL,
  sha256       TEXT NOT NULL,
  bytes        INTEGER NOT NULL,
  rows         INTEGER,
  PRIMARY KEY (seq, path)
) WITHOUT ROWID;
`
