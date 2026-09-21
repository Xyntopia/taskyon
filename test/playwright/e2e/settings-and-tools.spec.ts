import { expect, test } from '@playwright/test'

import {
  closeAiSettings,
  dataCy,
  expectTaskyonReady,
  expectSettingsToggle,
  selectLlmModel,
  setSettingsToggle,
  testModelId,
} from '../support/taskyon'

test('selects a free model from the nested picker and retains it after reload', async ({
  page,
}) => {
  await page.goto('/')
  await expectTaskyonReady(page)
  await dataCy(page, 'model-id').click()
  const currentModel = await dataCy(page, 'model-select').inputValue()
  await dataCy(page, 'model-select').click()
  await dataCy(page, 'model-select').fill('')

  const nextModel = currentModel === testModelId ? 'qwen/qwen3.8-flash' : testModelId
  const option = page.locator(
    `.model-select-popup:visible [data-cy="model-option"][data-model-id="${nextModel}"]`,
  )
  await expect(option).toBeVisible()
  await option.click()
  await expect(dataCy(page, 'model-id')).toContainText(nextModel)
  await expect(dataCy(page, 'model-selection')).toBeHidden()

  await dataCy(page, 'model-id').click()
  await expect(dataCy(page, 'model-selection')).toBeVisible()
  await page.locator('.create-tasks textarea').click()
  await expect(dataCy(page, 'model-selection')).toBeHidden()

  await page.reload()
  await expect(dataCy(page, 'model-id')).toContainText(nextModel)
})

test.describe('Taskyon settings and tools', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await expectTaskyonReady(page)
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

  test('opens every settings tab without render errors', async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', (error) => pageErrors.push(error.message))

    await page.goto('/settings')
    await expect(page.getByRole('tab', { name: 'AI Service Provider', exact: true })).toBeVisible()

    const expertToggle = page.locator('.q-toggle').filter({ hasText: 'Expert Settings' }).first()
    await expertToggle.click()

    for (const label of [
      'AI Service Provider',
      'Profile & Backup',
      'Secrets',
      'AI Configuration',
      'App Configuration',
    ]) {
      const tab = page.getByRole('tab', { name: label, exact: true })
      await expect(tab).toBeVisible()
      await tab.click()
      await expect(tab).toHaveAttribute('aria-selected', 'true')
      await expect(page.getByRole('tabpanel').first()).toBeVisible()
    }

    expect(pageErrors).toEqual([])
  })

  test('shows AI tool settings in one folded tree view', async ({ page }) => {
    await page.goto('/settings')
    const expertToggle = page.locator('.q-toggle').filter({ hasText: 'Expert Settings' }).first()
    await expertToggle.click()

    const aiTab = page.getByRole('tab', { name: 'AI Service Provider', exact: true })
    await expect(aiTab).toBeVisible()
    await page.getByRole('tab', { name: 'AI Configuration', exact: true }).click()

    const panel = page.getByRole('tabpanel').first()
    await expect(panel.getByText('AI/LLM toolchain configurations')).toBeVisible()
    const baseView = panel
      .getByText('Base settings', { exact: true })
      .locator('xpath=following-sibling::*[1]')
    await expect(baseView.locator('input[type="search"]')).toHaveCount(1)
    await expect(baseView.locator('.object-tree-view')).toHaveCount(1)
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
