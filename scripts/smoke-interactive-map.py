import asyncio,json,os,secrets,shutil,signal,subprocess,tempfile,uuid,base64
from pathlib import Path
from playwright.async_api import async_playwright,expect
ROOT=Path(__file__).resolve().parent.parent;STATE=Path(tempfile.mkdtemp(prefix='interactive-map-',dir=ROOT/'.cache'));OUT=ROOT/'.taste-skill'/'interactive-map';OUT.mkdir(parents=True,exist_ok=True);LOG=(STATE/'preview.log').open('w');BASE='http://127.0.0.1:4337'
process=subprocess.Popen(['node','scripts/run-tool.mjs','node','scripts/preview.mjs','--state',str(STATE/'state'),'--port','4337'],cwd=ROOT,stdout=LOG,stderr=LOG,start_new_session=True)
async def main():
 async with async_playwright() as p:
  b=await p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox']);ctx=await b.new_context();page=await ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)));reverse_points=[]
  png=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==')
  await ctx.route('https://tile.openstreetmap.org/**',lambda route:route.fulfill(status=200,content_type='image/png',body=png))
  async def geocode(route):
   data=route.request.post_data_json
   if route.request.url.endswith('/reverse'):
    point=data['point'];reverse_points.append(point);address='456 Đường Điện Biên Phủ, Bình Thạnh, TP.HCM'
   else:
    point={'lat':10.812345,'lng':106.712345};address='123 Đường D5, Bình Thạnh, TP.HCM'
    if 'chậm' in data['query']:
     await asyncio.sleep(2.5);address='Địa chỉ phản hồi cũ'
    if 'không tìm' in data['query']:
     await route.fulfill(status=200,json={'items':[]});return
   try:await route.fulfill(status=200,json={'items':[{'id':'place-1',**point,'address':address,'name':address}]})
   except Exception:pass
  await ctx.route('**/api/account/maps/*',geocode)
  try:
   for _ in range(100):
    try:
     if (await page.request.get(BASE+'/api/health',timeout=1000)).status==200:break
    except Exception:pass
    await asyncio.sleep(.5)
   r=await page.request.post(BASE+'/api/auth/register',headers={'Origin':BASE},data={'name':'Người thử bản đồ','email':str(uuid.uuid4())+'@example.test','password':secrets.token_urlsafe(24)});assert r.status==201
   await page.goto(BASE+'/tai-khoan/tin-dang/moi');await expect(page.locator('.leaflet-container')).to_be_visible();assert await page.locator('[data-map-editor] input[type=number]').count()==0
   await page.locator('#listing-title').fill('Phòng thử bản đồ tương tác');await page.locator('#listing-location').select_option('binh-thanh');await page.locator('#listing-price').fill('3000000');await page.locator('#listing-size').fill('25');await page.locator('#listing-plan').select_option('basic-7d')
   await page.locator('#listing-street').fill('123 Đường D5');await page.locator('#listing-street').press('Enter');await expect(page.locator('.map-suggestion')).to_have_count(1);assert page.url.endswith('/moi');await page.locator('.map-suggestion').click();await expect(page.locator('#listing-street')).to_have_value('123 Đường D5, Bình Thạnh, TP.HCM');await expect(page.locator('#map-lat')).to_have_value('10.812345')
   mapbox=page.locator('[data-interactive-map]');await mapbox.click(position={'x':100,'y':120});await expect(page.locator('#listing-street')).to_have_value('456 Đường Điện Biên Phủ, Bình Thạnh, TP.HCM');assert reverse_points;await expect(page.locator('.listing-map-pin')).to_be_visible();assert await page.locator('#map-lat').input_value()!='10.812345'
   async with page.expect_navigation():await page.get_by_role('button',name='Lưu bản nháp',exact=True).click()
   item=(await (await page.request.get(BASE+'/api/account/listings')).json())['items'][0];d=json.loads(item['details']);assert d['street']=='456 Đường Điện Biên Phủ, Bình Thạnh, TP.HCM';assert abs(d['map_point']['lat']-reverse_points[-1]['lat'])<.000001
   await page.goto(BASE+'/tai-khoan/tin-dang/'+item['id']);await expect(page.locator('#listing-street')).to_have_value(d['street']);await expect(page.locator('.listing-map-pin')).to_be_visible()
   await page.locator('#listing-street').fill('địa chỉ chậm');await page.locator('#listing-street').press('Enter');await page.wait_for_timeout(100);await page.locator('#listing-street').fill('123 Đường D5 mới');await page.locator('#listing-street').press('Enter');await expect(page.locator('.map-suggestion')).to_have_count(1);await page.wait_for_timeout(1600);assert 'phản hồi cũ' not in await page.locator('[data-map-suggestions]').inner_text();await page.locator('.map-suggestion').click()
   for width in [320,390,768,1440]:
    await page.set_viewport_size({'width':width,'height':1000});await page.locator('[data-map-editor]').scroll_into_view_if_needed();assert not await page.evaluate('document.documentElement.scrollWidth>innerWidth+1');await page.locator('[data-map-editor]').screenshot(path=str(OUT/(str(width)+'.png')))
   await page.locator('#listing-street').fill('không tìm thấy');await page.locator('#listing-street').press('Enter');await expect(page.locator('[data-map-status]')).to_contain_text('Chưa tìm thấy');assert not errors,errors
   print('Interactive map: typed suggestions, select point, map click reverse->address, save/restore coordinates, stale response protection, no manual coordinates,4 widths passed. Geocoder/tiles mocked.')
  finally:await b.close()
try:asyncio.run(main())
finally:
 os.killpg(process.pid,signal.SIGTERM)
 try:process.wait(timeout=10)
 except subprocess.TimeoutExpired:os.killpg(process.pid,signal.SIGKILL);process.wait()
 LOG.close();shutil.rmtree(STATE)
