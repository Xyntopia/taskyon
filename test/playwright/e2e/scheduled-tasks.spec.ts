import { expect, test } from '@playwright/test'

test('schedules a task and manages it from settings', async ({ page }) => {
  await page.goto('/task-chat-presentation-test')

  const widget = page.locator('.task-display').first()
  await expect(widget).toBeVisible()
  await widget.click({ button: 'right' })
  await page.getByText('Schedule task', { exact: true }).click()

  await expect(page.getByText('Schedule this task')).toBeVisible()
  await page.getByRole('spinbutton', { name: 'Every' }).fill('2')
  await page.locator('[data-cy="save-task-schedule"]').click()
  await expect(page.getByText('Schedule this task')).toHaveCount(0)

  await page.goto('/settings/app%20config')
  await expect(page.getByText('Scheduled tasks', { exact: true })).toBeVisible()
  await expect(page.getByText('Every 2 days')).toBeVisible()

  await page.getByLabel('delete schedule').first().click()
  await expect(page.getByText('No scheduled tasks.')).toBeVisible()
})
