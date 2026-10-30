"""CMS navigation and layout regression checks. Disposable LOCAL D1; no production data."""
import asyncio,json,os,secrets,signal,subprocess,tempfile,uuid,shutil
from pathlib import Path
from playwright.async_api import async_playwright,expect
ROOT=Path(__file__).resolve().parent.parent
BASE='http://127.0.0.1:4326';RUN=uuid.uuid4().hex;PASSWORD=secrets.token_urlsafe(24)
OUT=ROOT/'.taste-skill'/'cms-layout';OUT.mkdir(parents=True,exist_ok=True)
STATE=Path(tempfile.mkdtemp(prefix='cms-layout-',dir=ROOT/'.cache'));LOG=(STATE/'preview.log').open('w')
process=subprocess.Popen(['node','scripts/run-tool.mjs','node','scripts/preview.mjs','--state',str(STATE/'state'),'--port','4326'],cwd=ROOT,stdout=LOG,stderr=LOG,start_new_session=True)
def sql(statement):
 path=STATE/'fixture.sql';path.write_text(statement)
 try:
  r=subprocess.run(['node','scripts/run-tool.mjs','npm','exec','--workspace=@timphongtro/web','--','wrangler','d1','execute','DB','--local','--config',str(ROOT/'apps/web/dist/server/wrangler.json'),'--persist-to',str(STATE/'state'),'--file',str(path)],cwd=ROOT,capture_output=True,text=True)
  if r.returncode:raise RuntimeError('Isolated CMS layout fixture failed: '+r.stderr[-1200:]+r.stdout[-800:])
 finally:path.unlink(missing_ok=True)
async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
  context=await browser.new_context(viewport={'width':1440,'height':760});page=await context.new_page();errors=[]
  page.on('pageerror',lambda e:errors.append(str(e)))
  async def post(path,body,target=page):
   r=await target.request.post(BASE+path,headers={'Origin':BASE},data=body)
   assert r.status in [200,201],(path,r.status,await r.text());return await r.json()
  try:
   for _ in range(120):
    try:
     r=await page.request.get(BASE+'/api/health',timeout=1000)
     if r.status==200:break
    except Exception:pass
    await asyncio.sleep(.5)
   else:raise RuntimeError('CMS layout preview not ready.')
   admin=(await post('/api/auth/register',{'name':'Quản trị kiểm tra giao diện','email':f'layout-admin-{RUN}@example.test','password':PASSWORD}))['user']
   sellerctx=await browser.new_context();seller=await sellerctx.new_page()
   owner=(await post('/api/auth/register',{'name':'Chủ trọ quản lý phòng và căn hộ mini tại khu vực Thành phố Hồ Chí Minh','email':f'layout-owner-{RUN}@example.test','password':PASSWORD},seller))['user']
   readerctx=await browser.new_context(viewport={'width':1440,'height':760});reader=await readerctx.new_page()
   staff=(await post('/api/auth/register',{'name':'Nhân viên chỉ xem danh mục','email':f'layout-reader-{RUN}@example.test','password':PASSWORD},reader))['user']
   fixture=[f"UPDATE users SET role='admin',is_super_admin=1 WHERE id='{admin['id']}';",
    f"INSERT INTO seller_profiles(user_id,display_name,seller_type,phone,zalo_phone,status,change_token) VALUES('{owner['id']}','Chủ trọ thử giao diện','owner','0901234567','0901234567','approved','fixture');",
    f"INSERT INTO cms_roles(id,name,description) VALUES('layout-reader','Nhân viên chỉ xem bố cục','Không có quyền ghi'); INSERT INTO cms_role_permissions(role_id,permission) VALUES('layout-reader','plans.read'),('layout-reader','roles.read'); INSERT INTO cms_user_roles(user_id,role_id) VALUES('{staff['id']}','layout-reader');",
    "INSERT INTO cms_roles(id,name,description) VALUES('layout-long-role','Nhân viên quản lý và kiểm duyệt tin phòng tại Thành phố Hồ Chí Minh','Mô tả vai trò dài để kiểm tra các hàng có nội dung không đồng đều.');",
    "INSERT INTO cms_role_permissions(role_id,permission) VALUES('layout-long-role','users.read'),('layout-long-role','sellers.read'),('layout-long-role','listings.read');"]
   for i in range(22):fixture.append(f"INSERT INTO users(id,email,name,password_hash) SELECT '{uuid.uuid4()}','layout-long-contact-{i:02}-{RUN}@example.test','Người đăng quản lý nhiều phòng và căn hộ mini tại Thành phố Hồ Chí Minh {i:02}',password_hash FROM users WHERE id='{admin['id']}';")
   fixture.extend(["INSERT INTO listing_plans(id,name,price_vnd,duration_days,is_active) VALUES('layout-long-plan','Gói đăng phòng dành cho chủ trọ và môi giới tại Thành phố Hồ Chí Minh',10000,30,0);",
    "INSERT INTO content_pages(id,slug,title,body,is_active) VALUES('layout-content','huong-dan-kiem-tra-bo-cuc-voi-duong-dan-dai','Hướng dẫn người đăng quản lý thông tin và cập nhật tình trạng phòng đang cho thuê','Nội dung minh họa kiểm tra căn lề, xuống dòng và hộp thoại.',1);",
    f"INSERT INTO listing_drafts(id,title,owner_id,location_id,room_type,price_vnd,area_m2,description) VALUES('layout-draft','Phòng trọ có ban công và khu vực bếp riêng gần trường đại học tại Thành phố Hồ Chí Minh','{owner['id']}','thu-duc','room',3500000,25,'Thông tin dài để kiểm tra bố cục bảng và nội dung chi tiết.');"])
   await asyncio.to_thread(sql,'\n'.join(fixture))
   await post('/api/cms/wallets/'+owner['id']+'/adjust',{'amount_vnd':100000,'request_key':str(uuid.uuid4()),'note':'Số dư kiểm thử bố cục trong D1 local dùng một lần.','confirmed':True})
   config=(await (await page.request.get(BASE+'/api/cms/payments')).json())['settings']
   await post('/api/cms/payments',{'version':config['version'],'accepting_topups':True,'bank_code':'VCB','account_number':'000123456789','account_holder':'KIEM THU LOCAL'})
   topup=(await post('/api/account/topups',{'amount_vnd':50000,'request_key':str(uuid.uuid4())},seller))['topup']
   await post('/api/account/topups/'+topup['code']+'/report',{'version':topup['version'],'note':'Đã chuyển khoản kiểm thử bố cục.'},seller)
   withdrawal=(await post('/api/account/withdrawals',{'amount_vnd':10000,'bank_code':'VCB','account_number':'000123456789','account_holder':'NGUOI DUNG THU NGHIEM','confirmed':True,'current_password':PASSWORD,'request_key':str(uuid.uuid4())},seller))['withdrawal']
   await post('/api/cms/withdrawals/'+withdrawal['id']+'/review',{'version':withdrawal['version'],'action':'approved','confirmed':True})
   await post('/api/cms/withdrawals/'+withdrawal['id']+'/claim',{'version':2,'confirmed':True})
   await page.goto(BASE+'/quan-tri/vai-tro');await page.evaluate('document.fonts.ready')
   # The bug occurs in the menu's own scroll container, not the document.
   nav=page.locator('[data-cms-sidebar-scroll]')
   for height in [900,700,540]:
    await page.set_viewport_size({'width':1440,'height':height});await page.goto(BASE+'/quan-tri/vai-tro')
    await nav.evaluate('(e)=>{e.scrollTop=e.scrollHeight;}');await page.wait_for_timeout(120)
    expected=await nav.evaluate('e=>e.scrollTop');assert expected>0
    await nav.locator('a[href="/quan-tri/so-du"]').click();await page.wait_for_url('**/quan-tri/so-du')
    await expect(nav).to_have_js_property('scrollTop',expected)
    assert await page.evaluate('window.scrollY')==0
    await page.reload();await expect(nav).to_have_js_property('scrollTop',expected)
    await page.go_back();await expect(nav).to_have_js_property('scrollTop',expected)
    print(f'CMS sidebar {height}px height: navigation/reload/back retains {expected}px',flush=True)
   await page.set_viewport_size({'width':1440,'height':760});await page.goto(BASE+'/quan-tri/nap-tien/'+topup['id'])
   assert await nav.locator('[aria-current=page]').get_attribute('href')=='/quan-tri/nap-tien'
   await page.goto(BASE+'/quan-tri/rut-tien/'+withdrawal['id']);assert await nav.locator('[aria-current=page]').get_attribute('href')=='/quan-tri/rut-tien'
   # Responsive mobile menu does not overwrite the desktop position.
   expected=await nav.evaluate('e=>e.scrollTop');await page.set_viewport_size({'width':390,'height':844});await page.goto(BASE+'/quan-tri/khu-vuc')
   await page.locator('.cms-mobile-nav>summary').click();await expect(page.locator('.cms-mobile-nav a[aria-current=page]')).to_have_text('Khu vực')
   await page.set_viewport_size({'width':1440,'height':760});await expect(nav).to_have_js_property('scrollTop',expected)
   # No scroll storage is required to use the CMS.
   blocked=await browser.new_context(viewport={'width':1440,'height':760});await blocked.add_cookies(await context.cookies());await blocked.add_init_script("Storage.prototype.getItem=()=>{throw new Error('blocked')};Storage.prototype.setItem=()=>{throw new Error('blocked')}")
   blockedpage=await blocked.new_page();blockedpage.on('pageerror',lambda e:errors.append(str(e)))
   await blockedpage.goto(BASE+'/quan-tri/rut-tien/'+withdrawal['id']);await expect(blockedpage.locator('[data-cms-sidebar-scroll] [aria-current=page]')).to_be_in_viewport();await blocked.close()
   # Real editor opens, changes only the local fixture, and preserves the menu.
   await page.goto(BASE+'/quan-tri/vai-tro');await nav.evaluate('e=>{e.scrollTop=e.scrollHeight;}');await page.wait_for_timeout(100);expected=await nav.evaluate('e=>e.scrollTop')
   await page.locator('tr').filter(has_text='layout-long-role').get_by_role('button',name='Sửa',exact=True).click();await page.locator('#edit-description').fill('Đã sửa mô tả để kiểm tra bố cục và vị trí menu sau khi lưu.')
   async with page.expect_navigation():await page.get_by_role('button',name='Lưu thay đổi',exact=True).click()
   await expect(nav).to_have_js_property('scrollTop',expected)
   # Status and actions sit side by side when space allows, then stack on a shared edge.
   for route in ['tai-khoan','vai-tro','goi-dang-tin','khu-vuc','noi-dung','tin-phong/danh-sach']:
    await page.goto(BASE+'/quan-tri/'+route)
    layouts=await page.locator('.cms-record-state:has(.cms-row-actions button)').evaluate_all("nodes=>nodes.map(e=>{const badge=e.querySelector('.cms-badge').getBoundingClientRect(),action=e.querySelector('.cms-row-actions button').getBoundingClientRect();return{sameRow:badge.bottom>action.top+1&&action.bottom>badge.top+1,sharedLeft:Math.abs(badge.left-action.left)<1,afterBadge:action.left>=badge.right-1}})")
    assert layouts and all((row['afterBadge'] if row['sameRow'] else row['sharedLeft']) for row in layouts),(route,layouts)
   routes=['','tai-khoan','tai-khoan?page=2','vai-tro','goi-dang-tin','khu-vuc','noi-dung','tin-phong','nhat-ky','nguoi-dang?status=all','nap-tien','nap-tien/'+topup['id'],'so-du','so-du/'+owner['id'],'cau-hinh-thanh-toan','rut-tien','rut-tien/'+withdrawal['id'],'bao-mat']
   checks=0
   for width in [320,390,640,641,700,768,900,901,1024,1100,1200,1201,1280,1440,1920]:
    await page.set_viewport_size({'width':width,'height':900})
    for route in routes:
     r=await page.goto(BASE+'/quan-tri'+('/'+route if route else ''),wait_until='networkidle');assert r.status==200,(route,r.status)
     assert not await page.evaluate('document.documentElement.scrollWidth>innerWidth+1'),(route,width,'overflow')
     assert await page.locator('h1').count()==1
     control_issues=await page.evaluate("""()=>[...document.querySelectorAll('.cms-content .field input:not([type=hidden]):not([type=checkbox]):not([type=radio]),.cms-content .field select,.cms-content .field textarea,.cms-filters input,.cms-filters select,.filter select')].filter(e=>e.getClientRects().length).map(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e),mobile=innerWidth<=640;return{tag:e.tagName,name:e.getAttribute('name'),left:r.left,right:r.right,width:r.width,height:r.height,fontSize:s.fontSize,mobile}}).filter(x=>x.left < -1||x.right>innerWidth+1||x.width<100||(x.mobile&&parseFloat(x.fontSize)<15.9)||(x.tag!=='TEXTAREA'&&(x.height<39||x.height>48)))""")
     assert not control_issues,(route,width,'control geometry',control_issues)
     for table in await page.locator('.cms-table').all():
      assert not await table.evaluate('e=>e.getBoundingClientRect().right>innerWidth+1'),(route,width,'table outside')
     if width>900:
      sidebar=page.locator('.cms-sidebar');assert await sidebar.evaluate('e=>e.getBoundingClientRect().bottom<=innerHeight+1')
     if width in [320,390,768,1024,1440] and route in ['vai-tro','tai-khoan','goi-dang-tin','rut-tien','so-du/'+owner['id']]:await page.screenshot(path=str(OUT/f'{route.split("/")[0]}-{width}.png'),full_page=False)
     checks+=1
    print(f'CMS layout {width}px: {len(routes)} screens OK',flush=True)
   # Dialogs and expanded details, including longer roles, on narrow and desktop viewports.
   for width in [320,768,1440]:
    await page.set_viewport_size({'width':width,'height':700})
    for route in ['tai-khoan','vai-tro','noi-dung','tin-phong/danh-sach']:
     await page.goto(BASE+'/quan-tri/'+route);await page.get_by_role('button',name='Tạo mới',exact=True).click();await expect(page.locator('#cms-editor')).to_be_visible()
     assert not await page.locator('#cms-editor').evaluate('e=>e.scrollWidth>e.clientWidth+1'),(route,width,'dialog overflow')
     modal_issues=await page.locator('#cms-editor').evaluate("""d=>{const box=d.getBoundingClientRect(),mobile=innerWidth<=640;return[...d.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio]),select,textarea')].filter(e=>e.getClientRects().length).map(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return{tag:e.tagName,name:e.getAttribute('name'),left:r.left,right:r.right,width:r.width,height:r.height,fontSize:s.fontSize}}).filter(x=>x.left<box.left-1||x.right>box.right+1||x.width<100||(mobile&&parseFloat(x.fontSize)<15.9)||(x.tag!=='TEXTAREA'&&(x.height<39||x.height>48))) }""")
     assert not modal_issues,(route,width,'modal controls',modal_issues)
     if route=='tai-khoan':await page.screenshot(path=str(OUT/f'create-user-{width}.png'),full_page=False)
     await page.keyboard.press('Escape')
   await page.set_viewport_size({'width':1440,'height':760});await page.goto(BASE+'/quan-tri/vai-tro');await page.locator('.cms-record-detail').first.locator('summary').click()
   await page.screenshot(path=str(OUT/'roles-expanded-1440.png'))
   await reader.goto(BASE+'/quan-tri/goi-dang-tin');assert await reader.locator('[data-cms-edit]').count()==0;assert await reader.locator('.cms-sidebar a[href="/quan-tri/tai-khoan"]').count()==0
   await page.locator('[data-notification-root]>summary').click();await expect(page.locator('#cms-notification-panel')).to_be_visible();await page.keyboard.press('Escape')
   assert not errors,errors
   (OUT/'results.json').write_text(json.dumps({'layout_checks':checks,'dialog_checks':12,'sidebar_heights':[900,700,540],'navigation_reload_back_edit':'passed','status_alignment':'passed','responsive_controls':'passed','nested_active':'passed','page_errors':errors},indent=2))
   print('CMS: menu persistence, responsive control geometry, tables/dialogs and readonly staff: OK',flush=True)
  finally:await browser.close()
try:asyncio.run(main())
finally:
 os.killpg(process.pid,signal.SIGTERM)
 try:process.wait(timeout=10)
 except subprocess.TimeoutExpired:os.killpg(process.pid,signal.SIGKILL);process.wait()
 LOG.close();shutil.rmtree(STATE);print('Disposed isolated CMS layout database; no production mutations.',flush=True)
