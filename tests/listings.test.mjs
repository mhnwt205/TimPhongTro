import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createTestHarness} from 'wrangler';
import sharp from 'sharp';
const server=createTestHarness({root:fileURLToPath(new URL('../',import.meta.url)),workers:[{configPath:'apps/api/wrangler.test.jsonc'}]});
let DB,origin,admin,owner,other,reader,pending,photos=[];
const request=(path,{user,body,method=body?'POST':'GET',headers={}}={})=>server.fetch(new URL(path,origin),{method,headers:{Origin:origin,'Content-Type':'application/json',...(user?{Cookie:user.cookie}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})});
async function account(root=false,approved=true){const id=randomUUID(),token=randomBytes(32).toString('hex');await DB.batch([DB.prepare('INSERT INTO users(id,email,name,password_hash,is_super_admin) VALUES(?,?,?,?,?)').bind(id,id+'@example.test','Người kiểm thử','fixture-only-not-a-password',root?1:0),DB.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,unixepoch()+3600)').bind(createHash('sha256').update(token).digest('hex'),id),DB.prepare('INSERT INTO posting_promotions(user_id) VALUES(?)').bind(id),DB.prepare("INSERT INTO seller_profiles(user_id,display_name,seller_type,phone,zalo_phone,status,change_token) VALUES(?,'Chủ trọ kiểm thử','owner','0901234567','0901234567',?,'fixture')").bind(id,approved?'approved':'pending')]);return {id,cookie:'tpt_session='+token};}
const form=(overrides={})=>({request_key:randomUUID(),title:'Phòng thật kiểm thử ở Bình Thạnh',location_id:'binh-thanh',room_type:'room',price_vnd:3000000,area_m2:25,description:'Phòng nhiều ánh sáng, có cửa sổ và khu bếp riêng. Giờ giấc tự do.',plan_id:'basic-7d',details:{map_point:{lat:10.812345,lng:106.712345},street:'123 Đường bí mật, phường kiểm thử',address_visibility:'approximate',people:2,deposit:3000000,electricity:4000,water:100000,water_unit:'per_person',service:0,parking:0,amenities:['ac'],photos},...overrides});
async function create(overrides={},user=owner){const r=await request('/api/account/listings',{user,body:form(overrides)});assert.equal(r.status,201,await r.clone().text());return (await r.json()).id;}
const item=async id=>(await (await request('/api/account/listings/'+id,{user:owner})).json()).item;
const review=(id,version,decision='published',user=admin)=>request('/api/cms/listing-submissions/'+id+'/review',{user,body:{version,decision,note:decision==='rejected'?'Bổ sung ảnh phòng rõ hơn.':''}});
const balance=async()=> (await DB.prepare('SELECT balance_vnd FROM wallet_accounts WHERE user_id=?').bind(owner.id).first())?.balance_vnd??0;
before(async()=>{origin=(await server.listen()).url.origin;await server.getWorker().applyD1Migrations('DB');({DB}=await server.getWorker().getEnv());admin=await account(true);owner=await account();other=await account();reader=await account();pending=await account(false,false);const role=randomUUID();await DB.batch([DB.prepare('INSERT INTO cms_roles(id,name) VALUES(?,?)').bind(role,'Chỉ xem '+role),DB.prepare("INSERT INTO cms_role_permissions(role_id,permission) VALUES(?,'listings.read')").bind(role),DB.prepare('INSERT INTO cms_user_roles(user_id,role_id) VALUES(?,?)').bind(reader.id,role)]);});
after(()=>server.close());
test('listing endpoints require sessions, permissions and origin',async()=>{for(const path of ['/api/account/listings','/api/account/listings/missing','/api/cms/listing-submissions'])assert.equal((await request(path)).status,401,path);assert.equal((await request('/api/cms/listing-submissions',{user:owner})).status,403);assert.equal((await request('/api/account/listings',{user:owner,body:form(),headers:{Origin:'https://elsewhere.example'}})).status,403);});
test('photo upload rejects unapproved profiles, invalid JPEG and excessive bodies',async()=>{assert.equal((await request('/api/uploads/listing-images',{user:pending,body:{jpeg:'aGVsbG8='}})).status,403);assert.equal((await request('/api/uploads/listing-images',{user:owner,body:{jpeg:'aGVsbG8='}})).status,400);assert.equal((await request('/api/uploads/listing-images',{user:owner,body:{jpeg:'a'.repeat(850000)}})).status,413);});
test('uploads real JPEG and keeps unreviewed photos private',async()=>{const bytes=await sharp({create:{width:640,height:480,channels:3,background:'#d6e8ed'}}).jpeg().toBuffer();for(let i=0;i<3;i++){const r=await request('/api/uploads/listing-images',{user:owner,body:{jpeg:bytes.toString('base64')}});assert.equal(r.status,201,await r.clone().text());photos.push((await r.json()).id);}const url='/api/listing-images/'+photos[0];assert.equal((await request(url)).status,404);assert.equal((await request(url,{user:other})).status,404);for(const user of [owner,admin,reader]){const r=await request(url,{user});assert.equal(r.status,200);assert.equal(r.headers.get('content-type'),'image/jpeg');assert.match(r.headers.get('cache-control'),/private/);}});
test('CMS uploads and creates a complete owner-linked listing that appears in the owner account only after publication',async()=>{const bytes=await sharp({create:{width:640,height:480,channels:3,background:'#e3edf2'}}).jpeg().toBuffer();const uploaded=await request('/api/cms/listing-images',{user:admin,body:{owner_id:owner.id,jpeg:bytes.toString('base64')}});assert.equal(uploaded.status,201,await uploaded.clone().text());const photo=(await uploaded.json()).id;photos.push(photo);const payload=form({owner_id:owner.id,submit:true});const created=await request('/api/cms/listing-submissions',{user:admin,body:payload});assert.equal(created.status,201,await created.clone().text());const id=(await created.json()).id,row=await DB.prepare('SELECT * FROM listing_drafts WHERE id=?').bind(id).first();assert.equal(row.owner_id,owner.id);assert.equal(row.created_by_admin,1);assert.equal(row.status,'pending');assert.equal(row.plan_id,'basic-7d');assert.equal(JSON.parse(row.details).water_unit,'per_person');assert.ok(!(await (await request('/api/account/listings',{user:owner})).json()).items.some(l=>l.id===id));assert.equal((await request('/api/account/listings/'+id,{user:owner})).status,404);const quotaBefore=(await DB.prepare('SELECT free_posts_used FROM posting_promotions WHERE user_id=?').bind(owner.id).first()).free_posts_used;assert.equal((await review(id,row.version)).status,200);assert.equal((await DB.prepare('SELECT free_posts_used FROM posting_promotions WHERE user_id=?').bind(owner.id).first()).free_posts_used,quotaBefore+1);assert.ok((await (await request('/api/account/listings',{user:owner})).json()).items.some(l=>l.id===id));assert.equal((await request('/api/account/listings/'+id,{user:owner})).status,200);});
test('drafts validate input and enforce image ownership',async()=>{for(const changes of [{price_vnd:-1},{area_m2:0},{price_vnd:'NaN'},{location_id:'invalid'},{plan_id:'invalid'}])assert.equal((await request('/api/account/listings',{user:owner,body:form(changes)})).status,400);const r=await request('/api/account/listings',{user:other,body:form()});assert.equal(r.status,400);const id=await create({submit:false});assert.equal((await request('/api/account/listings/'+id,{user:other})).status,404);assert.equal((await request('/api/account/listings/'+id,{user:other,body:form({version:1})})).status,404);});
test('new creation retries return original, draft saves do not charge',async()=>{const usedBefore=(await DB.prepare('SELECT free_posts_used AS n FROM posting_promotions WHERE user_id=?').bind(owner.id).first()).n,body=form();const a=await request('/api/account/listings',{user:owner,body});assert.equal(a.status,201);const id=(await a.json()).id;const b=await request('/api/account/listings',{user:owner,body});assert.equal(b.status,200);assert.equal((await b.json()).id,id);assert.equal((await item(id)).status,'draft');assert.equal(await balance(),0);assert.equal((await DB.prepare('SELECT free_posts_used AS n FROM posting_promotions WHERE user_id=?').bind(owner.id).first()).n,usedBefore);});
test('submission needs approved profile, complete content and an explicit water unit',async()=>{assert.equal((await request('/api/account/listings',{user:pending,body:form({details:{...form().details,photos:[]},submit:true})})).status,403);for(const details of [{...form().details,photos:[]},{...form().details,street:''}])assert.equal((await request('/api/account/listings',{user:owner,body:form({details,submit:true})})).status,400);const noUnit=form();delete noUnit.details.water_unit;assert.equal((await request('/api/account/listings',{user:owner,body:noUnit})).status,400);});
test('per-cubic-metre water unit is stored and published accurately',async()=>{const id=await create({submit:true,details:{...form().details,water_unit:'per_m3'}});assert.equal((await review(id,1)).status,200);const listing=await item(id);assert.equal(JSON.parse(listing.details).water_unit,'per_m3');assert.equal(JSON.parse(listing.public_data).water_unit,'per_m3');});
test('submission CAS, rejection and resubmission preserve author content',async()=>{const id=await create({submit:true});assert.equal((await review(id,1,'published',reader)).status,403);assert.equal((await review(id,0)).status,400);assert.equal((await review(id,1,'rejected')).status,200);assert.equal((await review(id,1)).status,409);const l=await item(id);assert.equal(l.status,'rejected');assert.match(l.review_note,/Bổ sung/);const stale=await request('/api/account/listings/'+id,{user:owner,body:form({version:1,submit:true})});assert.equal(stale.status,409);const save=await request('/api/account/listings/'+id,{user:owner,body:form({version:l.version,submit:true})});assert.equal(save.status,200);assert.equal((await item(id)).status,'pending');});
test('first publication consumes exactly one promotion and starts duration; no self approval',async()=>{const ownAdmin=await create({details:{...form().details,photos:[]}},admin);await DB.prepare("UPDATE listing_drafts SET status='pending' WHERE id=?").bind(ownAdmin).run();assert.equal((await review(ownAdmin,1)).status,403);const usedBefore=(await DB.prepare('SELECT free_posts_used AS n FROM posting_promotions WHERE user_id=?').bind(owner.id).first()).n;const id=await create({submit:true});const r=await review(id,1);assert.equal(r.status,200,await r.clone().text());const l=await item(id);assert.equal(l.status,'published');assert.equal(l.expires_at-l.published_at,7*86400);assert.equal((await DB.prepare('SELECT free_posts_used AS n FROM posting_promotions WHERE user_id=?').bind(owner.id).first()).n,usedBefore+1);assert.equal(await balance(),0);assert.equal((await review(id,1)).status,409);const pub=JSON.parse(l.public_data);assert.equal(pub.street,'Khu vực Bình Thạnh');assert.ok(!l.public_data.includes('123 Đường bí mật'));assert.equal(pub.map_point,undefined);assert.ok(!l.public_data.includes('10.812345'));assert.equal(pub.seller.phone,'0901234567');assert.equal((await request('/api/listing-images/'+photos[0])).status,200);assert.equal((await request('/api/uploads/listing-images/'+photos[0]+'/delete',{user:owner,body:{}})).status,409);
 // Editing hides a published listing while pending; reapproval retains original expiry and fee.
 const edited=await request('/api/account/listings/'+id,{user:owner,body:form({version:l.version,submit:true})});assert.equal(edited.status,200);assert.equal((await review(id,l.version+1)).status,200);assert.equal((await item(id)).expires_at,l.expires_at);assert.equal((await DB.prepare('SELECT free_posts_used AS n FROM posting_promotions WHERE user_id=?').bind(owner.id).first()).n,usedBefore+1);
});
test('cash publication is atomic with insufficient balance, retries cannot double charge',async()=>{await DB.prepare('UPDATE posting_promotions SET free_posts_used=free_posts_total WHERE user_id=?').bind(owner.id).run();const id=await create({submit:true,plan_id:'standard-30d'});assert.equal((await review(id,1)).status,409);assert.equal((await item(id)).status,'pending');assert.equal((await DB.prepare('SELECT count(*) AS n FROM listing_publications WHERE listing_id=?').bind(id).first()).n,0);await DB.prepare("INSERT INTO wallet_entries(id,user_id,actor_id,kind,amount_vnd,balance_before_vnd,balance_after_vnd,idempotency_key,description) VALUES(?,?,?,'adjustment',20000,0,20000,?,'Số dư kiểm thử local')").bind(randomUUID(),owner.id,admin.id,randomUUID()).run();const results=await Promise.all([review(id,1),review(id,1)]);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);assert.equal(await balance(),10000);assert.equal((await item(id)).expires_at-(await item(id)).published_at,30*86400);assert.equal((await DB.prepare("SELECT count(*) AS n FROM wallet_entries WHERE idempotency_key=?").bind('listing:'+id).first()).n,1);const wallet=await (await request('/api/account/wallet',{user:owner})).json();assert.equal(wallet.ledger.items[0].kind,'listing_fee');});
test('unchanged approved seller profile preserves approval and version',async()=>{const r=await request('/api/account/profile',{user:owner,body:{version:1,display_name:'Chủ trọ kiểm thử',seller_type:'owner',phone:'+84 901 234 567',zalo_phone:'',introduction:''}});assert.equal(r.status,200);assert.equal((await r.json()).unchanged,true);const row=await DB.prepare('SELECT status,version FROM seller_profiles WHERE user_id=?').bind(owner.id).first();assert.deepEqual(row,{status:'approved',version:1});});

test('published report uses actual listing title and sample flag from server',async()=>{const row=await DB.prepare("SELECT id,title FROM listing_drafts WHERE owner_id=? AND status='published' LIMIT 1").bind(owner.id).first();const r=await request('/api/listing-reports',{body:{listing_id:row.id,listing_title:'Injected',reason:'incorrect',details:'Thông tin phòng cần được quản trị kiểm tra lại.',request_key:randomUUID()}});assert.equal(r.status,200);const report=await DB.prepare('SELECT listing_title,is_sample FROM listing_reports WHERE listing_id=?').bind(row.id).first();assert.deepEqual(report,{listing_title:row.title,is_sample:0});});
test('CMS saves a revision without overwriting its reviewed public snapshot or ownership',async()=>{const row=await DB.prepare("SELECT * FROM listing_drafts WHERE owner_id=? AND status='published' LIMIT 1").bind(owner.id).first();const payload={title:row.title,owner_id:row.owner_id,location_id:row.location_id,room_type:row.room_type,price_vnd:row.price_vnd+100,area_m2:row.area_m2,description:row.description,version:row.version};assert.equal((await request('/api/cms/listings/'+row.id,{user:admin,body:payload,method:'PATCH'})).status,409);const r=await request('/api/cms/listing-submissions/'+row.id,{user:admin,method:'PATCH',body:{version:row.version,title:row.title,location_id:row.location_id,room_type:row.room_type,price_vnd:row.price_vnd+100,area_m2:row.area_m2,description:row.description,details:JSON.parse(row.details)}});assert.equal(r.status,200,await r.clone().text());const updated=await item(row.id);assert.equal(updated.status,'draft');assert.equal(updated.price_vnd,row.price_vnd+100);assert.equal(updated.public_data,row.public_data);assert.equal(JSON.parse(updated.details).keep_public_copy,true);});

test('map point validation rejects partial, string, nonfinite and out-of-range coordinates',async()=>{for(const map_point of [{lat:10,lng:null},{lat:'10.8',lng:106},{lat:91,lng:106},{lat:10,lng:181}]){const r=await request('/api/account/listings',{user:owner,body:form({details:{...form().details,map_point}})});assert.equal(r.status,400);}});
test('exact-address publication retains the chosen map pin',async()=>{const id=await create({submit:true,details:{...form().details,address_visibility:'exact'}});assert.equal((await review(id,1)).status,200);const l=await item(id),pub=JSON.parse(l.public_data);assert.deepEqual(pub.map_point,{lat:10.812345,lng:106.712345});assert.equal(pub.street,'123 Đường bí mật, phường kiểm thử');});

const cmsPatch=(id,body,user=admin)=>request('/api/cms/listing-submissions/'+id,{user,method:'PATCH',body});
const stored=id=>DB.prepare('SELECT * FROM listing_drafts WHERE id=?').bind(id).first();
const fromStored=(row,overrides={})=>({title:row.title,location_id:row.location_id,room_type:row.room_type,price_vnd:row.price_vnd,area_m2:row.area_m2,description:row.description,plan_id:row.plan_id,owner_id:row.owner_id,version:row.version,details:JSON.parse(row.details),...overrides});
async function cmsFixture(submit=false){
 const seller=await account(),ids=[],bytes=await sharp({create:{width:400,height:300,channels:3,background:'#f4e6cd'}}).jpeg().toBuffer();
 for(let i=0;i<3;i++){const r=await request('/api/cms/listing-images',{user:admin,body:{owner_id:seller.id,jpeg:bytes.toString('base64')}});assert.equal(r.status,201,await r.clone().text());ids.push((await r.json()).id);}
 const body=form({owner_id:seller.id,submit,details:{...form().details,photos:ids}}),r=await request('/api/cms/listing-submissions',{user:admin,body});assert.equal(r.status,201,await r.clone().text());
 return {seller,id:(await r.json()).id,ids};
}
let reportSequence=10;
const reportPublic=id=>request('/api/listing-reports',{headers:{'CF-Connecting-IP':'198.51.100.'+(++reportSequence)},body:{listing_id:id,reason:'incorrect',details:'Kiểm tra bản công khai đã được duyệt của tin phòng.',request_key:randomUUID()}});

test('CMS draft can change plan, reject, correct and resubmit without exposing the initial draft or charging twice',async()=>{
 const {seller,id}=await cmsFixture();let row=await stored(id);
 assert.equal((await request('/api/account/listings/'+id,{user:seller})).status,404);
 assert.equal((await cmsPatch(id,fromStored(row,{owner_id:other.id}))).status,400);
 assert.equal((await cmsPatch(id,fromStored(row),reader)).status,403);
 const updates=await Promise.all([1,2].map(n=>cmsPatch(id,fromStored(row,{title:'Tin CMS hoàn thiện lần '+n,plan_id:'standard-30d',submit:true}))));
 assert.deepEqual(updates.map(r=>r.status).sort(),[200,409]);row=await stored(id);
 assert.equal(row.status,'pending');assert.equal(row.plan_id,'standard-30d');assert.equal(JSON.parse(row.details).quoted_duration,30);
 assert.equal((await DB.prepare('SELECT free_posts_used AS n FROM posting_promotions WHERE user_id=?').bind(seller.id).first()).n,0);
 assert.equal((await review(id,row.version,'rejected')).status,200);row=await stored(id);
 assert.equal(row.status,'rejected');assert.equal((await request('/api/account/listings/'+id,{user:seller})).status,404);
 const sent=await cmsPatch(id,fromStored(row,{submit:true}));assert.equal(sent.status,200,await sent.clone().text());row=await stored(id);
 assert.equal(row.review_note,'');assert.equal((await review(id,row.version)).status,200);row=await stored(id);
 assert.equal(row.expires_at-row.published_at,30*86400);
 assert.equal((await request('/api/account/listings/'+id,{user:seller})).status,200);
 assert.ok((await (await request('/api/account/listings',{user:seller})).json()).items.some(r=>r.id===id));
 assert.equal((await request('/api/account/listings/'+id,{user:other})).status,404);
 assert.equal((await review(id,row.version-1)).status,409);
 assert.equal((await DB.prepare('SELECT free_posts_used AS n FROM posting_promotions WHERE user_id=?').bind(seller.id).first()).n,1);
});

test('CMS revisions retain reviewed public text and photos until approval, preserve purchased terms, and stay visible to their owner',async()=>{
 const {seller,id,ids}=await cmsFixture(true);let row=await stored(id);assert.equal((await review(id,row.version)).status,200);row=await stored(id);
 const before=row,quote=JSON.parse(row.details),publicCopy=JSON.parse(row.public_data);
 const bytes=await sharp({create:{width:400,height:300,channels:3,background:'#ddeeff'}}).jpeg().toBuffer();
 const upload=await request('/api/cms/listing-submissions/'+id+'/images',{user:admin,body:{jpeg:bytes.toString('base64')}});assert.equal(upload.status,201);const freshImage=(await upload.json()).id;
 // Later changes to the live plan cannot rewrite an already purchased publication.
 await DB.prepare("UPDATE listing_plans SET price_vnd=99000,duration_days=90,is_priority=1,is_active=0 WHERE id='basic-7d'").run();
 try{
  const patch=fromStored(row,{title:'Bản sửa riêng tư chưa được duyệt',price_vnd:4200000,submit:true,details:{...quote,street:'Địa chỉ mới chưa công khai',address_visibility:'exact',photos:[freshImage,ids[1],ids[2]]}});
  const saved=await cmsPatch(id,patch);assert.equal(saved.status,200,await saved.clone().text());row=await stored(id);
  assert.equal(row.status,'pending');assert.equal(row.public_data,before.public_data);assert.equal(JSON.parse(row.details).quoted_price,quote.quoted_price);assert.equal(JSON.parse(row.details).quoted_duration,7);
  assert.equal((await request('/api/listing-images/'+ids[0])).status,200);assert.equal((await request('/api/listing-images/'+freshImage)).status,404);
  const report=await reportPublic(id);assert.equal(report.status,200,await report.clone().text());
  const reportRow=await DB.prepare('SELECT listing_title FROM listing_reports WHERE listing_id=? ORDER BY created_at DESC LIMIT 1').bind(id).first();assert.equal(reportRow.listing_title,publicCopy.title);
  assert.equal((await request('/api/account/listings/'+id,{user:seller})).status,200);
  assert.equal((await review(id,row.version,'rejected')).status,200);row=await stored(id);
  assert.equal((await request('/api/listing-images/'+ids[0])).status,200);
  assert.equal((await request('/api/account/listings/'+id,{user:seller})).status,200);
  const retry=await cmsPatch(id,fromStored(row,{submit:true}));assert.equal(retry.status,200,await retry.clone().text());row=await stored(id);
  assert.equal((await review(id,row.version)).status,200);row=await stored(id);
  assert.equal(JSON.parse(row.public_data).title,'Bản sửa riêng tư chưa được duyệt');assert.equal(JSON.parse(row.public_data).rent,4200000);assert.equal(JSON.parse(row.public_data).is_priority,false);
  assert.equal(row.published_at,before.published_at);assert.equal(row.expires_at,before.expires_at);assert.equal((await request('/api/listing-images/'+freshImage)).status,200);assert.equal((await request('/api/listing-images/'+ids[0])).status,404);
  assert.equal((await DB.prepare('SELECT count(*) AS n FROM listing_publications WHERE listing_id=?').bind(id).first()).n,1);
  assert.equal((await DB.prepare('SELECT free_posts_used AS n FROM posting_promotions WHERE user_id=?').bind(seller.id).first()).n,1);
 }finally{await DB.prepare("UPDATE listing_plans SET price_vnd=5000,duration_days=7,is_priority=0,is_active=1 WHERE id='basic-7d'").run();}
});

test('published plan is locked in both APIs; an owner can track their revision but cannot forge public-copy retention',async()=>{
 const {seller,id,ids}=await cmsFixture(true);let row=await stored(id);assert.equal((await review(id,row.version)).status,200);row=await stored(id);
 assert.equal((await cmsPatch(id,fromStored(row,{plan_id:'standard-30d',submit:true}))).status,400);
 assert.equal((await request('/api/account/listings/'+id,{user:seller,body:{...fromStored(row),plan_id:'standard-30d',submit:true}})).status,400);
 const edit={...fromStored(row),submit:true,details:{...JSON.parse(row.details),keep_public_copy:true}};
 const saved=await request('/api/account/listings/'+id,{user:seller,body:edit});assert.equal(saved.status,200,await saved.clone().text());
 row=await stored(id);assert.equal(row.status,'pending');assert.equal(JSON.parse(row.details).keep_public_copy,undefined);
 assert.equal((await request('/api/account/listings/'+id,{user:seller})).status,200);
 assert.ok((await (await request('/api/account/listings',{user:seller})).json()).items.some(r=>r.id===id));
 assert.equal((await request('/api/listing-images/'+ids[0])).status,404);assert.equal((await reportPublic(id)).status,400);
});

test('retained public copies expire normally and expired CMS revisions cannot be submitted or approved',async()=>{
 const {id,ids}=await cmsFixture(true);let row=await stored(id);assert.equal((await review(id,row.version)).status,200);row=await stored(id);
 assert.equal((await cmsPatch(id,fromStored(row,{submit:true}))).status,200);row=await stored(id);
 await DB.prepare('UPDATE listing_drafts SET expires_at=unixepoch()-1 WHERE id=?').bind(id).run();
 assert.equal((await request('/api/listing-images/'+ids[0])).status,404);assert.equal((await reportPublic(id)).status,400);
 assert.equal((await cmsPatch(id,fromStored(row,{submit:true}))).status,409);assert.equal((await review(id,row.version)).status,409);
});

test('CMS create accepts a realistic JPEG body above 32 KB after compression',async()=>{
 const {seller}=await cmsFixture();const bytes=await sharp(randomBytes(640*480*3),{raw:{width:640,height:480,channels:3}}).jpeg({quality:75}).toBuffer();assert.ok(bytes.length>32768&&bytes.length<614400);
 const r=await request('/api/cms/listing-images',{user:admin,body:{owner_id:seller.id,jpeg:bytes.toString('base64')}});assert.equal(r.status,201,await r.clone().text());
 const image=await DB.prepare('SELECT owner_id,bytes FROM listing_images WHERE id=?').bind((await r.json()).id).first();assert.equal(image.owner_id,seller.id);assert.equal(image.bytes,bytes.length);
});

test('before first publication a changed plan requires a new quote, and CMS resubmission obtains the current quote',async()=>{
 const {id}=await cmsFixture();const planId=randomUUID();
 await DB.prepare('INSERT INTO listing_plans(id,name,price_vnd,duration_days,is_active) VALUES(?,?,?,?,1)').bind(planId,'Gói kiểm tra báo giá mới',7000,15).run();
 let row=await stored(id);assert.equal((await cmsPatch(id,fromStored(row,{plan_id:planId,submit:true}))).status,200);row=await stored(id);
 await DB.prepare('UPDATE listing_plans SET price_vnd=9000 WHERE id=?').bind(planId).run();
 assert.equal((await review(id,row.version)).status,409);
 assert.equal((await cmsPatch(id,fromStored(row,{submit:true}))).status,200);row=await stored(id);
 assert.equal(JSON.parse(row.details).quoted_price,9000);assert.equal((await review(id,row.version)).status,200);
});
