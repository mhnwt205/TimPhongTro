import type {Listing} from './listings';

// All anonymous paths must apply the same display, moderation, account and time rules.
export const publicEligibility="(l.status='published' OR (l.published_at IS NOT NULL AND json_extract(l.details,'$.keep_public_copy')=1)) AND l.public_data IS NOT NULL AND l.deleted_at IS NULL AND l.display_state='available' AND l.moderation_hidden=0 AND l.expires_at>unixepoch() AND u.is_locked=0 AND u.deleted_at IS NULL AND s.status='approved'";
export async function publicListingIds(db:D1Database):Promise<string[]>{
 const {results}=await db.prepare(`SELECT l.id FROM listing_drafts l JOIN users u ON u.id=l.owner_id JOIN seller_profiles s ON s.user_id=l.owner_id WHERE ${publicEligibility} ORDER BY l.published_at DESC,l.id`).all<{id:string}>();
 return results.map(row=>row.id);
}
export function reviewedCopy(item:Listing){return item.published_at!=null&&item.public_data!=null&&(item.status==='published'||JSON.parse(item.details).keep_public_copy===true);}
export function displayLabel(item:Listing,now=Math.floor(Date.now()/1000)){
 if(item.moderation_hidden)return 'CMS đã tạm gỡ';
 if(item.display_state==='hidden')return 'Đang tạm ẩn';
 if(item.display_state==='unavailable')return 'Đã hết phòng';
 if(item.expires_at!=null&&item.expires_at<=now)return 'Đã hết hạn';
 return reviewedCopy(item)?'Đang hiển thị':'Chưa công khai';
}
export type InactiveListing={id:string;title:string;area:string;areaLabel:string;state:'expired'|'unavailable'};
export async function inactiveListing(db:D1Database,id:string):Promise<InactiveListing|null>{
 const row=await db.prepare(`SELECT l.public_data,l.display_state,l.expires_at FROM listing_drafts l JOIN users u ON u.id=l.owner_id JOIN seller_profiles s ON s.user_id=l.owner_id WHERE l.id=? AND l.published_at IS NOT NULL AND l.public_data IS NOT NULL AND l.deleted_at IS NULL AND l.moderation_hidden=0 AND l.display_state!='hidden' AND (l.display_state='unavailable' OR l.expires_at<=unixepoch()) AND u.is_locked=0 AND u.deleted_at IS NULL AND s.status='approved'`).bind(id).first<{public_data:string;display_state:string;expires_at:number}>();
 if(!row)return null;
 const approved=JSON.parse(row.public_data) as {id:string;title:string;area:string;areaLabel?:string};
 const area=await db.prepare('SELECT name FROM locations WHERE id=?').bind(approved.area).first<{name:string}>();
 // Deliberately return only the already public title/area/status; no raw listing JSON.
 return {id:approved.id,title:approved.title,area:approved.area,areaLabel:area?.name??approved.areaLabel??'',state:row.display_state==='unavailable'?'unavailable':'expired'};
}
