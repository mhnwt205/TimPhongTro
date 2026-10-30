-- Additive CMS migration. Keep accounts, sessions, review history and plans.
ALTER TABLE users ADD COLUMN is_super_admin INTEGER NOT NULL DEFAULT 0 CHECK(is_super_admin IN (0,1));
ALTER TABLE users ADD COLUMN deleted_at INTEGER;
CREATE TABLE cms_roles (
 id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE CHECK(length(name) BETWEEN 2 AND 80),
 description TEXT NOT NULL DEFAULT '' CHECK(length(description)<=500),
 version INTEGER NOT NULL DEFAULT 1, change_token TEXT NOT NULL DEFAULT '', deleted_at INTEGER,
 created_at INTEGER NOT NULL DEFAULT(unixepoch()), updated_at INTEGER NOT NULL DEFAULT(unixepoch())
);
CREATE TABLE cms_role_permissions (
 role_id TEXT NOT NULL REFERENCES cms_roles(id), permission TEXT NOT NULL, PRIMARY KEY(role_id,permission)
);
CREATE TABLE cms_user_roles (
 user_id TEXT NOT NULL REFERENCES users(id), role_id TEXT NOT NULL REFERENCES cms_roles(id), PRIMARY KEY(user_id,role_id)
);
CREATE INDEX cms_user_roles_role_idx ON cms_user_roles(role_id);
INSERT INTO cms_roles(id,name,description) VALUES
 ('moderator','Kiểm duyệt viên','Xem và xét duyệt hồ sơ người đăng.'),
 ('editor','Biên tập viên','Quản lý nội dung hướng dẫn và bản nháp phòng.');
INSERT INTO cms_role_permissions(role_id,permission) VALUES
 ('moderator','sellers.read'),('moderator','sellers.review'),
 ('editor','content.read'),('editor','content.create'),('editor','content.update'),
 ('editor','listings.read'),('editor','listings.create'),('editor','listings.update'),('editor','locations.read');
INSERT INTO cms_user_roles(user_id,role_id) SELECT id,'moderator' FROM users WHERE role='admin';

ALTER TABLE listing_plans ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE listing_plans ADD COLUMN change_token TEXT NOT NULL DEFAULT '';
ALTER TABLE listing_plans ADD COLUMN deleted_at INTEGER;
ALTER TABLE listing_plans ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;

CREATE TABLE locations (
 id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE CHECK(length(name) BETWEEN 2 AND 100),
 description TEXT NOT NULL DEFAULT '' CHECK(length(description)<=500), is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
 version INTEGER NOT NULL DEFAULT 1, change_token TEXT NOT NULL DEFAULT '', deleted_at INTEGER,
 created_at INTEGER NOT NULL DEFAULT(unixepoch()), updated_at INTEGER NOT NULL DEFAULT(unixepoch())
);
-- Familiar search-area names, not a claim about current administrative units.
INSERT INTO locations(id,name,description) VALUES
 ('binh-thanh','Bình Thạnh','Khu vực tìm kiếm theo tên gọi quen thuộc.'),
 ('thu-duc','Thủ Đức','Khu vực tìm kiếm theo tên gọi quen thuộc.'),
 ('tan-binh','Tân Bình','Khu vực tìm kiếm theo tên gọi quen thuộc.'),
 ('go-vap','Gò Vấp','Khu vực tìm kiếm theo tên gọi quen thuộc.'),
 ('phu-nhuan','Phú Nhuận','Khu vực tìm kiếm theo tên gọi quen thuộc.'),
 ('binh-tan','Bình Tân','Khu vực tìm kiếm theo tên gọi quen thuộc.');

CREATE TABLE content_pages (
 id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, title TEXT NOT NULL CHECK(length(title) BETWEEN 2 AND 150),
 body TEXT NOT NULL DEFAULT '' CHECK(length(body)<=6000), is_active INTEGER NOT NULL DEFAULT 0 CHECK(is_active IN (0,1)),
 version INTEGER NOT NULL DEFAULT 1, change_token TEXT NOT NULL DEFAULT '', deleted_at INTEGER,
 created_at INTEGER NOT NULL DEFAULT(unixepoch()), updated_at INTEGER NOT NULL DEFAULT(unixepoch())
);
CREATE TABLE listing_drafts (
 id TEXT PRIMARY KEY, title TEXT NOT NULL CHECK(length(title) BETWEEN 5 AND 150),
 owner_id TEXT NOT NULL REFERENCES users(id), location_id TEXT NOT NULL REFERENCES locations(id),
 room_type TEXT NOT NULL CHECK(room_type IN ('room','studio')),
 price_vnd INTEGER NOT NULL CHECK(typeof(price_vnd)='integer' AND price_vnd>0),
 area_m2 REAL NOT NULL CHECK(area_m2>0), description TEXT NOT NULL DEFAULT '' CHECK(length(description)<=4000),
 version INTEGER NOT NULL DEFAULT 1, change_token TEXT NOT NULL DEFAULT '', deleted_at INTEGER,
 created_at INTEGER NOT NULL DEFAULT(unixepoch()), updated_at INTEGER NOT NULL DEFAULT(unixepoch())
);
CREATE INDEX listing_drafts_deleted_idx ON listing_drafts(deleted_at,created_at);

-- Super-admin provisioning is performed with an operator script, never public registration.
-- Keep the grant and its audit row in the same SQLite transaction.
CREATE TRIGGER cms_super_admin_insert_audit AFTER INSERT ON users WHEN NEW.is_super_admin=1 BEGIN
 INSERT INTO admin_audit(id,actor_id,action,target_id,note)
 VALUES(lower(hex(randomblob(16))),NULL,'admin.bootstrap',NEW.id,'Operator provisioned super administrator');
END;
CREATE TRIGGER cms_super_admin_update_audit AFTER UPDATE OF is_super_admin ON users WHEN NEW.is_super_admin=1 AND OLD.is_super_admin=0 BEGIN
 INSERT INTO admin_audit(id,actor_id,action,target_id,note)
 VALUES(lower(hex(randomblob(16))),NULL,'admin.bootstrap',NEW.id,'Operator granted super administrator');
END;
