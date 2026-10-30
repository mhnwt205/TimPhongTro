import asyncio,json,os,secrets,shutil,signal,subprocess,tempfile,uuid
from pathlib import Path
from playwright.async_api import async_playwright,expect
ROOT=Path(__file__).resolve().parent.parent;STATE=Path(tempfile.mkdtemp(prefix='direct-address-',dir=ROOT/'.cache'));OUT=ROOT/'.taste-skill'/'direct-address';OUT.mkdir(parents=True,exist_ok=True);LOG=(STATE/'preview.log').open('w');BASE='http://127.0.0.1:4336'
process=subprocess.Popen(['node','scripts/run-tool.mjs','node','scripts/preview.mjs','--state',str(STATE/'state'),'--port','4336'],cwd=ROOT,stdout=LOG,stderr=LOG,start_new_session=True)
async def main():
 async with async_playwright() as p:
  b=await p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox']);ctx=await b.new_context();await ctx.route('https://maps.google.com/**',lambda route:route.fulfill(status=200,content_type='text/html',body='<html>Map test</html>'));page=await ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  try:
   for _ in range(100):
    try:
     if (await page.request.get(BASE+'/api/health',timeout=1000)).status==200:break
    except Exception:pass
    await asyncio.sleep(.5)
   r=await page.request.post(BASE+'/api/auth/register',headers={'Origin':BASE},data={'name':'Người thử địa chỉ','email':str(uuid.uuid4())+'@example.test','password':secrets.token_urlsafe(24)});assert r.status==201
   await page.goto(BASE+'/tai-khoan/tin-dang/moi');assert await page.locator('[name=street]').count()==1;assert await page.locator('[data-map-editor] input[type=number]').count()==0;assert 'Vĩ độ' not in await page.locator('[data-map-editor]').inner_text();assert 'Kinh độ' not in await page.locator('[data-map-editor]').inner_text();await expect(page.locator('#map-link')).to_be_hidden()
   await page.locator('#listing-title').fill('Phòng thử địa chỉ nhập trực tiếp');await page.locator('#listing-location').select_option('binh-thanh');await page.locator('#listing-price').fill('3000000');await page.locator('#listing-size').fill('25');await page.locator('#listing-plan').select_option('basic-7d');await page.locator('#listing-street').fill('123 Đường D5, phường Bình Thạnh');await page.locator('#listing-street').press('Enter');assert page.url.endswith('/moi');await expect(page.locator('[data-map-frame]')).to_be_visible();src=await page.locator('[data-map-preview]').get_attribute('src');from urllib.parse import urlparse,parse_qs;assert '123 Đường D5' in parse_qs(urlparse(src).query)['q'][0]
   async with page.expect_navigation():await page.get_by_role('button',name='Lưu bản nháp',exact=True).click()
   item=(await (await page.request.get(BASE+'/api/account/listings')).json())['items'][0];details=json.loads(item['details']);assert details['street']=='123 Đường D5, phường Bình Thạnh';assert details['map_point'] is None
   await page.goto(BASE+'/tai-khoan/tin-dang/'+item['id']);await expect(page.locator('[data-map-frame]')).to_be_visible();await expect(page.locator('#listing-street')).to_have_value(details['street'])
   await page.locator('.map-alternatives>summary').click();await page.locator('#map-link').fill('https://www.google.com/maps?q=10.8,106.7');await page.locator('#map-link').press('Tab');await expect(page.locator('#map-lat')).to_have_value('10.8');await page.locator('#listing-street').fill('456 Đường Điện Biên Phủ');await page.locator('#listing-street').press('Enter');await expect(page.locator('#map-lat')).to_have_value('');await expect(page.locator('#map-lng')).to_have_value('');assert '456 Đường Điện Biên Phủ' in parse_qs(urlparse(await page.locator('[data-map-preview]').get_attribute('src')).query)['q'][0]
   await page.locator('.map-alternatives>summary').click()
   async with page.expect_navigation():await page.get_by_role('button',name='Lưu bản nháp',exact=True).click()
   item=(await (await page.request.get(BASE+'/api/account/listings')).json())['items'][0];assert json.loads(item['details'])['street']=='456 Đường Điện Biên Phủ';assert json.loads(item['details'])['map_point'] is None
   await page.goto(BASE+'/tai-khoan/tin-dang/'+item['id'])
   for width in [320,390,768,1440]:
    await page.set_viewport_size({'width':width,'height':1000});assert not await page.evaluate('document.documentElement.scrollWidth>innerWidth+1');await page.locator('[data-map-editor]').screenshot(path=str(OUT/(str(width)+'.png')))
   assert not errors,errors;print('Direct address/Enter preview, one field, draft save/restore, stale pin reset, four responsive widths: passed. Google iframe mocked.')
  finally:await b.close()
try:asyncio.run(main())
finally:
 os.killpg(process.pid,signal.SIGTERM)
 try:process.wait(timeout=10)
 except subprocess.TimeoutExpired:os.killpg(process.pid,signal.SIGKILL);process.wait()
 LOG.close();shutil.rmtree(STATE)
