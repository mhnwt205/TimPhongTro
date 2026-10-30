ALTER TABLE listing_plans
  ADD COLUMN is_priority INTEGER NOT NULL DEFAULT 0 CHECK (is_priority IN (0, 1));
