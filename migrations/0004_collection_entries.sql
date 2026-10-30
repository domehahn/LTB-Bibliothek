-- Collection entries support all LTB series, multiple copies and collector metadata.
CREATE TABLE IF NOT EXISTS collection_entries (
  item_id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  edition_key TEXT NOT NULL,
  owned INTEGER NOT NULL DEFAULT 1 CHECK (owned IN (0, 1)),
  first_edition INTEGER NOT NULL DEFAULT 1 CHECK (first_edition IN (0, 1)),
  print_id TEXT NOT NULL DEFAULT 'original',
  condition TEXT NOT NULL DEFAULT 'unbekannt',
  purchase_price REAL,
  purchase_date TEXT,
  location TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_collection_entries_user ON collection_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_collection_entries_edition ON collection_entries(user_id, edition_key);

INSERT INTO collection_entries (user_id, edition_key, owned, first_edition, print_id, notes, created_at, updated_at)
SELECT user_id, 'main:' || edition_id, owned, first_edition, print_id, notes, updated_at, updated_at
FROM collection_items
WHERE NOT EXISTS (
  SELECT 1 FROM collection_entries e
  WHERE e.user_id = collection_items.user_id
    AND e.edition_key = 'main:' || collection_items.edition_id
);
