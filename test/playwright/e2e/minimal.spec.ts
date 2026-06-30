import { expect, test } from '@playwright/test'

test.describe('app smoke', () => {
  test('loads Taskyon', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveTitle(/Taskyon/)
  })
})
