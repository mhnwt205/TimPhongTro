-- Withdrawal reserves use append-only ledger debits. Existing ledger rows stay intact.
CREATE TABLE withdrawal_requests (
 id TEXT PRIMARY KEY,code TEXT NOT NULL UNIQUE CHECK(length(code)=15),user_id TEXT NOT NULL REFERENCES users(id),
 request_key TEXT NOT NULL,amount_vnd INTEGER NOT NULL CHECK(typeof(amount_vnd)='integer' AND amount_vnd BETWEEN 5000 AND 1000000),
 bank_code TEXT NOT NULL,bank_name TEXT NOT NULL,account_number TEXT NOT NULL CHECK(length(account_number) BETWEEN 6 AND 24),
 account_holder TEXT NOT NULL CHECK(length(account_holder) BETWEEN 2 AND 100),
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN('pending','approved','paid','rejected','cancelled')),
 customer_note TEXT NOT NULL DEFAULT '' CHECK(length(customer_note)<=500),review_note TEXT NOT NULL DEFAULT '' CHECK(length(review_note)<=1000),
 processor_id TEXT REFERENCES users(id),last_actor_id TEXT NOT NULL REFERENCES users(id),version INTEGER NOT NULL DEFAULT 1,change_token TEXT NOT NULL,
 created_at INTEGER NOT NULL DEFAULT(unixepoch()),updated_at INTEGER NOT NULL DEFAULT(unixepoch()),UNIQUE(user_id,request_key)
);
CREATE INDEX withdrawals_owner_idx ON withdrawal_requests(user_id,created_at DESC,id);
CREATE INDEX withdrawals_status_idx ON withdrawal_requests(status,created_at,id);
CREATE TABLE withdrawal_events (
 id TEXT PRIMARY KEY,withdrawal_id TEXT NOT NULL REFERENCES withdrawal_requests(id),actor_id TEXT NOT NULL REFERENCES users(id),
 action TEXT NOT NULL CHECK(action IN('created','approved','paid','rejected','cancelled','claimed','released')),note TEXT NOT NULL DEFAULT '',created_at INTEGER NOT NULL DEFAULT(unixepoch())
);
CREATE INDEX withdrawal_events_request_idx ON withdrawal_events(withdrawal_id,created_at,id);
CREATE TABLE withdrawal_payouts (
 id TEXT PRIMARY KEY,withdrawal_id TEXT NOT NULL UNIQUE REFERENCES withdrawal_requests(id),
 sender_bank_code TEXT NOT NULL,sender_account_number TEXT NOT NULL CHECK(length(sender_account_number) BETWEEN 6 AND 24),
 bank_reference TEXT NOT NULL CHECK(length(bank_reference) BETWEEN 4 AND 100 AND bank_reference=upper(bank_reference) AND bank_reference NOT GLOB '*[^A-Z0-9]*'),
 amount_vnd INTEGER NOT NULL CHECK(typeof(amount_vnd)='integer'),actor_id TEXT NOT NULL REFERENCES users(id),expected_version INTEGER NOT NULL,
 note TEXT NOT NULL DEFAULT '' CHECK(length(note)<=1000),created_at INTEGER NOT NULL DEFAULT(unixepoch()),
 UNIQUE(sender_bank_code,sender_account_number,bank_reference)
);
CREATE TRIGGER withdrawal_insert_guard BEFORE INSERT ON withdrawal_requests BEGIN
 SELECT CASE WHEN NEW.status!='pending' OR NEW.version!=1 OR NEW.processor_id IS NOT NULL OR NEW.last_actor_id!=NEW.user_id THEN RAISE(ABORT,'withdrawal_invalid_create') END;
END;
CREATE TRIGGER withdrawal_identity BEFORE UPDATE ON withdrawal_requests BEGIN
 SELECT CASE WHEN NEW.id!=OLD.id OR NEW.code!=OLD.code OR NEW.user_id!=OLD.user_id OR NEW.request_key!=OLD.request_key
 OR NEW.amount_vnd!=OLD.amount_vnd OR NEW.bank_code!=OLD.bank_code OR NEW.bank_name!=OLD.bank_name OR NEW.account_number!=OLD.account_number
 OR NEW.account_holder!=OLD.account_holder OR NEW.customer_note!=OLD.customer_note OR NEW.created_at!=OLD.created_at
 THEN RAISE(ABORT,'withdrawal_identity_immutable') END;
 SELECT CASE WHEN NEW.version!=OLD.version+1 OR NOT ((OLD.status='pending' AND NEW.status IN('approved','rejected','cancelled'))
 OR (OLD.status='approved' AND NEW.status IN('paid','rejected')) OR (OLD.status='approved' AND NEW.status='approved' AND ((OLD.processor_id IS NULL AND NEW.processor_id IS NOT NULL AND NEW.processor_id=NEW.last_actor_id) OR (OLD.processor_id=NEW.last_actor_id AND NEW.processor_id IS NULL)))) THEN RAISE(ABORT,'withdrawal_stale') END;
 SELECT CASE WHEN (NEW.status='cancelled' AND NEW.last_actor_id!=OLD.user_id) OR (NEW.status!='cancelled' AND NEW.last_actor_id=OLD.user_id)
 THEN RAISE(ABORT,'withdrawal_self_review') END;
 SELECT CASE WHEN NEW.status!=OLD.status AND NEW.processor_id IS NOT OLD.processor_id THEN RAISE(ABORT,'withdrawal_processor_immutable') END;
 SELECT CASE WHEN OLD.status='approved' AND OLD.processor_id IS NOT NULL AND NEW.last_actor_id!=OLD.processor_id THEN RAISE(ABORT,'withdrawal_claimed') END;
 SELECT CASE WHEN NEW.status='paid' AND NOT EXISTS(SELECT 1 FROM withdrawal_payouts p WHERE p.withdrawal_id=OLD.id AND p.id=NEW.change_token
 AND p.actor_id=NEW.last_actor_id AND p.amount_vnd=OLD.amount_vnd) THEN RAISE(ABORT,'withdrawal_requires_payout') END;
END;
CREATE TRIGGER withdrawal_reserve AFTER INSERT ON withdrawal_requests BEGIN
 INSERT INTO wallet_entries(id,user_id,actor_id,kind,amount_vnd,balance_before_vnd,balance_after_vnd,idempotency_key,description)
 SELECT NEW.id,NEW.user_id,NEW.user_id,'adjustment',-NEW.amount_vnd,COALESCE(w.balance_vnd,0),COALESCE(w.balance_vnd,0)-NEW.amount_vnd,
 'withdrawal:hold:'||NEW.id,'Giữ tiền cho yêu cầu rút '||NEW.code FROM (SELECT 1) LEFT JOIN wallet_accounts w ON w.user_id=NEW.user_id;
 INSERT INTO withdrawal_events(id,withdrawal_id,actor_id,action,note) VALUES(lower(hex(randomblob(16))),NEW.id,NEW.user_id,'created',NEW.customer_note);
END;
CREATE TRIGGER withdrawal_transition AFTER UPDATE ON withdrawal_requests BEGIN
 INSERT INTO wallet_entries(id,user_id,actor_id,kind,amount_vnd,balance_before_vnd,balance_after_vnd,idempotency_key,description)
 SELECT lower(hex(randomblob(16))),NEW.user_id,NEW.last_actor_id,'adjustment',NEW.amount_vnd,w.balance_vnd,w.balance_vnd+NEW.amount_vnd,
 'withdrawal:release:'||NEW.id,'Hoàn khoản giữ của yêu cầu rút '||NEW.code FROM wallet_accounts w WHERE w.user_id=NEW.user_id AND NEW.status IN('rejected','cancelled');
 INSERT INTO withdrawal_events(id,withdrawal_id,actor_id,action,note) VALUES(lower(hex(randomblob(16))),NEW.id,NEW.last_actor_id,CASE WHEN NEW.status=OLD.status THEN CASE WHEN NEW.processor_id IS NULL THEN 'released' ELSE 'claimed' END ELSE NEW.status END,NEW.review_note);
 INSERT INTO admin_audit(id,actor_id,action,target_id,note) VALUES(lower(hex(randomblob(16))),NEW.last_actor_id,'withdrawal.'||CASE WHEN NEW.status=OLD.status THEN CASE WHEN NEW.processor_id IS NULL THEN 'released' ELSE 'claimed' END ELSE NEW.status END,NEW.id,'Chi tiết trong yêu cầu rút theo quyền tài chính.');
END;
CREATE TRIGGER withdrawal_ledger_guard BEFORE INSERT ON wallet_entries WHEN NEW.idempotency_key LIKE 'withdrawal:%' BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM withdrawal_requests r WHERE r.user_id=NEW.user_id AND NEW.kind='adjustment' AND NEW.actor_id=r.last_actor_id
 AND ((NEW.idempotency_key='withdrawal:hold:'||r.id AND r.status='pending' AND NEW.amount_vnd=-r.amount_vnd)
 OR (NEW.idempotency_key='withdrawal:release:'||r.id AND r.status IN('rejected','cancelled') AND NEW.amount_vnd=r.amount_vnd)))
 THEN RAISE(ABORT,'withdrawal_invalid_ledger') END;
END;
CREATE TRIGGER withdrawal_payout_guard BEFORE INSERT ON withdrawal_payouts BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM withdrawal_requests r WHERE r.id=NEW.withdrawal_id AND r.status='approved'
 AND r.version=NEW.expected_version AND r.amount_vnd=NEW.amount_vnd AND r.processor_id=NEW.actor_id) THEN RAISE(ABORT,'withdrawal_stale') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM withdrawal_requests WHERE id=NEW.withdrawal_id AND user_id=NEW.actor_id) THEN RAISE(ABORT,'withdrawal_self_review') END;
END;
CREATE TRIGGER withdrawal_payout_apply AFTER INSERT ON withdrawal_payouts BEGIN
 UPDATE withdrawal_requests SET status='paid',last_actor_id=NEW.actor_id,review_note=NEW.note,version=version+1,updated_at=unixepoch(),change_token=NEW.id WHERE id=NEW.withdrawal_id;
END;
CREATE TRIGGER withdrawals_no_delete BEFORE DELETE ON withdrawal_requests BEGIN SELECT RAISE(ABORT,'withdrawal_history_immutable'); END;
CREATE TRIGGER withdrawal_events_no_update BEFORE UPDATE ON withdrawal_events BEGIN SELECT RAISE(ABORT,'withdrawal_history_immutable'); END;
CREATE TRIGGER withdrawal_events_no_delete BEFORE DELETE ON withdrawal_events BEGIN SELECT RAISE(ABORT,'withdrawal_history_immutable'); END;
CREATE TRIGGER withdrawal_payouts_no_update BEFORE UPDATE ON withdrawal_payouts BEGIN SELECT RAISE(ABORT,'withdrawal_history_immutable'); END;
CREATE TRIGGER withdrawal_payouts_no_delete BEFORE DELETE ON withdrawal_payouts BEGIN SELECT RAISE(ABORT,'withdrawal_history_immutable'); END;

-- Classify the reservation journals in generic audit without exposing bank details.
DROP TRIGGER wallet_entry_apply;
CREATE TRIGGER wallet_entry_apply AFTER INSERT ON wallet_entries BEGIN
 INSERT INTO wallet_accounts(user_id) VALUES(NEW.user_id) ON CONFLICT(user_id) DO NOTHING;
 UPDATE wallet_accounts SET balance_vnd=NEW.balance_after_vnd,version=version+1,last_sequence=NEW.sequence WHERE user_id=NEW.user_id;
 INSERT INTO admin_audit(id,actor_id,action,target_id,note) VALUES(lower(hex(randomblob(16))),NEW.actor_id,
 CASE WHEN NEW.idempotency_key LIKE 'withdrawal:hold:%' THEN 'wallet.withdrawal_hold' WHEN NEW.idempotency_key LIKE 'withdrawal:release:%' THEN 'wallet.withdrawal_release'
 WHEN NEW.kind='topup' THEN 'wallet.topup' ELSE 'wallet.adjustment' END,NEW.user_id,'Chi tiết trong sổ giao dịch theo quyền tài chính.');
END;
