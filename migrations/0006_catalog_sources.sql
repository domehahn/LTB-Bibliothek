CREATE TABLE IF NOT EXISTS catalog_sources (
  source_id INTEGER PRIMARY KEY AUTOINCREMENT,
  edition_key TEXT NOT NULL,
  source_name TEXT NOT NULL CHECK (source_name IN ('egmont', 'duckipedia')),
  source_url TEXT NOT NULL,
  title TEXT,
  publication_date TEXT,
  print_year INTEGER,
  fetched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (edition_key, source_name)
);

CREATE TABLE IF NOT EXISTS catalog_conflicts (
  conflict_id INTEGER PRIMARY KEY AUTOINCREMENT,
  edition_key TEXT NOT NULL,
  field_name TEXT NOT NULL,
  egmont_value TEXT,
  duckipedia_value TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'accepted', 'dismissed')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
