import { expect, test } from '@playwright/test'

test.describe('app smoke', () => {
  test('loads Taskyon', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveTitle(/Taskyon/)
  })

  test('shows an unavailable state for a nonexistent chat', async ({ page }) => {
    const browserErrors: string[] = []
    page.on('pageerror', (error) => browserErrors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') browserErrors.push(message.text())
    })

    await page.goto('/chat?t=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')

    try {
      await expect(
        page.getByText('This chat is not available in the current Taskyon session.'),
      ).toBeVisible()
    } catch {
      throw new Error(`The nonexistent chat did not resolve. ${browserErrors.join('\n')}`)
    }
    await expect(page.getByText('Opening chat...')).toBeHidden()
  })
})
