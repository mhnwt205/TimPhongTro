ALTER TABLE listing_plans
  ADD COLUMN description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 500);
