import { expect, test } from '@playwright/test'

import {
  closeAiSettings,
  dataCy,
  selectLlmModel,
  setSettingsToggle,
  testModelId,
} from '../support/taskyon'

test.describe('Taskyon settings and tools', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
  })

  test('opens quick settings and persists expert tool controls after reload', async ({ page }) => {
    await expect(page).toHaveTitle(/Taskyon/)

    await page.getByLabel('quick ai settings').click()
    await setSettingsToggle(page, 'Expert Mode', true)
    await setSettingsToggle(page, 'Tool Chooser', true)

    await dataCy(page, 'Tool Chooser').locator('.obj-info').click()
    await expect(
      page.getByText('Enable the tool-shortlist stage for this specific entry-node run.'),
    ).toBeVisible()
    await page.keyboard.press('Escape')
    await closeAiSettings(page)

    await selectLlmModel(page, undefined, testModelId)
    await page.reload()
    await expect(dataCy(page, 'model-id')).toContainText(testModelId)
  })

  test('opens the custom tool manager and saves the default tool', async ({ page }) => {
    await page.getByLabel('quick ai settings').click()
    await setSettingsToggle(page, 'Expert Mode', true)
    await closeAiSettings(page)

    await dataCy(page, 'tool-btn').click()
    await page.locator('.q-menu').getByText('Manager').click()

    await expect(page.locator('.cm-content')).toBeVisible()
    await page.getByLabel('New Tool Name').fill('playwrightExample')
    await expect(page.getByRole('button', { name: 'save tool' })).toBeEnabled()
    await page.getByRole('button', { name: 'save tool' }).click()
  })
})
