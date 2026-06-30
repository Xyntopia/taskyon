import { expect, test } from '@playwright/test'
import { join } from 'node:path'

import {
  addAiServices,
  checkLastMessage,
  dataCy,
  readOnlineEnv,
  selectLlmModel,
  setSettingsToggle,
  writeMessage,
} from '../support/taskyon'

const onlineEnv = readOnlineEnv(process.cwd())
const visionModelId = 'google/gemini-2.5-flash-lite'

test.describe('Taskyon API', () => {
  test.skip(!onlineEnv, 'requires cypress.env.json with OpenAI and OpenRouter API keys')
  test.setTimeout(180_000)

  test('can configure providers, upload an image, and get a vision response', async ({ page }) => {
    if (!onlineEnv) throw new Error('online env missing')

    await page.goto('/')
    await expect(page.getByText('Start with a guided design question')).toBeVisible()
    await page.waitForTimeout(3_000)

    await addAiServices(page, onlineEnv)
    await page.goto('/')
    await addAiServices(page, onlineEnv)

    await page.getByLabel('quick ai settings').click()
    await setSettingsToggle(page, 'Expert Mode', true)
    await page.keyboard.press('Escape')

    await page.waitForTimeout(5_000)
    await selectLlmModel(page, 'openai')
    await selectLlmModel(page, 'openrouter.ai', visionModelId)

    await page.reload()
    await expect(dataCy(page, 'model-id')).toContainText(visionModelId)

    await page
      .locator('.create-tasks')
      .locator('[data-cy="file-input"]')
      .setInputFiles(join(process.cwd(), 'public/taskyon_social_preview.png'))

    await writeMessage(page, 'Whats in the picture?')

    await checkLastMessage(page, 'taskyon.space')
    await checkLastMessage(page, 'logo')
  })
})
