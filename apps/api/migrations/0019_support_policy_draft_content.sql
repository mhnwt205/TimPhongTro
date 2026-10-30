-- Fill only untouched, hidden drafts so operator edits are never overwritten.

UPDATE content_pages SET body='Chi phí đăng tin

Giá và thời gian hiển thị được ghi rõ ở bảng giá và trước khi bạn gửi tin. Bạn có thể xem lại lựa chọn của mình trước khi xác nhận.

Tin nháp, tin đang chờ xem xét hoặc tin cần chỉnh sửa chưa bị tính phí. Khoản phí được trừ khi tin được chấp thuận và bắt đầu hiển thị. Nếu tài khoản có ưu đãi miễn phí, số lượt còn lại được thể hiện trong tài khoản và áp dụng theo thông tin ưu đãi đang công bố.

Gia hạn tin

Gia hạn cần dùng số dư trong tài khoản; lượt miễn phí dành cho tin mới. Yêu cầu chỉ được tính phí và cộng thời gian sau khi được chấp thuận. Nếu tin còn thời hạn, kỳ mới nối tiếp từ ngày hết hạn hiện tại. Nếu tin đã hết hạn, kỳ mới bắt đầu từ ngày yêu cầu được chấp thuận. Quyền ưu tiên của gói mới bắt đầu cùng kỳ mới.

Ẩn tin, hết phòng và khoản phí

Khi bạn tự ẩn tin hoặc báo phòng đã có người thuê, thời hạn đã mua vẫn tiếp tục. Tin hết hạn cũng không được hoàn phí hoặc cộng bù thời gian.

Nếu bạn thấy khoản trừ không đúng, hãy lưu mã tin và thông tin giao dịch để gửi yêu cầu kiểm tra. Việc xử lý khoản trừ sai hoặc trường hợp website gặp sự cố sẽ được xem xét theo từng tình huống.'
,version=version+1,change_token=lower(hex(randomblob(16))),updated_at=unixepoch()
WHERE id='support-draft-fees' AND body='' AND is_active=0 AND deleted_at IS NULL;

UPDATE content_pages SET body='Số dư dùng để thanh toán phí đăng tin, gia hạn tin hoặc gửi yêu cầu rút theo các lựa chọn đang có trong tài khoản. Website không nhận tiền thuê phòng hay tiền đặt cọc giữa người thuê và người cho thuê.

Nạp tiền

Khi tạo yêu cầu nạp, hãy chuyển đúng số tiền đến tài khoản nhận được hiển thị và ghi đúng mã yêu cầu trong nội dung chuyển khoản. Khoản tiền chỉ được cộng vào số dư sau khi giao dịch thực tế được đối chiếu. Bạn có thể báo đã chuyển trong phần chi tiết yêu cầu để chúng tôi biết cần kiểm tra.

Rút tiền

Khi gửi yêu cầu rút, hãy kiểm tra kỹ ngân hàng, số tài khoản và tên người nhận. Số tiền yêu cầu sẽ tạm giữ trong lúc chờ xử lý. Nếu bạn hủy yêu cầu khi yêu cầu còn chờ xem xét, khoản tiền giữ sẽ được trả lại vào số dư. Nếu yêu cầu bị từ chối, khoản tiền giữ cũng được trả lại. Yêu cầu được chấp thuận sẽ được chuyển khoản thủ công.

Hoàn và kiểm tra khoản tiền

Tin bị ẩn, hết phòng hoặc hết hạn không làm dừng thời gian đã mua và không tự phát sinh khoản hoàn. Nếu khoản nạp, trừ phí hoặc rút tiền có thông tin chưa đúng, hãy giữ lại mã yêu cầu và gửi phản ánh để được kiểm tra. Không chia sẻ mật khẩu hoặc mã xác minh cho bất kỳ ai.'
,version=version+1,change_token=lower(hex(randomblob(16))),updated_at=unixepoch()
WHERE id='support-draft-money' AND body='' AND is_active=0 AND deleted_at IS NULL;

UPDATE content_pages SET body='Thông tin chúng tôi sử dụng

Khi tạo tài khoản, bạn cung cấp tên và email. Khi đăng tin hoặc gửi yêu cầu, bạn có thể cung cấp số điện thoại, số Zalo, hình ảnh, địa chỉ phòng, thông tin nhận tiền, nội dung phản ánh và thông tin giao dịch.

Thông tin này được dùng để duy trì tài khoản, hiển thị tin theo lựa chọn của bạn, kiểm tra tin đăng, xử lý yêu cầu nạp hoặc rút tiền, ngăn hành vi gây hại và giải quyết phản ánh liên quan.

Thông tin hiển thị và quyền truy cập

Tin đã được chấp thuận có thể hiển thị thông tin liên hệ bạn đã cung cấp. Với địa chỉ, bạn chọn hiển thị vị trí cụ thể hoặc gần đúng trước khi gửi tin. Email đăng nhập, mật khẩu và mã xác minh không hiển thị trên tin đăng. Người xử lý chỉ được xem thông tin cần thiết cho công việc của họ.

Lưu giữ và yêu cầu thay đổi thông tin

Một số thông tin liên quan đến giao dịch, kiểm duyệt và phản ánh có thể được giữ lại để đối chiếu, xử lý yêu cầu và bảo vệ lịch sử giao dịch. Thời hạn lưu cụ thể và kênh tiếp nhận yêu cầu xem, sửa hoặc xóa dữ liệu sẽ được bổ sung trước khi trang này được công khai. Việc xóa tài khoản không nhất thiết xóa ngay lịch sử giao dịch cần lưu để đối chiếu.'
,version=version+1,change_token=lower(hex(randomblob(16))),updated_at=unixepoch()
WHERE id='support-draft-privacy' AND body='' AND is_active=0 AND deleted_at IS NULL;

UPDATE content_pages SET body='Báo cáo tin đăng

Nếu phát hiện tin có thông tin không chính xác, phòng đã có người thuê, tin trùng lặp, dấu hiệu lừa đảo hoặc sử dụng hình ảnh, thông tin cá nhân không phù hợp, hãy mở tin đó và chọn gửi báo cáo. Chọn lý do, mô tả cụ thể sự việc và gửi. Email liên hệ không bắt buộc; bạn có thể để lại email nếu muốn chúng tôi hỏi thêm.

Sau khi gửi, hãy lưu mã tiếp nhận để tiện trao đổi. Chúng tôi sẽ xem xét phản ánh. Việc gửi báo cáo không đồng nghĩa tin đã được xác định vi phạm hoặc sẽ tự động bị gỡ.

Hỗ trợ tài khoản và giao dịch

Với yêu cầu nạp hoặc rút tiền, hãy giữ lại mã yêu cầu và kiểm tra trạng thái trong tài khoản. Không gửi mật khẩu, mã xác minh hoặc thông tin đăng nhập khi báo cáo sự cố.

Thông tin liên hệ trực tiếp và thời gian tiếp nhận hỗ trợ sẽ được bổ sung trước khi trang này được công khai.'
,version=version+1,change_token=lower(hex(randomblob(16))),updated_at=unixepoch()
WHERE id='support-draft-contact' AND body='' AND is_active=0 AND deleted_at IS NULL;

UPDATE content_pages SET body='Trách nhiệm khi đăng tin

Người đăng chịu trách nhiệm về nội dung, hình ảnh và thông tin liên hệ mình cung cấp. Hãy kiểm tra kỹ giá thuê, tiền cọc, phí điện nước, diện tích, địa chỉ và tình trạng phòng trước khi gửi tin.

Chỉ đăng phòng bạn có quyền cho thuê hoặc được chủ phòng cho phép. Thông tin và hình ảnh cần phản ánh đúng căn phòng hiện có. Không đăng tin giả, tin trùng lặp, thông tin dễ gây hiểu lầm, nội dung xâm phạm quyền riêng tư hoặc nội dung trái quy định pháp luật.

Kiểm tra và chỉnh sửa tin

Tin được xem xét trước khi hiển thị. Nếu cần bổ sung hoặc chỉnh sửa, bạn sẽ nhận được hướng dẫn trong tài khoản. Khi sửa một tin đang hiển thị, nội dung mới sẽ được kiểm tra trước khi thay thế nội dung đã được chấp thuận.

Bạn có thể chọn hiển thị địa chỉ cụ thể hoặc gần đúng. Hãy bảo đảm số điện thoại và Zalo trong tin là thông tin bạn đồng ý cho người thuê liên hệ.

Lưu ý cho người thuê

Người tìm phòng nên đến xem trực tiếp, xác nhận người cho thuê và hỏi rõ các khoản tiền trước khi ký thỏa thuận hoặc chuyển cọc. Tìm Phòng Trọ kết nối người thuê với người đăng, không nhận tiền thuê hay tiền đặt cọc và không thể thay hai bên xác minh giao dịch thực tế.

Chúng tôi cố gắng kiểm tra tin trước khi hiển thị nhưng không thể xác nhận thay cho người thuê rằng mọi thông tin đều chính xác. Nếu thấy dấu hiệu bất thường, hãy gửi báo cáo từ trang tin.'
,version=version+1,change_token=lower(hex(randomblob(16))),updated_at=unixepoch()
WHERE id='support-draft-listing-rules' AND body='' AND is_active=0 AND deleted_at IS NULL;
