-- Internal posting credit only. No payment is enabled or bank account seeded.
CREATE TABLE payment_settings (
 id INTEGER PRIMARY KEY CHECK(id=1), accepting_topups INTEGER NOT NULL DEFAULT 0 CHECK(accepting_topups IN(0,1)),
 bank_account_id TEXT REFERENCES receiving_bank_accounts(id), version INTEGER NOT NULL DEFAULT 1,
 change_token TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL DEFAULT(unixepoch()),
 CHECK(accepting_topups=0 OR bank_account_id IS NOT NULL)
);
CREATE TABLE receiving_bank_accounts (
 id TEXT PRIMARY KEY, bank_code TEXT NOT NULL CHECK(length(bank_code) BETWEEN 2 AND 20),
 bank_name TEXT NOT NULL CHECK(length(bank_name) BETWEEN 2 AND 100),
 account_number TEXT NOT NULL CHECK(length(account_number) BETWEEN 6 AND 24),
 account_holder TEXT NOT NULL CHECK(length(account_holder) BETWEEN 2 AND 100),
 created_at INTEGER NOT NULL DEFAULT(unixepoch()), UNIQUE(bank_code,account_number)
);
INSERT INTO payment_settings(id) VALUES(1);
CREATE TRIGGER receiving_account_identity BEFORE UPDATE OF bank_code,account_number ON receiving_bank_accounts BEGIN SELECT RAISE(ABORT,'bank_identity_immutable'); END;
CREATE TRIGGER receiving_account_no_delete BEFORE DELETE ON receiving_bank_accounts BEGIN SELECT RAISE(ABORT,'bank_history_immutable'); END;

CREATE TABLE posting_promotions (
 user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 free_posts_total INTEGER NOT NULL DEFAULT 3 CHECK(free_posts_total>=0),
 free_posts_used INTEGER NOT NULL DEFAULT 0 CHECK(free_posts_used>=0 AND free_posts_used<=free_posts_total)
);
INSERT INTO posting_promotions(user_id) SELECT id FROM users;

CREATE TABLE topup_requests (
 id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE CHECK(length(code)=15),
 user_id TEXT NOT NULL REFERENCES users(id), request_key TEXT NOT NULL,
 requested_vnd INTEGER NOT NULL CHECK(typeof(requested_vnd)='integer' AND requested_vnd BETWEEN 5000 AND 1000000),
 bank_account_id TEXT NOT NULL REFERENCES receiving_bank_accounts(id),
 bank_code TEXT NOT NULL,bank_name TEXT NOT NULL,account_number TEXT NOT NULL,account_holder TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN('pending','reported','needs_review','credited','cancelled')),
 customer_note TEXT NOT NULL DEFAULT '' CHECK(length(customer_note)<=500),
 review_note TEXT NOT NULL DEFAULT '' CHECK(length(review_note)<=1000),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0), change_token TEXT NOT NULL DEFAULT '',
 created_at INTEGER NOT NULL DEFAULT(unixepoch()), updated_at INTEGER NOT NULL DEFAULT(unixepoch()),
 reported_at INTEGER, cancelled_at INTEGER, credited_at INTEGER,
 credited_vnd INTEGER CHECK(credited_vnd IS NULL OR (typeof(credited_vnd)='integer' AND credited_vnd>0)),
 UNIQUE(user_id,request_key),
 CHECK((status='credited' AND credited_at IS NOT NULL AND credited_vnd IS NOT NULL) OR (status!='credited' AND credited_at IS NULL AND credited_vnd IS NULL))
);
CREATE INDEX topups_owner_created_idx ON topup_requests(user_id,created_at DESC,id);
CREATE INDEX topups_status_created_idx ON topup_requests(status,created_at,id);
CREATE TRIGGER topups_preserve_credit BEFORE UPDATE ON topup_requests WHEN OLD.status='credited' BEGIN SELECT RAISE(ABORT,'credited_topup_immutable'); END;
CREATE TRIGGER topups_preserve_identity BEFORE UPDATE OF user_id,code,requested_vnd,bank_account_id,bank_code,bank_name,account_number,account_holder,request_key ON topup_requests BEGIN SELECT RAISE(ABORT,'topup_identity_immutable'); END;
CREATE TRIGGER topups_no_delete BEFORE DELETE ON topup_requests BEGIN SELECT RAISE(ABORT,'topup_history_immutable'); END;

CREATE TABLE wallet_accounts (
 user_id TEXT PRIMARY KEY REFERENCES users(id),
 balance_vnd INTEGER NOT NULL DEFAULT 0 CHECK(typeof(balance_vnd)='integer' AND balance_vnd BETWEEN 0 AND 1000000000000),
 version INTEGER NOT NULL DEFAULT 0, last_sequence INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE bank_receipts (
 id TEXT PRIMARY KEY,topup_id TEXT NOT NULL UNIQUE REFERENCES topup_requests(id),
 bank_account_id TEXT NOT NULL REFERENCES receiving_bank_accounts(id),
 bank_reference TEXT NOT NULL CHECK(length(bank_reference) BETWEEN 4 AND 100 AND bank_reference=upper(bank_reference) AND bank_reference NOT GLOB '*[^A-Z0-9]*'),
 actual_vnd INTEGER NOT NULL CHECK(typeof(actual_vnd)='integer' AND actual_vnd BETWEEN 1 AND 1000000),
 reviewed_by TEXT NOT NULL REFERENCES users(id),expected_version INTEGER NOT NULL,
 exception_confirmed INTEGER NOT NULL CHECK(exception_confirmed IN(0,1)),
 note TEXT NOT NULL DEFAULT '' CHECK(length(note)<=1000),created_at INTEGER NOT NULL DEFAULT(unixepoch()),
 UNIQUE(bank_account_id,bank_reference)
);
CREATE TABLE wallet_entries (
 sequence INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,
 user_id TEXT NOT NULL REFERENCES users(id),actor_id TEXT NOT NULL REFERENCES users(id),
 kind TEXT NOT NULL CHECK(kind IN('topup','adjustment')),
 amount_vnd INTEGER NOT NULL CHECK(typeof(amount_vnd)='integer' AND amount_vnd!=0 AND abs(amount_vnd)<=1000000),
 balance_before_vnd INTEGER NOT NULL CHECK(typeof(balance_before_vnd)='integer' AND balance_before_vnd>=0),
 balance_after_vnd INTEGER NOT NULL CHECK(typeof(balance_after_vnd)='integer' AND balance_after_vnd>=0 AND balance_after_vnd=balance_before_vnd+amount_vnd),
 topup_id TEXT UNIQUE REFERENCES topup_requests(id),receipt_id TEXT UNIQUE REFERENCES bank_receipts(id),
 idempotency_key TEXT NOT NULL UNIQUE,
 description TEXT NOT NULL CHECK(length(description) BETWEEN 5 AND 1000),created_at INTEGER NOT NULL DEFAULT(unixepoch()),
 CHECK((kind='topup' AND amount_vnd>0 AND topup_id IS NOT NULL AND receipt_id IS NOT NULL) OR (kind='adjustment' AND topup_id IS NULL AND receipt_id IS NULL))
);
CREATE INDEX wallet_entries_user_sequence_idx ON wallet_entries(user_id,sequence DESC);
CREATE TABLE topup_events (
 id TEXT PRIMARY KEY,topup_id TEXT NOT NULL REFERENCES topup_requests(id),actor_id TEXT NOT NULL REFERENCES users(id),
 action TEXT NOT NULL CHECK(action IN('created','reported','needs_review','cancelled','credited')),
 note TEXT NOT NULL DEFAULT '' CHECK(length(note)<=1000),created_at INTEGER NOT NULL DEFAULT(unixepoch())
);
CREATE INDEX topup_events_request_idx ON topup_events(topup_id,created_at,id);

-- A ledger insertion is the only path to changing a balance.
CREATE TRIGGER wallet_initial_zero BEFORE INSERT ON wallet_accounts WHEN NEW.balance_vnd!=0 OR NEW.last_sequence!=0 BEGIN SELECT RAISE(ABORT,'wallet_initial_balance'); END;
CREATE TRIGGER wallet_balance_from_ledger BEFORE UPDATE ON wallet_accounts BEGIN
 SELECT CASE WHEN NEW.user_id!=OLD.user_id OR NEW.version!=OLD.version+1 OR NEW.last_sequence<=OLD.last_sequence OR NOT EXISTS(
  SELECT 1 FROM wallet_entries e WHERE e.sequence=NEW.last_sequence AND e.user_id=OLD.user_id
  AND e.balance_before_vnd=OLD.balance_vnd AND e.balance_after_vnd=NEW.balance_vnd
 ) THEN RAISE(ABORT,'wallet_requires_ledger') END;
END;
CREATE TRIGGER wallet_no_delete BEFORE DELETE ON wallet_accounts BEGIN SELECT RAISE(ABORT,'wallet_history_immutable'); END;
CREATE TRIGGER wallet_entry_validate BEFORE INSERT ON wallet_entries BEGIN
 SELECT CASE WHEN NEW.balance_before_vnd!=COALESCE((SELECT balance_vnd FROM wallet_accounts WHERE user_id=NEW.user_id),0) THEN RAISE(ABORT,'wallet_stale_balance') END;
 SELECT CASE WHEN NEW.kind='topup' AND NOT EXISTS(SELECT 1 FROM bank_receipts r JOIN topup_requests t ON t.id=r.topup_id
  WHERE r.id=NEW.receipt_id AND r.topup_id=NEW.topup_id AND t.user_id=NEW.user_id AND r.actual_vnd=NEW.amount_vnd AND r.reviewed_by=NEW.actor_id
 ) THEN RAISE(ABORT,'wallet_invalid_receipt') END;
END;
CREATE TRIGGER wallet_entry_apply AFTER INSERT ON wallet_entries BEGIN
 INSERT INTO wallet_accounts(user_id) VALUES(NEW.user_id) ON CONFLICT(user_id) DO NOTHING;
 UPDATE wallet_accounts SET balance_vnd=NEW.balance_after_vnd,version=version+1,last_sequence=NEW.sequence WHERE user_id=NEW.user_id;
 INSERT INTO admin_audit(id,actor_id,action,target_id,note) VALUES(lower(hex(randomblob(16))),NEW.actor_id,
  CASE WHEN NEW.kind='topup' THEN 'wallet.topup' ELSE 'wallet.adjustment' END,NEW.user_id,'Chi tiết trong sổ giao dịch theo quyền tài chính.');
END;
CREATE TRIGGER wallet_entries_no_update BEFORE UPDATE ON wallet_entries BEGIN SELECT RAISE(ABORT,'ledger_immutable'); END;
CREATE TRIGGER wallet_entries_no_delete BEFORE DELETE ON wallet_entries BEGIN SELECT RAISE(ABORT,'ledger_immutable'); END;
CREATE TRIGGER receipts_no_update BEFORE UPDATE ON bank_receipts BEGIN SELECT RAISE(ABORT,'receipt_immutable'); END;
CREATE TRIGGER receipts_no_delete BEFORE DELETE ON bank_receipts BEGIN SELECT RAISE(ABORT,'receipt_immutable'); END;
CREATE TRIGGER events_no_update BEFORE UPDATE ON topup_events BEGIN SELECT RAISE(ABORT,'financial_history_immutable'); END;
CREATE TRIGGER events_no_delete BEFORE DELETE ON topup_events BEGIN SELECT RAISE(ABORT,'financial_history_immutable'); END;

-- Receipt + ledger + balance + request + history commit together, or all roll back.
CREATE TRIGGER receipt_validate BEFORE INSERT ON bank_receipts BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM topup_requests WHERE id=NEW.topup_id AND version=NEW.expected_version AND status!='credited') THEN RAISE(ABORT,'topup_stale') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM topup_requests WHERE id=NEW.topup_id AND user_id=NEW.reviewed_by) THEN RAISE(ABORT,'no_self_reconciliation') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM topup_requests WHERE id=NEW.topup_id AND (requested_vnd!=NEW.actual_vnd OR bank_account_id!=NEW.bank_account_id OR cancelled_at IS NOT NULL)) AND (NEW.exception_confirmed!=1 OR length(trim(NEW.note))<10) THEN RAISE(ABORT,'topup_exception_required') END;
END;
CREATE TRIGGER receipt_apply AFTER INSERT ON bank_receipts BEGIN
 INSERT INTO wallet_entries(id,user_id,actor_id,kind,amount_vnd,balance_before_vnd,balance_after_vnd,topup_id,receipt_id,idempotency_key,description)
  SELECT NEW.id,t.user_id,NEW.reviewed_by,'topup',NEW.actual_vnd,COALESCE(w.balance_vnd,0),COALESCE(w.balance_vnd,0)+NEW.actual_vnd,t.id,NEW.id,'topup:'||t.id,'Ghi nhận chuyển khoản '||t.code
  FROM topup_requests t LEFT JOIN wallet_accounts w ON w.user_id=t.user_id WHERE t.id=NEW.topup_id;
 UPDATE topup_requests SET status='credited',credited_vnd=NEW.actual_vnd,credited_at=unixepoch(),updated_at=unixepoch(),version=version+1,change_token=NEW.id,review_note=NEW.note WHERE id=NEW.topup_id;
 INSERT INTO topup_events(id,topup_id,actor_id,action,note) VALUES(NEW.id,NEW.topup_id,NEW.reviewed_by,'credited',NEW.note);
 INSERT INTO admin_audit(id,actor_id,action,target_id,note) VALUES(lower(hex(randomblob(16))),NEW.reviewed_by,'topup.credited',NEW.topup_id,'Đã ghi nhận khoản nhận; chi tiết theo quyền tài chính.');
END;
