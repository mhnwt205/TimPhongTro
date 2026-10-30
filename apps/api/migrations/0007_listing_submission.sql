ALTER TABLE listing_drafts ADD COLUMN status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN('draft','pending','published','rejected'));
ALTER TABLE listing_drafts ADD COLUMN details TEXT NOT NULL DEFAULT '{}';
ALTER TABLE listing_drafts ADD COLUMN plan_id TEXT REFERENCES listing_plans(id);
ALTER TABLE listing_drafts ADD COLUMN review_note TEXT NOT NULL DEFAULT '';
ALTER TABLE listing_drafts ADD COLUMN submitted_at INTEGER;
ALTER TABLE listing_drafts ADD COLUMN published_at INTEGER;
ALTER TABLE listing_drafts ADD COLUMN expires_at INTEGER;
ALTER TABLE listing_drafts ADD COLUMN public_data TEXT;
CREATE INDEX listing_owner_status_idx ON listing_drafts(owner_id,status,updated_at DESC);
CREATE TABLE listing_images (
 id TEXT PRIMARY KEY,owner_id TEXT NOT NULL REFERENCES users(id),object_key TEXT NOT NULL UNIQUE,
 bytes INTEGER NOT NULL CHECK(bytes BETWEEN 1 AND 614400),width INTEGER NOT NULL,height INTEGER NOT NULL,
 created_at INTEGER NOT NULL DEFAULT(unixepoch())
);
CREATE INDEX listing_images_owner_idx ON listing_images(owner_id,created_at);
CREATE TABLE listing_reviews (
 id TEXT PRIMARY KEY,listing_id TEXT NOT NULL REFERENCES listing_drafts(id),actor_id TEXT NOT NULL REFERENCES users(id),
 decision TEXT NOT NULL,note TEXT NOT NULL DEFAULT '',version INTEGER NOT NULL,created_at INTEGER NOT NULL DEFAULT(unixepoch())
);
CREATE TABLE listing_publications (
 listing_id TEXT PRIMARY KEY REFERENCES listing_drafts(id),owner_id TEXT NOT NULL REFERENCES users(id),
 actor_id TEXT NOT NULL REFERENCES users(id),plan_id TEXT NOT NULL REFERENCES listing_plans(id),
 amount_vnd INTEGER NOT NULL CHECK(amount_vnd BETWEEN 0 AND 1000000),duration_days INTEGER NOT NULL CHECK(duration_days BETWEEN 1 AND 365),
 promotional INTEGER NOT NULL CHECK(promotional IN(0,1)),created_at INTEGER NOT NULL DEFAULT(unixepoch())
);
CREATE TRIGGER publication_validate BEFORE INSERT ON listing_publications BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM listing_drafts l JOIN seller_profiles p ON p.user_id=l.owner_id JOIN users u ON u.id=l.owner_id
  WHERE l.id=NEW.listing_id AND l.owner_id=NEW.owner_id AND l.status='published' AND p.status='approved' AND u.deleted_at IS NULL AND u.is_locked=0)
  THEN RAISE(ABORT,'listing_not_ready') END;
 SELECT CASE WHEN NEW.promotional=1 AND NOT EXISTS(SELECT 1 FROM posting_promotions WHERE user_id=NEW.owner_id AND free_posts_used<free_posts_total)
  THEN RAISE(ABORT,'promotion_exhausted') END;
 SELECT CASE WHEN NEW.promotional=0 AND COALESCE((SELECT balance_vnd FROM wallet_accounts WHERE user_id=NEW.owner_id),0)<NEW.amount_vnd
  THEN RAISE(ABORT,'listing_insufficient_balance') END;
END;
CREATE TRIGGER publication_apply AFTER INSERT ON listing_publications BEGIN
 UPDATE posting_promotions SET free_posts_used=free_posts_used+1 WHERE user_id=NEW.owner_id AND NEW.promotional=1;
 INSERT INTO wallet_entries(id,user_id,actor_id,kind,amount_vnd,balance_before_vnd,balance_after_vnd,idempotency_key,description)
  SELECT lower(hex(randomblob(16))),NEW.owner_id,NEW.actor_id,'adjustment',-NEW.amount_vnd,balance_vnd,balance_vnd-NEW.amount_vnd,'listing:'||NEW.listing_id,'Phí đăng tin '||NEW.listing_id
  FROM wallet_accounts WHERE user_id=NEW.owner_id AND NEW.promotional=0 AND NEW.amount_vnd>0;
 UPDATE listing_drafts SET published_at=NEW.created_at,expires_at=NEW.created_at+NEW.duration_days*86400 WHERE id=NEW.listing_id;
END;
CREATE TRIGGER publication_no_update BEFORE UPDATE ON listing_publications BEGIN SELECT RAISE(ABORT,'publication_immutable'); END;
CREATE TRIGGER publication_no_delete BEFORE DELETE ON listing_publications BEGIN SELECT RAISE(ABORT,'publication_immutable'); END;
INSERT OR IGNORE INTO cms_role_permissions(role_id,permission) VALUES('moderator','listings.read'),('moderator','listings.review');
