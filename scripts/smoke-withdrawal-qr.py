"""Withdrawal browser flow and responsive layouts in a disposable LOCAL D1 database."""
import asyncio,json,os,secrets,signal,subprocess,tempfile,uuid,shutil
from pathlib import Path
from browser_banks import choose_bank
from playwright.async_api import async_playwright,expect
ROOT=Path(__file__).resolve().parent.parent
BASE='http://127.0.0.1:4325';RUN=uuid.uuid4().hex;PASSWORD=secrets.token_urlsafe(24)
OUT=ROOT/'.taste-skill'/'withdrawal-qr';OUT.mkdir(parents=True,exist_ok=True)
STATE=Path(tempfile.mkdtemp(prefix='withdrawal-browser-',dir=ROOT/'.cache'));LOG=(STATE/'preview.log').open('w')
process=subprocess.Popen(['node','scripts/run-tool.mjs','node','scripts/preview.mjs','--state',str(STATE/'state'),'--port','4325'],cwd=ROOT,stdout=LOG,stderr=LOG,start_new_session=True)
def sql(statement):
 path=STATE/'fixture.sql';path.write_text(statement)
 try:
  result=subprocess.run(['node','scripts/run-tool.mjs','npm','exec','--workspace=@timphongtro/web','--','wrangler','d1','execute','DB','--local','--config',str(ROOT/'apps/web/dist/server/wrangler.json'),'--persist-to',str(STATE/'state'),'--file',str(path)],cwd=ROOT,capture_output=True,text=True)
  if result.returncode:raise RuntimeError('Local withdrawal fixture command failed.')
 finally:path.unlink(missing_ok=True)
async def confirm(page,button):
 await page.get_by_role('button',name=button,exact=True).click();await expect(page.locator('#finance-confirm')).to_be_visible()
 async with page.expect_navigation():await page.get_by_role('button',name='Xác nhận thực hiện',exact=True).click()
def decode_png(path,bin,code,amount):
 script="""import sharp from 'sharp';import jsQR from 'jsqr';import assert from 'node:assert/strict';const [path,bin,code,amount]=process.argv.slice(1);const {data,info}=await sharp(path).ensureAlpha().raw().toBuffer({resolveWithObject:true});const qr=jsQR(new Uint8ClampedArray(data),info.width,info.height);assert.ok(qr);assert.ok(qr.data.includes(bin)&&qr.data.includes(code)&&qr.data.includes('000123456789'));assert.ok(qr.data.includes('54'+String(amount.length).padStart(2,'0')+amount));"""
 r=subprocess.run(['node','--input-type=module','-e',script,str(path),bin,code,str(amount)],cwd=ROOT,capture_output=True,text=True);assert r.returncode==0,r.stderr[-800:]
async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
  ac=await browser.new_context(viewport={'width':1440,'height':1000});sc=await browser.new_context(viewport={'width':390,'height':844});rc=await browser.new_context()
  admin=await ac.new_page();seller=await sc.new_page();reader=await rc.new_page();errors=[]
  for page in [admin,seller,reader]:page.on('pageerror',lambda e:errors.append(str(e)))
  async def post(page,path,data):return await page.request.post(BASE+path,headers={'Origin':BASE},data=data)
  async def create(amount):
   r=await post(seller,'/api/account/withdrawals',{'amount_vnd':amount,'bank_code':'VCB','account_number':'000123456789','account_holder':'NGUOI DUNG THU NGHIEM','current_password':PASSWORD,'confirmed':True,'request_key':str(uuid.uuid4())});assert r.status==201,await r.text();return (await r.json())['withdrawal']
  async def check_qr(r):
   img=admin.locator('[data-withdrawal-qr]');await expect(img).to_be_visible();await expect(img).to_have_js_property('complete',True);assert await img.evaluate('e=>e.naturalWidth')>0
   async with admin.expect_download() as downloaded:await admin.get_by_role('button',name='Lưu ảnh QR',exact=True).click()
   path=OUT/(r['code']+'.png');await (await downloaded.value).save_as(str(path));await asyncio.to_thread(decode_png,path,'970436',r['code'],20000)
  try:
   for _ in range(120):
    try:
     r=await admin.request.get(BASE+'/api/health',timeout=1000)
     if r.status==200:break
    except Exception:pass
    await asyncio.sleep(.5)
   else:raise RuntimeError('Local withdrawal preview not ready.')
   users=[]
   for page,kind in [(admin,'admin'),(seller,'seller'),(reader,'reader')]:
    r=await post(page,'/api/auth/register',{'name':'Kiểm thử rút '+kind,'email':f'withdrawal-{kind}-{RUN}@example.test','password':PASSWORD});assert r.status==201;users.append((await r.json())['user'])
   aid,sid,rid=[u['id'] for u in users];role=str(uuid.uuid4())
   await asyncio.to_thread(sql,f"UPDATE users SET role='admin',is_super_admin=1 WHERE id='{aid}'; INSERT INTO cms_roles(id,name) VALUES('{role}','Chỉ xem yêu cầu rút'); INSERT INTO cms_role_permissions(role_id,permission) VALUES('{role}','withdrawals.read'),('{role}','payments.read'); INSERT INTO cms_user_roles(user_id,role_id) VALUES('{rid}','{role}');")
   r=await post(admin,'/api/cms/wallets/'+sid+'/adjust',{'amount_vnd':50000,'request_key':str(uuid.uuid4()),'note':'Số dư kiểm thử cô lập, không phải tiền thật.','confirmed':True});assert r.status==200
   await seller.goto(BASE+'/tai-khoan/rut-tien');await expect(seller.get_by_text('50.000đ',exact=True)).to_be_visible()
   await seller.locator('#withdraw-amount').fill('20000');await choose_bank(seller,'withdraw-bank','VCB');await seller.locator('#withdraw-number').fill('000123456789');await seller.locator('#withdraw-holder').fill('NGUOI DUNG THU NGHIEM');await seller.locator('#withdraw-password').fill(PASSWORD);await seller.locator('[name=confirmed]').check()
   await confirm(seller,'Kiểm tra và gửi yêu cầu rút');code=seller.url.rsplit('/',1)[-1];assert code.startswith('RUT')
   r=(await (await seller.request.get(BASE+'/api/account/withdrawals/'+code)).json())['withdrawal'];await expect(seller.locator('.finance-page-heading .finance-status')).to_have_text('Chờ duyệt')
   w=await (await seller.request.get(BASE+'/api/account/wallet')).json();assert w['balance_vnd']==30000 and w['held_vnd']==20000
   await admin.goto(BASE+'/quan-tri');await expect(admin.locator('[data-withdrawal-queue-count]')).to_have_text('1')
   await admin.goto(BASE+'/quan-tri/rut-tien/'+r['id'])
   await admin.locator('[data-confirm=withdrawal-approve] [name=confirmed]').check();await confirm(admin,'Duyệt và chờ chuyển khoản')
   await expect(admin.locator('.finance-page-heading .finance-status')).to_have_text('Đang chuyển khoản');assert await admin.locator('#payout-reference').count()==0
   await seller.reload();assert await seller.get_by_role('button',name='Hủy yêu cầu và hoàn khoản giữ').count()==0
   await confirm(admin,'Nhận xử lý chuyển khoản');await expect(admin.locator('#payout-reference')).to_be_visible()
   await check_qr(r)
   old=(await (await admin.request.get(BASE+'/api/cms/withdrawals/'+r['id'])).json())['withdrawal'];old_url=BASE+'/api/cms/withdrawals/'+r['id']+'/qr?version='+str(old['version'])
   released=await post(admin,'/api/cms/withdrawals/'+r['id']+'/claim',{'version':old['version'],'release':True,'not_transferred':True,'confirmed':True,'note':'Chưa chuyển tiền, kiểm tra QR hết hiệu lực.'});assert released.status==200
   await admin.evaluate('window.dispatchEvent(new Event("focus"))');await expect(admin.locator('[data-withdrawal-qr-content]')).to_be_hidden();await expect(admin.locator('[data-withdrawal-qr-error]')).to_be_visible();assert (await admin.request.get(old_url)).status==409
   await admin.reload();await confirm(admin,'Nhận xử lý chuyển khoản');await check_qr(r)
   # Read-only operator sees the reservation and processor but no write actions.
   await reader.goto(BASE+'/quan-tri/rut-tien/'+r['id']);assert await reader.locator('[data-finance-form]').count()==0;assert await reader.locator('[data-withdrawal-qr]').count()==0
   denied=await post(reader,'/api/cms/withdrawals/'+r['id']+'/pay',{});assert denied.status==403
   claimed=await create(5000);pending=await create(5000)
   await admin.goto(BASE+'/quan-tri/rut-tien/'+pending['id']);assert await admin.locator('[data-withdrawal-qr]').count()==0
   # Keep one approved/claimed request for screenshots of the full payout form.
   await admin.goto(BASE+'/quan-tri/rut-tien/'+claimed['id']);await admin.locator('[data-confirm=withdrawal-approve] [name=confirmed]').check();await confirm(admin,'Duyệt và chờ chuyển khoản');await confirm(admin,'Nhận xử lý chuyển khoản')
   await admin.goto(BASE+'/quan-tri/rut-tien/'+r['id']);await choose_bank(admin,'payout-bank','MB');await admin.locator('#payout-number').fill('000987654321');await admin.locator('#payout-reference').fill('LOCALOUT'+RUN[:12]);await admin.locator('[name=verified]').check();await confirm(admin,'Kiểm tra và xác nhận đã chuyển')
   await expect(admin.locator('.finance-page-heading .finance-status')).to_have_text('Đã chuyển');assert await admin.locator('[data-withdrawal-qr]').count()==0;assert (await admin.request.get(old_url)).status==409;await seller.goto(BASE+'/tai-khoan/rut-tien/'+code);await expect(seller.locator('.finance-page-heading .finance-status')).to_have_text('Đã chuyển')
   # Cancel and reject each return their own reserve, never the transferred amount.
   await seller.goto(BASE+'/tai-khoan/rut-tien/'+pending['code']);await confirm(seller,'Hủy yêu cầu và hoàn khoản giữ');await expect(seller.locator('.finance-page-heading .finance-status')).to_have_text('Đã hủy')
   rejected=await create(5000);await admin.goto(BASE+'/quan-tri/rut-tien/'+rejected['id']);await admin.locator('#reject-note').fill('Chưa chuyển tiền, kiểm thử từ chối có lý do.');await admin.locator('[name=not_transferred]').check();await admin.locator('[data-confirm=withdrawal-reject] [name=confirmed]').check();await confirm(admin,'Từ chối và hoàn khoản giữ')
   w=await (await seller.request.get(BASE+'/api/account/wallet')).json();assert w['balance_vnd']==25000 and w['held_vnd']==5000 and w['ledger']['total']==7
   pending=await create(5000)
   assert (await seller.goto(BASE+'/quan-tri/rut-tien')).status==403
   # Single bank control in CMS settings and customer forms, keyboard/accents/empty/invalid paths.
   await admin.goto(BASE+'/quan-tri/cau-hinh-thanh-toan');await choose_bank(admin,'bank-code','TPB','tienphong',keyboard=True);await expect(admin.locator('#bank-name')).to_have_value('TPBank')
   field=admin.locator('#bank-code-input');await field.fill('ngan hang khong ton tai');await expect(admin.locator('[data-bank-empty]')).to_be_visible();assert await admin.locator('#bank-code').input_value()=='';assert not await field.evaluate('e=>e.checkValidity()');await field.press('Escape');await expect(field).to_have_value('TPBank')
   await choose_bank(admin,'bank-code','STB','Sài Gòn Thương Tín');await expect(admin.locator('#bank-name')).to_have_value('Sacombank');await admin.locator('#bank-number').fill('000123456789');await admin.locator('#bank-holder').fill('KIEM THU FORM LOCAL');await admin.locator('[name=accepting_topups]').check();await confirm(admin,'Lưu cấu hình')
   await admin.locator('#bank-code-input').click();await admin.screenshot(path=str(OUT/'bank-dropdown-1440.png'));await admin.locator('#bank-code-input').press('Escape')
   # Shared PNG helper must retain the existing customer topup QR behavior.
   await asyncio.to_thread(sql,f"INSERT INTO seller_profiles(user_id,display_name,seller_type,phone,zalo_phone,status,change_token) VALUES('{sid}','Người đăng thử form','owner','0901234567','0901234567','approved','fixture');")
   topup=await post(seller,'/api/account/topups',{'amount_vnd':10000,'request_key':str(uuid.uuid4())});assert topup.status==201;topup=(await topup.json())['topup'];await seller.goto(BASE+'/tai-khoan/nap-tien/'+topup['code']);await expect(seller.locator('[data-topup-qr]')).to_be_visible()
   async with seller.expect_download() as downloaded:await seller.get_by_role('button',name='Lưu ảnh QR',exact=True).click()
   path=OUT/'topup-regression.png';await (await downloaded.value).save_as(str(path));await asyncio.to_thread(decode_png,path,'970403',topup['code'],10000)
   await seller.goto(BASE+'/tai-khoan/rut-tien');await choose_bank(seller,'withdraw-bank','TPB','Tiên Phong',keyboard=True);await choose_bank(seller,'withdraw-bank','STB','sai gon thuong tin')
   await reader.goto(BASE+'/quan-tri/cau-hinh-thanh-toan');await expect(reader.locator('#bank-code-input')).to_be_disabled();assert await reader.get_by_role('button',name='Lưu cấu hình',exact=False).count()==0
   # Native fallback remains a single usable bank select with JavaScript disabled.
   cookies=await ac.cookies();plain=await browser.new_context(java_script_enabled=False);await plain.add_cookies(cookies);fallback=await plain.new_page();await fallback.goto(BASE+'/quan-tri/cau-hinh-thanh-toan');await expect(fallback.locator('#bank-code')).to_be_visible();assert await fallback.get_by_role('combobox').count()==1;await expect(fallback.locator('#bank-code-input')).to_be_hidden();await plain.close()
   routes=[(seller,'/tai-khoan/rut-tien','seller-requests'),(seller,'/tai-khoan/rut-tien/'+code,'seller-paid'),(seller,'/tai-khoan/rut-tien/'+pending['code'],'seller-pending'),(seller,'/tai-khoan/so-du','seller-wallet'),(admin,'/quan-tri/rut-tien?status=all','cms-requests'),(admin,'/quan-tri/rut-tien/'+pending['id'],'cms-pending'),(admin,'/quan-tri/rut-tien/'+claimed['id'],'cms-processing'),(admin,'/quan-tri/rut-tien/'+r['id'],'cms-paid')]
   routes.append((admin,'/quan-tri/cau-hinh-thanh-toan','cms-settings'))
   checks=0
   for width in [320,390,768,1024,1280,1440,1920]:
    for page,path,name in routes:
     await page.set_viewport_size({'width':width,'height':900});response=await page.goto(BASE+path,wait_until='networkidle');assert response.status==200,(name,response.status)
     assert not await page.evaluate('document.documentElement.scrollWidth>innerWidth+1'),(name,width,'overflow');assert await page.locator('h1').count()==1;checks+=1
     if name=='cms-settings':
      heights=await page.locator('#bank-code-input,#bank-number').evaluate_all('nodes=>nodes.map(e=>e.getBoundingClientRect().height)');assert abs(heights[0]-heights[1])<1,(width,heights)
      assert await page.locator('[data-bank-picker] input:visible').count()==1;await page.locator('#bank-code-input').click();assert not await page.evaluate('document.documentElement.scrollWidth>innerWidth+1');await page.locator('#bank-code-input').press('Escape')
     if name=='cms-processing':await expect(page.locator('[data-withdrawal-qr]')).to_be_visible()
     if width in [390,768,1440] and name in ['seller-requests','cms-processing','cms-settings']:await page.screenshot(path=str(OUT/f'{name}-{width}.png'),full_page=True)
    print(f'Withdrawal browser {width}px: 9 screens OK',flush=True)
   assert not errors,errors
   (OUT/'results.json').write_text(json.dumps({'layout_checks':checks,'financial_flow':'passed','page_errors':errors},indent=2))
   print('Withdrawal browser: create/hold, approve/claim/manual payout, cancel/refund, reject/refund, permissions, notifications, searchable bank forms and 63 layouts: OK',flush=True)
  except Exception:
   for name,page in [('admin',admin),('seller',seller)]:
    try:await page.screenshot(path=str(OUT/('failure-'+name+'.png')),full_page=True)
    except Exception:pass
   raise
  finally:await browser.close()
try:asyncio.run(main())
finally:
 os.killpg(process.pid,signal.SIGTERM)
 try:process.wait(timeout=10)
 except subprocess.TimeoutExpired:os.killpg(process.pid,signal.SIGKILL);process.wait()
 LOG.close();shutil.rmtree(STATE);print('Disposed local withdrawal test database; no production transactions.',flush=True)
