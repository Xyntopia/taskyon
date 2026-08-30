import { expect, test } from '@playwright/test'

test.describe('task chat presentation', () => {
  test('hides internal tasks and summarizes visible tool calls', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.goto('/task-chat-presentation-test')

    await expect(page.getByText('Visible user message')).toBeVisible()
    await expect(page.getByText('Visible assistant message')).toBeVisible()
    await expect(page.getByText('Visible task error')).toBeVisible()
    await expect(page.getByText('visibleTool')).toBeVisible()
    await expect(page.getByText('hiddenTool')).toHaveCount(0)
    await expect(page.getByText('selectTaskyonTools')).toHaveCount(0)
    await expect(page.getByText('hidden result')).toHaveCount(0)
    await expect(page.getByText('hidden system message')).toHaveCount(0)
    await expect(page.getByText('collapsed arguments')).toHaveCount(0)
    await expect(page.locator('[data-task-id="reloaded-selector-call"]')).toHaveCount(0)

    await page.reload()
    await expect(page.getByText('Visible user message')).toBeVisible()
    await expect(page.getByText('selectTaskyonTools')).toHaveCount(0)
    await expect(page.locator('[data-task-id="reloaded-selector-call"]')).toHaveCount(0)

    const visibleCall = page.locator('[data-task-id="visible-call"]')
    await expect(visibleCall).toHaveClass(/functioncall/)
    await expect(visibleCall.locator('.task-chat-message__content')).toHaveCount(0)

    await page.locator('[data-cy="copy-visible-task-chat"]').click()
    const copied = await page.evaluate(() => navigator.clipboard.readText())
    expect(copied).toContain('Visible user message')
    expect(copied).toContain('Visible assistant message')
    expect(copied).not.toContain('hiddenTool')
    expect(copied).not.toContain('hidden result')
    expect(copied).not.toContain('hidden system message')
    expect(copied).not.toContain('collapsed arguments')
  })

  test('shows function declarations and bindings only in dev mode', async ({ page }) => {
    await page.goto('/task-chat-presentation-test')
    const declaration = page.locator('[data-task-id="code-declaration"]')
    const binding = page.locator('[data-task-id="function-binding"]')

    await page.getByRole('button', { name: 'Enable expert mode' }).click()
    await expect(declaration).toHaveCount(0)
    await expect(binding).toHaveCount(0)

    await page.getByRole('button', { name: 'Enable dev mode' }).click()
    await expect(declaration).toContainText('internalCodeDeclaration')
    await expect(binding).toContainText('internalFunctionBinding')
  })

  for (const [viewport, size] of [
    ['desktop', { width: 1280, height: 720 }],
    ['mobile', { width: 390, height: 844 }],
  ] as const) {
    test(`uses the original inline live-response presentation on ${viewport}`, async ({ page }) => {
      await page.setViewportSize(size)
      await page.goto('/task-chat-presentation-test')

      const progress = page.locator('[data-cy="taskyon-live-progress"]')
      await expect(progress.getByText('THINKING:')).toBeVisible()
      await expect(progress.getByText('Checking the available lights.')).toBeVisible()
      await expect(progress.getByText('I found the kitchen light.')).toBeVisible()
      await expect(progress.getByText('Reading entity state')).toBeVisible()
      await expect(progress.getByText('{"query":"light"}')).toBeVisible()
      await expect(progress.getByText('Calling the model')).toHaveCount(0)
      await expect(progress.getByText('Answer', { exact: true })).toHaveCount(0)
      await expect(progress).toHaveCSS('width', `${size.width - 32}px`)
    })
  }

  test('renders a stored file operation with an immediate download action', async ({ page }) => {
    await page.goto('/task-chat-presentation-test')

    const storageCard = page.locator('[data-task-id="storage-download-call"]')
    await expect(storageCard.getByText('tool-files/presentation-test.pdf')).toBeVisible()
    await expect(storageCard.getByText('https://example.test/presentation-test.pdf')).toBeVisible()

    const downloadEvent = page.waitForEvent('download')
    await storageCard.locator('[data-cy="download-storage-object"]').click()
    const download = await downloadEvent

    expect(download.suggestedFilename()).toBe('presentation-test.pdf')
    const stream = await download.createReadStream()
    const chunks: Buffer[] = []
    for await (const chunk of stream) chunks.push(Buffer.from(chunk))
    expect(Buffer.concat(chunks).toString()).toContain('%PDF-1.7')

    await storageCard.locator('[data-cy="view-storage-object"]').click()
    await expect(page).toHaveURL(
      /\/storage\?namespace=tool-files&kind=blob&id=presentation-test.pdf/,
    )
    await expect(page.locator('[data-storage-object-id="presentation-test.pdf"]')).toHaveClass(
      /bg-blue-1/,
    )
    await expect(page.getByRole('tab', { name: 'Physical OPFS' })).toBeVisible()
  })

  test('renders workspace file operations through the same file actions', async ({ page }) => {
    await page.goto('/task-chat-presentation-test')

    const workspaceCard = page.locator('[data-task-id="workspace-write-call"]')
    await expect(workspaceCard.getByText('workspace-files/v1/docs/note.txt')).toBeVisible()
    await expect(workspaceCard.getByRole('button', { name: 'Download' })).toBeEnabled()
    await expect(workspaceCard.getByRole('button', { name: 'View' })).toBeEnabled()

    const downloadEvent = page.waitForEvent('download')
    await workspaceCard.getByRole('button', { name: 'Download' }).click()
    const download = await downloadEvent
    expect(download.suggestedFilename()).toBe('note.txt')
    const stream = await download.createReadStream()
    const chunks: Buffer[] = []
    for await (const chunk of stream) chunks.push(Buffer.from(chunk))
    expect(Buffer.concat(chunks).toString()).toBe('Workspace fixture')

    await workspaceCard.getByRole('button', { name: 'View' }).click()
    await expect(page).toHaveURL(
      /\/storage\?namespace=workspace-files\/v1&kind=record&id=docs\/note.txt/,
    )
    await expect(page.locator('[data-storage-object-id="docs/note.txt"]')).toHaveClass(/bg-blue-1/)
  })

  test('keeps source actions usable when browser storage download fails', async ({ page }) => {
    await page.addInitScript(() => {
      window.open = (url) => {
        sessionStorage.setItem('last-window-open-url', String(url))
        return null
      }
    })
    await page.route('https://example.test/failed-download.pdf', async (route) => {
      await route.fulfill({
        contentType: 'application/pdf',
        headers: { 'content-disposition': 'attachment; filename="failed-download.pdf"' },
        body: '%PDF-1.7\nSource fallback fixture',
      })
    })
    await page.goto('/task-chat-presentation-test')

    const storageCard = page.locator('[data-task-id="failed-storage-download-call"]')
    const downloadButton = storageCard.locator('[data-cy="download-storage-object"]')
    const viewButton = storageCard.locator('[data-cy="view-storage-object"]')
    await expect(storageCard.getByText(/Download file failed/)).toBeVisible()
    await expect(downloadButton).toHaveText(/Download source/)
    await expect(viewButton).toHaveText(/View source/)
    await expect(downloadButton).toBeEnabled()
    await expect(viewButton).toBeEnabled()

    const downloadEvent = page.waitForEvent('download')
    await downloadButton.click()
    const download = await downloadEvent
    expect(download.suggestedFilename()).toBe('failed-download.pdf')

    await viewButton.click()
    await expect
      .poll(() => page.evaluate(() => sessionStorage.getItem('last-window-open-url')))
      .toBe('https://example.test/failed-download.pdf')
  })
})
