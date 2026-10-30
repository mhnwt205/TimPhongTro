ALTER TABLE account_email_tokens ADD COLUMN consumed_reason TEXT;

DROP TRIGGER account_email_token_update_guard;
CREATE TRIGGER account_email_token_update_guard BEFORE UPDATE ON account_email_tokens BEGIN
 SELECT CASE WHEN NEW.token_hash!=OLD.token_hash OR NEW.user_id!=OLD.user_id OR NEW.purpose!=OLD.purpose OR NEW.created_at!=OLD.created_at OR NEW.expires_at!=OLD.expires_at THEN RAISE(ABORT,'account_token_identity_immutable') END;
 SELECT CASE WHEN OLD.consumed_at IS NOT NULL OR NEW.consumed_at IS NULL OR NEW.consumed_reason NOT IN('used','superseded','expired') THEN RAISE(ABORT,'account_token_already_used') END;
END;

DROP TRIGGER verified_token_notification;
CREATE TRIGGER verified_token_notification AFTER UPDATE ON account_email_tokens
WHEN OLD.consumed_at IS NULL AND NEW.consumed_at IS NOT NULL AND NEW.consumed_reason='used' AND NEW.purpose='verify_email'
BEGIN
 INSERT INTO user_notifications(id,user_id,event_key,kind,title,body,href)
 SELECT lower(hex(randomblob(16))),NEW.user_id,'email-verified:'||NEW.user_id,'security','Email đã được xác minh','Email tài khoản đã được xác minh.','/tai-khoan/ho-so'
 WHERE EXISTS(SELECT 1 FROM users WHERE id=NEW.user_id AND change_token!='');
END;

DROP TRIGGER reset_token_notification;
CREATE TRIGGER reset_token_notification AFTER UPDATE ON account_email_tokens
WHEN OLD.consumed_at IS NULL AND NEW.consumed_at IS NOT NULL AND NEW.consumed_reason='used' AND NEW.purpose='password_reset'
BEGIN
 INSERT INTO user_notifications(id,user_id,event_key,kind,title,body,href)
 SELECT lower(hex(randomblob(16))),NEW.user_id,'password-reset:'||NEW.token_hash,'security','Mật khẩu đã được cập nhật','Mật khẩu tài khoản vừa được đặt lại. Nếu không phải bạn, hãy liên hệ hỗ trợ.','/tai-khoan/bao-mat';
END;
