import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'

const sharedChatUrl = 'https://example.test/shared-chat.md'
const sharedChatMarkdown = `<!--taskyon
role: user
-->

Shared public question

---

<!--taskyon
role: assistant
-->

Shared public answer
`

const directTransportProfile = JSON.parse(
  readFileSync(new URL('../../../src/assets/taskyon_settings.json', import.meta.url), 'utf8'),
) as { appConfiguration: Record<string, unknown> }
directTransportProfile.appConfiguration.sandboxFetchTransport = 'direct'

const mockSharedChat = async (page: Page) => {
  let downloads = 0
  await page.route(sharedChatUrl, async (route) => {
    downloads += 1
    await route.fulfill({
      status: 200,
      contentType: 'text/markdown',
      headers: { 'access-control-allow-origin': '*' },
      body: sharedChatMarkdown,
    })
  })
  return () => downloads
}

const presetDirectTransport = async (page: Page) => {
  await page.addInitScript((profile) => {
    localStorage.setItem('currentProfile', 'e2e-public-chat')
    localStorage.setItem('uiProfile:e2e-public-chat', JSON.stringify(profile))
  }, directTransportProfile)
}

test.describe('public shared chat import', () => {
  test('asks for trust before downloading and imports on Trust', async ({ page }) => {
    const downloadCount = await mockSharedChat(page)
    await presetDirectTransport(page)
    await page.goto(`/chat?url=${encodeURIComponent(sharedChatUrl)}`)

    await expect(page.getByText('Open this shared chat?')).toBeVisible()
    await expect(page.locator('[data-cy="public-chat-source"]')).toContainText(sharedChatUrl)
    expect(downloadCount()).toBe(0)

    await page.locator('[data-cy="trust-public-chat"]').click()

    await expect(page.getByText('Shared public question', { exact: true })).toBeVisible({ timeout: 60_000 })
    await expect(page.getByText('Shared public answer', { exact: true })).toBeVisible()
    expect(downloadCount()).toBe(1)
  })

  test('leaves the document unloaded on Deny', async ({ page }) => {
    const downloadCount = await mockSharedChat(page)
    await presetDirectTransport(page)
    await page.goto(`/chat?url=${encodeURIComponent(sharedChatUrl)}`)

    await expect(page.getByText('Open this shared chat?')).toBeVisible()
    await page.locator('[data-cy="deny-public-chat"]').click()

    await expect(page.locator('[data-cy="public-chat-denied"]')).toContainText(
      'Shared chat not loaded.',
    )
    await expect(page.getByText('Shared public question', { exact: true })).toHaveCount(0)
    expect(downloadCount()).toBe(0)
  })

  test('asks for trust on the legacy GDrive entry point', async ({ page }) => {
    await presetDirectTransport(page)
    await page.goto('/chat?gd=legacy-share-id')

    await expect(page.getByText('Open this shared chat?')).toBeVisible()
    await expect(page.locator('[data-cy="public-chat-source"]')).toContainText(
      'https://share.taskyon.space/proxy/gdrive/legacy-share-id',
    )
  })
})
