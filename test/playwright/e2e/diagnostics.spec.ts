import { expect, test } from '@playwright/test'

import { addAiServices, dataCy, readOnlineEnv } from '../support/taskyon'

const diagnosticsTimeoutMs = 200_000
const onlineEnv = readOnlineEnv(process.cwd())

test.describe('diagnostics page', () => {
  test.skip(!onlineEnv, 'requires cypress.env.json with OpenAI and OpenRouter API keys')
  test.setTimeout(diagnosticsTimeoutMs + 30_000)

  test('runs browser diagnostics through the UI', async ({ page }) => {
    if (!onlineEnv) throw new Error('online env missing')

    await page.goto('/')
    await expect(page.getByText('Start with a guided design question')).toBeVisible()
    await page.waitForTimeout(3_000)

    await addAiServices(page, onlineEnv)

    await page.goto('/diagnostics')

    await dataCy(page, 'run-tests').click()

    await expect(dataCy(page, 'test-finished')).toContainText('Test Finished', {
      timeout: diagnosticsTimeoutMs,
    })

    const diagnosticsResult = dataCy(page, 'diagnostics-result')
    await expect(diagnosticsResult).toContainText('finished all tests!', {
      timeout: diagnosticsTimeoutMs,
    })

    const diagnosticsText = (await diagnosticsResult.textContent()) ?? ''
    const diagnosticsLines = diagnosticsText
      .trim()
      .toLowerCase()
      .split('\n')
      .map((line) => line.trim())
    expect(diagnosticsLines.at(-1)).toBe('finished all tests!')

    const okCount = diagnosticsText.match(/ok/gi)?.length ?? 0
    expect(okCount).toBeGreaterThan(10)
    expect(diagnosticsText).not.toMatch(/error/i)
  })
})
