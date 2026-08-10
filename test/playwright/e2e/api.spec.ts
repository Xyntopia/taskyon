import { expect, test, type Page } from '@playwright/test'
import { join } from 'node:path'

import {
  addAiServices,
  checkLastMessage,
  dataCy,
  readOnlineEnv,
  selectLlmModel,
  setSettingsToggle,
  waitForTaskyonSession,
  writeMessage,
} from '../support/taskyon'

const onlineEnv = readOnlineEnv(process.cwd())
const visionModelId = 'openai/gpt-4.1-mini'
const freeTaskyonModelIds = new Set([
  'google/gemini-2.5-flash-lite',
  'openai/gpt-5-nano',
  'openai/gpt-oss-120b',
  'mistralai/devstral-2512',
])

const enableExpertMode = async (page: Page) => {
  await page.getByLabel('quick ai settings').click()
  await setSettingsToggle(page, 'Expert Mode', true)
  await page.keyboard.press('Escape')
}

const openTaskyonModelOptions = async (page: Page) => {
  await selectLlmModel(page, 'taskyon')
  await dataCy(page, 'model-id').click()
  await dataCy(page, 'model-selection')
    .locator('.q-field')
    .filter({ hasText: 'Select LLM Model for answering/solving the task.' })
    .click()

  const options = page.locator('.model-select-popup:visible [data-cy="model-option"]')
  await expect(options.first()).toBeVisible()
  const modelIds = await options.evaluateAll((modelOptions) =>
    modelOptions
      .map((option) => option.getAttribute('data-model-id'))
      .filter((modelId): modelId is string => modelId !== null),
  )

  return { modelIds, options }
}

test.describe('Taskyon API', () => {
  test.skip(
    !onlineEnv,
    'requires playwright.env.json with Taskyon, OpenAI, and OpenRouter API keys',
  )
  test.setTimeout(180_000)

  test('can configure providers, upload an image, and get a vision response', async ({ page }) => {
    if (!onlineEnv) throw new Error('online env missing')

    await page.goto('/')
    await expect(page.getByPlaceholder('Describe what you want to build')).toBeVisible()
    await waitForTaskyonSession(page)

    await addAiServices(page, onlineEnv)
    await page.getByLabel('go to chat').click()

    await enableExpertMode(page)
    const { modelIds: taskyonModelIds } = await openTaskyonModelOptions(page)
    expect(taskyonModelIds.length).toBeGreaterThan(freeTaskyonModelIds.size)
    expect(taskyonModelIds.some((modelId) => !freeTaskyonModelIds.has(modelId))).toBe(true)
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')

    await selectLlmModel(page, 'openrouter.ai', visionModelId)
    await expect(dataCy(page, 'model-id')).toContainText(visionModelId)

    await page
      .locator('.create-tasks')
      .locator('[data-cy="file-input"]')
      .setInputFiles(join(process.cwd(), 'public/taskyon_social_preview.png'))

    await writeMessage(page, 'Whats in the picture?')

    await checkLastMessage(page, 'taskyon.space')
    await checkLastMessage(page, 'logo')
  })

  test('persists a model unlocked by a Taskyon key across reloads', async ({ page }) => {
    if (!onlineEnv) throw new Error('online env missing')

    await page.goto('/')
    await expect(page.getByPlaceholder('Describe what you want to build')).toBeVisible()
    await waitForTaskyonSession(page)

    await addAiServices(page, onlineEnv)
    await page.getByLabel('go to chat').click()
    await enableExpertMode(page)

    const { modelIds, options } = await openTaskyonModelOptions(page)
    const unlockedModelIndex = modelIds.findIndex((modelId) => !freeTaskyonModelIds.has(modelId))
    expect(unlockedModelIndex).toBeGreaterThanOrEqual(0)
    const unlockedModelId = modelIds[unlockedModelIndex]
    if (!unlockedModelId) throw new Error('Taskyon key did not unlock an additional model')

    await options.nth(unlockedModelIndex).click()
    await expect(dataCy(page, 'model-id')).toContainText(unlockedModelId)

    await page.reload()
    await waitForTaskyonSession(page)
    await expect(dataCy(page, 'model-id')).toContainText(unlockedModelId)

    await dataCy(page, 'model-id').click()
    await expect(dataCy(page, 'provider-select')).toContainText('taskyon')
    await expect(dataCy(page, 'model-select')).toHaveValue(unlockedModelId)
  })
})
