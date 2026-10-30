ALTER TABLE users ADD COLUMN email_verified_at INTEGER;
UPDATE users SET email_verified_at=created_at WHERE email_verified_at IS NULL;

CREATE TABLE account_email_tokens (
 token_hash TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id),
 purpose TEXT NOT NULL CHECK(purpose IN('verify_email','password_reset')),
 created_at INTEGER NOT NULL DEFAULT(unixepoch()),
 expires_at INTEGER NOT NULL CHECK(expires_at>created_at),
 consumed_at INTEGER
);
CREATE INDEX account_email_tokens_user_idx ON account_email_tokens(user_id,purpose,created_at DESC);
CREATE INDEX account_email_tokens_expiry_idx ON account_email_tokens(expires_at);
CREATE TRIGGER account_email_token_update_guard BEFORE UPDATE ON account_email_tokens BEGIN
 SELECT CASE WHEN NEW.token_hash!=OLD.token_hash OR NEW.user_id!=OLD.user_id OR NEW.purpose!=OLD.purpose OR NEW.created_at!=OLD.created_at OR NEW.expires_at!=OLD.expires_at THEN RAISE(ABORT,'account_token_identity_immutable') END;
 SELECT CASE WHEN OLD.consumed_at IS NOT NULL OR NEW.consumed_at IS NULL THEN RAISE(ABORT,'account_token_already_used') END;
END;
CREATE TRIGGER account_email_tokens_no_delete BEFORE DELETE ON account_email_tokens BEGIN SELECT RAISE(ABORT,'account_token_history_immutable'); END;

CREATE TABLE user_notifications (
 id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),event_key TEXT NOT NULL UNIQUE,
 kind TEXT NOT NULL CHECK(kind IN('security','profile','listing','topup','withdrawal','renewal')),
 title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 120),body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 1000),
 href TEXT NOT NULL CHECK(substr(href,1,1)='/' AND substr(href,1,2)!='//'),
 created_at INTEGER NOT NULL DEFAULT(unixepoch()),read_at INTEGER
);
CREATE INDEX user_notifications_account_idx ON user_notifications(user_id,created_at DESC,id);
CREATE INDEX user_notifications_unread_idx ON user_notifications(user_id,read_at,created_at DESC);
CREATE TRIGGER user_notifications_identity BEFORE UPDATE OF id,user_id,event_key,kind,title,body,href,created_at ON user_notifications BEGIN SELECT RAISE(ABORT,'notification_identity_immutable'); END;
CREATE TRIGGER user_notifications_no_delete BEFORE DELETE ON user_notifications BEGIN SELECT RAISE(ABORT,'notification_history_immutable'); END;

CREATE TRIGGER verified_token_notification AFTER UPDATE ON account_email_tokens
WHEN OLD.consumed_at IS NULL AND NEW.consumed_at IS NOT NULL AND NEW.purpose='verify_email'
BEGIN
 INSERT INTO user_notifications(id,user_id,event_key,kind,title,body,href)
 SELECT lower(hex(randomblob(16))),NEW.user_id,'email-verified:'||NEW.user_id,'security','Email đã được xác minh','Email tài khoản đã được xác minh.','/tai-khoan/ho-so'
 WHERE EXISTS(SELECT 1 FROM users WHERE id=NEW.user_id AND change_token!='');
END;
CREATE TRIGGER reset_token_notification AFTER UPDATE ON account_email_tokens
WHEN OLD.consumed_at IS NULL AND NEW.consumed_at IS NOT NULL AND NEW.purpose='password_reset'
BEGIN
 INSERT INTO user_notifications(id,user_id,event_key,kind,title,body,href)
 SELECT lower(hex(randomblob(16))),NEW.user_id,'password-reset:'||NEW.token_hash,'security','Mật khẩu đã được cập nhật','Mật khẩu tài khoản vừa được đặt lại. Nếu không phải bạn, hãy liên hệ hỗ trợ.','/tai-khoan/bao-mat';
END;

CREATE TRIGGER admin_event_notification AFTER INSERT ON admin_audit BEGIN
 INSERT INTO user_notifications(id,user_id,event_key,kind,title,body,href)
 SELECT lower(hex(randomblob(16))),NEW.target_id,'audit:'||NEW.id,'profile',CASE NEW.action WHEN 'seller.approved' THEN 'Hồ sơ người đăng đã được duyệt' ELSE 'Hồ sơ người đăng cần bổ sung' END,
 CASE NEW.action WHEN 'seller.approved' THEN 'Bạn có thể đăng tin sau khi xác minh email.' ELSE 'Mở hồ sơ để xem hướng dẫn bổ sung.' END,'/tai-khoan/ho-so'
 WHERE NEW.action IN('seller.approved','seller.rejected') AND EXISTS(SELECT 1 FROM users WHERE id=NEW.target_id);
 INSERT INTO user_notifications(id,user_id,event_key,kind,title,body,href)
 SELECT lower(hex(randomblob(16))),l.owner_id,'audit:'||NEW.id,'listing',CASE NEW.action WHEN 'listing.published' THEN 'Tin đăng đã được duyệt' ELSE 'Tin đăng cần bổ sung' END,
 CASE NEW.action WHEN 'listing.published' THEN 'Tin “'||l.title||'” đã được duyệt. Mở tin để xem.' ELSE 'Tin “'||l.title||'” cần chỉnh sửa. Mở tin để xem góp ý.' END,'/tai-khoan/tin-dang/'||l.id
 FROM listing_drafts l WHERE NEW.action IN('listing.published','listing.rejected') AND l.id=NEW.target_id;
 INSERT INTO user_notifications(id,user_id,event_key,kind,title,body,href)
 SELECT lower(hex(randomblob(16))),t.user_id,'audit:'||NEW.id,'topup',CASE NEW.action WHEN 'topup.credited' THEN 'Đã ghi nhận khoản nạp' WHEN 'topup.cancelled' THEN 'Yêu cầu nạp đã hủy' ELSE 'Yêu cầu nạp cần được kiểm tra' END,
 CASE NEW.action WHEN 'topup.credited' THEN 'Đã ghi nhận số tiền '||COALESCE(r.actual_vnd,t.requested_vnd)||'đ vào số dư.' WHEN 'topup.cancelled' THEN 'Yêu cầu nạp tiền đã được hủy.' ELSE 'Yêu cầu nạp tiền đang cần được kiểm tra thêm.' END,'/tai-khoan/nap-tien/'||t.code
 FROM topup_requests t LEFT JOIN bank_receipts r ON r.topup_id=t.id WHERE NEW.action IN('topup.credited','topup.cancelled','topup.needs_review') AND t.id=NEW.target_id;
 INSERT INTO user_notifications(id,user_id,event_key,kind,title,body,href)
 SELECT lower(hex(randomblob(16))),r.user_id,'audit:'||NEW.id,'withdrawal',CASE NEW.action WHEN 'withdrawal.approved' THEN 'Yêu cầu rút đã được duyệt' WHEN 'withdrawal.rejected' THEN 'Yêu cầu rút bị từ chối' ELSE 'Đã xác nhận chuyển khoản rút' END,
 CASE NEW.action WHEN 'withdrawal.approved' THEN 'Yêu cầu rút '||r.amount_vnd||'đ đã được duyệt.' WHEN 'withdrawal.rejected' THEN 'Yêu cầu rút đã được từ chối. Khoản giữ được hoàn lại theo quy trình.' ELSE 'Yêu cầu rút đã được xác nhận chuyển khoản.' END,'/tai-khoan/rut-tien/'||r.code
 FROM withdrawal_requests r WHERE NEW.action IN('withdrawal.approved','withdrawal.rejected','withdrawal.paid') AND r.id=NEW.target_id;
 INSERT INTO user_notifications(id,user_id,event_key,kind,title,body,href)
 SELECT lower(hex(randomblob(16))),r.owner_id,'audit:'||NEW.id,'renewal',CASE NEW.action WHEN 'renewal.approved' THEN 'Yêu cầu gia hạn đã được duyệt' ELSE 'Yêu cầu gia hạn bị từ chối' END,
 CASE NEW.action WHEN 'renewal.approved' THEN 'Tin “'||json_extract(l.public_data,'$.title')||'” đã được gia hạn.' ELSE 'Mở lịch sử gia hạn để xem phản hồi của CMS.' END,'/tai-khoan/tin-dang/'||r.listing_id||'/gia-han'
 FROM listing_renewals r JOIN listing_drafts l ON l.id=r.listing_id WHERE NEW.action IN('renewal.approved','renewal.rejected') AND r.id=NEW.target_id;
END;
