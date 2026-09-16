import { expect, test } from '@playwright/test'

import { waitForTaskyonSession } from '../support/taskyon'

test.describe('app smoke', () => {
  test('loads Taskyon', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveTitle(/Taskyon/)
  })

  test('about dialog follows the selected color scheme', async ({ page }) => {
    await page.route('**/build-metadata.json', async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          commit: 'test-commit',
          publishDate: '2026-09-15T10:00:00.000Z',
        }),
      })
    })

    const openAboutDialog = async () => {
      await page.locator('#ty-space-menu').click()
      await page.locator('.q-menu').getByText('About', { exact: true }).click()
      const dialog = page.locator('[data-cy="taskyon-about"]')
      await expect(dialog).toBeVisible()
      return dialog
    }

    await page.emulateMedia({ colorScheme: 'light' })
    await page.goto('/')
    await expect(page.locator('body')).toHaveClass(/body--light/)
    const lightDialog = await openAboutDialog()
    await expect(lightDialog).toHaveCSS('background-color', 'rgb(255, 255, 255)')
    await expect(lightDialog.locator('[data-cy="taskyon-build-commit"]')).toHaveText('test-commit')
    await lightDialog.getByLabel('Close About Taskyon').click()

    await page.emulateMedia({ colorScheme: 'dark' })
    await page.reload()
    await expect(page.locator('body')).toHaveClass(/body--dark/)
    const darkDialog = await openAboutDialog()
    await expect(darkDialog).toHaveCSS('background-color', 'rgb(13, 17, 23)')
  })

  test('clears the message composer immediately after submission', async ({ page }) => {
    await page.goto('/')
    await waitForTaskyonSession(page)

    const composer = page.getByPlaceholder('Describe what you want to build')
    await composer.fill('Clear this draft after submission')
    const valueAfterSubmission = await composer.evaluate(async (element) => {
      const sendButton = element
        .closest('.create-tasks')
        ?.querySelector<HTMLButtonElement>('.msg-edit__send-button')
      if (!sendButton) throw new Error('Message send button not found')
      sendButton.click()
      await Promise.resolve()
      return (element as HTMLTextAreaElement).value
    })

    expect(valueAfterSubmission).toBe('')
  })

  test('shows the shared conversation browser', async ({ page }) => {
    await page.goto('/')
    await page.getByLabel('Open Sidebar').click()
    const conversationBrowser = page.locator('.task-conversation-browser')
    await expect(conversationBrowser).toBeVisible()
    await expect(conversationBrowser.getByLabel('start new chat')).toBeVisible()
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
