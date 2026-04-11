-- Rules engine table
CREATE TABLE IF NOT EXISTS rules (
  id              TEXT PRIMARY KEY,
  type            TEXT NOT NULL,
  rule            TEXT NOT NULL,
  scope           TEXT NOT NULL,
  severity        TEXT,
  confidence      REAL,
  source          TEXT,
  source_detail   TEXT,
  times_applied   INTEGER DEFAULT 0,
  times_violated  INTEGER DEFAULT 0,
  check_pattern   TEXT,
  prevention      TEXT,
  active          INTEGER DEFAULT 1,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
