-- The regular German LTB main series now extends through volume 618.
-- SQLite CHECK constraints require rebuilding the table to widen the range.
PRAGMA foreign_keys = OFF;

CREATE TABLE collection_items_expanded (
  user_id TEXT NOT NULL REFERENCES users(id),
  edition_id INTEGER NOT NULL CHECK (edition_id BETWEEN 1 AND 618),
  owned INTEGER NOT NULL DEFAULT 0 CHECK (owned IN (0, 1)),
  first_edition INTEGER NOT NULL DEFAULT 1 CHECK (first_edition IN (0, 1)),
  print_id TEXT NOT NULL DEFAULT 'original',
  notes TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, edition_id)
);

INSERT INTO collection_items_expanded (user_id, edition_id, owned, first_edition, print_id, notes, updated_at)
SELECT user_id, edition_id, owned, first_edition, print_id, notes, updated_at
FROM collection_items;

DROP TABLE collection_items;
ALTER TABLE collection_items_expanded RENAME TO collection_items;
CREATE INDEX IF NOT EXISTS idx_collection_user ON collection_items(user_id);

PRAGMA foreign_keys = ON;
