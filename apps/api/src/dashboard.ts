import type {User} from './security';
import {can} from './permissions';

export type ActivityDay={day:string;users?:number;listings?:number;content?:number};
export type CmsNotification={id:string;title:string;description:string;href:string;count:number;icon:string};
export type CmsActivity={id:string;label:string;actor:string;created_at:number;href:string};
export type CmsNotifications={pending:number;counts:{sellers:number;topups:number;withdrawals:number;reports:number;listings:number;renewals:number};items:CmsNotification[];activity:CmsActivity[];updated_at:number};
export type CmsDashboard={metrics:Record<string,number>;activity:ActivityDay[];days:number;updated_at:number;distribution:{title:string;items:{label:string;value:number;href:string;tone:string}[]};pending_sellers:{id:string;name:string;type:string;submitted_at:number}[];notifications:CmsNotifications};
const auditLabels:Record<string,string>={
 'renewal.approved':'Duyệt gia hạn tin','renewal.rejected':'Từ chối gia hạn','renewal.cancelled':'Hủy yêu cầu gia hạn','listing.hide':'Tạm ẩn tin','listing.unavailable':'Đánh dấu hết phòng','listing.reopen':'Mở lại tin','listing.confirm':'Xác nhận còn phòng','listing.block':'CMS tạm gỡ tin','listing.unblock':'CMS mở gỡ tin',
 'listing.published':'Duyệt xuất bản tin phòng','listing.rejected':'Yêu cầu bổ sung tin phòng','report.review':'Xử lý báo cáo tin đăng','admin.bootstrap':'Cấp quyền quản trị cao nhất','user.create':'Tạo tài khoản','user.update':'Cập nhật tài khoản','user.roles':'Thay đổi vai trò tài khoản','user.lock':'Khóa tài khoản','user.unlock':'Mở khóa tài khoản','user.delete':'Chuyển tài khoản vào thùng rác','user.restore':'Khôi phục tài khoản','account.password':'Đổi mật khẩu','seller.approved':'Duyệt quyền đăng','seller.rejected':'Yêu cầu bổ sung hồ sơ',
 'withdrawal.claimed':'Nhận xử lý chuyển tiền rút','withdrawal.released':'Nhả xử lý yêu cầu rút','withdrawal.approved':'Duyệt yêu cầu rút','withdrawal.rejected':'Từ chối yêu cầu rút','withdrawal.cancelled':'Hủy yêu cầu rút','withdrawal.paid':'Xác nhận chuyển tiền rút','wallet.withdrawal_hold':'Giữ tiền cho yêu cầu rút','wallet.withdrawal_release':'Hoàn khoản giữ yêu cầu rút',
 'payments.update':'Cập nhật cấu hình nhận tiền','topup.credited':'Xác nhận khoản nạp','topup.needs_review':'Đánh dấu yêu cầu nạp cần xử lý','topup.cancelled':'Hủy yêu cầu nạp','payment.sepay_exception_review':'Ghi nhận đã kiểm tra giao dịch SePay','wallet.topup':'Ghi nhận số dư từ chuyển khoản','wallet.adjustment':'Điều chỉnh số dư',
};
const resourceLabels:Record<string,string>={roles:'vai trò',plans:'gói đăng tin',locations:'khu vực',content:'trang nội dung',listings:'tin phòng'};
const actionLabels:Record<string,string>={create:'Tạo',update:'Cập nhật',delete:'Chuyển vào thùng rác:',restore:'Khôi phục'};
export function activityLabel(action:string){const [resource,verb]=action.split('.');return auditLabels[action]??(resourceLabels[resource]&&actionLabels[verb]?`${actionLabels[verb]} ${resourceLabels[resource]}`:'Thao tác quản trị');}

export async function loadNotifications(db:D1Database,user:User):Promise<CmsNotifications>{
 const items:CmsNotification[]=[];let activity:CmsActivity[]=[];const counts={sellers:0,topups:0,withdrawals:0,reports:0,listings:0,renewals:0};
 if(can(user,'sellers.read')){
  const row=await db.prepare(`SELECT count(*) AS total FROM seller_profiles p JOIN users u ON u.id=p.user_id WHERE p.status='pending' AND u.is_locked=0 AND u.deleted_at IS NULL`).first<{total:number}>();
  if(row?.total)items.push({id:'pending-sellers',title:'Hồ sơ người đăng chờ duyệt',description:'Chủ trọ và môi giới đang chờ được kiểm tra hồ sơ.',href:'/quan-tri/nguoi-dang?status=pending',count:row.total,icon:'user-check'});
  counts.sellers=row?.total??0;
 }
 if(can(user,'listings.read')){
  const row=await db.prepare("SELECT count(*) AS total FROM listing_drafts WHERE status='pending' AND deleted_at IS NULL").first<{total:number}>();
  counts.listings=row?.total??0;
  if(counts.listings)items.push({id:'pending-listings',title:'Tin phòng chờ duyệt',description:'Kiểm tra nội dung và ảnh trước khi xuất bản.',href:'/quan-tri/tin-phong',count:counts.listings,icon:'home'});
 }
 if(can(user,'renewals.read')){
  const row=await db.prepare("SELECT count(*) AS total FROM listing_renewals WHERE status='pending'").first<{total:number}>();
  counts.renewals=row?.total??0;
  if(counts.renewals)items.push({id:'pending-renewals',title:'Yêu cầu gia hạn chờ duyệt',description:'Kiểm tra gói, phí và thời hạn trước khi duyệt.',href:'/quan-tri/gia-han',count:counts.renewals,icon:'clock'});
 }
 if(can(user,'topups.read')){
  const [row,exceptions]=await db.batch<{total:number}>([
   db.prepare("SELECT count(*) AS total FROM topup_requests t WHERE status IN('reported','needs_review') AND NOT (payment_provider='sepay_pg' AND EXISTS(SELECT 1 FROM sepay_payment_events e WHERE e.topup_id=t.id AND e.outcome!='credited' AND e.reviewed_at IS NULL))"),
   db.prepare("SELECT count(*) AS total FROM sepay_payment_events WHERE outcome!='credited' AND reviewed_at IS NULL")
  ]);
  counts.topups=Number(row.results[0]?.total??0)+Number(exceptions.results[0]?.total??0);
  if(counts.topups)items.push({id:'pending-topups',title:'Khoản nạp cần kiểm tra',description:'Có yêu cầu cũ hoặc giao dịch SePay chưa ghép được tự động.',href:'/quan-tri/nap-tien?status=waiting',count:counts.topups,icon:'wallet'});
 }
 if(can(user,'withdrawals.read')){
  const row=await db.prepare("SELECT count(*) AS total FROM withdrawal_requests WHERE status IN('pending','approved')").first<{total:number}>();
  counts.withdrawals=row?.total??0;
  if(counts.withdrawals)items.push({id:'pending-withdrawals',title:'Yêu cầu rút chờ xử lý',description:'Cần duyệt hoặc xác nhận chuyển khoản thủ công.',href:'/quan-tri/rut-tien?status=waiting',count:counts.withdrawals,icon:'wallet'});
 }
 if(can(user,'reports.read')){
  const row=await db.prepare("SELECT count(*) AS total FROM listing_reports WHERE status IN('open','reviewing')").first<{total:number}>();
  counts.reports=row?.total??0;
  if(counts.reports)items.push({id:'pending-reports',title:'Báo cáo tin cần kiểm tra',description:'Phản ánh về nội dung tin đang chờ xử lý.',href:'/quan-tri/bao-cao-tin?status=waiting',count:counts.reports,icon:'shield'});
 }
 if(can(user,'audit.read')){
  const rows=(await db.prepare(`SELECT a.id,a.action,a.created_at,u.name AS actor FROM admin_audit a LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.created_at DESC,a.rowid DESC LIMIT 5`).all<{id:string;action:string;created_at:number;actor:string|null}>()).results;
  activity=rows.map(r=>({id:r.id,label:activityLabel(r.action),actor:r.actor??'Quản trị hệ thống',created_at:r.created_at,href:'/quan-tri/nhat-ky'}));
 }
 return {pending:items.reduce((n,i)=>n+i.count,0),counts,items,activity,updated_at:Math.floor(Date.now()/1000)};
}

export async function loadDashboard(db:D1Database,user:User,days:7|30):Promise<CmsDashboard>{
 const definitions=[['users','users.read',"SELECT count(*) AS total FROM users WHERE id!='sepay-ipn-system' AND deleted_at IS NULL"],['sellers','sellers.read',"SELECT count(*) AS total FROM seller_profiles p JOIN users u ON u.id=p.user_id WHERE p.status='pending' AND u.is_locked=0 AND u.deleted_at IS NULL"],['listings','listings.read','SELECT count(*) AS total FROM listing_drafts WHERE deleted_at IS NULL'],['content','content.read','SELECT count(*) AS total FROM content_pages WHERE deleted_at IS NULL']] as const;
 const allowed=definitions.filter(d=>can(user,d[1]));
 const series=[['users','users.read','users'],['listings','listings.read','listing_drafts'],['content','content.read','content_pages']] as const;
 const permitted=series.filter(s=>can(user,s[1]));
 const now=Date.now(),today=new Date(now+7*3600000).toISOString().slice(0,10);
 const startDate=new Date(today+'T00:00:00Z');startDate.setUTCDate(startDate.getUTCDate()-days+1);
 const start=startDate.toISOString().slice(0,10),startTimestamp=Math.floor(startDate.getTime()/1000)-7*3600;
 const statements=[...allowed.map(d=>db.prepare(d[2])),...permitted.map(s=>db.prepare(`SELECT date(created_at,'unixepoch','+7 hours') AS day,count(*) AS total FROM ${s[2]} WHERE ${s[0]==='users'?"id!='sepay-ipn-system' AND ":''}created_at>=? AND created_at<=? GROUP BY day ORDER BY day`).bind(startTimestamp,Math.floor(now/1000)))];
 const rows=statements.length?await db.batch<{total:number;day:string}>(statements):[];
 const activity:ActivityDay[]=Array.from({length:days},(_,index)=>{const d=new Date(start+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+index);return {day:d.toISOString().slice(0,10)};});
 permitted.forEach(([key],index)=>{const points=new Map(rows[allowed.length+index].results.map(r=>[r.day,Number(r.total)]));for(const point of activity)point[key]=points.get(point.day)??0;});
 let distribution:CmsDashboard['distribution']={title:'Cơ cấu dữ liệu',items:[]},pending_sellers:CmsDashboard['pending_sellers']=[];
 if(can(user,'sellers.read')){
  const grouped=(await db.prepare(`SELECT p.status,count(*) AS total FROM seller_profiles p JOIN users u ON u.id=p.user_id WHERE u.deleted_at IS NULL AND u.is_locked=0 GROUP BY p.status`).all<{status:string;total:number}>()).results;
  const count=(status:string)=>Number(grouped.find(g=>g.status===status)?.total??0);
  distribution={title:'Trạng thái người đăng',items:[{label:'Đã duyệt',value:count('approved'),href:'/quan-tri/nguoi-dang?status=approved',tone:'accent'},{label:'Chờ duyệt',value:count('pending'),href:'/quan-tri/nguoi-dang?status=pending',tone:'amber'},{label:'Cần bổ sung',value:count('rejected'),href:'/quan-tri/nguoi-dang?status=rejected',tone:'slate'}]};
  pending_sellers=(await db.prepare(`SELECT p.user_id AS id,p.display_name AS name,p.seller_type AS type,p.submitted_at FROM seller_profiles p JOIN users u ON u.id=p.user_id WHERE p.status='pending' AND u.is_locked=0 AND u.deleted_at IS NULL ORDER BY p.submitted_at,p.user_id LIMIT 5`).all<CmsDashboard['pending_sellers'][number]>()).results;
 }else if(can(user,'users.read')){
  const grouped=(await db.prepare("SELECT is_locked,count(*) AS total FROM users WHERE id!='sepay-ipn-system' AND deleted_at IS NULL GROUP BY is_locked").all<{is_locked:number;total:number}>()).results;
  distribution={title:'Trạng thái tài khoản',items:[{label:'Đang hoạt động',value:Number(grouped.find(g=>!g.is_locked)?.total??0),href:'/quan-tri/tai-khoan',tone:'accent'},{label:'Đã khóa',value:Number(grouped.find(g=>g.is_locked)?.total??0),href:'/quan-tri/tai-khoan?state=locked',tone:'slate'}]};
 }else if(can(user,'content.read')){
  const grouped=(await db.prepare('SELECT is_active,count(*) AS total FROM content_pages WHERE deleted_at IS NULL GROUP BY is_active').all<{is_active:number;total:number}>()).results;
  distribution={title:'Trang nội dung',items:[{label:'Đã xuất bản',value:Number(grouped.find(g=>g.is_active)?.total??0),href:'/quan-tri/noi-dung',tone:'accent'},{label:'Chưa xuất bản',value:Number(grouped.find(g=>!g.is_active)?.total??0),href:'/quan-tri/noi-dung',tone:'slate'}]};
 }
 const notifications=await loadNotifications(db,user);
 return {metrics:Object.fromEntries(allowed.map((d,i)=>[d[0],Number(rows[i].results[0]?.total??0)])),activity,days,updated_at:Math.floor(now/1000),distribution,pending_sellers,notifications};
}
