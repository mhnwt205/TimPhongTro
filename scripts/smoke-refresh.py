"""All-page visual refresh, VietQR, bank picker and reporting. Disposable LOCAL D1 only."""
import asyncio,json,os,secrets,signal,subprocess,tempfile,uuid,shutil
from pathlib import Path
from browser_banks import choose_bank
from playwright.async_api import async_playwright,expect
ROOT=Path(__file__).resolve().parent.parent
BASE='http://127.0.0.1:4328';RUN=uuid.uuid4().hex;PASSWORD=secrets.token_urlsafe(24)
OUT=ROOT/'.taste-skill'/'refresh';OUT.mkdir(parents=True,exist_ok=True)
STATE=Path(tempfile.mkdtemp(prefix='refresh-browser-',dir=ROOT/'.cache'));LOG=(STATE/'preview.log').open('w')
process=subprocess.Popen(['node','scripts/run-tool.mjs','node','scripts/preview.mjs','--state',str(STATE/'state'),'--port','4328'],cwd=ROOT,stdout=LOG,stderr=LOG,start_new_session=True)
def sql(statement):
 path=STATE/'fixture.sql';path.write_text(statement)
 try:
  r=subprocess.run(['node','scripts/run-tool.mjs','npm','exec','--workspace=@timphongtro/web','--','wrangler','d1','execute','DB','--local','--config',str(ROOT/'apps/web/dist/server/wrangler.json'),'--persist-to',str(STATE/'state'),'--file',str(path)],cwd=ROOT,capture_output=True,text=True)
  if r.returncode:raise RuntimeError('Isolated refresh fixture failed: '+r.stderr[-600:])
 finally:path.unlink(missing_ok=True)
def decode_png(path,bin,code,amount):
 script="""import sharp from 'sharp';import jsQR from 'jsqr';import assert from 'node:assert/strict';const [path,bin,code,amount]=process.argv.slice(1);const {data,info}=await sharp(path).ensureAlpha().raw().toBuffer({resolveWithObject:true});const qr=jsQR(new Uint8ClampedArray(data),info.width,info.height);assert.ok(qr);assert.ok(qr.data.includes(bin)&&qr.data.includes(code)&&qr.data.includes('000123456789'));assert.ok(qr.data.includes('54'+String(amount.length).padStart(2,'0')+amount));console.log('Downloaded PNG independently decodes to expected bank/account/amount/code.');"""
 r=subprocess.run(['node','--input-type=module','-e',script,str(path),bin,code,str(amount)],cwd=ROOT,capture_output=True,text=True);assert r.returncode==0,r.stderr[-800:]
async def confirm(page,name):
 await page.get_by_role('button',name=name,exact=True).click();await expect(page.locator('#finance-confirm')).to_be_visible()
 async with page.expect_navigation():await page.get_by_role('button',name='Xác nhận thực hiện',exact=True).click()
async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox']);errors=[]
  ac=await browser.new_context(viewport={'width':1440,'height':1000});sc=await browser.new_context(viewport={'width':390,'height':844});pc=await browser.new_context(viewport={'width':1440,'height':1000});rc=await browser.new_context()
  admin=await ac.new_page();seller=await sc.new_page();public=await pc.new_page();reader=await rc.new_page()
  for page in [admin,seller,public,reader]:page.on('pageerror',lambda e:errors.append(str(e)))
  async def post(page,path,body):
   r=await page.request.post(BASE+path,headers={'Origin':BASE},data=body);assert r.status in [200,201],(path,r.status,await r.text());return await r.json()
  async def bank_config(query,bank):
   await admin.goto(BASE+'/quan-tri/cau-hinh-thanh-toan');await expect(admin.locator('#bank-code option[value='+bank+']')).to_have_count(1);await choose_bank(admin,'bank-code',bank,query);await expect(admin.locator('#bank-name')).to_have_value('TPBank' if bank=='TPB' else 'Sacombank');await admin.locator('#bank-number').fill('000123456789');await admin.locator('#bank-holder').fill('KIEM THU QR LOCAL');await admin.locator('[name=accepting_topups]').check();await confirm(admin,'Lưu cấu hình')
  async def topup(value,bin):
   await seller.goto(BASE+'/tai-khoan/nap-tien');await seller.locator('#topup-amount').fill(str(value))
   async with seller.expect_navigation():await seller.get_by_role('button',name='Tạo mã và xem hướng dẫn',exact=True).click()
   code=seller.url.rsplit('/',1)[-1];image=seller.locator('[data-topup-qr]');await expect(image).to_be_visible();await expect(image).to_have_js_property('complete',True);assert await image.evaluate('i=>i.naturalWidth')>0
   async with seller.expect_download() as download:await seller.get_by_role('button',name='Lưu ảnh QR',exact=True).click()
   item=await download.value;path=OUT/(code+'.png');await item.save_as(str(path));await asyncio.to_thread(decode_png,path,bin,code,value)
   return (await (await seller.request.get(BASE+'/api/account/topups/'+code)).json())['topup']
  try:
   for _ in range(120):
    try:
     r=await admin.request.get(BASE+'/api/health',timeout=1000)
     if r.status==200:break
    except Exception:pass
    await asyncio.sleep(.5)
   else:raise RuntimeError('Refresh preview not ready.')
   await public.goto(BASE+'/');await public.screenshot(path=str(OUT/'home-first-1440.png'))
   users=[]
   for page,kind in [(admin,'admin'),(seller,'seller'),(reader,'reader')]:users.append((await post(page,'/api/auth/register',{'name':'Kiểm thử giao diện '+kind,'email':f'refresh-{kind}-{RUN}@example.test','password':PASSWORD}))['user'])
   aid,sid,rid=[u['id'] for u in users];role=str(uuid.uuid4())
   await asyncio.to_thread(sql,f"UPDATE users SET role='admin',is_super_admin=1 WHERE id='{aid}'; INSERT INTO seller_profiles(user_id,display_name,seller_type,phone,zalo_phone,status,change_token) VALUES('{sid}','Người đăng kiểm tra giao diện','owner','0901234567','0901234567','approved','fixture'); INSERT INTO cms_roles(id,name) VALUES('{role}','Chỉ xem báo cáo thử'); INSERT INTO cms_role_permissions(role_id,permission) VALUES('{role}','reports.read'); INSERT INTO cms_user_roles(user_id,role_id) VALUES('{rid}','{role}'); INSERT INTO content_pages(id,slug,title,body,is_active) VALUES('refresh-info','huong-dan-thu-giao-dien','Hướng dẫn sử dụng website','Nội dung minh họa kiểm tra bố cục trang thông tin.',1);")
   await bank_config('TP bank','TPB');first=await topup(50000,'970423')
   await bank_config('Sài Gòn Thương Tín','STB');second=await topup(20000,'970403')
   # Existing TPBank request still uses its own snapshot after switching to Sacombank.
   await seller.goto(BASE+'/tai-khoan/nap-tien/'+first['code']);async_download=seller.expect_download()
   async with async_download as download:await seller.get_by_role('button',name='Lưu ảnh QR',exact=True).click()
   path=OUT/'tpbank-snapshot.png';await (await download.value).save_as(str(path));await asyncio.to_thread(decode_png,path,'970423',first['code'],50000)
   await confirm(seller,'Đã chuyển khoản');assert await seller.locator('[data-topup-qr]').count()==0;assert (await seller.request.get(BASE+'/api/account/topups/'+first['code']+'/qr')).status==409
   await post(admin,'/api/cms/topups/'+first['id']+'/reconcile',{'version':2,'actual_vnd':50000,'bank_account_id':first['bank_account_id'],'bank_reference':'REFRESH'+RUN[:12],'verified':True})
   await seller.goto(BASE+'/tai-khoan/nap-tien/'+first['code']);assert await seller.locator('[data-topup-qr]').count()==0
   await seller.goto(BASE+'/tai-khoan/rut-tien');await choose_bank(seller,'withdraw-bank','STB');await expect(seller.locator('#withdraw-bank')).to_have_value('STB')
   withdrawal=(await post(seller,'/api/account/withdrawals',{'amount_vnd':10000,'bank_code':'STB','account_number':'000123456789','account_holder':'NGUOI DUNG KIEM THU','current_password':PASSWORD,'confirmed':True,'request_key':str(uuid.uuid4())}))['withdrawal']
   await post(admin,'/api/cms/withdrawals/'+withdrawal['id']+'/review',{'version':1,'action':'approved','confirmed':True});await post(admin,'/api/cms/withdrawals/'+withdrawal['id']+'/claim',{'version':2,'confirmed':True})
   await admin.goto(BASE+'/quan-tri/rut-tien/'+withdrawal['id']);await choose_bank(admin,'payout-bank','TPB');await expect(admin.locator('#payout-bank')).to_have_value('TPB')
   # No fixture listings are supplied to a fresh local database.
   await public.goto(BASE+'/');assert await public.locator('.room-card').count()==0
   await public.goto(BASE+'/tim-phong');assert await public.locator('.room-row').count()==0
   response=await public.goto(BASE+'/phong/studio-ban-cong-binh-thanh');assert response.status==404
   await reader.goto(BASE+'/quan-tri/bao-cao-tin');await expect(reader.get_by_role('heading',name='Chưa có báo cáo phù hợp')).to_be_visible()
   print('Empty catalogue, removed sample route, and empty report queue: OK',flush=True)
   # Preserve sidebar position after this release adds the reports queue.
   await admin.set_viewport_size({'width':1440,'height':700});await admin.goto(BASE+'/quan-tri/bao-cao-tin');nav=admin.locator('[data-cms-sidebar-scroll]');await nav.evaluate('e=>e.scrollTop=e.scrollHeight');await admin.wait_for_timeout(100);scroll=await nav.evaluate('e=>e.scrollTop');await nav.locator('a[href="/quan-tri/so-du"]').click();await admin.wait_for_url('**/quan-tri/so-du');await expect(nav).to_have_js_property('scrollTop',scroll)
   routes=[(public,path) for path in ['/','/tim-phong','/phong-da-luu','/bang-gia','/dang-tin','/dang-nhap','/dang-ky','/quan-tri/dang-nhap','/bao-cao-tin?tin=studio-ban-cong-binh-thanh','/thong-tin/huong-dan-thu-giao-dien','/404','/403']]
   routes +=[(seller,path) for path in ['/tai-khoan/ho-so','/tai-khoan/so-du','/tai-khoan/nap-tien','/tai-khoan/nap-tien/'+second['code'],'/tai-khoan/nap-tien/'+first['code'],'/tai-khoan/rut-tien','/tai-khoan/rut-tien/'+withdrawal['code']]]
   routes +=[(admin,'/quan-tri'+('/'+path if path else '')) for path in ['','tai-khoan','vai-tro','goi-dang-tin','khu-vuc','noi-dung','tin-phong','nhat-ky','nguoi-dang?status=all','nap-tien','nap-tien/'+second['id'],'so-du','so-du/'+sid,'cau-hinh-thanh-toan','rut-tien','rut-tien/'+withdrawal['id'],'bao-mat','bao-cao-tin']]
   screenshots={'/':'home','/tim-phong':'search','/bang-gia':'pricing','/dang-nhap':'login','/tai-khoan/so-du':'wallet','/tai-khoan/nap-tien/'+second['code']:'qr','/tai-khoan/rut-tien':'withdrawal','/quan-tri':'cms','/quan-tri/vai-tro':'cms-roles','/quan-tri/cau-hinh-thanh-toan':'bank-settings','/quan-tri/bao-cao-tin':'cms-reports'}
   checks=0
   for width in [320,390,768,1024,1280,1440,1920]:
    for target in [public,seller,admin]:await target.set_viewport_size({'width':width,'height':900})
    for target,path in routes:
     r=await target.goto(BASE+path,wait_until='networkidle');expected=404 if path in ['/404','/bao-cao-tin?tin=studio-ban-cong-binh-thanh'] else 403 if path=='/403' else 200;assert r.status==expected,(path,width,r.status)
     assert await target.locator('h1').count()==1,(path,width,'h1')
     if await target.evaluate('document.documentElement.scrollWidth>innerWidth+1'):
      await target.screenshot(path=str(OUT/'overflow.png'));raise AssertionError((path,width,'overflow'))
     bad=await target.evaluate('[...document.images].filter(i=>i.getBoundingClientRect().top<innerHeight&&i.getBoundingClientRect().bottom>0&&(!i.complete||!i.naturalWidth)).length');assert bad==0,(path,width,'broken image')
     if width in [390,768,1440] and path in screenshots:await target.screenshot(path=str(OUT/(screenshots[path]+'-'+str(width)+'.png')),full_page=False)
     checks+=1
    print(f'All-page refresh {width}px: {len(routes)} routes OK',flush=True)
   assert not errors,errors
   (OUT/'results.json').write_text(json.dumps({'layout_checks':checks,'routes':len(routes),'sample_listings':0,'QR_PNG_banks':['TPB','STB'],'bank_search_forms':3,'report_flow':'covered by report integration tests','sidebar':'passed','page_errors':errors},indent=2))
   print('All-page refresh, finance, QR and reporting browser checks: OK',flush=True)
  finally:await browser.close()
try:asyncio.run(main())
finally:
 os.killpg(process.pid,signal.SIGTERM)
 try:process.wait(timeout=10)
 except subprocess.TimeoutExpired:os.killpg(process.pid,signal.SIGKILL);process.wait()
 LOG.close();shutil.rmtree(STATE);print('Disposed isolated refresh database. No production content or financial mutations.',flush=True)
