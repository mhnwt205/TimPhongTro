ALTER TABLE listing_drafts
 ADD COLUMN created_by_admin INTEGER NOT NULL DEFAULT 0 CHECK(created_by_admin IN (0,1));
