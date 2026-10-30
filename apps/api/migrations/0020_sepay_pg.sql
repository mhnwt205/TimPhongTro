-- SePay PG orders are verified server-to-server before changing the wallet ledger.
ALTER TABLE topup_requests ADD COLUMN payment_provider TEXT NOT NULL DEFAULT 'manual'
 CHECK(payment_provider IN ('manual','sepay_pg'));
ALTER TABLE bank_receipts ADD COLUMN provider TEXT NOT NULL DEFAULT 'manual'
 CHECK(provider IN ('manual','sepay_pg'));
ALTER TABLE bank_receipts ADD COLUMN provider_transaction_id TEXT;
CREATE UNIQUE INDEX bank_receipts_provider_transaction_unique
 ON bank_receipts(provider_transaction_id) WHERE provider_transaction_id IS NOT NULL;

-- Locked, non-interactive actor required by the append-only financial ledger.
INSERT INTO users(id,email,name,password_hash,role,is_locked,is_super_admin,email_verified_at)
 VALUES('sepay-ipn-system','sepay-ipn@system.invalid','SePay tự động','!disabled-system-account!','user',1,0,unixepoch());

CREATE TABLE sepay_payment_events (
 id TEXT PRIMARY KEY,
 provider_reference TEXT NOT NULL UNIQUE CHECK(length(provider_reference) BETWEEN 1 AND 200),
 order_invoice_number TEXT NOT NULL CHECK(length(order_invoice_number) BETWEEN 1 AND 100),
 topup_id TEXT REFERENCES topup_requests(id),
 amount_vnd INTEGER NOT NULL CHECK(typeof(amount_vnd)='integer' AND amount_vnd>=0 AND amount_vnd<=1000000000000),
 currency TEXT NOT NULL CHECK(length(currency) BETWEEN 1 AND 10),
 outcome TEXT NOT NULL CHECK(outcome IN('credited','unmatched','amount_mismatch','cancelled_request','legacy_request','already_credited','request_not_pending')),
 note TEXT NOT NULL DEFAULT '' CHECK(length(note)<=1000),
 received_at INTEGER NOT NULL DEFAULT(unixepoch()),
 reviewed_at INTEGER,
 reviewed_by TEXT REFERENCES users(id),
 review_note TEXT NOT NULL DEFAULT '' CHECK(length(review_note)<=1000)
);
CREATE INDEX sepay_payment_events_open_idx ON sepay_payment_events(outcome,reviewed_at,received_at DESC);
CREATE INDEX sepay_payment_events_topup_idx ON sepay_payment_events(topup_id,received_at DESC);
CREATE TRIGGER sepay_payment_events_identity BEFORE UPDATE ON sepay_payment_events BEGIN
 SELECT CASE WHEN NEW.id!=OLD.id OR NEW.provider_reference!=OLD.provider_reference
  OR NEW.order_invoice_number!=OLD.order_invoice_number OR NEW.topup_id IS NOT OLD.topup_id
  OR NEW.amount_vnd!=OLD.amount_vnd OR NEW.currency!=OLD.currency OR NEW.outcome!=OLD.outcome
  OR NEW.note!=OLD.note OR NEW.received_at!=OLD.received_at
  OR OLD.reviewed_at IS NOT NULL OR NEW.reviewed_at IS NULL OR NEW.reviewed_by IS NULL
  OR length(trim(NEW.review_note))<5
  THEN RAISE(ABORT,'sepay_event_review_invalid') END;
END;
CREATE TRIGGER sepay_payment_events_no_delete BEFORE DELETE ON sepay_payment_events BEGIN
 SELECT RAISE(ABORT,'sepay_event_history_immutable');
END;

ALTER TABLE topup_requests ADD COLUMN payment_provider_version INTEGER NOT NULL DEFAULT 1;
CREATE TRIGGER topups_provider_immutable BEFORE UPDATE OF payment_provider,payment_provider_version ON topup_requests BEGIN
 SELECT CASE WHEN NEW.payment_provider!=OLD.payment_provider OR NEW.payment_provider_version!=OLD.payment_provider_version
  THEN RAISE(ABORT,'topup_provider_immutable') END;
END;
