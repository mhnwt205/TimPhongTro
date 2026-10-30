DROP TRIGGER admin_event_notification;
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
 CASE NEW.action WHEN 'withdrawal.approved' THEN 'Yêu cầu rút '||r.amount_vnd||'đ đã được duyệt.' WHEN 'withdrawal.rejected' THEN 'Yêu cầu rút đã bị từ chối. Khoản giữ được hoàn lại theo quy trình.' ELSE 'Yêu cầu rút đã được xác nhận chuyển khoản.' END,'/tai-khoan/rut-tien/'||r.code
 FROM withdrawal_requests r WHERE NEW.action IN('withdrawal.approved','withdrawal.rejected','withdrawal.paid') AND r.id=NEW.target_id;
 INSERT INTO user_notifications(id,user_id,event_key,kind,title,body,href)
 SELECT lower(hex(randomblob(16))),r.owner_id,'audit:'||NEW.id,'renewal',CASE NEW.action WHEN 'renewal.approved' THEN 'Yêu cầu gia hạn đã được duyệt' ELSE 'Yêu cầu gia hạn bị từ chối' END,
 CASE NEW.action WHEN 'renewal.approved' THEN 'Tin “'||json_extract(l.public_data,'$.title')||'” đã được gia hạn.' ELSE 'Mở lịch sử gia hạn để xem phản hồi của CMS.' END,'/tai-khoan/tin-dang/'||r.listing_id||'/gia-han'
 FROM listing_renewals r JOIN listing_drafts l ON l.id=r.listing_id WHERE NEW.action IN('renewal.approved','renewal.rejected') AND r.id=NEW.target_id;
END;
