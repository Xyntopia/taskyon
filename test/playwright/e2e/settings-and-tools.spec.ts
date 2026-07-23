import { expect, test } from '@playwright/test'

import {
  closeAiSettings,
  dataCy,
  expectSettingsToggle,
  selectLlmModel,
  setSettingsToggle,
  testModelId,
  waitForTaskyonSession,
} from '../support/taskyon'

test.describe('Taskyon settings and tools', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await waitForTaskyonSession(page)
  })

  test('opens quick settings and persists expert tool controls after reload', async ({ page }) => {
    await expect(page).toHaveTitle(/Taskyon/)

    await page.getByLabel('quick ai settings').click()
    await setSettingsToggle(page, 'Expert Mode', true)
    await setSettingsToggle(page, 'Tool Chooser', true)
    await closeAiSettings(page)

    await selectLlmModel(page, undefined, testModelId)
    await page.reload()
    await expect(dataCy(page, 'model-id')).toContainText(testModelId)
    await page.getByLabel('quick ai settings').click()
    await expectSettingsToggle(page, 'Expert Mode', true)
    await expectSettingsToggle(page, 'Tool Chooser', true)
  })

  test('opens the custom tool manager and saves the default tool', async ({ page }) => {
    await page.getByLabel('quick ai settings').click()
    await setSettingsToggle(page, 'Expert Mode', true)
    await closeAiSettings(page)

    await dataCy(page, 'tool-btn').click()
    await page.locator('.q-menu').getByText('Open Tool Manager', { exact: true }).click()

    await expect(page.locator('.cm-content')).toBeVisible()
    await page.getByLabel('New Tool Name').fill('playwrightExample')
    await expect(page.getByRole('button', { name: 'save tool' })).toBeEnabled()
    await page.getByRole('button', { name: 'save tool' }).click()
  })
})
