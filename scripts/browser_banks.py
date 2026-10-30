from playwright.async_api import expect
async def choose_bank(page,control,code,query=None,keyboard=False):
 field=page.locator('#'+control+'-input')
 await field.fill(query or code)
 option=page.locator('#'+control+'-list [role=option][data-value="'+code+'"]')
 await expect(option).to_be_visible()
 if keyboard:await field.press('Enter')
 else:await option.click()
 await expect(page.locator('#'+control)).to_have_value(code)
 await expect(field).to_have_attribute('aria-expanded','false')
