-- Update only the original nạp tiền paragraph; keep any CMS-edited policy copy intact.
UPDATE content_pages
SET body=replace(
 body,
 'Khi tạo yêu cầu nạp, hãy chuyển đúng số tiền đến tài khoản nhận được hiển thị và ghi đúng mã yêu cầu trong nội dung chuyển khoản. Khoản tiền chỉ được cộng vào số dư sau khi giao dịch thực tế được đối chiếu. Bạn có thể báo đã chuyển trong phần chi tiết yêu cầu để chúng tôi biết cần kiểm tra.',
 'Khi tạo yêu cầu nạp, bạn sẽ được chuyển sang trang thanh toán SePay. Hãy hoàn tất giao dịch đúng số tiền hiển thị. Sau khi SePay xác nhận thành công, số dư sẽ được cộng tự động. Nếu trạng thái chưa cập nhật, hãy giữ mã yêu cầu và liên hệ hỗ trợ; đừng thanh toán lần thứ hai trước khi kiểm tra trạng thái.'
),
version=version+1,change_token=lower(hex(randomblob(16))),updated_at=unixepoch()
WHERE id='support-draft-money'
 AND instr(body,'Khi tạo yêu cầu nạp, hãy chuyển đúng số tiền đến tài khoản nhận được hiển thị và ghi đúng mã yêu cầu trong nội dung chuyển khoản.')>0;
