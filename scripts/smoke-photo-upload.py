"""Responsive, LOCAL-only browser check for seller and CMS listing photo uploads."""
import asyncio, os, secrets, signal, subprocess, tempfile, uuid, shutil, base64
from pathlib import Path
from PIL import Image
from playwright.async_api import async_playwright, expect

ROOT=Path(__file__).resolve().parent.parent
BASE='http://127.0.0.1:4337'
OUT=ROOT/'.cache'/'photo-upload-browser';OUT.mkdir(parents=True,exist_ok=True)
STATE=Path(tempfile.mkdtemp(prefix='photo-upload-',dir=ROOT/'.cache'))
LOG=(STATE/'preview.log').open('w')
process=subprocess.Popen(['node','scripts/run-tool.mjs','node','scripts/preview.mjs','--state',str(STATE/'state'),'--port','4337'],cwd=ROOT,stdout=LOG,stderr=LOG,start_new_session=True)

def sql(statement):
 path=STATE/'fixture.sql';path.write_text(statement)
 try:
  result=subprocess.run(['node','scripts/run-tool.mjs','npm','exec','--workspace=@timphongtro/web','--','wrangler','d1','execute','DB','--local','--config',str(ROOT/'apps/web/dist/server/wrangler.json'),'--persist-to',str(STATE/'state'),'--file',str(path)],cwd=ROOT,capture_output=True,text=True)
  if result.returncode:raise RuntimeError('Local fixture setup failed: '+result.stderr[-500:])
 finally:path.unlink(missing_ok=True)

success=False
async def main():
 global success
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium'),args=['--no-sandbox'])
  try:
   seller_context=await browser.new_context(viewport={'width':390,'height':844})
   seller=await seller_context.new_page();errors=[];seller.on('pageerror',lambda e:errors.append(str(e)))
   for _ in range(120):
    try:
     if (await seller.request.get(BASE+'/api/health',timeout=1000)).status==200:break
    except Exception:pass
    await asyncio.sleep(.5)
   else:raise RuntimeError('Isolated local preview did not start.')
   run=uuid.uuid4().hex;password=secrets.token_urlsafe(24)
   async def register(page,label):
    response=await page.request.post(BASE+'/api/auth/register',headers={'Origin':BASE},data={'name':'Kiểm tra tải ảnh '+label,'email':f'photo-{label}-{run}@example.test','password':password})
    assert response.status==201,(label,response.status,(await response.text())[:300])
    return (await response.json())['user']['id']
   seller_id=await register(seller,'seller')
   admin_context=await browser.new_context(viewport={'width':1440,'height':1000})
   admin=await admin_context.new_page();admin.on('pageerror',lambda e:errors.append(str(e)))
   admin_id=await register(admin,'admin')
   await asyncio.to_thread(sql,f"INSERT INTO seller_profiles(user_id,display_name,seller_type,phone,zalo_phone,status,change_token) VALUES('{seller_id}','Chủ trọ kiểm tra tải ảnh','owner','0901234567','0901234567','approved','fixture'); UPDATE users SET is_super_admin=1 WHERE id='{admin_id}';")
   image=STATE/'room.jpg';Image.new('RGB',(2400,1800),'#b2d0de').save(image,quality=92)
   image_png=STATE/'room.png';Image.new('RGB',(2400,1800),'#d0c0a8').save(image_png)
   image_webp=STATE/'room.webp';Image.new('RGB',(2400,1800),'#a8cfd0').save(image_webp,quality=90)
   large_image=STATE/'phone-photo-over-2mb.jpg';Image.effect_noise((4032,3024),80).convert('RGB').save(large_image,quality=95)
   assert large_image.stat().st_size>2*1024*1024,large_image.stat().st_size
   near_limit=STATE/'phone-photo-near-2mb.jpg';Image.effect_noise((3000,2000),80).convert('RGB').save(near_limit,quality=28)
   assert 1536*1024<near_limit.stat().st_size<2*1024*1024,near_limit.stat().st_size
   await seller.goto(BASE+'/tai-khoan/tin-dang/moi');await expect(seller.locator('[data-listing-form]')).to_be_visible()
   for index,width in enumerate([320,390,768,1024,1280,1440,1920],start=1):
    await seller.set_viewport_size({'width':width,'height':900 if width>=1024 else 844})
    await seller.evaluate('document.fonts.ready')
    assert await seller.evaluate('document.documentElement.scrollWidth<=window.innerWidth+1'),(width,'seller form overflows')
    picker=seller.locator('.listing-upload');box=await picker.bounding_box();assert box and box['width']>200 and box['x']>=-1 and box['x']+box['width']<=width+1,(width,box)
    async with seller.expect_file_chooser() as chooser_info:await picker.click()
    source={320:image_png,390:image_webp}.get(width,image)
    await (await chooser_info.value).set_files(str(source));await expect(seller.locator('[data-upload-status]')).to_contain_text('Đã thêm 1 ảnh',timeout=30000)
    actual=await seller.locator('.listing-photo').count()
    if actual!=index:raise AssertionError((width,'upload count',actual,'status',await seller.locator('[data-upload-status]').inner_text(),'error',await seller.locator('[data-upload-error]').inner_text()))
    await expect(seller.locator('[data-upload-status]')).to_contain_text('Đã thêm 1 ảnh')
    if width in [390,768,1440]:await seller.screenshot(path=str(OUT/f'seller-{width}.png'),full_page=True)
   mobile=await browser.new_context(viewport={'width':390,'height':844},device_scale_factor=3,is_mobile=True,has_touch=True,storage_state=await seller_context.storage_state())
   touch=await mobile.new_page();touch.on('pageerror',lambda e:errors.append(str(e)));await touch.route('**/api/maps/tiles/**',lambda route:route.fulfill(status=200,content_type='image/png',body=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1ioAAAAASUVORK5CYII=')))
   await touch.goto(BASE+'/tai-khoan/tin-dang/moi');await expect(touch.locator('[data-listing-form]')).to_be_visible()
   touch_target=touch.locator('.listing-upload');await touch_target.scroll_into_view_if_needed();box=await touch_target.bounding_box();assert box and box['height']>=100
   async with touch.expect_file_chooser() as chooser_info:await touch.touchscreen.tap(box['x']+box['width']/2,box['y']+box['height']/2)
   await (await chooser_info.value).set_files(str(large_image));await expect(touch.locator('[data-upload-error]')).to_contain_text('Mỗi ảnh cần nhỏ hơn 2 MB.')
   assert await touch.locator('.listing-photo').count()==0
   async with touch.expect_file_chooser() as chooser_info:await touch.locator('.listing-upload').click()
   await (await chooser_info.value).set_files(str(near_limit));await expect(touch.locator('.listing-photo')).to_have_count(1,timeout=30000);await expect(touch.locator('[data-upload-status]')).to_contain_text('Đã thêm 1 ảnh',timeout=30000)
   await touch.screenshot(path=str(OUT/'seller-mobile-touch.png'),full_page=True)
   await admin.set_viewport_size({'width':390,'height':844});await admin.goto(BASE+'/quan-tri/tin-phong/tao');await admin.locator('#listing-owner').select_option(seller_id)
   box=await admin.locator('.listing-upload').bounding_box();assert box and box['width']>200
   async with admin.expect_file_chooser() as chooser_info:await admin.locator('.listing-upload').click()
   await (await chooser_info.value).set_files(str(image));await expect(admin.locator('.listing-photo')).to_have_count(1,timeout=30000);await expect(admin.locator('[data-upload-status]')).to_contain_text('Đã thêm 1 ảnh',timeout=30000)
   await admin.screenshot(path=str(OUT/'cms-mobile.png'),full_page=True)
   assert not errors,errors
   success=True
   print('Ảnh PNG/WebP/JPEG chọn và gửi thành công: seller tại 320/390/768/1024/1280/1440/1920px; mobile từ chối ảnh >2 MB, nhận ảnh JPEG gần giới hạn 2 MB; CMS trên mobile. Không tràn ngang, không lỗi JavaScript.',flush=True)
  finally:await browser.close()

try:asyncio.run(main())
finally:
 os.killpg(process.pid,signal.SIGTERM)
 try:process.wait(timeout=10)
 except subprocess.TimeoutExpired:os.killpg(process.pid,signal.SIGKILL);process.wait()
 LOG.close()
 if not success:
  try:shutil.copyfile(STATE/'preview.log',OUT/'last-preview.log')
  except OSError:pass
 shutil.rmtree(STATE);print('Đã xóa D1/R2 local dùng riêng cho kiểm tra; không thay đổi dữ liệu production.',flush=True)
