import asyncio,os,shutil,signal,subprocess,tempfile
from pathlib import Path
from playwright.async_api import async_playwright,expect
ROOT=Path(__file__).resolve().parent.parent;STATE=Path(tempfile.mkdtemp(prefix='search-layout-',dir=ROOT/'.cache'));OUT=ROOT/'.taste-skill'/'search-final';OUT.mkdir(parents=True,exist_ok=True);LOG=(STATE/'preview.log').open('w')
process=subprocess.Popen(['node','scripts/run-tool.mjs','node','scripts/preview.mjs','--state',str(STATE/'state'),'--port','4334'],cwd=ROOT,stdout=LOG,stderr=LOG,start_new_session=True)
async def main():
 async with async_playwright() as p:
  b=await p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox']);page=await b.new_page()
  try:
   for _ in range(100):
    try:
     if (await page.request.get('http://127.0.0.1:4334/api/health',timeout=1000)).status==200:break
    except Exception:pass
    await asyncio.sleep(.5)
   for width in [320,390,768,1024,1440,1920]:
    await page.set_viewport_size({'width':width,'height':1000});await page.goto('http://127.0.0.1:4334/tim-phong',wait_until='networkidle');assert await page.locator('.room-row').count()==12;assert not await page.evaluate('document.documentElement.scrollWidth>innerWidth+1');assert await page.locator('.room-row .room-card-price').first.evaluate('e=>getComputedStyle(e).color')=='rgb(27, 108, 128)';await page.screenshot(path=str(OUT/('search-'+str(width)+'.png')))
   await page.set_viewport_size({'width':390,'height':900});await page.goto('http://127.0.0.1:4334/tim-phong?size=20-30');await page.get_by_role('button',name='Bộ lọc',exact=True).click();await expect(page.locator('#mobile-size')).to_have_value('20-30');await page.locator('#mobile-min').fill('3000000');await page.locator('#filter-dialog [name=amenity][value=ac]').check()
   async with page.expect_navigation():await page.locator('#filter-dialog').get_by_role('button',name='Áp dụng bộ lọc',exact=True).click()
   assert 'size=20-30' in page.url and 'min=3000000' in page.url and 'amenity=ac' in page.url;assert await page.locator('.room-row').count()>0
   await page.goto('http://127.0.0.1:4334/tim-phong?size=0-20');await expect(page.locator('.empty-state')).to_be_visible();print('Search layout:6 widths, original price color,12 rows, empty state: passed')
  finally:await b.close()
try:asyncio.run(main())
finally:
 os.killpg(process.pid,signal.SIGTERM)
 try:process.wait(timeout=10)
 except subprocess.TimeoutExpired:os.killpg(process.pid,signal.SIGKILL);process.wait()
 LOG.close();shutil.rmtree(STATE)
