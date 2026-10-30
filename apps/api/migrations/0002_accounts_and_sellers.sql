PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 2 AND 100),
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user', 'admin')),
  is_locked INTEGER NOT NULL DEFAULT 0 CHECK(is_locked IN (0, 1)),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
  change_token TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  expires_at INTEGER NOT NULL CHECK(expires_at > created_at)
);
CREATE INDEX sessions_user_idx ON sessions(user_id);
CREATE INDEX sessions_expiry_idx ON sessions(expires_at);

CREATE TABLE seller_profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  display_name TEXT NOT NULL CHECK(length(display_name) BETWEEN 2 AND 100),
  seller_type TEXT NOT NULL CHECK(seller_type IN ('owner', 'broker')),
  phone TEXT NOT NULL CHECK(length(phone) = 10),
  zalo_phone TEXT NOT NULL CHECK(length(zalo_phone) = 10),
  introduction TEXT NOT NULL DEFAULT '' CHECK(length(introduction) <= 600),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
  review_note TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
  change_token TEXT NOT NULL,
  submitted_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX seller_profiles_status_idx ON seller_profiles(status, submitted_at, user_id);

CREATE TABLE seller_reviews (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  reviewer_id TEXT NOT NULL REFERENCES users(id),
  decision TEXT NOT NULL CHECK(decision IN ('approved', 'rejected')),
  note TEXT NOT NULL CHECK(length(note) <= 1000),
  profile_version INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX seller_reviews_user_idx ON seller_reviews(user_id, created_at, id);

CREATE TABLE admin_audit (
  id TEXT PRIMARY KEY,
  actor_id TEXT REFERENCES users(id),
  action TEXT NOT NULL,
  target_id TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX admin_audit_target_idx ON admin_audit(target_id, created_at);

CREATE TABLE auth_rate_limits (
  key TEXT NOT NULL,
  bucket INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 1,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY(key, bucket)
);
CREATE INDEX auth_rate_limits_expiry_idx ON auth_rate_limits(expires_at);
