import { expect, test } from '@playwright/test'
import { join } from 'node:path'

import {
  addAiServices,
  checkLastMessage,
  dataCy,
  readOnlineEnv,
  selectLlmModel,
  setSettingsToggle,
} from '../support/taskyon'

const onlineEnv = readOnlineEnv(process.cwd())
const visionModelId = 'google/gemini-2.5-flash-lite'
const freeTaskyonModelIds = new Set([
  'google/gemini-2.5-flash-lite',
  'openai/gpt-5-nano',
  'openai/gpt-oss-120b',
  'mistralai/devstral-2512',
])

test.describe('Taskyon API', () => {
  test.skip(!onlineEnv, 'requires cypress.env.json with Taskyon, OpenAI, and OpenRouter API keys')
  test.setTimeout(180_000)

  test('can configure providers, upload an image, and get a vision response', async ({ page }) => {
    if (!onlineEnv) throw new Error('online env missing')
    const browserErrors: string[] = []
    page.on('pageerror', (error) => browserErrors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') browserErrors.push(message.text())
    })
    page.on('requestfailed', (request) => {
      browserErrors.push(
        `Request failed: ${request.url()} (${request.failure()?.errorText ?? 'unknown error'})`,
      )
    })

    await page.goto('/')
    await expect(page.getByText('Start with a guided design question')).toBeVisible()
    await page.waitForTimeout(3_000)

    await addAiServices(page, onlineEnv)
    await page.getByLabel('go to chat').click()

    await page.getByLabel('quick ai settings').click()
    await setSettingsToggle(page, 'Expert Mode', true)
    await page.keyboard.press('Escape')

    await page.waitForTimeout(5_000)
    await selectLlmModel(page, 'taskyon')
    await dataCy(page, 'model-id').click()
    const modelField = dataCy(page, 'model-selection')
      .locator('.q-field')
      .filter({ hasText: 'Select LLM Model for answering/solving the task.' })
    await modelField.click()
    const taskyonModelOptions = page.locator('.model-select-popup:visible [data-cy="model-option"]')
    await expect(taskyonModelOptions.first()).toBeVisible()
    const taskyonModelIds = await taskyonModelOptions.evaluateAll((options) =>
      options
        .map((option) => option.getAttribute('data-model-id'))
        .filter((modelId): modelId is string => modelId !== null),
    )
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

    const messageInput = page.locator('.create-tasks textarea')
    await messageInput.fill('Whats in the picture?')
    await messageInput.press('Enter')
    try {
      await expect(messageInput).toHaveValue('', { timeout: 30_000 })
    } catch {
      throw new Error(`Image prompt was not submitted. ${browserErrors.join('\n')}`)
    }

    await checkLastMessage(page, 'taskyon.space')
    await checkLastMessage(page, 'logo')
  })
})
