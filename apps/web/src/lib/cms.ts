export type CmsKey='users'|'roles'|'plans'|'locations'|'content'|'listings'|'audit';
export const financeSections=[
 {slug:'nap-tien',key:'topups',label:'Nạp tiền qua SePay',icon:'wallet',description:'Theo dõi thanh toán và kiểm tra giao dịch bất thường.'},
 {slug:'rut-tien',key:'withdrawals',label:'Yêu cầu rút số dư',icon:'wallet',description:'Duyệt và xác nhận chuyển khoản thủ công.'},
 {slug:'so-du',key:'wallets',label:'Số dư và giao dịch',icon:'list',description:'Tra cứu lịch sử và điều chỉnh số dư.'},
] as const;
export const cmsSections = [
 {slug:'gia-han',key:'renewals',label:'Gia hạn tin',icon:'clock',description:'Duyệt yêu cầu gia hạn và các kỳ hiển thị đã mua.'},
 {slug:'tai-khoan',key:'users',label:'Tài khoản',icon:'user',description:'Quản lý tài khoản, trạng thái và vai trò được cấp.'},
 {slug:'vai-tro',key:'roles',label:'Vai trò và quyền',icon:'shield',description:'Tạo bộ quyền theo công việc và gán cho nhân viên.'},
 {slug:'goi-dang-tin',key:'plans',label:'Gói đăng tin',icon:'wallet',description:'Quản lý giá, thời hạn và trạng thái gói hiển thị trên bảng giá.'},
 {slug:'khu-vuc',key:'locations',label:'Khu vực',icon:'pin',description:'Danh mục khu vực tìm kiếm. Tên gọi quen thuộc không thay thế địa chỉ hành chính.'},
 {slug:'noi-dung',key:'content',label:'Trang nội dung',icon:'list',description:'Quản lý trang hướng dẫn, giới thiệu, hỗ trợ và chính sách; bản chưa sẵn sàng có thể để ẩn.'},
 {slug:'noi-dung-website',key:'site_content',label:'Nội dung website',icon:'list',description:'Sửa nội dung giới thiệu, chính sách đăng tin, ưu đãi, câu hỏi thường gặp và chân trang.'},
 {slug:'tin-phong',key:'listings',label:'Tin phòng',icon:'home',description:'Quản lý nội dung, hình ảnh và xét duyệt tin đăng.'},
 {slug:'nhat-ky',key:'audit',label:'Nhật ký',icon:'clock',description:'Tra cứu người thực hiện, đối tượng, thời điểm và lý do thao tác.'},
] as const;
export const dateVi=(n:unknown)=>typeof n==='number'?new Date(n*1000).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'}):String(n??'');
export const moneyVi=(n:unknown)=>Number(n).toLocaleString('vi-VN')+'đ';

export const reportSection={slug:'bao-cao-tin',key:'reports',label:'Báo cáo tin đăng',icon:'shield',description:'Kiểm tra phản ánh và ghi nhận kết quả xử lý.'} as const;
