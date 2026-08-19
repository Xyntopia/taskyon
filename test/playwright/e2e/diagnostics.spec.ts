import { expect, test } from '@playwright/test'

import {
  addAiServices,
  dataCy,
  readOnlineEnv,
  selectLlmModel,
  waitForTaskyonSession,
  writeMessage,
} from '../support/taskyon'

const diagnosticsTimeoutMs = 600_000
const toolWorkflowTimeoutMs = 450_000
const onlineEnv = readOnlineEnv(process.cwd())

test.describe('diagnostics page', () => {
  test.skip(!onlineEnv, 'requires playwright.env.json with Taskyon, OpenAI, and OpenRouter keys')
  test.setTimeout(diagnosticsTimeoutMs + 30_000)

  test('runs browser diagnostics through the UI', async ({ page }) => {
    if (!onlineEnv) throw new Error('online env missing')

    await page.goto('/')
    await expect(page.getByPlaceholder('Describe what you want to build')).toBeVisible()
    await waitForTaskyonSession(page)

    await addAiServices(page, onlineEnv)

    await page.goto('/')
    await expect(page.getByPlaceholder('Describe what you want to build')).toBeVisible()
    await waitForTaskyonSession(page)
    await selectLlmModel(page, 'openai', 'gpt-5.1')
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

  test('simple chat completes without routing errors', async ({ page, context }) => {
    test.info().annotations.push({
      type: 'model-based',
      description: 'Replays the routing-error transcript through the browser UI runtime.',
    })
    if (!onlineEnv) throw new Error('online env missing')

    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.goto('/')
    await expect(page.getByPlaceholder('Describe what you want to build')).toBeVisible()
    await waitForTaskyonSession(page)
    await addAiServices(page, onlineEnv)
    await page.getByLabel('go to chat').click()
    await waitForTaskyonSession(page)
    await selectLlmModel(page, 'openai', 'gpt-5.1')

    const assistantMessages = page.locator('.assistant.message')
    const initialAssistantMessageCount = await assistantMessages.count()
    const submissionOutcomePromise = Promise.race([
      expect(page.locator('.user.message').last())
        .toContainText('what happened?')
        .then(() => ({ type: 'created' as const })),
      page
        .waitForEvent('pageerror')
        .then((error) => ({ type: 'error' as const, message: error.stack ?? error.message })),
    ])
    await writeMessage(page, 'what happened?')
    const submissionOutcome = await submissionOutcomePromise
    expect(
      submissionOutcome.type,
      submissionOutcome.type === 'error' ? submissionOutcome.message : undefined,
    ).toBe('created')
    const routingErrors = page.locator('.task-container.error, .task-container:has(.text-negative)')
    const clarificationDialog = page.getByRole('dialog').filter({ hasText: 'Clarify Request' })
    const outcome = await Promise.race([
      expect(assistantMessages)
        .toHaveCount(initialAssistantMessageCount + 1, { timeout: diagnosticsTimeoutMs })
        .then(() => ({ type: 'assistant' as const })),
      clarificationDialog
        .waitFor({ state: 'visible', timeout: diagnosticsTimeoutMs })
        .then(() => ({ type: 'clarification' as const })),
      routingErrors
        .first()
        .waitFor({ state: 'visible', timeout: diagnosticsTimeoutMs })
        .then(async () => ({
          type: 'error' as const,
          message: await routingErrors.first().innerText(),
        })),
    ])
    expect(outcome.type, outcome.type === 'error' ? outcome.message : undefined).not.toBe('error')
    await expect(routingErrors).toHaveCount(0)
    if (outcome.type === 'clarification') {
      await clarificationDialog.getByRole('button', { name: 'Cancel', exact: true }).click()
      await expect(clarificationDialog).toBeHidden()
    }

    await page.getByLabel('copy entire chat as markdown').click()
    const copiedChat = await page.evaluate(() => navigator.clipboard.readText())
    expect(copiedChat).not.toContain('Invalid arguments for tool')
    expect(copiedChat).not.toContain('type: tooldefinition')
    expect(copiedChat).not.toContain('prompt_templates')
    expect(copiedChat).not.toContain('use_baseprompt')
    expect(copiedChat).not.toContain('tool_chooser_min_tools')
  })

  test('plans separate tool tasks and opens the animated clock popup', async ({
    page,
    context,
  }) => {
    test.info().annotations.push({
      type: 'model-based',
      description: 'Scores whether the selected model completes a multi-tool workflow.',
    })
    test.setTimeout(toolWorkflowTimeoutMs + 30_000)
    if (!onlineEnv) throw new Error('online env missing')

    await page.goto('/')
    await expect(page.getByPlaceholder('Describe what you want to build')).toBeVisible()
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

    const clockPopupPromise = context
      .waitForEvent('page', { timeout: toolWorkflowTimeoutMs })
      .then((clockPopup) => ({ type: 'popup' as const, clockPopup }))
    await diagnosticButton.click()
    const diagnosticFinishedPromise = dataCy(page, 'test-finished')
      .waitFor({ state: 'visible', timeout: toolWorkflowTimeoutMs })
      .then(async () => {
        const diagnosticsText = (await dataCy(page, 'diagnostics-result').textContent()) ?? ''
        return { type: 'diagnostic' as const, diagnosticsText }
      })
    const outcome = await Promise.race([clockPopupPromise, diagnosticFinishedPromise])
    if (outcome.type === 'diagnostic') {
      test.skip(
        outcome.diagnosticsText.includes('status: MODEL MISS'),
        'The selected model did not satisfy this capability evaluation.',
      )
      throw new Error(
        `Diagnostic failed before opening the clock popup:\n${outcome.diagnosticsText}`,
      )
    }
    const { clockPopup } = outcome

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
