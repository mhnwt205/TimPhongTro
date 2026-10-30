import {Hono} from 'hono';
import {bodyLimit} from 'hono/body-limit';
import {type ApiEnv,requireUser,requireAdmin,requirePermission,resolveUser,readBody,limit} from './security';
import {can} from './permissions';
import {text} from './responses';
import {publicEligibility} from './listing-status';
import {validPoint,type MapPoint} from '../../shared/maps';
import {amenities,type Room} from '../../shared/rooms';
import {sendNotificationEmail} from './notifications';
import {emailShell} from './email';

export type Listing = {id:string;owner_id:string;title:string;location_id:string;room_type:'room'|'studio';price_vnd:number;area_m2:number;description:string;details:string;plan_id:string|null;status:'draft'|'pending'|'published'|'rejected';version:number;review_note:string;created_at:number;updated_at:number;published_at:number|null;expires_at:number|null;public_data:string|null;deleted_at:number|null;created_by_admin:number;display_state:'available'|'hidden'|'unavailable';moderation_hidden:number;availability_confirmed_at:number|null};
export type ListingDetails={map_point?:MapPoint|null;street:string;address_visibility:'exact'|'approximate';people:number;quoted_price?:number;quoted_duration?:number;quoted_priority?:number;deposit:number;electricity:number;water:number;water_unit:'per_person'|'per_m3';service:number;parking:number;amenities:string[];photos:string[];keep_public_copy?:boolean};
const router=new Hono<ApiEnv>();
router.use('/account/listings*',requireUser);
router.use('/cms/listing-submissions*',requireUser,requireAdmin);
const own=async(db:D1Database,id:string,user:string)=>db.prepare('SELECT * FROM listing_drafts WHERE id=? AND owner_id=? AND deleted_at IS NULL AND (created_by_admin=0 OR published_at IS NOT NULL)').bind(id,user).first<Listing>();
const integer=(v:unknown,min:number,max:number)=>['string','number'].includes(typeof v)&&String(v).trim()!==''&&Number.isSafeInteger(Number(v))&&Number(v)>=min&&Number(v)<=max;
const safeVersion=(v:unknown)=>integer(v,1,1000000000);

type PlanSnapshot={id:string;price_vnd:number;duration_days:number;is_priority:number};
function listingContent(data:Record<string,unknown>){
 const title=text(data.title),description=text(data.description),locationId=text(data.location_id),type=text(data.room_type);
 const d=data.details&&typeof data.details==='object'&&!Array.isArray(data.details)?data.details as Record<string,unknown>:{};
 const photos=Array.isArray(d.photos)?d.photos:[],features=Array.isArray(d.amenities)?d.amenities:[],point=d.map_point,waterUnit=text(d.water_unit);
 if(title.length<5||title.length>150||description.length>4000||!integer(data.price_vnd,1,100000000)
  ||!['string','number'].includes(typeof data.area_m2)||!Number.isFinite(Number(data.area_m2))||Number(data.area_m2)<1||Number(data.area_m2)>1000
  ||!['room','studio'].includes(type)||text(d.street).length>200||!['exact','approximate'].includes(text(d.address_visibility))||!integer(d.people,1,20)
  ||!['per_person','per_m3'].includes(waterUnit)||!['deposit','electricity','water','service','parking'].every(k=>integer(d[k],0,100000000))
  ||d.photos!==undefined&&!Array.isArray(d.photos)||d.amenities!==undefined&&!Array.isArray(d.amenities)
  ||photos.length>8||photos.some(v=>typeof v!=='string'||!/^[a-f0-9-]{36}$/.test(v))||new Set(photos).size!==photos.length
  ||features.length>amenities.length||features.some(v=>!amenities.some(a=>a.id===v))||point!=null&&!validPoint(point))return null;
 const details:ListingDetails={map_point:validPoint(point)?{lat:point.lat,lng:point.lng}:null,street:text(d.street),address_visibility:text(d.address_visibility) as ListingDetails['address_visibility'],people:Number(d.people),deposit:Number(d.deposit),electricity:Number(d.electricity),water:Number(d.water),water_unit:waterUnit as ListingDetails['water_unit'],service:Number(d.service),parking:Number(d.parking),amenities:features as string[],photos:photos as string[]};
 return {title,description,locationId,type:type as Listing['room_type'],price:Number(data.price_vnd),size:Number(data.area_m2),details};
}
async function planForSave(db:D1Database,id:string,current?:Listing|null):Promise<PlanSnapshot|null>{
 if(current?.published_at!=null){
  if(id!==current.plan_id)return null;
  const publication=await db.prepare('SELECT duration_days FROM listing_publications WHERE listing_id=?').bind(current.id).first<{duration_days:number}>();
  if(!publication)return null;
  const old=JSON.parse(current.details) as ListingDetails,publicCopy=JSON.parse(current.public_data??'{}') as Partial<Room>;
  return {id,price_vnd:old.quoted_price??0,duration_days:publication.duration_days,is_priority:old.quoted_priority??(publicCopy.is_priority?1:0)};
 }
 return db.prepare('SELECT id,price_vnd,duration_days,is_priority FROM listing_plans WHERE id=? AND is_active=1 AND deleted_at IS NULL').bind(id).first<PlanSnapshot>();
}
const contentError='Kiểm tra tiêu đề, giá thuê, diện tích, địa chỉ, số người, đơn vị nước và các khoản phí. Tối đa 8 ảnh mỗi tin.';

export async function publicRooms(db:D1Database):Promise<Room[]>{
 const {results}=await db.prepare(`SELECT CASE WHEN r.id IS NULL THEN l.public_data ELSE json_set(l.public_data,'$.is_priority',json(CASE r.is_priority WHEN 1 THEN 'true' ELSE 'false' END)) END AS public_data FROM listing_drafts l JOIN users u ON u.id=l.owner_id JOIN seller_profiles s ON s.user_id=l.owner_id
 LEFT JOIN listing_renewal_approvals r ON r.listing_id=l.id AND r.starts_at<=unixepoch() AND r.expires_at>unixepoch()
 WHERE ${publicEligibility} ORDER BY COALESCE(r.is_priority,json_extract(l.public_data,'$.is_priority'),0) DESC,l.published_at DESC,l.id LIMIT 300`).all<{public_data:string}>();
 return results.flatMap(r=>{try{return [JSON.parse(r.public_data) as Room];}catch{return [];}});
}
router.get('/account/listings',async c=>{
 const db=c.env.DB,user=c.get('user');
 const [{results},profile,{results:locations},{results:plans},promotion,wallet]=await Promise.all([
 db.prepare('SELECT * FROM listing_drafts WHERE owner_id=? AND deleted_at IS NULL AND (created_by_admin=0 OR published_at IS NOT NULL) ORDER BY updated_at DESC,id LIMIT 100').bind(user.id).all<Listing>(),
 db.prepare('SELECT display_name,phone,zalo_phone,status FROM seller_profiles WHERE user_id=?').bind(user.id).first(),
 db.prepare('SELECT id,name FROM locations WHERE is_active=1 AND deleted_at IS NULL ORDER BY name').all(),
 db.prepare('SELECT id,name,price_vnd,duration_days,is_priority FROM listing_plans WHERE is_active=1 AND deleted_at IS NULL ORDER BY price_vnd').all(),
 db.prepare('SELECT free_posts_total-free_posts_used AS remaining FROM posting_promotions WHERE user_id=?').bind(user.id).first<{remaining:number}>(),
 db.prepare('SELECT balance_vnd FROM wallet_accounts WHERE user_id=?').bind(user.id).first<{balance_vnd:number}>()]);
 return c.json({items:results,profile,locations,plans,free_posts_remaining:promotion?.remaining??0,balance_vnd:wallet?.balance_vnd??0});
});
router.get('/account/listings/:id',async c=>{const item=await own(c.env.DB,c.req.param('id'),c.get('user').id);return item?c.json({item}):c.json({error:'Không tìm thấy tin của bạn.'},404);});
async function save(c:import('./security').ApiContext,id:string|null){
 const user=c.get('user'),db=c.env.DB,b=await readBody(c),submit=b.submit===true;
 const denied=await limit(c,'listing-save',user.id,40,3600);if(denied)return denied;
 if(submit&&c.env.EMAIL_VERIFICATION_REQUIRED==='true'&&user.email_verified_at==null)return c.json({error:'Xác minh email trước khi gửi tin. Bạn vẫn có thể lưu bản nháp.'},403);
 const current=id?await own(db,id,user.id):null;
 if(id&&!current)return c.json({error:'Không tìm thấy tin của bạn.'},404);
 if(current&&(!safeVersion(b.version)||current.version!==Number(b.version)))return c.json({error:'Tin đã thay đổi. Hãy tải lại trước khi lưu.'},409);
 if(!id&&!/^[a-f0-9-]{36}$/.test(text(b.request_key)))return c.json({error:'Hãy tải lại biểu mẫu trước khi tạo tin.'},400);
 const listingId=id??text(b.request_key);
 if(!id){const duplicate=await own(db,listingId,user.id);if(duplicate)return c.json({ok:true,id:duplicate.id,duplicate:true});}
 const content=listingContent(b);if(!content)return c.json({error:contentError},400);
 const {title,description,locationId:location,type,details:d}=content,plan=text(b.plan_id),photos=d.photos;
 if(current?.published_at!=null&&plan!==current.plan_id)return c.json({error:'Tin đã xuất bản giữ nguyên gói đã sử dụng. Gia hạn được xử lý riêng.'},400);
 const activePlan=await planForSave(db,plan,current);
 if(!await db.prepare('SELECT id FROM locations WHERE id=? AND is_active=1 AND deleted_at IS NULL').bind(location).first()
 ||!activePlan)return c.json({error:'Chọn khu vực và gói đăng tin đang sử dụng.'},400);
 if(photos.length){const n=await db.prepare(`SELECT count(*) AS n FROM listing_images WHERE owner_id=? AND id IN (${photos.map(()=>'?').join(',')})`).bind(user.id,...photos as string[]).first<{n:number}>();if(n?.n!==photos.length)return c.json({error:'Ảnh không thuộc tài khoản của bạn. Hãy chọn lại ảnh.'},400);}
 if(submit){
 const profile=await db.prepare('SELECT status FROM seller_profiles WHERE user_id=?').bind(user.id).first<{status:string}>();
 if(profile?.status!=='approved')return c.json({error:'Hồ sơ người đăng cần được duyệt trước khi gửi tin. Bạn vẫn có thể lưu bản nháp.'},403);
 if(description.length<30||text(d.street).length<5||photos.length<3)return c.json({error:'Để gửi duyệt, bổ sung địa chỉ/khu vực từ 5 ký tự, mô tả từ 30 ký tự và ít nhất 3 ảnh phòng.'},400);
 if(current?.expires_at&&current.expires_at<=Math.floor(Date.now()/1000))return c.json({error:'Tin đã hết hạn. Hãy tạo tin mới để đăng lại.'},409);
 }
 const details:ListingDetails={...d,quoted_price:activePlan.price_vnd,quoted_duration:activePlan.duration_days,quoted_priority:activePlan.is_priority};
 const count=await db.prepare('SELECT count(*) AS n FROM listing_drafts WHERE owner_id=? AND deleted_at IS NULL').bind(user.id).first<{n:number}>();
 if(!id&&(count?.n??0)>=100)return c.json({error:'Bạn đã có 100 tin. Hãy xóa bớt bản nháp không còn dùng.'},409);
 const stamp=crypto.randomUUID(),state=submit?'pending':'draft';
 const result=id?await db.prepare(`UPDATE listing_drafts SET title=?,location_id=?,room_type=?,price_vnd=?,area_m2=?,description=?,details=?,plan_id=?,status=?,review_note='',submitted_at=?,version=version+1,change_token=?,updated_at=unixepoch() WHERE id=? AND owner_id=? AND version=? AND deleted_at IS NULL`)
 .bind(title,location,type,Number(b.price_vnd),Number(b.area_m2),description,JSON.stringify(details),plan,state,submit?Math.floor(Date.now()/1000):null,stamp,id,user.id,Number(b.version)).run():
 await db.prepare(`INSERT INTO listing_drafts(id,owner_id,title,location_id,room_type,price_vnd,area_m2,description,details,plan_id,status,submitted_at,change_token) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING`)
 .bind(listingId,user.id,title,location,type,Number(b.price_vnd),Number(b.area_m2),description,JSON.stringify(details),plan,state,submit?Math.floor(Date.now()/1000):null,stamp).run();
 if(result.meta.changes!==1)return c.json({error:'Tin đã thay đổi. Hãy tải lại trang.'},409);
 return c.json({ok:true,id:listingId,status:state},id?200:201);
}
router.post('/account/listings',c=>save(c,null));
router.post('/account/listings/:id',c=>save(c,c.req.param('id')));
router.post('/account/listings/:id/delete',async c=>{const b=await readBody(c);if(!safeVersion(b.version))return c.json({error:'Hãy tải lại trang.'},400);const r=await c.env.DB.prepare(`UPDATE listing_drafts SET deleted_at=unixepoch(),version=version+1,updated_at=unixepoch() WHERE id=? AND owner_id=? AND version=? AND deleted_at IS NULL AND status!='pending' AND (created_by_admin=0 OR published_at IS NOT NULL)`).bind(c.req.param('id'),c.get('user').id,Number(b.version)).run();return r.meta.changes===1?c.json({ok:true}):c.json({error:'Tin đã thay đổi hoặc đang chờ duyệt. Hãy tải lại trang.'},409);});

// CMS creates the same full listing payload as the seller form, while assigning it
// to an already approved seller. Publication and payment remain in moderation.
router.post('/cms/listing-submissions',requirePermission('listings.create'),async c=>{
 const db=c.env.DB,b=await readBody(c),id=text(b.request_key),ownerId=text(b.owner_id),submit=b.submit===true;
 if(!/^[a-f0-9-]{36}$/.test(id))return c.json({error:'Hãy tải lại biểu mẫu trước khi tạo tin.'},400);
 const duplicate=await db.prepare('SELECT id,owner_id,status FROM listing_drafts WHERE id=? AND deleted_at IS NULL').bind(id).first<{id:string;owner_id:string;status:string}>();
 if(duplicate)return duplicate.owner_id===ownerId?c.json({ok:true,id,status:duplicate.status,duplicate:true}):c.json({error:'Mã yêu cầu đã được dùng. Tải lại biểu mẫu rồi thử lại.'},409);
 const content=listingContent(b);if(!content)return c.json({error:contentError},400);
 const {title,description,locationId,type,details:d}=content,planId=text(b.plan_id),photos=d.photos;
 const [profile,location,plan]=await Promise.all([
  db.prepare('SELECT status FROM seller_profiles WHERE user_id=?').bind(ownerId).first<{status:string}>(),
  db.prepare('SELECT id FROM locations WHERE id=? AND is_active=1 AND deleted_at IS NULL').bind(locationId).first<{id:string}>(),
  db.prepare('SELECT id,price_vnd,duration_days,is_priority FROM listing_plans WHERE id=? AND is_active=1 AND deleted_at IS NULL').bind(planId).first<{id:string;price_vnd:number;duration_days:number;is_priority:number}>(),
 ]);
 const owner=await db.prepare('SELECT id FROM users WHERE id=? AND is_locked=0 AND deleted_at IS NULL').bind(ownerId).first();
 if(!owner||profile?.status!=='approved')return c.json({error:'Chọn người đăng có hồ sơ đã được duyệt.'},400);
 if(!location||!plan)return c.json({error:'Chọn khu vực và gói đăng tin đang sử dụng.'},400);
 if(photos.length){const owned=await db.prepare(`SELECT count(*) AS n FROM listing_images WHERE owner_id=? AND id IN (${photos.map(()=>'?').join(',')})`).bind(ownerId,...photos as string[]).first<{n:number}>();if(owned?.n!==photos.length)return c.json({error:'Có ảnh không thuộc người đăng đã chọn. Hãy tải ảnh lại.'},400);}
 if(submit&&(description.length<30||text(d.street).length<5||photos.length<3))return c.json({error:'Để gửi duyệt, cần địa chỉ từ 5 ký tự, mô tả từ 30 ký tự và ít nhất 3 ảnh.'},400);
 const count=await db.prepare('SELECT count(*) AS n FROM listing_drafts WHERE owner_id=? AND deleted_at IS NULL').bind(ownerId).first<{n:number}>();
 if((count?.n??0)>=100)return c.json({error:'Người đăng đã có 100 tin. Hãy dọn bớt bản nháp trước.'},409);
 const details:ListingDetails={...d,quoted_price:plan.price_vnd,quoted_duration:plan.duration_days,quoted_priority:plan.is_priority};
 const state=submit?'pending':'draft',stamp=crypto.randomUUID(),result=await db.prepare(`INSERT INTO listing_drafts(id,owner_id,title,location_id,room_type,price_vnd,area_m2,description,details,plan_id,status,submitted_at,change_token,created_by_admin) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,1) ON CONFLICT(id) DO NOTHING`)
  .bind(id,ownerId,title,locationId,type,Number(b.price_vnd),Number(b.area_m2),description,JSON.stringify(details),planId,state,submit?Math.floor(Date.now()/1000):null,stamp).run();
 if(result.meta.changes!==1)return c.json({error:'Không tạo được tin. Tải lại biểu mẫu rồi thử lại.'},409);
 return c.json({ok:true,id,status:state},201);
});

// JSON upload keeps the existing strict same-origin policy; only re-encoded JPEG is accepted.
router.post('/uploads/listing-images',requireUser,bodyLimit({maxSize:840000,onError:c=>c.json({error:'Ảnh quá lớn. Hãy chọn ảnh nhỏ hơn.'},413)}),async c=>{
 const db=c.env.DB,user=c.get('user');const denied=await limit(c,'listing-photo',user.id,60,3600);if(denied)return denied;
 const profile=await db.prepare('SELECT status FROM seller_profiles WHERE user_id=?').bind(user.id).first<{status:string}>();
 if(profile?.status!=='approved')return c.json({error:'Hồ sơ cần được duyệt trước khi tải ảnh phòng lên.'},403);
 const abandoned=(await db.prepare(`SELECT i.id,i.object_key FROM listing_images i WHERE i.owner_id=? AND i.created_at<unixepoch()-86400 AND NOT EXISTS(SELECT 1 FROM listing_drafts l WHERE l.deleted_at IS NULL AND (EXISTS(SELECT 1 FROM json_each(l.details,'$.photos') WHERE value=i.id) OR EXISTS(SELECT 1 FROM json_each(COALESCE(l.public_data,'{}'),'$.images') WHERE value=i.id))) LIMIT 10`).bind(user.id).all<{id:string;object_key:string}>()).results;
 for(const image of abandoned){await c.env.LISTING_IMAGES.delete(image.object_key);await db.prepare('DELETE FROM listing_images WHERE id=? AND owner_id=?').bind(image.id,user.id).run();}
 const count=await db.prepare('SELECT count(*) AS n FROM listing_images WHERE owner_id=?').bind(user.id).first<{n:number}>();
 if((count?.n??0)>=80)return c.json({error:'Kho ảnh đã đầy. Xóa ảnh không còn dùng trước khi tải thêm.'},409);
 const b=await readBody(c);if(typeof b.jpeg!=='string'||b.jpeg.length>819200||!/^[A-Za-z0-9+/]+={0,2}$/.test(b.jpeg))return c.json({error:'Không đọc được ảnh. Hãy chọn lại ảnh JPG, PNG hoặc WebP.'},400);
 let bytes:Uint8Array;try{bytes=Uint8Array.from(atob(b.jpeg),x=>x.charCodeAt(0));}catch{return c.json({error:'Ảnh không hợp lệ.'},400);}
 const dimensions=jpegDimensions(bytes);if(!dimensions||bytes.length>614400||dimensions[0]>1600||dimensions[1]>1600||dimensions[0]<200||dimensions[1]<200)return c.json({error:'Ảnh cần có cạnh từ 200 đến 1.600 px, dung lượng tối đa 600 KB sau xử lý.'},400);
 const id=crypto.randomUUID(),key=`listings/${user.id}/${id}.jpg`;
 await c.env.LISTING_IMAGES.put(key,bytes,{httpMetadata:{contentType:'image/jpeg'}});
 try{await db.prepare('INSERT INTO listing_images(id,owner_id,object_key,bytes,width,height) VALUES(?,?,?,?,?,?)').bind(id,user.id,key,bytes.length,...dimensions).run();}catch(e){await c.env.LISTING_IMAGES.delete(key);throw e;}
 return c.json({id,url:'/api/listing-images/'+id},201);
});
router.post('/cms/listing-images',requireUser,requireAdmin,requirePermission('listings.create'),bodyLimit({maxSize:840000,onError:c=>c.json({error:'Ảnh quá lớn. Hãy chọn ảnh nhỏ hơn.'},413)}),async c=>{
 const db=c.env.DB,actor=c.get('user'),b=await readBody(c),ownerId=text(b.owner_id),denied=await limit(c,'cms-listing-photo',actor.id,60,3600);if(denied)return denied;
 if(!ownerId)return c.json({error:'Chọn người đăng trước khi tải ảnh.'},400);
 const approved=await db.prepare(`SELECT u.id FROM users u JOIN seller_profiles p ON p.user_id=u.id WHERE u.id=? AND u.is_locked=0 AND u.deleted_at IS NULL AND p.status='approved'`).bind(ownerId).first();
 if(!approved)return c.json({error:'Chỉ tải ảnh cho người đăng đã được duyệt.'},400);
 const abandoned=(await db.prepare(`SELECT i.id,i.object_key FROM listing_images i WHERE i.owner_id=? AND i.created_at<unixepoch()-86400 AND NOT EXISTS(SELECT 1 FROM listing_drafts l WHERE l.deleted_at IS NULL AND (EXISTS(SELECT 1 FROM json_each(l.details,'$.photos') WHERE value=i.id) OR EXISTS(SELECT 1 FROM json_each(COALESCE(l.public_data,'{}'),'$.images') WHERE value=i.id))) LIMIT 10`).bind(ownerId).all<{id:string;object_key:string}>()).results;
 for(const image of abandoned){await c.env.LISTING_IMAGES.delete(image.object_key);await db.prepare('DELETE FROM listing_images WHERE id=? AND owner_id=?').bind(image.id,ownerId).run();}
 const count=await db.prepare('SELECT count(*) AS n FROM listing_images WHERE owner_id=?').bind(ownerId).first<{n:number}>();
 if((count?.n??0)>=80)return c.json({error:'Kho ảnh của người đăng đã đầy.'},409);
 if(typeof b.jpeg!=='string'||b.jpeg.length>819200||!/^[A-Za-z0-9+/]+={0,2}$/.test(b.jpeg))return c.json({error:'Không đọc được ảnh. Hãy chọn lại ảnh JPG, PNG hoặc WebP.'},400);
 let bytes:Uint8Array;try{bytes=Uint8Array.from(atob(b.jpeg),x=>x.charCodeAt(0));}catch{return c.json({error:'Ảnh không hợp lệ.'},400);}
 const dimensions=jpegDimensions(bytes);if(!dimensions||bytes.length>614400||dimensions[0]>1600||dimensions[1]>1600||dimensions[0]<200||dimensions[1]<200)return c.json({error:'Ảnh cần có cạnh từ 200 đến 1.600 px, dung lượng tối đa 600 KB sau xử lý.'},400);
 const imageId=crypto.randomUUID(),key=`listings/${ownerId}/${imageId}.jpg`;
 await c.env.LISTING_IMAGES.put(key,bytes,{httpMetadata:{contentType:'image/jpeg'}});
 try{await db.prepare('INSERT INTO listing_images(id,owner_id,object_key,bytes,width,height) VALUES(?,?,?,?,?,?)').bind(imageId,ownerId,key,bytes.length,...dimensions).run();}catch(e){await c.env.LISTING_IMAGES.delete(key);throw e;}
 return c.json({id:imageId,url:'/api/listing-images/'+imageId},201);
});
function jpegDimensions(b:Uint8Array):[number,number]|null{
 if(b.length<4||b[0]!==255||b[1]!==216||b[b.length-2]!==255||b[b.length-1]!==217)return null;
 for(let i=2;i+8<b.length;){if(b[i]!==255)return null;const marker=b[i+1];if(marker===218||marker===217)break;const length=b[i+2]*256+b[i+3];if(length<2||i+2+length>b.length)return null;
 if([192,193,194].includes(marker)){const h=b[i+5]*256+b[i+6],w=b[i+7]*256+b[i+8];return [w,h];}i+=2+length;}return null;
}
router.get('/listing-images/:id',async c=>{
 const row=await c.env.DB.prepare('SELECT * FROM listing_images WHERE id=?').bind(c.req.param('id')).first<{id:string;owner_id:string;object_key:string}>();if(!row)return c.notFound();
 const published=await c.env.DB.prepare(`SELECT l.id FROM listing_drafts l JOIN users u ON u.id=l.owner_id JOIN seller_profiles s ON s.user_id=l.owner_id WHERE ${publicEligibility} AND EXISTS(SELECT 1 FROM json_each(l.public_data,'$.images') WHERE value=?) LIMIT 1`).bind(row.id).first();
 if(!published){const user=await resolveUser(c.req.raw,c.env.DB);if(!user||(user.id!==row.owner_id&&!can(user,'listings.read')))return c.notFound();}
 const object=await c.env.LISTING_IMAGES.get(row.object_key);if(!object)return c.notFound();
 c.header('Content-Type','image/jpeg');c.header('Content-Security-Policy',"default-src 'none'");c.header('Cross-Origin-Resource-Policy','same-origin');c.header('Cache-Control',published?'public, max-age=300, s-maxage=300, must-revalidate':'private, no-store');c.header('X-Robots-Tag','noindex');return c.body(object.body);
});
router.post('/uploads/listing-images/:id/delete',requireUser,async c=>{
 const id=c.req.param('id'),user=c.get('user');
 const used=await c.env.DB.prepare(`SELECT id FROM listing_drafts WHERE owner_id=? AND deleted_at IS NULL AND (EXISTS(SELECT 1 FROM json_each(details,'$.photos') WHERE value=?) OR EXISTS(SELECT 1 FROM json_each(COALESCE(public_data,'{}'),'$.images') WHERE value=?)) LIMIT 1`).bind(user.id,id,id).first();if(used)return c.json({error:'Ảnh đang được dùng trong tin. Gỡ ảnh và lưu tin trước khi xóa.'},409);
 const row=await c.env.DB.prepare('DELETE FROM listing_images WHERE id=? AND owner_id=? RETURNING object_key').bind(id,user.id).first<{object_key:string}>();if(!row)return c.notFound();await c.env.LISTING_IMAGES.delete(row.object_key);return c.json({ok:true});
});
router.get('/cms/listing-submissions',requirePermission('listings.read'),async c=>{
 const status=c.req.query('status')??'pending',page=Number(c.req.query('page')??1);
 if(!['all','draft','pending','published','rejected'].includes(status)||!Number.isSafeInteger(page)||page<1||page>10000)return c.json({error:'Trạng thái hoặc số trang không hợp lệ. Chọn lại bộ lọc rồi tải danh sách.'},400);
 const where=status==='all'?'l.deleted_at IS NULL':'l.deleted_at IS NULL AND l.status=?',params=status==='all'?[]:[status];
 const {results}=await c.env.DB.prepare(`SELECT l.*,s.display_name,s.phone,s.status AS profile_status,u.email FROM listing_drafts l JOIN users u ON u.id=l.owner_id LEFT JOIN seller_profiles s ON s.user_id=l.owner_id WHERE ${where} ORDER BY l.updated_at DESC,l.id LIMIT 20 OFFSET ?`).bind(...params,(page-1)*20).all();
 const n=await c.env.DB.prepare(`SELECT count(*) AS n FROM listing_drafts l WHERE ${where}`).bind(...params).first<{n:number}>();return c.json({items:results,total:n?.n??0,page,page_size:20});
});
router.get('/cms/listing-submissions/:id',requirePermission('listings.read'),async c=>{
 const row=await c.env.DB.prepare(`SELECT l.*,s.display_name,s.phone,s.zalo_phone,s.status AS profile_status,u.email,COALESCE((SELECT json_group_array(json_object('id',p.id,'name',p.name,'price_vnd',p.price_vnd,'duration_days',p.duration_days,'is_priority',p.is_priority)) FROM listing_plans p WHERE p.id=l.plan_id),'[]') AS plan_json FROM listing_drafts l JOIN users u ON u.id=l.owner_id LEFT JOIN seller_profiles s ON s.user_id=l.owner_id WHERE l.id=? AND l.deleted_at IS NULL`).bind(c.req.param('id')).first<Record<string,unknown>>();
 if(!row)return c.json({error:'Không tìm thấy tin phòng.'},404);
 return c.json({item:{...row,plan:JSON.parse(String(row.plan_json))[0]??null}});
});
router.patch('/cms/listing-submissions/:id',requirePermission('listings.update'),async c=>{
 const db=c.env.DB,id=c.req.param('id'),data=await readBody(c),current=await db.prepare('SELECT * FROM listing_drafts WHERE id=? AND deleted_at IS NULL').bind(id).first<Listing>();
 if(!current)return c.json({error:'Không tìm thấy tin phòng.'},404);
 if(!safeVersion(data.version)||current.version!==Number(data.version))return c.json({error:'Tin đã thay đổi. Tải lại rồi thử lại; nội dung bạn nhập vẫn được giữ trên trang.'},409);
 if(data.owner_id!==undefined&&text(data.owner_id)!==current.owner_id)return c.json({error:'Không thể đổi người sở hữu tin đã tạo.'},400);
 const content=listingContent(data);if(!content)return c.json({error:contentError},400);
 const {title,description,locationId,type,price,size,details:d}=content,submit=data.submit===true,planId=text(data.plan_id??current.plan_id);
 if(current.published_at!=null&&planId!==current.plan_id)return c.json({error:'Tin đã xuất bản giữ nguyên gói đã sử dụng. Gia hạn được xử lý riêng.'},400);
 const [location,plan]=await Promise.all([
  db.prepare('SELECT id FROM locations WHERE id=? AND is_active=1 AND deleted_at IS NULL').bind(locationId).first(),
  planForSave(db,planId,current),
 ]);
 if(!location||!plan)return c.json({error:'Chọn khu vực và gói đăng tin đang sử dụng.'},400);
 if(d.photos.length){const count=await db.prepare(`SELECT count(*) AS n FROM listing_images WHERE owner_id=? AND id IN (${d.photos.map(()=>'?').join(',')})`).bind(current.owner_id,...d.photos).first<{n:number}>();if(count?.n!==d.photos.length)return c.json({error:'Có ảnh không thuộc người đăng của tin này.'},400);}
 if(submit){
  const approved=await db.prepare(`SELECT u.id FROM users u JOIN seller_profiles p ON p.user_id=u.id WHERE u.id=? AND u.is_locked=0 AND u.deleted_at IS NULL AND p.status='approved'`).bind(current.owner_id).first();
  if(!approved)return c.json({error:'Người đăng cần có hồ sơ đã duyệt và tài khoản đang hoạt động trước khi gửi tin.'},409);
  if(description.length<30||d.street.length<5||d.photos.length<3)return c.json({error:'Để gửi duyệt, cần địa chỉ từ 5 ký tự, mô tả từ 30 ký tự và ít nhất 3 ảnh.'},400);
  if(current.expires_at!=null&&current.expires_at<=Math.floor(Date.now()/1000))return c.json({error:'Tin đã hết hạn. Không thể dùng sửa tin để kéo dài thời gian hiển thị.'},409);
 }
 const old=JSON.parse(current.details) as ListingDetails;
 const keepPublic=Boolean(current.published_at!=null&&current.public_data&&(current.status==='published'||old.keep_public_copy===true));
 const details:ListingDetails={...d,quoted_price:plan.price_vnd,quoted_duration:plan.duration_days,quoted_priority:plan.is_priority,keep_public_copy:keepPublic};
 const status=submit?'pending':'draft',stamp=crypto.randomUUID(),result=await db.batch([
  db.prepare('UPDATE listing_drafts SET title=?,location_id=?,room_type=?,price_vnd=?,area_m2=?,description=?,details=?,plan_id=?,status=?,submitted_at=?,review_note=?,version=version+1,change_token=?,updated_at=unixepoch() WHERE id=? AND version=? AND deleted_at IS NULL').bind(title,locationId,type,price,size,description,JSON.stringify(details),planId,status,submit?Math.floor(Date.now()/1000):null,submit?'':current.review_note,stamp,id,Number(data.version)),
  db.prepare(`INSERT INTO admin_audit(id,actor_id,action,target_id,note) SELECT ?,?,'listing.cms_update',id,? FROM listing_drafts WHERE id=? AND change_token=?`).bind(crypto.randomUUID(),c.get('user').id,submit?'Submitted listing revision for review in CMS':'Saved listing draft in CMS',id,stamp),
 ]);
 return result[0].meta.changes===1?c.json({ok:true,id,status,version:Number(data.version)+1}):c.json({error:'Tin đã thay đổi. Nội dung chưa được lưu, hãy tải lại dữ liệu mới.'},409);
});
router.post('/cms/listing-submissions/:id/images',requirePermission('listings.update'),bodyLimit({maxSize:840000,onError:c=>c.json({error:'Ảnh quá lớn. Hãy chọn ảnh nhỏ hơn.'},413)}),async c=>{
 const db=c.env.DB,id=c.req.param('id'),actor=c.get('user'),listing=await db.prepare('SELECT owner_id,details FROM listing_drafts WHERE id=? AND deleted_at IS NULL').bind(id).first<{owner_id:string;details:string}>();
 if(!listing)return c.json({error:'Không tìm thấy tin phòng.'},404);
 const denied=await limit(c,'cms-listing-photo',actor.id,40,3600);if(denied)return denied;
 const body=await readBody(c);if(typeof body.jpeg!=='string'||body.jpeg.length>819200||!/^[A-Za-z0-9+/]+={0,2}$/.test(body.jpeg))return c.json({error:'Không đọc được ảnh JPG, PNG hoặc WebP.'},400);
 let bytes:Uint8Array;try{bytes=Uint8Array.from(atob(body.jpeg),x=>x.charCodeAt(0));}catch{return c.json({error:'Ảnh không hợp lệ.'},400);}
 const dimensions=jpegDimensions(bytes);if(!dimensions||bytes.length>614400||dimensions[0]>1600||dimensions[1]>1600||dimensions[0]<200||dimensions[1]<200)return c.json({error:'Ảnh cần có cạnh 200–1.600 px và dung lượng tối đa 600 KB sau xử lý.'},400);
 const count=await db.prepare('SELECT count(*) AS n FROM listing_images WHERE owner_id=?').bind(listing.owner_id).first<{n:number}>();if((count?.n??0)>=80)return c.json({error:'Kho ảnh của người đăng đã đầy.'},409);
 const imageId=crypto.randomUUID(),key=`listings/${listing.owner_id}/${imageId}.jpg`;
 await c.env.LISTING_IMAGES.put(key,bytes,{httpMetadata:{contentType:'image/jpeg'}});
 try{await db.batch([
  db.prepare('INSERT INTO listing_images(id,owner_id,object_key,bytes,width,height) VALUES(?,?,?,?,?,?)').bind(imageId,listing.owner_id,key,bytes.length,...dimensions),
  db.prepare("INSERT INTO admin_audit(id,actor_id,action,target_id,note) VALUES(?,?, 'listing.image_upload',?,'Uploaded room image in CMS')").bind(crypto.randomUUID(),actor.id,id),
 ]);}catch(error){await c.env.LISTING_IMAGES.delete(key);throw error;}
 return c.json({id:imageId,url:'/api/listing-images/'+imageId},201);
});
router.post('/cms/listing-submissions/:id/review',requirePermission('listings.review'),async c=>{
 const b=await readBody(c),id=c.req.param('id'),db=c.env.DB,actor=c.get('user'),decision=text(b.decision),note=text(b.note);
 if(!['published','rejected'].includes(decision)||!safeVersion(b.version)||note.length>1000||(decision==='rejected'&&note.length<5))return c.json({error:'Chọn kết quả; lý do yêu cầu bổ sung cần từ 5–1.000 ký tự.'},400);
 const l=await db.prepare('SELECT * FROM listing_drafts WHERE id=? AND deleted_at IS NULL').bind(id).first<Listing>();
 if(!l||l.version!==Number(b.version)||l.status!=='pending')return c.json({error:'Tin đã thay đổi hoặc đã được xét duyệt. Hãy tải lại.'},409);
 if(l.owner_id===actor.id)return c.json({error:'Bạn không thể tự xét duyệt tin của mình.'},403);
 const profile=await db.prepare('SELECT display_name,phone,zalo_phone,status FROM seller_profiles WHERE user_id=?').bind(l.owner_id).first<{display_name:string;phone:string;zalo_phone:string;status:string}>();
 const publication=await db.prepare('SELECT plan_id,duration_days FROM listing_publications WHERE listing_id=?').bind(id).first<{plan_id:string;duration_days:number}>();
 const plan=await planForSave(db,l.plan_id??'',publication?l:null);
 if(decision==='published'&&(!profile||profile.status!=='approved'||!plan||!publication&&plan.price_vnd>1000000||l.expires_at!=null&&l.expires_at<=Math.floor(Date.now()/1000)))return c.json({error:'Hồ sơ/gói đăng tin không còn hợp lệ hoặc tin đã hết hạn. Yêu cầu cập nhật trước khi gửi lại.'},409);
 const d=JSON.parse(l.details) as ListingDetails;
 if(decision==='published'&&publication&&publication.plan_id!==l.plan_id)return c.json({error:'Gói đã tính phí không khớp lịch sử xuất bản.'},409);
 if(decision==='published'&&!publication&&(d.quoted_price!==plan?.price_vnd||d.quoted_duration!==plan?.duration_days||d.quoted_priority!==undefined&&d.quoted_priority!==plan?.is_priority))return c.json({error:'Gói đăng tin đã thay đổi giá, thời hạn hoặc mức hiển thị. Chọn lại gói rồi gửi duyệt lại.'},409);
 if(decision==='published'&&(!listingContent({...l,details:d})||!Array.isArray(d.photos)||d.photos.length<3||d.street.length<5||l.description.length<30))return c.json({error:'Tin chưa đủ địa chỉ, ảnh, mô tả hoặc chi phí. Hãy yêu cầu bổ sung.'},400);
 const location=await db.prepare('SELECT name FROM locations WHERE id=? AND is_active=1 AND deleted_at IS NULL').bind(l.location_id).first<{name:string}>();
 if(decision==='published'&&!location)return c.json({error:'Khu vực không còn sử dụng. Hãy yêu cầu bổ sung.'},409);
 const data=decision==='published'?JSON.stringify({id:l.id,title:l.title,area:l.location_id,areaLabel:location?.name,type:l.room_type==='studio'?'mini':'room',rent:l.price_vnd,size:l.area_m2,is_priority:plan?.is_priority===1,map_point:d.address_visibility==='exact'&&validPoint(d.map_point)?d.map_point:undefined,street:d.address_visibility==='exact'?d.street:'Khu vực '+location?.name,people:d.people,photo:0,images:d.photos,amenities:d.amenities,deposit:d.deposit,electricity:d.electricity,water:d.water,water_unit:d.water_unit??'per_person',service:d.service,parking:d.parking,description:l.description,seller:{name:profile?.display_name,phone:profile?.phone,zalo:profile?.zalo_phone}}):null;
 const stamp=crypto.randomUUID();
 try{
 const results=await db.batch([
 db.prepare(`UPDATE listing_drafts SET status=?,review_note=?,public_data=CASE WHEN ?='published' THEN ? ELSE public_data END,version=version+1,change_token=?,updated_at=unixepoch() WHERE id=? AND version=? AND status='pending' AND deleted_at IS NULL AND EXISTS(SELECT 1 FROM users WHERE id=listing_drafts.owner_id AND is_locked=0 AND deleted_at IS NULL) AND (?='rejected' OR EXISTS(SELECT 1 FROM seller_profiles WHERE user_id=listing_drafts.owner_id AND status='approved'))`).bind(decision,note,decision,data,stamp,id,Number(b.version),decision),
 db.prepare(`INSERT INTO listing_publications(listing_id,owner_id,actor_id,plan_id,amount_vnd,duration_days,promotional) SELECT l.id,l.owner_id,?,p.id,CASE WHEN COALESCE(pr.free_posts_total-pr.free_posts_used,0)>0 THEN 0 ELSE p.price_vnd END,p.duration_days,CASE WHEN COALESCE(pr.free_posts_total-pr.free_posts_used,0)>0 THEN 1 ELSE 0 END FROM listing_drafts l JOIN listing_plans p ON p.id=l.plan_id LEFT JOIN posting_promotions pr ON pr.user_id=l.owner_id WHERE l.id=? AND l.change_token=? AND l.status='published' AND NOT EXISTS(SELECT 1 FROM listing_publications WHERE listing_id=l.id)`).bind(actor.id,id,stamp),
 db.prepare(`INSERT INTO listing_reviews(id,listing_id,actor_id,decision,note,version) SELECT ?,id,?,?,?,? FROM listing_drafts WHERE id=? AND change_token=?`).bind(crypto.randomUUID(),actor.id,decision,note,Number(b.version),id,stamp),
 db.prepare(`INSERT INTO admin_audit(id,actor_id,action,target_id,note) SELECT ?,?,? ,id,? FROM listing_drafts WHERE id=? AND change_token=?`).bind(crypto.randomUUID(),actor.id,'listing.'+decision,note,id,stamp)]);
 if(results[0].meta.changes!==1)return c.json({error:'Tin đã thay đổi hoặc hồ sơ bị khóa. Hãy tải lại.'},409);
 const account=await db.prepare('SELECT email FROM users WHERE id=?').bind(l.owner_id).first<{email:string}>();
 const body=decision==='published'?'Tin “'+l.title+'” đã được duyệt và xuất bản.':'Tin “'+l.title+'” cần bổ sung: '+note;
 if(account)sendNotificationEmail(c,{to:account.email,subject:decision==='published'?'Tin đăng của bạn đã được duyệt':'Tin đăng cần bổ sung thông tin',html:emailShell(decision==='published'?'Tin đã được duyệt':'Tin cần bổ sung',[body],new URL('/tai-khoan/tin-dang/'+l.id,c.req.url).toString(),'Xem tin đăng'),text:body+'\n'+new URL('/tai-khoan/tin-dang/'+l.id,c.req.url).toString(),key:`listing-review:${l.id}:${l.version}:${decision}`});
 }catch(e){if(/listing_insufficient_balance|balance_after_vnd/.test(String(e)))return c.json({error:'Người đăng chưa đủ số dư. Chờ họ nạp tiền rồi duyệt lại; tin chưa bị trừ phí.'},409);throw e;}
 return c.json({ok:true});
});
export default router;
