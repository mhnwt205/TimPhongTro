"""Real browser CMS checks against isolated compiled preview on port 4322."""
import asyncio,json,secrets,subprocess,uuid
from pathlib import Path
from playwright.async_api import async_playwright,expect
ROOT=Path(__file__).resolve().parent.parent
BASE='http://127.0.0.1:4322'
RUN=uuid.uuid4().hex
EMAIL=f'cms-browser-{RUN}@example.test'
STAFF=f'cms-staff-{RUN}@example.test'
PASSWORD=secrets.token_urlsafe(24)
OUT=ROOT/'.taste-skill'/'cms'
OUT.mkdir(parents=True,exist_ok=True)
def sql(command):
 path=ROOT/'.cache'/f'cms-{RUN}.sql';path.parent.mkdir(exist_ok=True)
 path.write_text(command)
 try:
  r=subprocess.run(['node','scripts/run-tool.mjs','npm','exec','--workspace=@timphongtro/web','--','wrangler','d1','execute','DB','--local','--config',str(ROOT/'apps/web/dist/server/wrangler.json'),'--persist-to',str(ROOT/'apps/web/.wrangler/preview-state'),'--file',str(path)],cwd=ROOT,capture_output=True,text=True)
  if r.returncode:raise RuntimeError('Local CMS fixture SQL failed; no secret printed.')
 finally:path.unlink(missing_ok=True)
async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
  context=await browser.new_context(viewport={'width':1440,'height':1000});page=await context.new_page()
  await page.clock.install()
  errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  try:
   r=await page.request.post(BASE+'/api/auth/register',headers={'Origin':BASE},data={'name':'Quản trị kiểm thử','email':EMAIL,'password':PASSWORD});assert r.status==201
   await asyncio.to_thread(sql,"UPDATE users SET is_super_admin=1,role='admin' WHERE email='"+EMAIL+"';")
   await page.goto(BASE+'/quan-tri')
   await expect(page.get_by_role('heading',name='Quản trị website',exact=True)).to_be_visible()
   await expect(page.locator('[data-activity-chart]')).to_be_visible()
   await page.locator('.chart-day').first.focus()
   await expect(page.locator('[data-chart-insight] span')).to_have_text(await page.locator('.chart-day').first.get_attribute('data-chart-caption'))
   await page.locator('#dashboard-days').select_option('30')
   async with page.expect_navigation():await page.get_by_role('button',name='Cập nhật khoảng thời gian',exact=True).click()
   await expect(page.locator('.chart-day')).to_have_count(30)
   await page.get_by_role('link',name='Nội dung mới',exact=True).click()
   await expect(page.locator('[data-chart-metric=content]')).to_be_visible()
   await expect(page.locator('.chart-empty')).to_be_visible()
   await page.locator('[data-notification-root]>summary').click()
   await expect(page.locator('#cms-notification-panel')).to_be_visible()
   await page.keyboard.press('Escape');await expect(page.locator('#cms-notification-panel')).not_to_be_visible()
   # UI CRUD exercises real dialogs and HTTP, not direct DB writes.
   async def create(slug,fields,active=False):
    await page.goto(BASE+'/quan-tri/'+slug)
    await page.get_by_role('button',name='Tạo mới',exact=True).click()
    for name,value in fields.items():
     if name in ['room_type','owner_id','location_id']:await page.locator(f'#cms-editor [name={name}]').select_option(value)
     else:await page.locator(f'#cms-editor [name={name}]').fill(str(value))
    if active:await page.locator('#edit-active').select_option('1')
    async with page.expect_navigation():await page.get_by_role('button',name='Lưu thay đổi',exact=True).click()
    assert await page.locator('#cms-editor').is_hidden()
   title='Phòng thử CMS '+RUN[:6]
   await create('tin-phong',{'title':title,'price_vnd':3100000,'area_m2':24,'description':'Mô tả bản nháp từ trình duyệt.','location_id':'thu-duc','room_type':'room'})
   await expect(page.get_by_text(title,exact=True)).to_be_visible()
   await create('goi-dang-tin',{'name':'Gói thử '+RUN[:6],'price_vnd':8000,'duration_days':12},True)
   await create('khu-vuc',{'name':'Khu thử '+RUN[:6],'description':'Danh mục thử nghiệm.'},True)
   slug='cms-thu-'+RUN[:6]
   await create('noi-dung',{'title':'Hướng dẫn thử CMS','slug':slug,'body':'Nội dung thử <script>window.injected=true</script> để kiểm tra văn bản.'},True)
   r=await page.goto(BASE+'/thong-tin/'+slug);assert r.status==200;assert not await page.evaluate('window.injected===true')
   await page.goto(BASE+'/quan-tri/noi-dung')
   row=page.locator('tr').filter(has_text='Hướng dẫn thử CMS')
   await row.get_by_role('button',name='Sửa',exact=True).click()
   await page.locator('#edit-title').fill('Hướng dẫn đã sửa CMS')
   async with page.expect_navigation():await page.get_by_role('button',name='Lưu thay đổi',exact=True).click()
   row=page.locator('tr').filter(has_text='Hướng dẫn đã sửa CMS')
   await row.get_by_role('button',name='Xóa',exact=True).click();await page.locator('#action-note').fill('Chuyển bản thử vào thùng rác.')
   async with page.expect_navigation():await page.get_by_role('button',name='Xác nhận',exact=True).click()
   assert (await page.request.get(BASE+'/thong-tin/'+slug)).status==404
   await page.goto(BASE+'/quan-tri/noi-dung?state=deleted');await page.get_by_role('button',name='Khôi phục',exact=True).click();await page.locator('#action-note').fill('Khôi phục để kiểm tra.')
   async with page.expect_navigation():await page.get_by_role('button',name='Xác nhận',exact=True).click()
   await page.goto(BASE+'/quan-tri/noi-dung');await expect(page.get_by_text('Hướng dẫn đã sửa CMS',exact=True)).to_be_visible()
   assert (await page.request.get(BASE+'/thong-tin/'+slug)).status==404 # restored as unpublished
   await page.goto(BASE+'/quan-tri/vai-tro');await page.get_by_role('button',name='Tạo mới',exact=True).click();await page.locator('#edit-name').fill('Nhân viên xem thử '+RUN[:6]);await page.locator('#edit-description').fill('Chỉ xem danh mục gói.');await page.locator('input[name=permissions][value="plans.read"]').check()
   async with page.expect_navigation():await page.get_by_role('button',name='Lưu thay đổi',exact=True).click()
   await create('tai-khoan',{'name':'Nhân viên kiểm thử','email':STAFF,'password':PASSWORD})
   row=page.locator('tr').filter(has_text=STAFF);await row.get_by_role('button',name='Phân quyền',exact=True).click();await page.get_by_label('Nhân viên xem thử '+RUN[:6],exact=True).check()
   async with page.expect_navigation():await page.get_by_role('button',name='Lưu phân quyền',exact=True).click()
   staff=await browser.new_context();staffpage=await staff.new_page();await staffpage.goto(BASE+'/quan-tri/dang-nhap');await staffpage.get_by_label('Email',exact=True).fill(STAFF);await staffpage.get_by_label('Mật khẩu',exact=True).fill(PASSWORD)
   async with staffpage.expect_navigation():await staffpage.get_by_role('button',name='Đăng nhập CMS',exact=True).click()
   assert staffpage.url.endswith('/quan-tri');assert await staffpage.locator('.cms-sidebar a[href="/quan-tri/tai-khoan"]').count()==0
   assert (await staffpage.goto(BASE+'/quan-tri/tai-khoan')).status==403
   await staffpage.goto(BASE+'/quan-tri/goi-dang-tin');assert await staffpage.get_by_role('button',name='Tạo mới',exact=True).count()==0
   denied=await staffpage.request.post(BASE+'/api/cms/plans',headers={'Origin':BASE},data={});assert denied.status==403
   # A real submitted profile updates the bell; moderation clears the work count.
   await page.bring_to_front()
   submitted=await staffpage.request.post(BASE+'/api/account/profile',headers={'Origin':BASE},data={'version':0,'display_name':'Người đăng kiểm tra thông báo','seller_type':'owner','phone':'0901234567','zalo_phone':'','introduction':''});assert submitted.status==200
   async with page.expect_response(lambda r:r.url.endswith('/api/cms/notifications')):
    await page.clock.fast_forward(61000)
   await expect(page.locator('[data-notification-count]')).to_have_text('1')
   await page.goto(BASE+'/quan-tri')
   await expect(page.locator('[data-notification-count]')).to_have_text('1')
   await expect(page.locator('[data-seller-queue-count]')).to_have_text('1')
   await page.locator('[data-notification-root]>summary').click()
   await page.locator('[data-notification-queue] a').click()
   async with page.expect_navigation():await page.get_by_role('button',name='Duyệt quyền đăng',exact=True).click()
   await page.goto(BASE+'/quan-tri')
   await expect(page.locator('[data-notification-count]')).to_be_hidden()
   # Notification list is live, not a hard-coded unread counter.
   await page.set_viewport_size({'width':390,'height':844})
   await page.locator('[data-notification-root]>summary').click()
   await page.screenshot(path=str(OUT/'notifications-390.png'))
   assert not await page.evaluate('document.documentElement.scrollWidth>innerWidth+1')
   await page.keyboard.press('Escape')
   print('CMS charts: 7/30 days, series tabs, daily details and live notification queue: OK',flush=True)
   print('CMS UI: create/edit/trash/restore, plain-text publication, roles and restricted staff login: OK',flush=True)
   routes=['','tai-khoan','vai-tro','nguoi-dang','goi-dang-tin','khu-vuc','noi-dung','tin-phong','nhat-ky','bao-mat']
   checks=0
   for width in [320,390,768,1024,1280,1440,1920]:
    await page.set_viewport_size({'width':width,'height':900})
    for route in routes:
     response=await page.goto(BASE+'/quan-tri'+('/'+route if route else ''),wait_until='networkidle');assert response.status==200,(route,response.status)
     assert not await page.evaluate('document.documentElement.scrollWidth>innerWidth+1'),(route,width,'overflow')
     await expect(page.locator('h1')).to_be_visible();checks+=1
     if width in [390,768,1440] and route in ['','tai-khoan','vai-tro','tin-phong']:
      await page.screenshot(path=str(OUT/f'{route or "dashboard"}-{width}.png'),full_page=False)
    print(f'CMS responsive {width}px: 10 screens OK',flush=True)
   await page.set_viewport_size({'width':390,'height':844});await page.goto(BASE+'/quan-tri/vai-tro');await page.get_by_role('button',name='Tạo mới',exact=True).click();await page.screenshot(path=str(OUT/'role-dialog-390.png'));assert not await page.evaluate('document.documentElement.scrollWidth>innerWidth+1');await page.keyboard.press('Escape')
   assert not errors,errors
   (OUT/'results.json').write_text(json.dumps({'layout_checks':checks,'functional':'passed','page_errors':errors},indent=2))
  finally:await browser.close()
try:asyncio.run(main())
finally:
 # Exact local test fixtures and their dependent rows only.
 condition="IN (SELECT id FROM users WHERE email IN ('"+EMAIL+"','"+STAFF+"'))"
 asyncio.run(asyncio.to_thread(sql,f"DELETE FROM listing_drafts WHERE owner_id {condition}; DELETE FROM admin_audit WHERE actor_id {condition} OR target_id {condition}; DELETE FROM seller_reviews WHERE user_id {condition} OR reviewer_id {condition}; DELETE FROM seller_profiles WHERE user_id {condition}; DELETE FROM cms_user_roles WHERE user_id {condition}; DELETE FROM sessions WHERE user_id {condition}; DELETE FROM users WHERE email IN ('{EMAIL}','{STAFF}'); DELETE FROM cms_role_permissions WHERE role_id IN (SELECT id FROM cms_roles WHERE name='Nhân viên xem thử {RUN[:6]}'); DELETE FROM cms_roles WHERE name='Nhân viên xem thử {RUN[:6]}'; DELETE FROM listing_plans WHERE name='Gói thử {RUN[:6]}'; DELETE FROM locations WHERE name='Khu thử {RUN[:6]}'; DELETE FROM content_pages WHERE slug='cms-thu-{RUN[:6]}';"))
