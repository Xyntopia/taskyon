import { expect, test } from '@playwright/test'

import {
  addAiServices,
  dataCy,
  expectTaskyonReady,
  readOnlineEnv,
  selectLlmModel,
  testModelId,
  writeMessage,
} from '../support/taskyon'

const diagnosticsTimeoutMs = 600_000
const toolWorkflowTimeoutMs = 450_000
const onlineEnv = readOnlineEnv(process.cwd())
const researchProvider = process.env.PLAYWRIGHT_RESEARCH_PROVIDER ?? 'openrouter.ai'
const researchModel = process.env.PLAYWRIGHT_RESEARCH_MODEL ?? 'openai/gpt-5.6-luna'

test.describe('diagnostics page', () => {
  test.skip(!onlineEnv, 'requires playwright.env.json with Taskyon, OpenAI, and OpenRouter keys')
  test.setTimeout(diagnosticsTimeoutMs + 30_000)

  test('runs browser diagnostics through the UI', async ({ page }) => {
    if (!onlineEnv) throw new Error('online env missing')

    await page.goto('/')
    await expect(page.getByPlaceholder('Describe what you want to build')).toBeVisible()
    await expectTaskyonReady(page)

    await addAiServices(page, onlineEnv)

    await page.goto('/')
    await expect(page.getByPlaceholder('Describe what you want to build')).toBeVisible()
    await expectTaskyonReady(page)
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

  test('runs the shared document retrieval diagnostic and validates stored PDFs', async ({
    page,
  }) => {
    if (!onlineEnv) throw new Error('online env missing')

    const browserFailures: string[] = []
    page.on('pageerror', (error) => browserFailures.push(`page error: ${error.message}`))
    page.on('console', (message) => {
      const text = message.text()
      if (/error|warn|storage|completion|securetunnel/i.test(text)) {
        browserFailures.push(`console ${message.type()}: ${text.slice(0, 500)}`)
      }
    })
    page.on('response', (response) => {
      if (/chat\/completions|tokenservice|ws-proxy|\/proxy/.test(response.url())) {
        browserFailures.push(`response ${response.status()}: ${response.url()}`)
      }
    })
    page.on('requestfailed', (request) =>
      browserFailures.push(
        `request failed: ${request.method()} ${request.url()} (${request.failure()?.errorText})`,
      ),
    )

    await page.goto('/')
    await expect(page.getByPlaceholder('Describe what you want to build')).toBeVisible()
    await expectTaskyonReady(page)
    await addAiServices(page, onlineEnv)

    await page.goto('/browser-access')
    const fetchTransport = dataCy(page, 'sandbox-fetch-transport')
    await fetchTransport.click()
    await page.getByRole('option', { name: 'Local or configured CORS proxy', exact: true }).click()
    await dataCy(page, 'check-cors-proxy').click()
    await expect(dataCy(page, 'cors-proxy-status')).toContainText('CORS proxy is available')
    await page.addLocatorHandler(
      page.locator('.taskyon-capability-dialog--network-access'),
      async (dialog) => {
        await dialog.getByText('Allow network access this session', { exact: true }).click()
        await dialog.getByRole('button', { name: 'Allow network', exact: true }).click()
      },
    )

    await page.goto('/')
    await expect(page.getByPlaceholder('Describe what you want to build')).toBeVisible()
    await expectTaskyonReady(page)
    await selectLlmModel(page, researchProvider, researchModel)
    await expect(dataCy(page, 'model-select')).toHaveValue(researchModel)
    await expect(dataCy(page, 'model-id')).toContainText(researchModel)
    await page.locator('#ty-space-menu').click()
    await page.getByText('About', { exact: true }).click()
    await page.getByRole('link', { name: 'Open Diagnostics', exact: true }).click()
    await expect(page).toHaveURL(/\/diagnostics$/)

    await page.getByLabel('Filter tests').fill('testDocumentRetrievalStoresOfficialFederalRulesPdf')
    await page.getByText('modelBasedTests', { exact: true }).click()
    await page.getByText('Tests', { exact: true }).first().click()
    const diagnosticButton = page.getByRole('button', {
      name: 'Test Document Retrieval Stores Official Federal Rules Pdf',
      exact: true,
    })
    await expect(diagnosticButton).toBeVisible()
    await diagnosticButton.click()

    await expect(dataCy(page, 'test-finished')).toContainText('Test Finished', {
      timeout: diagnosticsTimeoutMs,
    })
    const diagnosticsText = (await dataCy(page, 'diagnostics-result').textContent()) ?? ''
    expect(diagnosticsText, browserFailures.join('\n')).toContain('status: MODEL PASS')
    expect(diagnosticsText).toMatch(/failed tests: 0\/1/i)
    expect(diagnosticsText).toMatch(/model capability score: 1\/1/i)
    expect(diagnosticsText).toContain('websearch auto is supplied by the chain builder')
    expect(diagnosticsText).toMatch(/sha256:\s+sha256:[A-Za-z0-9_-]{43}/i)
    expect(diagnosticsText).toContain('finished all tests!')
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
    await expectTaskyonReady(page)
    await addAiServices(page, onlineEnv)
    await page.getByLabel('go to chat').click()
    await expectTaskyonReady(page)
    await selectLlmModel(page, 'taskyon', testModelId)

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
    const processingComplete = page.getByRole('button', { name: 'all processed', exact: true })
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
      processingComplete
        .waitFor({ state: 'visible', timeout: diagnosticsTimeoutMs })
        .then(() => ({ type: 'processed' as const })),
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
    expect(copiedChat).not.toContain('recentToolCount')
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
    await expectTaskyonReady(page)

    await addAiServices(page, onlineEnv)
    await page.getByLabel('go to chat').click()
    await selectLlmModel(page, 'openai', 'gpt-5.1')
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
