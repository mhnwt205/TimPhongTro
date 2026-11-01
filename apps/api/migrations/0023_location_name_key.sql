-- The CMS computes name_key with Unicode normalization because SQLite NOCASE
-- only handles ASCII. Keep this index partial so existing rows can be checked
-- and backfilled safely by the API without making this migration fail if old
-- data already contains equivalent Vietnamese spellings.
ALTER TABLE locations ADD COLUMN name_key TEXT NOT NULL DEFAULT '';
CREATE UNIQUE INDEX locations_name_key_unique ON locations(name_key) WHERE name_key <> '';
