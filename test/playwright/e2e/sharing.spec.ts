import { expect, test } from '@playwright/test'

import {
  addAiServices,
  lastAssistantMessage,
  readOnlineEnv,
  writeMessage,
} from '../support/taskyon'

const onlineEnv = readOnlineEnv(process.cwd())

test.describe('sharing functionality', () => {
  test.skip(!onlineEnv, 'requires playwright.env.json with OpenAI and OpenRouter API keys')

  test('can open sharing for an assistant message', async ({ page }) => {
    if (!onlineEnv) throw new Error('online env missing')

    await page.goto('/')
    await expect(page.getByText('Start with a guided design question')).toBeVisible()
    await addAiServices(page, onlineEnv)

    await page.goto('/')
    await writeMessage(page, 'Hello world! how are you?')
    await expect(lastAssistantMessage(page)).toBeVisible({ timeout: 100_000 })

    await page.getByLabel('share content').click()
    await expect(page.getByText(/share/i)).toBeVisible()
  })
})
