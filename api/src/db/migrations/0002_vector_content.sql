-- Vector content table — stores the raw text that each vector embedding
-- corresponds to. Vectorize only stores the numbers; we keep the source
-- text here so we can return it alongside search results.
CREATE TABLE IF NOT EXISTS vector_content (
  vector_id     TEXT PRIMARY KEY,
  content       TEXT NOT NULL,
  content_type  TEXT NOT NULL,
  service       TEXT NOT NULL,
  file_path     TEXT,
  identifier    TEXT,
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
