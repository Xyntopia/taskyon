import { expect, test } from '@playwright/test'

test('starts the ranking workflow with a clear naming goal', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await page.goto('/ranking')

  await expect(page.getByRole('heading', { name: 'Start with a naming goal' })).toBeVisible()
  await expect(
    page.getByText(
      'Describe what the name should communicate, who it is for, and any constraints.',
    ),
  ).toBeVisible()

  await page.getByRole('button', { name: 'Set naming goal' }).click()

  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name: 'Set the naming goal' })).toBeVisible()
  await dialog
    .getByLabel('Naming goal')
    .fill('A memorable name for a privacy-first collaboration app')
  await dialog.getByRole('button', { name: 'Save goal' }).click()

  await expect(dialog).toBeHidden()
  await expect(
    page.getByText('A memorable name for a privacy-first collaboration app'),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: 'Generate name ideas' })).toBeVisible()
  expect(pageErrors).toEqual([])
})

test('opens the ranking agent as a direct Taskyon client', async ({ page }) => {
  await page.goto('/ranking')
  await page.getByRole('button', { name: 'Agent' }).click()

  await expect(page.getByRole('region', { name: 'Ranking agent' })).toBeVisible()
  await expect(page.locator('.agent-sheet .task-chat-window')).toBeVisible()
  await expect(page.locator('.agent-sheet .task-chat-window__composer')).toBeVisible()
  await expect(page.locator('.agent-sheet iframe')).toHaveCount(0)
})

test('keeps the ranking app out of public navigation', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('Open apps menu').click()

  await expect(page.getByText('Normal Chat', { exact: true })).toBeVisible()
  await expect(page.getByText('Ranking App', { exact: true })).toHaveCount(0)
})
