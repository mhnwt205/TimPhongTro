"""Browser checks for the compiled local preview, not production customer data."""
import asyncio
import json
import re
from pathlib import Path
from playwright.async_api import async_playwright, expect

BASE='http://127.0.0.1:4322'
OUT=Path(__file__).resolve().parent.parent / '.taste-skill' / 'responsive'
WIDTHS=[320,390,768,1024,1280,1440,1920]
ROUTES=['/','/tim-phong','/phong-da-luu','/bang-gia','/dang-tin','/dang-ky','/dang-nhap','/404']

async def main():
    OUT.mkdir(parents=True,exist_ok=True)
    results=[]
    async with async_playwright() as p:
        browser=await p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
        try:
            context=await browser.new_context()
            page=await context.new_page()
            for width in WIDTHS:
                await page.set_viewport_size({'width':width,'height':900 if width>=1200 else 844})
                for route in ROUTES:
                    response=await page.goto(BASE+route,wait_until='networkidle')
                    assert response.status==(404 if route=='/404' else 200),(width,route,response.status)
                    await page.evaluate('document.fonts.ready')
                    assert await page.locator('h1').count()==1,(width,route,'h1 count')
                    assert await page.locator('h1').is_visible(),(width,route,'h1 not visible')
                    measurements=await page.evaluate("""() => ({
                      overflow:document.documentElement.scrollWidth>innerWidth+1,
                      font:document.fonts.check('14px system-ui','Phòng trọ'),
                      badImages:[...document.images].filter(i=>i.getBoundingClientRect().top<innerHeight&&i.getBoundingClientRect().bottom>0&&(!i.complete||i.naturalWidth===0)).length
                    })""")
                    assert not measurements['overflow'],(width,route,'horizontal overflow')
                    assert measurements['font'],(width,route,'font not loaded')
                    assert measurements['badImages']==0,(width,route,'broken image')
                    results.append({'width':width,'route':route,'status':'passed'})
                    if width in [390,1440] and route in ['/','/tim-phong','/dang-nhap','/dang-ky','/bang-gia']:
                        name='home' if route=='/' else route.strip('/').replace('/','-')
                        await page.screenshot(path=str(OUT/f'{name}-{width}.png'),full_page=False)
                print(f'Responsive {width}px: {len(ROUTES)} routes OK',flush=True)

            await page.set_viewport_size({'width':390,'height':844})
            await page.goto(BASE+'/')
            await page.get_by_label('Bạn muốn ở đâu?',exact=True).select_option('thu-duc')
            await page.get_by_label('Giá thuê mỗi tháng',exact=True).select_option('4000000')
            await page.get_by_role('button',name='Tìm phòng',exact=True).click()
            await expect(page.locator('[data-result-count]')).to_have_text('0')
            for text in await page.locator('.room-card-location').all_text_contents():
                assert 'Thủ Đức' in text
            await page.get_by_role('button',name='Bộ lọc',exact=True).click()
            await expect(page.locator('#filter-dialog')).to_be_visible()
            await page.keyboard.press('Escape')
            await expect(page.locator('#filter-dialog')).not_to_be_visible()
            await page.get_by_role('button',name='Mở menu',exact=True).click()
            await expect(page.locator('#navigation-dialog')).to_be_visible()
            await page.keyboard.press('Escape')
            await expect(page.locator('#navigation-dialog')).not_to_be_visible()
            print('Search and mobile dialogs: OK',flush=True)

            await page.goto(BASE+'/tim-phong?sort=price-asc')
            values=[float(re.search(r'[\d,]+',text).group().replace(',','.')) for text in await page.locator('.room-card-price').all_text_contents()]
            assert values==sorted(values)
            await page.goto(BASE+'/tim-phong?q=khong-co-phong-phu-hop')
            await expect(page.get_by_role('heading',name='Chưa tìm thấy phòng phù hợp')).to_be_visible()
            await page.goto(BASE+'/phong-da-luu')
            await expect(page.locator('[data-saved-empty]')).to_be_visible()
            print('Empty catalogue, search, sorting and saved-room state: OK',flush=True)

            missing=await page.goto(BASE+'/phong/studio-ban-cong-binh-thanh')
            assert missing.status==404,(missing.status,'removed sample detail')
            await page.goto(BASE+'/dang-nhap')
            await page.get_by_role('button',name='Hiện mật khẩu',exact=True).click()
            await expect(page.locator('#password')).to_have_attribute('type','text')
            await page.get_by_role('button',name='Ẩn mật khẩu',exact=True).click()
            await expect(page.locator('#password')).to_have_attribute('type','password')
            await page.emulate_media(reduced_motion='reduce')
            await page.goto(BASE+'/')
            await expect(page.locator('.room-card:visible')).to_have_count(0)
            print('Cost calculator, password visibility and reduced motion: OK',flush=True)

            nojs=await browser.new_context(java_script_enabled=False,viewport={'width':390,'height':844})
            basic=await nojs.new_page()
            await basic.goto(BASE+'/tim-phong?area=thu-duc&max=4000000')
            await expect(basic.locator('.room-card')).to_have_count(0)
            assert not await basic.evaluate('document.documentElement.scrollWidth>innerWidth+1')
            print('Server-rendered filters without JavaScript: OK',flush=True)
            (OUT/'results.json').write_text(json.dumps({'routes':results,'functional_checks':'passed'},ensure_ascii=False,indent=2))
        finally:
            await browser.close()

asyncio.run(main())
