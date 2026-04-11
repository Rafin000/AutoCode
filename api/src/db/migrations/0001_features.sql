-- Features lifecycle table
CREATE TABLE IF NOT EXISTS features (
  id                    TEXT PRIMARY KEY,
  repo                  TEXT NOT NULL,
  title                 TEXT NOT NULL,
  description           TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'pending',
  implementation_plan   TEXT,
  impact_report         TEXT,
  test_results          TEXT,
  tokens_used           TEXT,
  branch_name           TEXT,
  files_created         TEXT,
  files_modified        TEXT,
  pr_url                TEXT,
  pr_number             INTEGER,
  github_repo           TEXT,
  base_branch           TEXT,
  target_repo           TEXT,
  rework_history        TEXT DEFAULT '[]',
  error                 TEXT,
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
);
