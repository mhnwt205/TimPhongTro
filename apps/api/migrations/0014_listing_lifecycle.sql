-- Display status is independent of moderation status and purchased time.
ALTER TABLE listing_drafts ADD COLUMN display_state TEXT NOT NULL DEFAULT 'available' CHECK(display_state IN('available','hidden','unavailable'));
ALTER TABLE listing_drafts ADD COLUMN moderation_hidden INTEGER NOT NULL DEFAULT 0 CHECK(moderation_hidden IN(0,1));
ALTER TABLE listing_drafts ADD COLUMN availability_confirmed_at INTEGER;
UPDATE listing_drafts SET availability_confirmed_at=published_at WHERE published_at IS NOT NULL;
CREATE TABLE listing_events (
 id TEXT PRIMARY KEY,listing_id TEXT NOT NULL REFERENCES listing_drafts(id),actor_id TEXT NOT NULL REFERENCES users(id),
 action TEXT NOT NULL,note TEXT NOT NULL DEFAULT '' CHECK(length(note)<=1000),created_at INTEGER NOT NULL DEFAULT(unixepoch())
);
CREATE INDEX listing_events_listing_idx ON listing_events(listing_id,created_at DESC,id);
CREATE TRIGGER listing_events_no_update BEFORE UPDATE ON listing_events BEGIN SELECT RAISE(ABORT,'listing_history_immutable'); END;
CREATE TRIGGER listing_events_no_delete BEFORE DELETE ON listing_events BEGIN SELECT RAISE(ABORT,'listing_history_immutable'); END;
CREATE TRIGGER publication_availability AFTER INSERT ON listing_publications BEGIN
 UPDATE listing_drafts SET availability_confirmed_at=NEW.created_at WHERE id=NEW.listing_id;
 INSERT INTO listing_events(id,listing_id,actor_id,action) VALUES(lower(hex(randomblob(16))),NEW.listing_id,NEW.actor_id,'published');
END;

CREATE TABLE listing_renewals (
 id TEXT PRIMARY KEY,listing_id TEXT NOT NULL REFERENCES listing_drafts(id),owner_id TEXT NOT NULL REFERENCES users(id),request_key TEXT NOT NULL,
 plan_id TEXT NOT NULL REFERENCES listing_plans(id),plan_name TEXT NOT NULL,price_vnd INTEGER NOT NULL CHECK(typeof(price_vnd)='integer' AND price_vnd BETWEEN 1 AND 1000000),
 duration_days INTEGER NOT NULL CHECK(duration_days BETWEEN 1 AND 365),is_priority INTEGER NOT NULL CHECK(is_priority IN(0,1)),
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN('pending','approved','rejected','cancelled')),
 version INTEGER NOT NULL DEFAULT 1,last_actor_id TEXT NOT NULL REFERENCES users(id),change_token TEXT NOT NULL,
 review_note TEXT NOT NULL DEFAULT '' CHECK(length(review_note)<=1000),created_at INTEGER NOT NULL DEFAULT(unixepoch()),reviewed_at INTEGER,
 UNIQUE(owner_id,request_key)
);
CREATE UNIQUE INDEX renewal_one_pending ON listing_renewals(listing_id) WHERE status='pending';
CREATE INDEX renewal_status_idx ON listing_renewals(status,created_at,id);
CREATE INDEX renewal_owner_idx ON listing_renewals(owner_id,created_at DESC);
CREATE TABLE listing_renewal_approvals (
 id TEXT PRIMARY KEY,renewal_id TEXT NOT NULL UNIQUE REFERENCES listing_renewals(id),listing_id TEXT NOT NULL REFERENCES listing_drafts(id),
 actor_id TEXT NOT NULL REFERENCES users(id),expected_request_version INTEGER NOT NULL,expected_listing_version INTEGER NOT NULL,
 price_vnd INTEGER NOT NULL CHECK(typeof(price_vnd)='integer' AND price_vnd BETWEEN 1 AND 1000000),
 is_priority INTEGER NOT NULL CHECK(is_priority IN(0,1)),previous_expires_at INTEGER NOT NULL,
 starts_at INTEGER NOT NULL,expires_at INTEGER NOT NULL CHECK(expires_at>starts_at),created_at INTEGER NOT NULL DEFAULT(unixepoch())
);
CREATE INDEX renewal_period_idx ON listing_renewal_approvals(listing_id,starts_at,expires_at);
CREATE TRIGGER renewal_insert_guard BEFORE INSERT ON listing_renewals BEGIN
 SELECT CASE WHEN NEW.status!='pending' OR NEW.version!=1 OR NEW.last_actor_id!=NEW.owner_id OR NEW.reviewed_at IS NOT NULL THEN RAISE(ABORT,'renewal_invalid_create') END;
END;
CREATE TRIGGER renewal_identity BEFORE UPDATE ON listing_renewals BEGIN
 SELECT CASE WHEN NEW.id!=OLD.id OR NEW.listing_id!=OLD.listing_id OR NEW.owner_id!=OLD.owner_id OR NEW.request_key!=OLD.request_key
 OR NEW.plan_id!=OLD.plan_id OR NEW.plan_name!=OLD.plan_name OR NEW.price_vnd!=OLD.price_vnd OR NEW.duration_days!=OLD.duration_days OR NEW.is_priority!=OLD.is_priority OR NEW.created_at!=OLD.created_at
 THEN RAISE(ABORT,'renewal_identity_immutable') END;
 SELECT CASE WHEN OLD.status!='pending' OR NEW.status NOT IN('approved','rejected','cancelled') OR NEW.version!=OLD.version+1 THEN RAISE(ABORT,'renewal_stale') END;
 SELECT CASE WHEN (NEW.status='cancelled' AND NEW.last_actor_id!=OLD.owner_id) OR (NEW.status!='cancelled' AND NEW.last_actor_id=OLD.owner_id) THEN RAISE(ABORT,'renewal_self_review') END;
 SELECT CASE WHEN NEW.status='approved' AND NOT EXISTS(SELECT 1 FROM listing_renewal_approvals WHERE renewal_id=OLD.id) THEN RAISE(ABORT,'renewal_requires_approval') END;
END;
CREATE TRIGGER renewal_created_event AFTER INSERT ON listing_renewals BEGIN
 INSERT INTO listing_events(id,listing_id,actor_id,action) VALUES(lower(hex(randomblob(16))),NEW.listing_id,NEW.owner_id,'renewal_requested');
END;
CREATE TRIGGER renewal_changed_event AFTER UPDATE ON listing_renewals BEGIN
 INSERT INTO listing_events(id,listing_id,actor_id,action,note) VALUES(lower(hex(randomblob(16))),NEW.listing_id,NEW.last_actor_id,'renewal_'||NEW.status,NEW.review_note);
 INSERT INTO admin_audit(id,actor_id,action,target_id,note) VALUES(lower(hex(randomblob(16))),NEW.last_actor_id,'renewal.'||NEW.status,NEW.id,'Xem chi tiết trong lịch sử gia hạn theo quyền.');
END;
CREATE TRIGGER renewal_approval_validate BEFORE INSERT ON listing_renewal_approvals BEGIN
 SELECT CASE WHEN NOT EXISTS(
  SELECT 1 FROM listing_renewals r JOIN listing_drafts l ON l.id=r.listing_id JOIN users u ON u.id=l.owner_id JOIN seller_profiles s ON s.user_id=u.id
  WHERE r.id=NEW.renewal_id AND r.listing_id=NEW.listing_id AND r.status='pending' AND r.version=NEW.expected_request_version
  AND l.version=NEW.expected_listing_version AND l.owner_id=r.owner_id AND l.published_at IS NOT NULL AND l.public_data IS NOT NULL AND l.deleted_at IS NULL AND l.moderation_hidden=0
  AND u.is_locked=0 AND u.deleted_at IS NULL AND s.status='approved'
 ) THEN RAISE(ABORT,'renewal_not_ready') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM listing_renewals WHERE id=NEW.renewal_id AND owner_id=NEW.actor_id) THEN RAISE(ABORT,'renewal_self_review') END;
 SELECT CASE WHEN NOT EXISTS(
  SELECT 1 FROM listing_renewals r JOIN listing_plans p ON p.id=r.plan_id WHERE r.id=NEW.renewal_id AND p.is_active=1 AND p.deleted_at IS NULL
  AND p.price_vnd=r.price_vnd AND p.duration_days=r.duration_days AND p.is_priority=r.is_priority AND NEW.price_vnd=r.price_vnd AND NEW.is_priority=r.is_priority
 ) THEN RAISE(ABORT,'renewal_quote_changed') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM listing_drafts l JOIN listing_renewals r ON r.listing_id=l.id
  WHERE r.id=NEW.renewal_id AND NEW.previous_expires_at=l.expires_at AND NEW.starts_at=max(l.expires_at,unixepoch()) AND NEW.expires_at=NEW.starts_at+r.duration_days*86400
 ) THEN RAISE(ABORT,'renewal_invalid_period') END;
 SELECT CASE WHEN COALESCE((SELECT w.balance_vnd FROM wallet_accounts w JOIN listing_renewals r ON r.owner_id=w.user_id WHERE r.id=NEW.renewal_id),0)<NEW.price_vnd THEN RAISE(ABORT,'renewal_insufficient_balance') END;
END;
CREATE TRIGGER renewal_approval_apply AFTER INSERT ON listing_renewal_approvals BEGIN
 INSERT INTO wallet_entries(id,user_id,actor_id,kind,amount_vnd,balance_before_vnd,balance_after_vnd,idempotency_key,description)
 SELECT lower(hex(randomblob(16))),r.owner_id,NEW.actor_id,'adjustment',-NEW.price_vnd,w.balance_vnd,w.balance_vnd-NEW.price_vnd,'renewal:'||r.id,'Phí gia hạn tin: '||r.plan_name
 FROM listing_renewals r JOIN wallet_accounts w ON w.user_id=r.owner_id WHERE r.id=NEW.renewal_id;
 UPDATE listing_drafts SET expires_at=NEW.expires_at,version=version+1,change_token=NEW.id,updated_at=unixepoch() WHERE id=NEW.listing_id;
 UPDATE listing_renewals SET status='approved',last_actor_id=NEW.actor_id,reviewed_at=NEW.created_at,version=version+1,change_token=NEW.id WHERE id=NEW.renewal_id;
END;
CREATE TRIGGER renewal_no_delete BEFORE DELETE ON listing_renewals BEGIN SELECT RAISE(ABORT,'renewal_history_immutable'); END;
CREATE TRIGGER renewal_approval_no_update BEFORE UPDATE ON listing_renewal_approvals BEGIN SELECT RAISE(ABORT,'renewal_history_immutable'); END;
CREATE TRIGGER renewal_approval_no_delete BEFORE DELETE ON listing_renewal_approvals BEGIN SELECT RAISE(ABORT,'renewal_history_immutable'); END;
INSERT OR IGNORE INTO cms_role_permissions(role_id,permission) VALUES('moderator','renewals.read'),('moderator','renewals.review');
