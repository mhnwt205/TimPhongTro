"""Phase 1 listing editor acceptance. Uses only disposable LOCAL D1/R2."""
import asyncio,json,os,secrets,signal,subprocess,tempfile,uuid,shutil,base64
from pathlib import Path
from PIL import Image
from playwright.async_api import async_playwright,expect
ROOT=Path(__file__).resolve().parent.parent
BASE='http://127.0.0.1:4336';RUN=uuid.uuid4().hex;PASSWORD=secrets.token_urlsafe(24)
OUT=ROOT/'.cache'/'phase1-browser';OUT.mkdir(parents=True,exist_ok=True)
STATE=Path(tempfile.mkdtemp(prefix='phase1-',dir=ROOT/'.cache'));LOG=(STATE/'preview.log').open('w')
process=subprocess.Popen(['node','scripts/run-tool.mjs','node','scripts/preview.mjs','--state',str(STATE/'state'),'--port','4336'],cwd=ROOT,stdout=LOG,stderr=LOG,start_new_session=True)
def sql(statement):
 path=STATE/'fixture.sql';path.write_text(statement)
 try:
  result=subprocess.run(['node','scripts/run-tool.mjs','npm','exec','--workspace=@timphongtro/web','--','wrangler','d1','execute','DB','--local','--config',str(ROOT/'apps/web/dist/server/wrangler.json'),'--persist-to',str(STATE/'state'),'--file',str(path)],cwd=ROOT,capture_output=True,text=True)
  if result.returncode:raise RuntimeError(result.stderr[-500:])
 finally:path.unlink(missing_ok=True)
async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
  contexts=[await browser.new_context(viewport={'width':1440,'height':1000}) for _ in range(4)]
  admin,seller,reader,public=[await c.new_page() for c in contexts];errors=[]
  # Tiles are mocked to keep this acceptance test independent of a map provider.
  png=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1ioAAAAASUVORK5CYII=')
  for page in [admin,seller,reader,public]:
   page.on('pageerror',lambda e:errors.append(str(e)))
   page.on('dialog',lambda d:asyncio.create_task(d.accept()))
   await page.route('**/api/maps/tiles/**',lambda route:route.fulfill(status=200,content_type='image/png',body=png))
   await page.route('https://www.google.com/maps**',lambda route:route.abort())
  async def send(page,path,body,method='POST',expected=200):
   response=await page.request.fetch(BASE+path,method=method,headers={'Origin':BASE},data=body)
   assert response.status==expected,(path,response.status,(await response.text())[:500])
   return await response.json()
  async def row(id):return (await (await admin.request.get(BASE+'/api/cms/listing-submissions/'+id)).json())['item']
  async def approve(id,decision='published'):
   item=await row(id)
   return await send(admin,'/api/cms/listing-submissions/'+id+'/review',{'version':item['version'],'decision':decision,'note':'Bổ sung thông tin trước khi đăng.' if decision=='rejected' else ''})
  async def submit(page,name):
   async with page.expect_navigation():await page.get_by_role('button',name=name,exact=True).click()
  try:
   for _ in range(120):
    try:
     if (await admin.request.get(BASE+'/api/health',timeout=1000)).status==200:break
    except Exception:pass
    await asyncio.sleep(.5)
   else:raise RuntimeError('Isolated preview did not start.')
   users=[]
   for page,label in [(admin,'admin'),(seller,'seller'),(reader,'reader')]:
    users.append((await send(page,'/api/auth/register',{'name':'Kiểm tra phần một '+label,'email':f'phase1-{label}-{RUN}@example.test','password':PASSWORD},expected=201))['user'])
   aid,sid,rid=[u['id'] for u in users];role=str(uuid.uuid4())
   await asyncio.to_thread(sql,f"UPDATE users SET is_super_admin=1 WHERE id='{aid}'; INSERT INTO seller_profiles(user_id,display_name,seller_type,phone,zalo_phone,status,change_token) VALUES('{sid}','Chủ trọ kiểm tra phần một','owner','0901234567','0901234567','approved','fixture'); INSERT INTO cms_roles(id,name) VALUES('{role}','Chỉ đọc tin phần một'); INSERT INTO cms_role_permissions(role_id,permission) VALUES('{role}','listings.read'); INSERT INTO cms_user_roles(user_id,role_id) VALUES('{rid}','{role}');")
   original='Phòng thử luồng CMS và tài khoản khách';revised='Bản sửa CMS chỉ công khai sau khi được duyệt'
   image=STATE/'room.jpg';Image.new('RGB',(800,600),'#b2d0de').save(image)
   second_image=STATE/'room-new.jpg';Image.new('RGB',(800,600),'#e3c79d').save(second_image)
   await admin.goto(BASE+'/quan-tri/tin-phong/tao')
   await admin.locator('#listing-owner').select_option(sid)
   for selector,value in [('#listing-title',original),('#listing-price','3200000'),('#listing-size','26'),('#listing-street','123 Đường thử riêng tư Bình Thạnh'),('#listing-description','Phòng có cửa sổ sáng, bếp riêng và chỗ để xe. Hẹn xem phòng trực tiếp trước khi quyết định thuê.')]:await admin.locator(selector).fill(value)
   await admin.locator('#listing-location').select_option('binh-thanh');await admin.locator('#listing-plan').select_option('basic-7d');await admin.locator('#fee-water-unit').select_option('per_m3')
   await admin.locator('#listing-photos').set_input_files([str(image)]*3);await expect(admin.locator('.listing-photo')).to_have_count(3)
   await submit(admin,'Lưu bản nháp')
   items=(await (await admin.request.get(BASE+'/api/cms/listing-submissions?status=draft')).json())['items'];lid=next(i['id'] for i in items if i['title']==original)
   assert not (await (await seller.request.get(BASE+'/api/account/listings')).json())['items']
   assert (await seller.request.get(BASE+'/api/account/listings/'+lid)).status==404
   edit='/quan-tri/tin-phong/'+lid+'/sua'
   await admin.goto(BASE+edit);await expect(admin.locator('[data-listing-form]')).to_have_attribute('data-mode','cms');await expect(admin.locator('.listing-photo')).to_have_count(3)
   assert await admin.locator('#listing-owner').count()==0
   # A stale edit must report conflict while keeping the unsaved browser input.
   item=await row(lid);payload={k:item[k] for k in ['title','location_id','room_type','price_vnd','area_m2','description','plan_id','owner_id','version']};payload['details']=json.loads(item['details'])
   await send(admin,'/api/cms/listing-submissions/'+lid,payload,method='PATCH')
   await admin.locator('#listing-title').fill('Nội dung đang nhập chưa được lưu')
   await admin.get_by_role('button',name='Lưu bản nháp',exact=True).click();await expect(admin.locator('[data-listing-error]')).to_be_visible();await expect(admin.locator('#listing-title')).to_have_value('Nội dung đang nhập chưa được lưu')
   await admin.reload();await admin.locator('#listing-plan').select_option('standard-30d');await submit(admin,'Gửi tin chờ duyệt')
   await approve(lid,'rejected');await admin.goto(BASE+edit);await expect(admin.locator('.finance-notice.warning')).to_contain_text('Bổ sung thông tin')
   await submit(admin,'Gửi tin chờ duyệt');await approve(lid)
   first=await row(lid);before=(await (await seller.request.get(BASE+'/api/account/wallet')).json())['free_posts_remaining']
   assert before==2
   await seller.goto(BASE+'/tai-khoan/tin-dang');await expect(seller.locator('.owner-listing')).to_have_count(1)
   await public.goto(BASE+'/phong/'+lid);await expect(public.locator('h1')).to_have_text(original)
   await admin.goto(BASE+edit);assert await admin.locator('#listing-plan').count()==0
   await admin.locator('#listing-title').fill(revised);await admin.locator('#listing-price').fill('4100000');await admin.locator('#listing-street').fill('456 Địa chỉ mới chỉ công khai sau duyệt');await admin.locator('[name=address_visibility][value=exact]').check()
   await admin.locator('.listing-photo').first.get_by_role('button',name='Gỡ ảnh phòng 1',exact=True).click();await admin.locator('#listing-photos').set_input_files(str(second_image));await expect(admin.locator('.listing-photo')).to_have_count(3)
   await submit(admin,'Gửi tin chờ duyệt')
   await public.goto(BASE+'/phong/'+lid);await expect(public.locator('h1')).to_have_text(original);assert revised not in await public.locator('main').inner_text();assert '456 Địa chỉ' not in await public.locator('main').inner_text()
   await seller.goto(BASE+'/tai-khoan/tin-dang');await expect(seller.locator('.owner-listing')).to_have_count(1);await expect(seller.locator('.owner-listing .profile-status')).to_have_text('Bản sửa chờ xét duyệt')
   await reader.goto(BASE+edit);await expect(reader.locator('#listing-title')).to_be_disabled();assert await reader.locator('[data-listing-form] button[type=submit]').count()==0
   await approve(lid);after=await row(lid);assert after['published_at']==first['published_at'] and after['expires_at']==first['expires_at'];assert (await (await seller.request.get(BASE+'/api/account/wallet')).json())['free_posts_remaining']==before
   await public.goto(BASE+'/phong/'+lid);await expect(public.locator('h1')).to_have_text(revised);await expect(public.locator('.detail-location')).to_contain_text('456 Địa chỉ')
   # Owner can still track their own revision after the CMS-created listing was published.
   await seller.goto(BASE+'/tai-khoan/tin-dang/'+lid);await seller.locator('#listing-title').fill('Khách sửa lại tin đã từng xuất bản từ CMS');await submit(seller,'Gửi tin xét duyệt')
   await expect(seller.locator('.owner-listing')).to_have_count(1);assert (await seller.request.get(BASE+'/api/account/listings/'+lid)).status==200
   await approve(lid)
   # Exercise the actual file chooser overlay and upload handler across narrow phones,
   # tablets, laptops and wide desktops, then repeat with touch-enabled mobile emulation.
   await seller.goto(BASE+'/tai-khoan/tin-dang/moi')
   for index,width in enumerate([320,390,768,1024,1440,1920],start=1):
    await seller.set_viewport_size({'width':width,'height':900 if width>=1024 else 844})
    await seller.evaluate('document.fonts.ready')
    assert await seller.evaluate('document.documentElement.scrollWidth<=window.innerWidth+1'),(width,'seller upload form horizontal overflow')
    target=seller.locator('.listing-upload');box=await target.bounding_box();assert box and box['width']>200 and box['x']>=-1 and box['x']+box['width']<=width+1,(width,box)
    async with seller.expect_file_chooser() as chooser_info:await target.click()
    await (await chooser_info.value).set_files(str(image));await expect(seller.locator('.listing-photo')).to_have_count(index)
    await expect(seller.locator('[data-upload-status]')).to_contain_text('Đã thêm 1 ảnh')
    if width in [390,768,1440]:await seller.screenshot(path=str(OUT/f'seller-upload-{width}.png'),full_page=True)
   touch_context=await browser.new_context(viewport={'width':390,'height':844},device_scale_factor=3,is_mobile=True,has_touch=True,storage_state=await seller.context.storage_state())
   touch=await touch_context.new_page();touch.on('pageerror',lambda e:errors.append(str(e)));await touch.route('**/api/maps/tiles/**',lambda route:route.fulfill(status=200,content_type='image/png',body=png));await touch.goto(BASE+'/tai-khoan/tin-dang/moi')
   touch_target=touch.locator('.listing-upload');touch_box=await touch_target.bounding_box();assert touch_box and touch_box['width']>200 and touch_box['height']>=100
   async with touch.expect_file_chooser() as chooser_info:await touch.touchscreen.tap(touch_box['x']+touch_box['width']/2,touch_box['y']+touch_box['height']/2)
   await (await chooser_info.value).set_files(str(image));await expect(touch.locator('.listing-photo')).to_have_count(1)
   await expect(touch.locator('[data-upload-status]')).to_contain_text('Đã thêm 1 ảnh');await touch.screenshot(path=str(OUT/'seller-upload-touch-390.png'),full_page=True);await touch_context.close()
   print('Upload ảnh từ bộ chọn tại 320/390/768/1024/1440/1920px và thao tác chạm mobile giả lập — OK',flush=True)
   routes=[(admin,'/quan-tri/tin-phong/tao'),(admin,edit),(seller,'/tai-khoan/tin-dang/'+lid),(seller,'/tai-khoan/tin-dang'),(admin,'/quan-tri/tin-phong?status=published'),(admin,'/quan-tri/tin-phong/danh-sach')]
   checks=0
   for width in [320,390,768,1024,1440,1920]:
    for page,path in routes:
     await page.set_viewport_size({'width':width,'height':1000});await page.goto(BASE+path);await page.evaluate('document.fonts.ready')
     assert await page.evaluate('document.documentElement.scrollWidth<=window.innerWidth+1'),(width,path,'horizontal overflow')
     for control in await page.locator('[data-listing-form] input:not([type=radio]):not([type=checkbox]):visible,[data-listing-form] select:visible,[data-listing-form] textarea:visible').all():
      box=await control.bounding_box();assert box and box['width']>50 and box['x']>=-1 and box['x']+box['width']<=width+1,(width,path,box)
     checks+=1
     if path==edit and width in [390,768,1440]:await page.screenshot(path=str(OUT/f'cms-edit-{width}.png'),full_page=True)
   assert not errors,errors
   print(f'CMS/customer draft restore, plan selection, conflict preservation, reject/resubmit, reviewed public copy, owner visibility, read-only permissions, unchanged fee/expiry: passed; {checks} responsive page checks.',flush=True)
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
 LOG.close();shutil.rmtree(STATE);print('Disposed LOCAL test D1/R2; no production mutations.',flush=True)
