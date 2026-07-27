import { expect, test } from '@playwright/test'

import {
  addAiServices,
  dataCy,
  readOnlineEnv,
  selectLlmModel,
  waitForTaskyonSession,
} from '../support/taskyon'

const diagnosticsTimeoutMs = 200_000
const toolWorkflowTimeoutMs = 450_000
const onlineEnv = readOnlineEnv(process.cwd())

test.describe('diagnostics page', () => {
  test.skip(!onlineEnv, 'requires playwright.env.json with Taskyon, OpenAI, and OpenRouter keys')
  test.setTimeout(diagnosticsTimeoutMs + 30_000)

  test('runs browser diagnostics through the UI', async ({ page }) => {
    if (!onlineEnv) throw new Error('online env missing')

    await page.goto('/')
    await expect(page.getByText('Start with a guided design question')).toBeVisible()
    await waitForTaskyonSession(page)

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
    expect(diagnosticsText).toMatch(/failed tests: 0\/\d+/i)
    expect(diagnosticsText).not.toContain('status: ERROR')
  })

  test('plans separate tool tasks and opens the animated clock popup', async ({
    page,
    context,
  }) => {
    test.setTimeout(toolWorkflowTimeoutMs + 30_000)
    if (!onlineEnv) throw new Error('online env missing')

    await page.goto('/')
    await expect(page.getByText('Start with a guided design question')).toBeVisible()
    await waitForTaskyonSession(page)

    await addAiServices(page, onlineEnv)
    await page.getByLabel('go to chat').click()
    await selectLlmModel(page, 'openai', 'gpt-4.1')
    await page.goto('/diagnostics')

    await page.getByLabel('Filter tests').fill('testTaskyonUiListsAndUsesAvailableTools')
    await page.getByText('guiTests', { exact: true }).click()
    await page.getByText('Tests', { exact: true }).click()
    const diagnosticButton = page
      .getByRole('button', { name: 'Test Taskyon Ui Lists And Uses Available Tools', exact: true })
      .first()
    await expect(diagnosticButton).toBeVisible()

    const clockPopupPromise = context.waitForEvent('page', { timeout: toolWorkflowTimeoutMs })
    await diagnosticButton.click()
    const diagnosticFinishedPromise = dataCy(page, 'test-finished')
      .waitFor({ state: 'visible', timeout: toolWorkflowTimeoutMs })
      .then(async () => {
        const diagnosticsText = (await dataCy(page, 'diagnostics-result').textContent()) ?? ''
        if (diagnosticsText.includes('status: ERROR')) {
          throw new Error(`Diagnostic failed before opening the clock popup:\n${diagnosticsText}`)
        }
        return clockPopupPromise
      })
    const clockPopup = await Promise.race([clockPopupPromise, diagnosticFinishedPromise])

    await expect(clockPopup).toHaveTitle('Animated Clock')
    await expect(clockPopup.locator('#time')).toHaveText(/^\d{2}:\d{2}$/)
    await expect(clockPopup.locator('#seconds')).toHaveText(/^\d{2}$/)
    await expect(clockPopup.locator('#date')).not.toHaveText('Loading date...')

    await expect(dataCy(page, 'test-finished')).toContainText('Test Finished', {
      timeout: toolWorkflowTimeoutMs,
    })
    const diagnosticsResult = dataCy(page, 'diagnostics-result')
    await expect(diagnosticsResult).toContainText('Test Taskyon Ui Lists And Uses Available Tools')
    await expect(diagnosticsResult).toContainText('status: MODEL PASS')
    await expect(diagnosticsResult).toContainText('finished all tests!')
  })
})
