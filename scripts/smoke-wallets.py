"""Financial browser tests use a disposable LOCAL database; no production money or account."""
import asyncio,json,os,secrets,signal,subprocess,tempfile,time,uuid,shutil
from pathlib import Path
from browser_banks import choose_bank
from playwright.async_api import async_playwright,expect
ROOT=Path(__file__).resolve().parent.parent
BASE='http://127.0.0.1:4324'
RUN=uuid.uuid4().hex
PASSWORD=secrets.token_urlsafe(24)
OUT=ROOT/'.taste-skill'/'wallets';OUT.mkdir(parents=True,exist_ok=True)
STATE=Path(tempfile.mkdtemp(prefix='finance-browser-',dir=ROOT/'.cache'))
EMAILS=[f'finance-{kind}-{RUN}@example.test' for kind in ['admin','seller','reader']]
LOG=(STATE/'preview.log').open('w')
process=subprocess.Popen(['node','scripts/run-tool.mjs','node','scripts/preview.mjs','--state',str(STATE/'state'),'--port','4324'],cwd=ROOT,stdout=LOG,stderr=LOG,start_new_session=True)
def sql(statement):
 path=STATE/'fixture.sql';path.write_text(statement)
 try:
  result=subprocess.run(['node','scripts/run-tool.mjs','npm','exec','--workspace=@timphongtro/web','--','wrangler','d1','execute','DB','--local','--config',str(ROOT/'apps/web/dist/server/wrangler.json'),'--persist-to',str(STATE/'state'),'--file',str(path)],cwd=ROOT,capture_output=True,text=True)
  if result.returncode:raise RuntimeError('Local financial fixture command failed.')
 finally:path.unlink(missing_ok=True)
async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
  adminctx=await browser.new_context(viewport={'width':1440,'height':1000});sellerctx=await browser.new_context(viewport={'width':390,'height':844})
  admin=await adminctx.new_page();seller=await sellerctx.new_page();errors=[]
  admin.on('pageerror',lambda e:errors.append(str(e)));seller.on('pageerror',lambda e:errors.append(str(e)))
  try:
   for _ in range(120):
    try:
     ready=await admin.request.get(BASE+'/api/health',timeout=1000)
     if ready.status==200:break
    except Exception:pass
    await asyncio.sleep(.5)
   else:raise RuntimeError('Financial preview did not become ready.')
   for page,email,name in [(admin,EMAILS[0],'Quản trị đối soát thử'),(seller,EMAILS[1],'Chủ trọ kiểm thử số dư')]:
    r=await page.request.post(BASE+'/api/auth/register',headers={'Origin':BASE},data={'name':name,'email':email,'password':PASSWORD});assert r.status==201
   await asyncio.to_thread(sql,"UPDATE users SET role='admin',is_super_admin=1 WHERE email='"+EMAILS[0]+"';")
   r=await seller.request.post(BASE+'/api/account/profile',headers={'Origin':BASE},data={'version':0,'display_name':'Chủ trọ kiểm thử số dư','seller_type':'owner','phone':'0901234567','zalo_phone':'','introduction':''});assert r.status==200
   me=await (await seller.request.get(BASE+'/api/auth/me')).json();sellerid=me['user']['id']
   r=await admin.request.post(BASE+'/api/admin/sellers/'+sellerid+'/review',headers={'Origin':BASE},data={'version':1,'decision':'approved','note':''});assert r.status==200
   await seller.goto(BASE+'/tai-khoan/nap-tien');await expect(seller.get_by_text('Chưa mở nạp tiền',exact=True)).to_be_visible();assert await seller.get_by_role('button',name='Tạo mã và xem hướng dẫn').count()==0
   r=await seller.request.post(BASE+'/api/account/topups',headers={'Origin':BASE},data={'amount_vnd':50000,'request_key':str(uuid.uuid4())});assert r.status==503
   await admin.goto(BASE+'/quan-tri/cau-hinh-thanh-toan')
   await expect(admin.get_by_text('Đang tắt tạo yêu cầu nạp',exact=True)).to_be_visible()
   await admin.screenshot(path=str(OUT/'settings-disabled-1440.png'))
   await choose_bank(admin,'bank-code','VCB');await expect(admin.locator('#bank-name')).to_have_value('Vietcombank')
   await admin.locator('#bank-number').fill('000123456789');await admin.locator('#bank-holder').fill('TAI KHOAN KIEM THU LOCAL');await admin.locator('[name=accepting_topups]').check()
   await admin.get_by_role('button',name='Lưu cấu hình',exact=True).click();await expect(admin.locator('#finance-confirm')).to_be_visible()
   async with admin.expect_navigation():await admin.get_by_role('button',name='Xác nhận thực hiện',exact=True).click()
   await expect(admin.get_by_text('Đang mở tạo yêu cầu nạp',exact=True)).to_be_visible()
   await seller.goto(BASE+'/tai-khoan/nap-tien');await seller.get_by_role('button',name='50.000đ',exact=True).click();await expect(seller.locator('#topup-amount')).to_have_value('50000')
   async with seller.expect_navigation():await seller.get_by_role('button',name='Tạo mã và xem hướng dẫn',exact=True).click()
   code=seller.url.rsplit('/',1)[-1];assert code.startswith('NAP') and len(code)==15
   detail=await (await seller.request.get(BASE+'/api/account/topups/'+code)).json();topupid=detail['topup']['id'];bankid=detail['topup']['bank_account_id']
   await seller.get_by_role('button',name='Đã chuyển khoản',exact=True).click()
   async with seller.expect_navigation():await seller.get_by_role('button',name='Xác nhận thực hiện',exact=True).click()
   await expect(seller.locator('.finance-page-heading .finance-status')).to_have_text('Chờ đối soát')
   data=await (await seller.request.get(BASE+'/api/account/wallet')).json();assert data['balance_vnd']==0
   await admin.goto(BASE+'/quan-tri');await expect(admin.locator('[data-topup-queue-count]')).to_have_text('1');await expect(admin.locator('[data-seller-queue-count]')).to_be_hidden()
   await admin.goto(BASE+'/quan-tri/nap-tien');await expect(admin.get_by_text(code,exact=True)).to_be_visible();await admin.get_by_role('link',name='Xem yêu cầu',exact=True).click()
   ref='LOCAL'+RUN[:12];await admin.locator('#bank-reference').fill(ref);await admin.locator('[name=verified]').check();await admin.get_by_role('button',name='Kiểm tra và xác nhận cộng số dư',exact=True).click()
   await expect(admin.locator('[data-finance-confirm-text]')).to_contain_text('50.000đ')
   async with admin.expect_navigation():await admin.get_by_role('button',name='Xác nhận thực hiện',exact=True).click()
   await expect(admin.locator('.finance-page-heading .finance-status')).to_have_text('Đã ghi nhận')
   await seller.goto(BASE+'/tai-khoan/so-du');await expect(seller.locator('.finance-balance>strong')).to_have_text('50.000đ');await expect(seller.locator('.finance-table tbody tr')).to_have_count(1)
   r=await admin.request.post(BASE+'/api/cms/topups/'+topupid+'/reconcile',headers={'Origin':BASE},data={'version':2,'actual_vnd':50000,'bank_account_id':bankid,'bank_reference':ref,'verified':True});assert r.status==200
   await admin.goto(BASE+'/quan-tri/so-du/'+sellerid);await admin.locator('#adjustment-amount').fill('-10000');await admin.locator('#adjustment-note').fill('Điều chỉnh sai sót kiểm thử có căn cứ.');await admin.locator('[name=confirmed]').check();await admin.get_by_role('button',name='Kiểm tra điều chỉnh',exact=True).click()
   async with admin.expect_navigation():await admin.get_by_role('button',name='Xác nhận thực hiện',exact=True).click()
   await expect(admin.locator('.finance-balance>strong')).to_have_text('40.000đ');await expect(admin.locator('.finance-table tbody tr')).to_have_count(2)
   # Second request: a duplicate bank reference is rejected visibly; mismatch needs exception handling.
   r=await seller.request.post(BASE+'/api/account/topups',headers={'Origin':BASE},data={'amount_vnd':10000,'request_key':str(uuid.uuid4())});assert r.status==201
   second=(await r.json())['topup'];await admin.goto(BASE+'/quan-tri/nap-tien/'+second['id']);await admin.locator('#bank-reference').fill(ref);await admin.locator('[name=verified]').check();await admin.get_by_role('button',name='Kiểm tra và xác nhận cộng số dư',exact=True).click();await admin.get_by_role('button',name='Xác nhận thực hiện',exact=True).click()
   await expect(admin.locator('[data-endpoint$="/reconcile"] [data-finance-error]')).to_contain_text('đã được ghi nhận')
   await admin.locator('#bank-reference').fill('EXCEPTION'+RUN[:12]);await admin.locator('#actual-vnd').fill('7000');await admin.get_by_role('button',name='Kiểm tra và xác nhận cộng số dư',exact=True).click();await admin.get_by_role('button',name='Xác nhận thực hiện',exact=True).click()
   await expect(admin.locator('[data-endpoint$="/reconcile"] [data-finance-error]')).to_contain_text('ngoại lệ')
   await admin.locator('[name=exception_confirmed]').check();await admin.locator('#receipt-note').fill('Đã đối chiếu, nhận thiếu 3.000đ so với yêu cầu.');await admin.get_by_role('button',name='Kiểm tra và xác nhận cộng số dư',exact=True).click()
   async with admin.expect_navigation():await admin.get_by_role('button',name='Xác nhận thực hiện',exact=True).click()
   data=await (await seller.request.get(BASE+'/api/account/wallet')).json();assert data['balance_vnd']==47000;assert data['ledger']['total']==3
   # A read-only finance operator can inspect, not reconcile or adjust.
   readerctx=await browser.new_context();reader=await readerctx.new_page();r=await reader.request.post(BASE+'/api/auth/register',headers={'Origin':BASE},data={'name':'Nhân viên chỉ xem tài chính','email':EMAILS[2],'password':PASSWORD});assert r.status==201
   readerid=(await r.json())['user']['id'];roleid=str(uuid.uuid4())
   await asyncio.to_thread(sql,f"INSERT INTO cms_roles(id,name) VALUES('{roleid}','Quyền xem tài chính thử'); INSERT INTO cms_role_permissions(role_id,permission) VALUES('{roleid}','topups.read'),('{roleid}','wallets.read'),('{roleid}','payments.read'); INSERT INTO cms_user_roles(user_id,role_id) VALUES('{readerid}','{roleid}');")
   await reader.goto(BASE+'/quan-tri/nap-tien/'+topupid);assert await reader.get_by_role('button',name='Kiểm tra và xác nhận cộng số dư').count()==0
   await reader.goto(BASE+'/quan-tri/so-du/'+sellerid);assert await reader.locator('#adjustment-amount').count()==0
   await reader.goto(BASE+'/quan-tri/cau-hinh-thanh-toan');assert await reader.get_by_role('button',name='Lưu cấu hình').count()==0;await expect(reader.locator('#bank-number')).to_be_disabled()
   r=await reader.request.post(BASE+'/api/cms/wallets/'+sellerid+'/adjust',headers={'Origin':BASE},data={});assert r.status==403
   assert (await seller.goto(BASE+'/quan-tri/nap-tien')).status==403
   # Turn local receipts off again. Actual deployment also starts disabled and has no bank.
   await admin.goto(BASE+'/quan-tri/cau-hinh-thanh-toan');await admin.locator('[name=accepting_topups]').uncheck()
   async with admin.expect_navigation():await admin.get_by_role('button',name='Lưu cấu hình',exact=True).click()
   await expect(admin.get_by_text('Đang tắt tạo yêu cầu nạp',exact=True)).to_be_visible()
   routes=[(seller,'/tai-khoan/so-du','seller-wallet'),(seller,'/tai-khoan/nap-tien','seller-topups'),(seller,'/tai-khoan/nap-tien/'+code,'seller-detail'),(admin,'/quan-tri/nap-tien?status=all','cms-topups'),(admin,'/quan-tri/nap-tien/'+topupid,'cms-detail'),(admin,'/quan-tri/so-du','cms-wallets'),(admin,'/quan-tri/so-du/'+sellerid,'cms-ledger'),(admin,'/quan-tri/cau-hinh-thanh-toan','cms-settings')]
   checks=0
   for width in [320,390,768,1024,1280,1440,1920]:
    for page,path,name in routes:
     await page.set_viewport_size({'width':width,'height':900});r=await page.goto(BASE+path,wait_until='networkidle');assert r.status==200,(name,r.status)
     if await page.evaluate('document.documentElement.scrollWidth>innerWidth+1'):
      await page.screenshot(path=str(OUT/f'overflow-{name}-{width}.png'),full_page=False)
      offenders=await page.evaluate("[...document.querySelectorAll('body *')].filter(e=>e.getBoundingClientRect().right>innerWidth+1).slice(0,8).map(e=>({tag:e.tagName,cls:e.className,width:e.getBoundingClientRect().width}))")
      raise AssertionError((name,width,'overflow',offenders))
     assert await page.locator('h1').count()==1;checks+=1
     if width in [390,768,1440] and name in ['seller-wallet','seller-topups','cms-detail','cms-ledger','cms-settings']:await page.screenshot(path=str(OUT/f'{name}-{width}.png'),full_page=False)
    print(f'Finance browser {width}px: 8 screens OK',flush=True)
   assert not errors,errors
   (OUT/'results.json').write_text(json.dumps({'layout_checks':checks,'financial_flow':'passed','page_errors':errors},indent=2))
   print('Finance browser: disabled creation, local bank setup, report/reconcile, duplicate receipt, mismatch, adjustment, role boundaries and 56 layouts: OK',flush=True)
  finally:await browser.close()
try:asyncio.run(main())
finally:
 os.killpg(process.pid,signal.SIGTERM)
 try:process.wait(timeout=10)
 except subprocess.TimeoutExpired:os.killpg(process.pid,signal.SIGKILL);process.wait()
 LOG.close();shutil.rmtree(STATE)
 print('Disposed isolated finance test database; production was not used.',flush=True)
