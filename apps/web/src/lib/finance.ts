import app from '@timphongtro/api';
import {env} from 'cloudflare:workers';
export const topupLabels:Record<string,string>={pending:'Chờ thanh toán',reported:'Chờ đối soát',needs_review:'Cần kiểm tra',credited:'Đã cộng số dư',cancelled:'Đã hủy'};
export const money=(n:number)=>n.toLocaleString('vi-VN')+'đ';
export const date=(n:number)=>new Date(n*1000).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
export type Page<T>={items:T[];total:number;page:number;page_size:number};
export type Event={id:string;action:string;note:string;created_at:number;actor_name:string};
export const eventLabels:Record<string,string>={created:'Tạo yêu cầu',reported:'Người đăng báo đã chuyển',needs_review:'Chuyển cần xử lý',cancelled:'Hủy yêu cầu',credited:'Xác nhận tiền thực nhận'};
export async function financeRead<T>(path:string,url:URL,cookie:string|null){const response=await app.fetch(new Request(new URL(path,url),{headers:{cookie:cookie??''}}),env);return {status:response.status,data:response.ok?await response.json() as T:null};}

export const withdrawalLabels:Record<string,string>={pending:'Chờ duyệt',approved:'Đang chuyển khoản',paid:'Đã chuyển',rejected:'Đã từ chối',cancelled:'Đã hủy'};
export const withdrawalEventLabels:Record<string,string>={created:'Gửi yêu cầu và giữ tiền',claimed:'Quản trị viên nhận xử lý chuyển tiền',released:'Nhả xử lý, chưa chuyển tiền',approved:'Đã duyệt, chờ chuyển khoản',paid:'Xác nhận đã chuyển khoản',rejected:'Từ chối và hoàn khoản giữ',cancelled:'Hủy và hoàn khoản giữ'};
