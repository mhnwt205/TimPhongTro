-- New top-ups use SePay. Keep the legacy receiving-bank rows and request snapshots
-- for old manual requests, and use an internal marker for the existing receipt FK.
INSERT INTO receiving_bank_accounts(id,bank_code,bank_name,account_number,account_holder)
VALUES('system-sepay-gateway','SEPAY','SePay Payment Gateway','000000','SePay Payment Gateway')
ON CONFLICT(id) DO NOTHING;

-- The switch controls whether new SePay requests can be created; it no longer
-- depends on a second bank account being configured in the CMS.
CREATE TABLE payment_settings_sepay (
 id INTEGER PRIMARY KEY CHECK(id=1),
 accepting_topups INTEGER NOT NULL DEFAULT 0 CHECK(accepting_topups IN(0,1)),
 bank_account_id TEXT REFERENCES receiving_bank_accounts(id),
 version INTEGER NOT NULL DEFAULT 1,
 change_token TEXT NOT NULL DEFAULT '',
 updated_at INTEGER NOT NULL DEFAULT(unixepoch())
);
INSERT INTO payment_settings_sepay(id,accepting_topups,bank_account_id,version,change_token,updated_at)
SELECT id,accepting_topups,bank_account_id,version,change_token,updated_at FROM payment_settings;
DROP TABLE payment_settings;
ALTER TABLE payment_settings_sepay RENAME TO payment_settings;
