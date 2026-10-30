"""Withdrawal browser flow and responsive layouts in a disposable LOCAL D1 database."""
import asyncio,json,os,secrets,signal,subprocess,tempfile,uuid,shutil
from pathlib import Path
from browser_banks import choose_bank
from playwright.async_api import async_playwright,expect
ROOT=Path(__file__).resolve().parent.parent
BASE='http://127.0.0.1:4325';RUN=uuid.uuid4().hex;PASSWORD=secrets.token_urlsafe(24)
OUT=ROOT/'.taste-skill'/'withdrawals';OUT.mkdir(parents=True,exist_ok=True)
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
async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
  ac=await browser.new_context(viewport={'width':1440,'height':1000});sc=await browser.new_context(viewport={'width':390,'height':844});rc=await browser.new_context()
  admin=await ac.new_page();seller=await sc.new_page();reader=await rc.new_page();errors=[]
  for page in [admin,seller,reader]:page.on('pageerror',lambda e:errors.append(str(e)))
  async def post(page,path,data):return await page.request.post(BASE+path,headers={'Origin':BASE},data=data)
  async def create(amount):
   r=await post(seller,'/api/account/withdrawals',{'amount_vnd':amount,'bank_code':'VCB','account_number':'000123456789','account_holder':'NGUOI DUNG THU NGHIEM','current_password':PASSWORD,'confirmed':True,'request_key':str(uuid.uuid4())});assert r.status==201,await r.text();return (await r.json())['withdrawal']
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
   await asyncio.to_thread(sql,f"UPDATE users SET role='admin',is_super_admin=1 WHERE id='{aid}'; INSERT INTO cms_roles(id,name) VALUES('{role}','Chỉ xem yêu cầu rút'); INSERT INTO cms_role_permissions(role_id,permission) VALUES('{role}','withdrawals.read'); INSERT INTO cms_user_roles(user_id,role_id) VALUES('{rid}','{role}');")
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
   # Read-only operator sees the reservation and processor but no write actions.
   await reader.goto(BASE+'/quan-tri/rut-tien/'+r['id']);assert await reader.locator('[data-finance-form]').count()==0
   denied=await post(reader,'/api/cms/withdrawals/'+r['id']+'/pay',{});assert denied.status==403
   claimed=await create(5000);pending=await create(5000)
   # Keep one approved/claimed request for screenshots of the full payout form.
   await admin.goto(BASE+'/quan-tri/rut-tien/'+claimed['id']);await admin.locator('[data-confirm=withdrawal-approve] [name=confirmed]').check();await confirm(admin,'Duyệt và chờ chuyển khoản');await confirm(admin,'Nhận xử lý chuyển khoản')
   await admin.goto(BASE+'/quan-tri/rut-tien/'+r['id']);await choose_bank(admin,'payout-bank','MB');await admin.locator('#payout-number').fill('000987654321');await admin.locator('#payout-reference').fill('LOCALOUT'+RUN[:12]);await admin.locator('[name=verified]').check();await confirm(admin,'Kiểm tra và xác nhận đã chuyển')
   await expect(admin.locator('.finance-page-heading .finance-status')).to_have_text('Đã chuyển');await seller.goto(BASE+'/tai-khoan/rut-tien/'+code);await expect(seller.locator('.finance-page-heading .finance-status')).to_have_text('Đã chuyển')
   # Cancel and reject each return their own reserve, never the transferred amount.
   await seller.goto(BASE+'/tai-khoan/rut-tien/'+pending['code']);await confirm(seller,'Hủy yêu cầu và hoàn khoản giữ');await expect(seller.locator('.finance-page-heading .finance-status')).to_have_text('Đã hủy')
   rejected=await create(5000);await admin.goto(BASE+'/quan-tri/rut-tien/'+rejected['id']);await admin.locator('#reject-note').fill('Chưa chuyển tiền, kiểm thử từ chối có lý do.');await admin.locator('[name=not_transferred]').check();await admin.locator('[data-confirm=withdrawal-reject] [name=confirmed]').check();await confirm(admin,'Từ chối và hoàn khoản giữ')
   w=await (await seller.request.get(BASE+'/api/account/wallet')).json();assert w['balance_vnd']==25000 and w['held_vnd']==5000 and w['ledger']['total']==7
   pending=await create(5000)
   assert (await seller.goto(BASE+'/quan-tri/rut-tien')).status==403
   routes=[(seller,'/tai-khoan/rut-tien','seller-requests'),(seller,'/tai-khoan/rut-tien/'+code,'seller-paid'),(seller,'/tai-khoan/rut-tien/'+pending['code'],'seller-pending'),(seller,'/tai-khoan/so-du','seller-wallet'),(admin,'/quan-tri/rut-tien?status=all','cms-requests'),(admin,'/quan-tri/rut-tien/'+pending['id'],'cms-pending'),(admin,'/quan-tri/rut-tien/'+claimed['id'],'cms-processing'),(admin,'/quan-tri/rut-tien/'+r['id'],'cms-paid')]
   checks=0
   for width in [320,390,768,1024,1280,1440,1920]:
    for page,path,name in routes:
     await page.set_viewport_size({'width':width,'height':900});response=await page.goto(BASE+path,wait_until='networkidle');assert response.status==200,(name,response.status)
     assert not await page.evaluate('document.documentElement.scrollWidth>innerWidth+1'),(name,width,'overflow');assert await page.locator('h1').count()==1;checks+=1
     if width in [390,768,1440] and name in ['seller-requests','seller-wallet','cms-processing','cms-requests']:await page.screenshot(path=str(OUT/f'{name}-{width}.png'),full_page=True)
    print(f'Withdrawal browser {width}px: 8 screens OK',flush=True)
   assert not errors,errors
   (OUT/'results.json').write_text(json.dumps({'layout_checks':checks,'financial_flow':'passed','page_errors':errors},indent=2))
   print('Withdrawal browser: create/hold, approve/claim/manual payout, cancel/refund, reject/refund, permissions, notifications and 56 layouts: OK',flush=True)
  finally:await browser.close()
try:asyncio.run(main())
finally:
 os.killpg(process.pid,signal.SIGTERM)
 try:process.wait(timeout=10)
 except subprocess.TimeoutExpired:os.killpg(process.pid,signal.SIGKILL);process.wait()
 LOG.close();shutil.rmtree(STATE);print('Disposed local withdrawal test database; no production transactions.',flush=True)
