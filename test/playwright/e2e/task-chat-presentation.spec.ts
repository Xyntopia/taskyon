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
    await expect(page.getByText('hidden result')).toHaveCount(0)
    await expect(page.getByText('hidden system message')).toHaveCount(0)
    await expect(page.getByText('collapsed arguments')).toHaveCount(0)

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
})
