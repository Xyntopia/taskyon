import { expect, test } from '@playwright/test'

for (const width of [390, 1280]) {
  test(`pending messages and expandable previews at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 })
    await page.goto('/task-chat-responsiveness-test')
    const input = page.getByRole('textbox')
    await input.fill('Show my message immediately')
    await input.press('Enter')
    await expect(page.locator('[data-cy="pending-chat-message"]')).toContainText(
      'Show my message immediately',
    )
    await expect(page.getByText('Creation is waiting')).toBeVisible()
    await input.fill('I can still type')
    await page.getByRole('button', { name: 'Confirm creation' }).click()
    await expect(page.locator('[data-cy="pending-chat-message"]')).toHaveCount(0)
    await expect(page.locator('[data-cy="taskyon-chat-thread"]')).toContainText(
      'Show my message immediately',
    )
    await page.getByRole('button', { name: 'Open tool example' }).click()
    const row = page.locator('[data-task-id="fixture-call"]')
    await expect(row).toContainText('fixtureTool')
    await expect(row).toContainText('42')
    await expect(row.locator('.task-content-view')).toHaveCount(0)
    await row.getByRole('button').click()
    await expect(row.locator('.task-content-view')).toHaveCount(2)
    await expect(page.getByText('A visible assistant summary')).toBeVisible()
  })
}

test('finishing an earlier send does not reopen its conversation', async ({ page }) => {
  await page.goto('/task-chat-responsiveness-test')
  const input = page.getByRole('textbox')
  await input.fill('Keep this in the original conversation')
  await input.press('Enter')
  await expect(page.getByText('Creation is waiting')).toBeVisible()
  await page.getByRole('button', { name: 'Open tool example' }).click()
  await expect(page.getByText('A visible assistant summary')).toBeVisible()
  await page.getByRole('button', { name: 'Confirm creation' }).click()
  await expect(page.locator('[data-cy="pending-chat-message"]')).toHaveCount(0)
  await expect(page.getByText('A visible assistant summary')).toBeVisible()
  await expect(page.locator('[data-cy="taskyon-chat-thread"]')).not.toContainText(
    'Keep this in the original conversation',
  )
})
