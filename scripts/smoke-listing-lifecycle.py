"""Phase 2 acceptance; disposable LOCAL D1/R2 only, no real payments."""
import asyncio,json,os,secrets,signal,subprocess,tempfile,uuid,shutil,base64,io
from pathlib import Path
from PIL import Image
from playwright.async_api import async_playwright,expect
ROOT=Path(__file__).resolve().parent.parent
BASE='http://127.0.0.1:4337';RUN=uuid.uuid4().hex;PASSWORD=secrets.token_urlsafe(24)
OUT=ROOT/'.cache'/'phase2-browser';OUT.mkdir(parents=True,exist_ok=True)
STATE=Path(tempfile.mkdtemp(prefix='phase2-',dir=ROOT/'.cache'));LOG=(STATE/'preview.log').open('w')
process=subprocess.Popen(['node','scripts/run-tool.mjs','node','scripts/preview.mjs','--state',str(STATE/'state'),'--port','4337'],cwd=ROOT,stdout=LOG,stderr=LOG,start_new_session=True)
def sql(statement):
 path=STATE/'fixture.sql';path.write_text(statement)
 try:
  r=subprocess.run(['node','scripts/run-tool.mjs','npm','exec','--workspace=@timphongtro/web','--','wrangler','d1','execute','DB','--local','--config',str(ROOT/'apps/web/dist/server/wrangler.json'),'--persist-to',str(STATE/'state'),'--file',str(path)],cwd=ROOT,capture_output=True,text=True)
  if r.returncode:raise RuntimeError(r.stderr[-500:])
 finally:path.unlink(missing_ok=True)
async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
  contexts=[await browser.new_context(viewport={'width':1440,'height':1000}) for _ in range(4)]
  admin,seller,reader,public=[await c.new_page() for c in contexts];errors=[]
  png=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1ioAAAAASUVORK5CYII=')
  for page in [admin,seller,reader,public]:
   page.on('pageerror',lambda e:errors.append(str(e)))
   await page.route('**/api/maps/tiles/**',lambda route:route.fulfill(status=200,content_type='image/png',body=png))
   await page.route('https://www.google.com/maps**',lambda route:route.abort())
  async def send(page,path,body,expected=200):
   r=await page.request.post(BASE+path,headers={'Origin':BASE},data=body)
   assert r.status==expected,(path,r.status,(await r.text())[:400])
   return await r.json()
  async def row():return (await (await admin.request.get(BASE+'/api/cms/listing-submissions/'+lid)).json())['item']
  async def wallet():return await (await seller.request.get(BASE+'/api/account/wallet')).json()
  async def action(page,key):
   await page.locator('[data-state-action='+key+']').click()
   if key=='block':await page.locator('dialog[open] textarea').fill('Kiểm tra quyền CMS tạm gỡ tin.')
   async with page.expect_navigation():await page.locator('dialog[open] [data-state-confirm]').click()
  async def create_renewal():
   await seller.goto(BASE+renewpath);await seller.locator('#renewal-plan').select_option('standard-30d');await seller.locator('[name=confirmed]').check()
   async with seller.expect_navigation():await seller.get_by_role('button',name='Gửi yêu cầu gia hạn',exact=True).click()
   await expect(seller.locator('.renewal-history')).to_contain_text('Chờ CMS duyệt')
  try:
   for _ in range(120):
    try:
     if (await admin.request.get(BASE+'/api/health',timeout=1000)).status==200:break
    except Exception:pass
    await asyncio.sleep(.5)
   else:raise RuntimeError('Isolated preview did not start.')
   users=[]
   for page,label in [(admin,'admin'),(seller,'seller'),(reader,'reader')]:users.append((await send(page,'/api/auth/register',{'name':'Kiểm tra vòng đời '+label,'email':f'phase2-{label}-{RUN}@example.test','password':PASSWORD},201))['user'])
   aid,sid,rid=[u['id'] for u in users];role=str(uuid.uuid4());entry=str(uuid.uuid4())
   await asyncio.to_thread(sql,f"UPDATE users SET is_super_admin=1 WHERE id='{aid}'; INSERT INTO seller_profiles(user_id,display_name,seller_type,phone,zalo_phone,status,change_token) VALUES('{sid}','Chủ phòng kiểm thử','owner','0901234567','0901234567','approved','fixture'); INSERT INTO cms_roles(id,name) VALUES('{role}','Chỉ xem gia hạn'); INSERT INTO cms_role_permissions(role_id,permission) VALUES('{role}','renewals.read'); INSERT INTO cms_user_roles(user_id,role_id) VALUES('{rid}','{role}'); INSERT INTO wallet_entries(id,user_id,actor_id,kind,amount_vnd,balance_before_vnd,balance_after_vnd,idempotency_key,description) VALUES('{entry}','{sid}','{aid}','adjustment',50000,0,50000,'fixture-{entry}','LOCAL isolated acceptance only');")
   image=io.BytesIO();Image.new('RGB',(800,600),'#b2d0de').save(image,format='JPEG');photos=[]
   for _ in range(3):photos.append((await send(seller,'/api/uploads/listing-images',{'jpeg':base64.b64encode(image.getvalue()).decode()},201))['id'])
   title='Phòng kiểm tra vòng đời, gia hạn và quyền hiển thị'
   payload={'request_key':str(uuid.uuid4()),'title':title,'location_id':'binh-thanh','room_type':'room','price_vnd':3200000,'area_m2':26,'description':'Phòng thoáng sáng có cửa sổ, chỗ để xe và bếp riêng. Vui lòng hẹn xem phòng trực tiếp.','plan_id':'basic-7d','submit':True,'details':{'street':'123 Địa chỉ riêng không được hiển thị khi hết phòng','address_visibility':'exact','people':2,'deposit':3000000,'electricity':4000,'water':100000,'water_unit':'per_person','service':0,'parking':0,'amenities':[],'photos':photos}}
   lid=(await send(seller,'/api/account/listings',payload,201))['id'];await send(admin,'/api/cms/listing-submissions/'+lid+'/review',{'version':1,'decision':'published','note':''});initial=await row();renewpath='/tai-khoan/tin-dang/'+lid+'/gia-han'
   await public.goto(BASE+'/phong/'+lid);await expect(public.locator('h1')).to_have_text(title)
   await seller.goto(BASE+'/tai-khoan/tin-dang');await action(seller,'hide');await expect(seller.locator('.owner-listing')).to_contain_text('Đang tạm ẩn');assert (await public.goto(BASE+'/phong/'+lid)).status==404
   await action(seller,'reopen');await action(seller,'unavailable');await public.goto(BASE+'/phong/'+lid);await expect(public.locator('h1')).to_have_text(title);await expect(public.locator('.inactive-listing')).to_contain_text('Phòng đã hết')
   inactive_html=await public.locator('main').inner_html();assert '0901234567' not in inactive_html and payload['details']['street'] not in inactive_html
   for photo in photos:assert '/api/listing-images/'+photo not in inactive_html
   await action(seller,'reopen');await asyncio.to_thread(sql,f"UPDATE listing_drafts SET availability_confirmed_at=unixepoch()-8*86400 WHERE id='{lid}';")
   await seller.reload();await expect(seller.locator('.listing-state')).to_contain_text('Đã 7 ngày');await action(seller,'confirm');assert 'Đã 7 ngày' not in await seller.locator('.listing-state').inner_text();assert (await row())['expires_at']==initial['expires_at']
   await admin.goto(BASE+'/quan-tri/tin-phong?status=published');await action(admin,'block');await seller.reload();await expect(seller.locator('.listing-state')).to_contain_text('CMS đã tạm gỡ');assert await seller.locator('[data-state-action=reopen]').count()==0
   await admin.reload();await action(admin,'unblock')
   await create_renewal();assert (await wallet())['balance_vnd']==50000
   await reader.goto(BASE+'/quan-tri/gia-han');await expect(reader.locator('.renewal-history')).to_contain_text(title);assert await reader.locator('[data-renewal-review]').count()==0
   await admin.goto(BASE+'/quan-tri/gia-han');form=admin.locator('[data-renewal-review]');await form.locator('[name=confirmed]').check()
   async with admin.expect_navigation():await form.get_by_role('button',name='Lưu kết quả gia hạn').click()
   assert (await row())['expires_at']==initial['expires_at']+30*86400;assert (await wallet())['balance_vnd']==40000
   await seller.goto(BASE+renewpath);await expect(seller.locator('.renewal-history')).to_contain_text('Đã gia hạn');await expect(seller.locator('.renewal-history')).to_contain_text('Kỳ đã mua')
   await create_renewal();await seller.get_by_role('button',name='Hủy yêu cầu này').click()
   async with seller.expect_navigation():await seller.locator('[data-confirm-cancel]').click()
   await expect(seller.locator('.renewal-history')).to_contain_text('Đã hủy');assert (await wallet())['balance_vnd']==40000
   await create_renewal();await admin.goto(BASE+'/quan-tri/gia-han');form=admin.locator('[data-renewal-review]');await form.locator('[name=decision]').select_option('rejected');await form.locator('[name=note]').fill('Đổi gói theo yêu cầu của khách.')
   async with admin.expect_navigation():await form.get_by_role('button',name='Lưu kết quả gia hạn').click()
   await seller.goto(BASE+renewpath);await expect(seller.locator('.renewal-history')).to_contain_text('Bị từ chối');assert (await wallet())['balance_vnd']==40000
   # Keep a pending queue row for responsive checks and compare both sides.
   await create_renewal()
   routes=[(seller,'/tai-khoan/tin-dang'),(seller,renewpath),(admin,'/quan-tri/gia-han'),(admin,'/quan-tri/tin-phong?status=published')];checks=0
   for width in [320,390,768,1024,1440,1920]:
    for page,path in routes:
     await page.set_viewport_size({'width':width,'height':1000});await page.goto(BASE+path);await page.evaluate('document.fonts.ready');assert await page.evaluate('document.documentElement.scrollWidth<=window.innerWidth+1'),(width,path,'horizontal overflow')
     for control in await page.locator('main input:not([type=checkbox]):visible,main select:visible,main textarea:visible,main button:visible').all():
      box=await control.bounding_box();assert box and box['width']>=40 and box['height']>=32 and box['x']>=-1 and box['x']+box['width']<=width+1,(width,path,box)
     checks+=1
     if path in [renewpath,'/quan-tri/gia-han'] and width in [390,768,1440]:await page.screenshot(path=str(OUT/f'{"seller" if page==seller else "cms"}-{width}.png'),full_page=True)
   await asyncio.to_thread(sql,f"UPDATE listing_drafts SET expires_at=unixepoch()-1 WHERE id='{lid}';")
   for width in [320,390,768,1024,1440,1920]:
    await public.set_viewport_size({'width':width,'height':1000});await public.goto(BASE+'/phong/'+lid);await expect(public.locator('.inactive-listing')).to_contain_text('Tin đăng đã hết hạn');assert await public.evaluate('document.documentElement.scrollWidth<=window.innerWidth+1');checks+=1
   assert not errors,errors
   print(f'Hide/reopen/unavailable, 7-day confirmation, CMS blocking, renewal request/approve/cancel/reject, cash/expiry, permissions and inactive-page privacy passed; {checks} responsive page checks.',flush=True)
  except Exception:
   for label,page in [('admin',admin),('seller',seller),('public',public)]:
    try:await page.screenshot(path=str(OUT/('failure-'+label+'.png')),full_page=True)
    except Exception:pass
   raise
  finally:await browser.close()
try:asyncio.run(main())
finally:
 os.killpg(process.pid,signal.SIGTERM)
 try:process.wait(timeout=10)
 except subprocess.TimeoutExpired:os.killpg(process.pid,signal.SIGKILL);process.wait()
 LOG.close();shutil.rmtree(STATE);print('Disposed LOCAL D1/R2; no production fixtures or payments.',flush=True)
