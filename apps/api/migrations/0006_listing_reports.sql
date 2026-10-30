CREATE TABLE listing_reports (
 id TEXT PRIMARY KEY,code TEXT NOT NULL UNIQUE,listing_id TEXT NOT NULL,listing_title TEXT NOT NULL CHECK(length(listing_title) BETWEEN 2 AND 150),
 is_sample INTEGER NOT NULL CHECK(is_sample IN(0,1)),reason TEXT NOT NULL CHECK(reason IN('incorrect','unavailable','fraud','privacy','duplicate','other')),
 details TEXT NOT NULL CHECK(length(details) BETWEEN 10 AND 2000),contact_email TEXT NOT NULL DEFAULT '' CHECK(length(contact_email)<=254),
 request_key TEXT NOT NULL UNIQUE,status TEXT NOT NULL DEFAULT 'open' CHECK(status IN('open','reviewing','resolved','dismissed')),
 review_note TEXT NOT NULL DEFAULT '' CHECK(length(review_note)<=1000),version INTEGER NOT NULL DEFAULT 1,change_token TEXT NOT NULL DEFAULT '',
 created_at INTEGER NOT NULL DEFAULT(unixepoch()),updated_at INTEGER NOT NULL DEFAULT(unixepoch())
);
CREATE INDEX listing_reports_status_idx ON listing_reports(status,created_at,id);
CREATE TABLE listing_report_events (
 id TEXT PRIMARY KEY,report_id TEXT NOT NULL REFERENCES listing_reports(id),actor_id TEXT NOT NULL REFERENCES users(id),
 status TEXT NOT NULL CHECK(status IN('reviewing','resolved','dismissed')),note TEXT NOT NULL CHECK(length(note) BETWEEN 5 AND 1000),created_at INTEGER NOT NULL DEFAULT(unixepoch())
);
CREATE TRIGGER listing_reports_preserve_identity BEFORE UPDATE OF id,code,listing_id,listing_title,is_sample,reason,details,contact_email,request_key,created_at ON listing_reports BEGIN SELECT RAISE(ABORT,'report_identity_immutable'); END;
CREATE TRIGGER listing_reports_no_delete BEFORE DELETE ON listing_reports BEGIN SELECT RAISE(ABORT,'report_history_preserved'); END;
CREATE TRIGGER report_events_no_update BEFORE UPDATE ON listing_report_events BEGIN SELECT RAISE(ABORT,'report_history_preserved'); END;
CREATE TRIGGER report_events_no_delete BEFORE DELETE ON listing_report_events BEGIN SELECT RAISE(ABORT,'report_history_preserved'); END;
