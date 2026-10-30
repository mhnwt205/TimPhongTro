import {Hono} from 'hono';
import type {ApiContext,ApiEnv} from './security';
import {requireUser} from './security';
import {sendResend,type EmailMessage} from './email';
const router=new Hono<ApiEnv>();
router.use('/account/notifications/*',requireUser);
export type UserNotification={id:string;kind:string;title:string;body:string;href:string;created_at:number;read_at:number|null};
export function sendNotificationEmail(c:ApiContext,message:EmailMessage){c.executionCtx.waitUntil(sendResend(c.env,message));}
export async function notifyAccount(c:ApiContext,input:{userId:string;eventKey:string;kind:UserNotification['kind'];title:string;body:string;href:string;email?:EmailMessage}){
 const inserted=await c.env.DB.prepare('INSERT INTO user_notifications(id,user_id,event_key,kind,title,body,href) VALUES(?,?,?,?,?,?,?) ON CONFLICT(event_key) DO NOTHING RETURNING id').bind(crypto.randomUUID(),input.userId,input.eventKey,input.kind,input.title,input.body,input.href).first<{id:string}>();
 if(inserted&&input.email)sendNotificationEmail(c,input.email);
 return Boolean(inserted);
}
router.get('/account/notifications',requireUser,async c=>{
 const user=c.get('user'),page=Number(c.req.query('page')??1);if(!Number.isSafeInteger(page)||page<1||page>10000)return c.json({error:'Trang thông báo không hợp lệ.'},400);
 const [items,count]=await c.env.DB.batch([
  c.env.DB.prepare('SELECT id,kind,title,body,href,created_at,read_at FROM user_notifications WHERE user_id=? ORDER BY created_at DESC,id DESC LIMIT 30 OFFSET ?').bind(user.id,(page-1)*30),
  c.env.DB.prepare('SELECT count(*) AS total FROM user_notifications WHERE user_id=? AND read_at IS NULL').bind(user.id),
 ]);
 return c.json({items:items.results,total_unread:Number((count.results[0] as {total:number})?.total??0),page,page_size:30});
});
router.post('/account/notifications/:id/read',requireUser,async c=>{
 const user=c.get('user'),id=c.req.param('id');
 const result=await c.env.DB.prepare('UPDATE user_notifications SET read_at=COALESCE(read_at,unixepoch()) WHERE id=? AND user_id=? RETURNING id').bind(id,user.id).first<{id:string}>();
 return result?c.json({ok:true}):c.json({error:'Không tìm thấy thông báo.'},404);
});
router.post('/account/notifications/read-all',requireUser,async c=>{
 const result=await c.env.DB.prepare('UPDATE user_notifications SET read_at=unixepoch() WHERE user_id=? AND read_at IS NULL').bind(c.get('user').id).run();
 return c.json({ok:true,updated:result.meta.changes});
});
export default router;
