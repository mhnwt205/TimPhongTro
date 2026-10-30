import {Hono} from 'hono';
import {bodyLimit} from 'hono/body-limit';
import {publicRooms} from './listings';
import {readBody,limit,clientIp,requireUser,requireAdmin,requirePermission,type ApiEnv} from './security';
import {text} from './responses';
export const reportReasons={incorrect:'Thông tin không chính xác',unavailable:'Phòng đã hết / không còn cho thuê',fraud:'Có dấu hiệu lừa đảo',privacy:'Ảnh hoặc thông tin cá nhân bị dùng sai',duplicate:'Tin trùng lặp',other:'Nội dung khác cần kiểm tra'};
export type ListingReport={id:string;code:string;listing_id:string;listing_title:string;is_sample:number;reason:keyof typeof reportReasons;details:string;contact_email:string;status:'open'|'reviewing'|'resolved'|'dismissed';review_note:string;version:number;created_at:number;updated_at:number};
const router=new Hono<ApiEnv>();
router.use('/listing-reports',bodyLimit({maxSize:8192,onError:c=>c.json({error:'Nội dung báo cáo quá dài.'},413)}));
router.post('/listing-reports',async(c):Promise<Response>=>{
 const data=await readBody(c),id=text(data.listing_id),reason=text(data.reason),details=text(data.details),email=text(data.contact_email).toLowerCase(),key=text(data.request_key);
 const listing=(await publicRooms(c.env.DB)).find(room=>room.id===id);
 if(!listing||!Object.hasOwn(reportReasons,reason)||details.length<10||details.length>2000||email.length>254||email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||text(data.website)||!(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(key)))return c.json({error:'Chọn tin, lý do và mô tả 10–2.000 ký tự. Email liên hệ là tùy chọn nhưng cần đúng định dạng.'},400);
 const prior=await c.env.DB.prepare('SELECT code,listing_id,reason,details,contact_email FROM listing_reports WHERE request_key=?').bind(key).first<ListingReport>();
 const replay=(row:ListingReport)=>row.listing_id===id&&row.reason===reason&&row.details===details&&row.contact_email===email?c.json({ok:true,code:row.code,replayed:true}):c.json({error:'Mã gửi đã được sử dụng với nội dung khác.'},409);
 if(prior)return replay(prior);
 const denied=await limit(c,'listing-report',clientIp(c),5,3600);if(denied)return denied;
 const code='BAO'+Array.from(crypto.getRandomValues(new Uint8Array(12)),n=>'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[n&31]).join('');
 const inserted=await c.env.DB.prepare('INSERT INTO listing_reports(id,code,listing_id,listing_title,is_sample,reason,details,contact_email,request_key) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(request_key) DO NOTHING').bind(crypto.randomUUID(),code,id,listing.title,0,reason,details,email,key).run();
 const result=await c.env.DB.prepare('SELECT code,listing_id,reason,details,contact_email FROM listing_reports WHERE request_key=?').bind(key).first<ListingReport>();
 return result?(inserted.meta.changes===1?c.json({ok:true,code:result.code}):replay(result)):c.json({error:'Chưa ghi nhận được báo cáo. Hãy thử lại.'},409);
});
router.use('/cms/reports',requireUser,requireAdmin);
router.use('/cms/reports/*',requireUser,requireAdmin);
router.get('/cms/reports',requirePermission('reports.read'),async(c):Promise<Response>=>{
 const page=Number(c.req.query('page')??1),status=c.req.query('status')??'waiting',q=(c.req.query('q')??'').trim().slice(0,100);
 if(!Number.isSafeInteger(page)||page<1||page>10000||!['waiting','all','open','reviewing','resolved','dismissed'].includes(status))return c.json({error:'Trạng thái hoặc số trang không hợp lệ. Chọn lại bộ lọc rồi tải danh sách.'},400);
 const where=`WHERE (instr(lower(listing_title),lower(?))>0 OR instr(code,upper(?))>0)${status==='all'?'':status==='waiting'?" AND status IN('open','reviewing')":' AND status=?'}`;
 const args=['waiting','all'].includes(status)?[q,q]:[q,q,status];
 const [items,count]=await c.env.DB.batch<Record<string,unknown>>([c.env.DB.prepare(`SELECT * FROM listing_reports ${where} ORDER BY created_at DESC,rowid DESC LIMIT 10 OFFSET ?`).bind(...args,(page-1)*10),c.env.DB.prepare(`SELECT count(*) AS total FROM listing_reports ${where}`).bind(...args)]);
 return c.json({items:items.results.map(({request_key,change_token,...row})=>row),total:Number(count.results[0]?.total??0),page,page_size:10});
});
router.post('/cms/reports/:id/review',requirePermission('reports.review'),async(c):Promise<Response>=>{
 const data=await readBody(c),status=text(data.status),note=text(data.note),user=c.get('user');
 if(typeof data.version!=='number'||!Number.isSafeInteger(data.version)||data.version<1||!['reviewing','resolved','dismissed'].includes(status)||note.length<5||note.length>1000)return c.json({error:'Chọn trạng thái và nhập ghi chú 5–1.000 ký tự.'},400);
 const denied=await limit(c,'report-review',user.id,60,3600);if(denied)return denied;
 const stamp=crypto.randomUUID();
 const result=await c.env.DB.batch([
  c.env.DB.prepare('UPDATE listing_reports SET status=?,review_note=?,version=version+1,change_token=?,updated_at=unixepoch() WHERE id=? AND version=? AND (status!=? OR review_note!=?)').bind(status,note,stamp,c.req.param('id'),data.version,status,note),
  c.env.DB.prepare('INSERT INTO listing_report_events(id,report_id,actor_id,status,note) SELECT ?,id,?,?,? FROM listing_reports WHERE id=? AND change_token=?').bind(crypto.randomUUID(),user.id,status,note,c.req.param('id'),stamp),
  c.env.DB.prepare("INSERT INTO admin_audit(id,actor_id,action,target_id,note) SELECT ?,?,'report.review',id,'Chi tiết theo quyền xử lý báo cáo.' FROM listing_reports WHERE id=? AND change_token=?").bind(crypto.randomUUID(),user.id,c.req.param('id'),stamp)
 ]);
 return result[0].meta.changes===1?c.json({ok:true}):c.json({error:'Báo cáo đã thay đổi. Tải lại trước khi xử lý.'},409);
});
export default router;
