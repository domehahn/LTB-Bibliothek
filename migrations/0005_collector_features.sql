ALTER TABLE collection_entries ADD COLUMN isbn TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS price_snapshots (
  snapshot_id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  edition_key TEXT NOT NULL,
  average REAL,
  median REAL,
  listing_count INTEGER NOT NULL DEFAULT 0,
  checked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_price_snapshots_user_edition ON price_snapshots(user_id, edition_key, checked_at);

CREATE TABLE IF NOT EXISTS share_links (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('wishlist', 'trade')),
  expires_at INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS correction_reports (
  report_id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  edition_key TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
