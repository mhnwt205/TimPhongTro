"""Optional browser smoke test. Requires Playwright Python and Chromium.

Uses only localhost and exact, randomly named test accounts; cleans them afterwards.
Run with the dev server already running: python3 scripts/smoke-accounts.py
"""
import asyncio
import os
from pathlib import Path
import secrets
import subprocess
import sys
import uuid
from playwright.async_api import async_playwright, expect

ROOT = Path(__file__).resolve().parent.parent
PREVIEW = '--preview' in sys.argv[1:]
BASE = 'http://127.0.0.1:4322' if PREVIEW else 'http://127.0.0.1:4321'
SHOTS = ROOT / '.taste-skill' / 'responsive'
SHOTS.mkdir(parents=True, exist_ok=True)
RUN = uuid.uuid4().hex
EMAILS = [f'smoke-seller-{RUN}@example.test', f'smoke-admin-{RUN}@example.test']
PASSWORD = secrets.token_urlsafe(24)
DISPLAY_NAME = f'Chủ trọ dùng thử {RUN[:6]}'


def local_command(args):
    result = subprocess.run(['node', 'scripts/run-tool.mjs', *args], cwd=ROOT, capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError('Local database command failed; no credentials printed.')


def database_command(path):
    config = ROOT / 'apps/web' / ('dist/server/wrangler.json' if PREVIEW else 'wrangler.jsonc')
    args = ['npm', 'exec', '--workspace=@timphongtro/web', '--', 'wrangler', 'd1', 'execute', 'DB', '--local', '--config', str(config), '--file', str(path)]
    if PREVIEW:
        args += ['--persist-to', str(ROOT / 'apps/web/.wrangler/preview-state')]
    return args


async def inspect_sizes(page, name):
    for width in [320, 390, 768, 1024, 1280, 1440, 1920]:
        await page.set_viewport_size({'width': width, 'height': 900 if width >= 1200 else 844})
        await page.reload(wait_until='networkidle')
        assert not await page.evaluate('document.documentElement.scrollWidth > innerWidth + 1'), (name, width, 'overflow')
        if width in [390, 768, 1280, 1440]:
            await page.screenshot(path=str(SHOTS / f'{name}-{width}.png'), full_page=False)
    print(f'Browser: {name} trên 7 độ rộng 320–1920px — OK', flush=True)


async def register(page, email, name):
    await page.goto(BASE + '/dang-ky')
    await page.get_by_label('Tên của bạn', exact=True).fill(name)
    await page.get_by_label('Email', exact=True).fill(email)
    await page.get_by_label('Mật khẩu', exact=True).fill(PASSWORD)
    await page.get_by_label('Nhập lại mật khẩu', exact=True).fill(PASSWORD)
    async with page.expect_navigation(wait_until='networkidle'):
        await page.get_by_role('button', name='Tạo tài khoản', exact=True).click()
    assert page.url.endswith('/tai-khoan/ho-so'), 'Registration did not reach profile'


async def submit(page, name):
    async with page.expect_navigation(wait_until='networkidle'):
        await page.get_by_role('button', name=name, exact=True).click()


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH', '/usr/bin/chromium'), args=['--no-sandbox'])
        try:
            seller_context = await browser.new_context(viewport={'width': 390, 'height': 844})
            admin_context = await browser.new_context(viewport={'width': 1365, 'height': 1000})
            seller = await seller_context.new_page()
            admin = await admin_context.new_page()

            await seller.goto(BASE + '/tai-khoan/ho-so')
            assert seller.url.endswith('/dang-nhap')
            await register(seller, EMAILS[0], 'Người đăng dùng thử')
            await seller.get_by_label('Tên hiển thị', exact=True).fill(DISPLAY_NAME)
            await seller.locator('[name=seller_type][value=owner]').check()
            await seller.get_by_label('Số điện thoại', exact=True).fill('0901234567')
            await seller.get_by_label('Giới thiệu ngắn', exact=False).fill('Kiểm tra luồng hồ sơ ở TP.HCM.')
            await submit(seller, 'Gửi hồ sơ xét duyệt')
            await expect(seller.locator('.profile-status')).to_have_text('Chờ xét duyệt')
            denied = await seller.goto(BASE + '/quan-tri/nguoi-dang')
            assert denied.status == 403
            await seller.goto(BASE + '/tai-khoan/ho-so')
            print('Browser: đăng ký, gửi hồ sơ và chặn quyền quản trị — OK')

            await register(admin, EMAILS[1], 'Quản trị dùng thử')
            if PREVIEW:
                grant = ROOT / '.cache' / f'smoke-grant-{RUN}.sql'
                grant.write_text("UPDATE users SET role='admin',is_super_admin=1,version=version+1 WHERE email='" + EMAILS[1] + "';")
                try:
                    await asyncio.to_thread(local_command, database_command(grant))
                finally:
                    grant.unlink(missing_ok=True)
            else:
                await asyncio.to_thread(local_command, ['npm', 'run', 'admin:local', '--', '--email', EMAILS[1]])
            await admin.goto(BASE + '/quan-tri/nguoi-dang')
            card = admin.locator('article.seller-card').filter(has_text=DISPLAY_NAME)
            await expect(card).to_have_count(1)
            await card.get_by_label('Ghi chú / lý do cần bổ sung', exact=True).fill('Vui lòng bổ sung khu vực có phòng.')
            async with admin.expect_navigation(wait_until='networkidle'):
                await card.get_by_role('button', name='Yêu cầu bổ sung', exact=True).click()
            await seller.reload()
            await expect(seller.locator('.profile-status')).to_have_text('Cần bổ sung')
            await seller.get_by_label('Giới thiệu ngắn', exact=False).fill('Có phòng tại khu vực TP.HCM, liên hệ qua điện thoại.')
            await submit(seller, 'Cập nhật và gửi xét duyệt')
            await admin.reload()
            card = admin.locator('article.seller-card').filter(has_text=DISPLAY_NAME)
            async with admin.expect_navigation(wait_until='networkidle'):
                await card.get_by_role('button', name='Duyệt quyền đăng', exact=True).click()
            await seller.reload()
            await expect(seller.locator('.profile-status')).to_have_text('Đã duyệt hồ sơ')
            assert await seller.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), 'Horizontal overflow on mobile'
            await seller.screenshot(path='/tmp/timphongtro-profile-mobile.png', full_page=True)
            await inspect_sizes(seller, 'profile')
            await seller.set_viewport_size({'width':390,'height':844})
            print('Browser: từ chối có lý do, gửi lại, duyệt và hiển thị mobile — OK')

            await admin.goto(BASE + '/quan-tri/nguoi-dang?status=approved')
            card = admin.locator('article.seller-card').filter(has_text=DISPLAY_NAME)
            await admin.screenshot(path='/tmp/timphongtro-admin-desktop.png', full_page=True)
            await inspect_sizes(admin, 'admin')
            await admin.set_viewport_size({'width':1365,'height':1000})
            await card.locator('summary').click()
            await card.get_by_label('Lý do khóa', exact=True).fill('Kiểm tra thu hồi phiên đăng nhập.')
            async with admin.expect_navigation(wait_until='networkidle'):
                await card.get_by_role('button', name='Xác nhận khóa tài khoản', exact=True).click()
            await seller.reload()
            assert seller.url.endswith('/dang-nhap'), 'Locked session was not rejected'
            await admin.goto(BASE + '/quan-tri/nguoi-dang?status=locked')
            card = admin.locator('article.seller-card').filter(has_text=DISPLAY_NAME)
            await card.locator('summary').click()
            await card.get_by_label('Lý do mở khóa', exact=True).fill('Hoàn tất kiểm tra mở khóa.')
            async with admin.expect_navigation(wait_until='networkidle'):
                await card.get_by_role('button', name='Xác nhận mở khóa', exact=True).click()
            await seller.get_by_label('Email', exact=True).fill(EMAILS[0])
            await seller.get_by_label('Mật khẩu', exact=True).fill(PASSWORD)
            await submit(seller, 'Đăng nhập')
            await expect(seller.locator('.profile-status')).to_have_text('Đã duyệt hồ sơ')
            await submit(seller, 'Đăng xuất')
            assert seller.url.endswith('/dang-nhap')
            print('Browser: khóa/mở khóa, thu hồi phiên, đăng nhập lại và đăng xuất — OK')
        finally:
            await browser.close()


try:
    asyncio.run(main())
finally:
    # Delete only this run's exact fixture identities and related records.
    quoted = ','.join("'" + value.replace("'", "''") + "'" for value in EMAILS)
    ids = f'SELECT id FROM users WHERE email IN ({quoted})'
    sql = (f'DELETE FROM seller_reviews WHERE user_id IN ({ids}) OR reviewer_id IN ({ids});\n'
           f'DELETE FROM admin_audit WHERE target_id IN ({ids}) OR actor_id IN ({ids});\n'
           f'DELETE FROM seller_profiles WHERE user_id IN ({ids});\n'
           f'DELETE FROM sessions WHERE user_id IN ({ids});\n'
           f'DELETE FROM users WHERE email IN ({quoted});\n')
    path = ROOT / '.cache' / f'smoke-clean-{RUN}.sql'
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(sql)
    try:
        local_command(database_command(path))
        print('Browser: đã dọn đúng tài khoản thử của lượt chạy — OK')
    finally:
        path.unlink(missing_ok=True)
