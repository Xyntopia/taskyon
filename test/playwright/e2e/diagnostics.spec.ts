import { expect, test, type Page } from '@playwright/test'
import { captureBrowserChatCompletionTrace } from '../support/chatCompletionTrace'

import {
  addAiServices,
  dataCy,
  expectTaskyonReady,
  readOnlineEnv,
  selectLlmModel,
  testModelId,
  writeMessage,
} from '../support/taskyon'

const startCapabilityDialogHandler = (page: Page) => {
  let active = true
  let busy = false
  const handle = async () => {
    if (!active || busy) return
    busy = true
    try {
      const network = page.locator('.taskyon-capability-dialog--network-access:visible').last()
      if (await network.isVisible().catch(() => false)) {
        const direct = network.getByText('Direct host fetch', { exact: true })
        if (await direct.isVisible().catch(() => false)) {
          await direct.click()
          await network.getByRole('button', { name: 'Use transport', exact: true }).click()
          return
        }
        await network.getByText('Allow network access this session', { exact: true }).click()
        await network.getByRole('button', { name: 'Allow network', exact: true }).click()
        return
      }
      const popup = page.locator('.taskyon-capability-dialog--popup-access:visible').last()
      if (await popup.isVisible().catch(() => false)) {
        await popup.getByText('Allow popups this session', { exact: true }).click()
        await popup.getByRole('button', { name: 'Open popup', exact: true }).click()
      }
    } catch {
      // The dialog can be replaced or closed while the poll is running.
    } finally {
      busy = false
    }
  }
  const timer = setInterval(() => {
    void handle()
  }, 500)
  const stop = () => {
    active = false
    clearInterval(timer)
  }
  page.once('close', stop)
  return stop
}

const diagnosticsTimeoutMs = 600_000
const toolWorkflowTimeoutMs = 450_000
const onlineEnv = readOnlineEnv(process.cwd())
const researchProvider = process.env.PLAYWRIGHT_RESEARCH_PROVIDER ?? 'openrouter.ai'
const researchModel = process.env.PLAYWRIGHT_RESEARCH_MODEL ?? 'openai/gpt-6-luna'
const clockProvider = process.env.PLAYWRIGHT_CLOCK_PROVIDER ?? 'openrouter.ai'
const clockModelId = process.env.PLAYWRIGHT_CLOCK_MODEL ?? 'openai/gpt-6-luna'

test('runs quick browser diagnostics without a provider', async ({ page }) => {
  await page.addLocatorHandler(
    page.getByRole('dialog').filter({ hasText: 'Connect to taskyon?' }),
    async (dialog) => {
      await dialog.getByRole('button', { name: 'Cancel' }).click()
    },
  )
  await page.goto('/diagnostics')
  await expect(dataCy(page, 'run-tests')).toContainText('Run through L1')
  await dataCy(page, 'diagnostics-run-level').click()
  await page.getByRole('option', { name: 'L1 · Quick smoke' }).click()
  await expect(dataCy(page, 'run-tests')).toContainText('Run through L1')
  await dataCy(page, 'run-tests').click()
  await expect(dataCy(page, 'test-finished')).toContainText('Test Finished')
  const report = dataCy(page, 'diagnostics-result')
  await expect(report).toContainText(
    'Test Combined Workflow Requires Search Before Final Computation',
  )
  await expect(report).toContainText('failed tests: 0/')
})

test('runs storage targeting and spatial regression diagnostics in the browser', async ({
  page,
}) => {
  await page.goto('/diagnostics')
  await dataCy(page, 'diagnostics-run-level').click()
  await page.getByRole('option', { name: 'L3 · Release checks', exact: true }).click()
  const cases = [
    [
      'testWebResearchPlannerUsesStructuredStorageTargetArguments',
      'Test Web Research Planner Uses Structured Storage Target Arguments',
    ],
    ['testSpatialCandidatesLargePolygon', 'Test Spatial Candidates Large Polygon'],
    [
      'testSpatialStudyStopsDuringRejectedGridScan',
      'Test Spatial Study Stops During Rejected Grid Scan',
    ],
    [
      'testSpatialCandidatesStopDuringFeatureRejections',
      'Test Spatial Candidates Stop During Feature Rejections',
    ],
  ]
  for (const [index, [filter, label]] of cases.entries()) {
    await page.getByLabel('Filter tests').fill(filter!)
    const button = page.getByRole('button', { name: label!, exact: true }).first()
    if (index === 0) {
      await page.getByText('tests', { exact: true }).first().click()
      await page.getByText('Tests', { exact: true }).first().click()
    }
    await expect(button).toBeVisible()
    await button.click()
    await expect(dataCy(page, 'test-finished')).toContainText('Test Finished')
    await expect(dataCy(page, 'diagnostics-result')).toContainText('status: OK')
    await expect(dataCy(page, 'diagnostics-result')).toContainText('failed tests: 0/1')
  }
})

test('runs graph locks and pinned source cache diagnostics in the browser', async ({ page }) => {
  await page.goto('/diagnostics')
  await dataCy(page, 'diagnostics-run-level').click()
  await page.getByRole('option', { name: 'L3 · Release checks', exact: true }).click()
  const cases = [
    [
      'testGraphAuthoringCommittedSourceLockPinsImports',
      'Test Graph Authoring Committed Source Lock Pins Imports',
    ],
    [
      'testGraphAuthoringGitSourcesPreservePinsWithoutDataOrHistory',
      'Test Graph Authoring Git Sources Preserve Pins Without Data Or History',
    ],
    [
      'testSourceSnapshotUnchangedRefreshReusesCalculations',
      'Test Source Snapshot Unchanged Refresh Reuses Calculations',
    ],
    [
      'testSourceSnapshotRebuildsMissingOutputWithRetainedCacheIndex',
      'Test Source Snapshot Rebuilds Missing Output With Retained Cache Index',
    ],
    [
      'testPublicDesignRepositoriesLoadImmutableRootClosures',
      'Test Public Design Repositories Load Immutable Root Closures',
    ],
  ]
  for (const [index, [filter, label]] of cases.entries()) {
    await page.getByLabel('Filter tests').fill(filter!)
    if (index === 0) {
      await page.getByText('tests', { exact: true }).first().click()
      await page.getByText('Tests', { exact: true }).first().click()
    }
    await page.getByRole('button', { name: label!, exact: true }).first().click()
    await expect(dataCy(page, 'test-finished')).toContainText('Test Finished')
    await expect(dataCy(page, 'diagnostics-result')).toContainText(label!)
    await expect(dataCy(page, 'diagnostics-result')).toContainText('status: OK')
    await expect(dataCy(page, 'diagnostics-result')).toContainText('failed tests: 0/1')
  }
})

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
    await selectLlmModel(page, 'google', 'gemini-3.8-flash')
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

    const summaryMatch = diagnosticsText.match(/failed tests:\s*0\/(\d+)/i)
    expect(summaryMatch).not.toBeNull()
    const totalTests = Number(summaryMatch?.[1] ?? 0)
    expect(totalTests).toBeGreaterThan(0)
    expect(diagnosticsText.match(/:\s+OK\b/g)?.length ?? 0).toBe(totalTests)
    expect(diagnosticsText).not.toContain('status: ERROR')
  })

  test('runs the shared document retrieval diagnostic and validates stored PDFs', async ({
    page,
  }) => {
    if (!onlineEnv) throw new Error('online env missing')
    const trace = await captureBrowserChatCompletionTrace(page)
    try {
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

      await page.goto('/settings/sandbox-network')
      const fetchTransport = dataCy(page, 'sandbox-fetch-transport')
      await fetchTransport.click()
      if (process.env.PLAYWRIGHT_LOCAL_PRODUCTION === '1') {
        await page
          .getByRole('option', { name: 'Secure WSS tunnel (recommended)', exact: true })
          .click()
      } else {
        await page.getByRole('option', { name: 'CORS proxy', exact: true }).click()
        await dataCy(page, 'check-cors-proxy').click()
        await expect(dataCy(page, 'cors-proxy-status')).toContainText('CORS proxy is available')
      }
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
      await trace?.saveRuntimeConfig()
      await page.locator('#ty-space-menu').click()
      await page.getByText('About', { exact: true }).click()
      await page.getByRole('link', { name: 'Open Diagnostics', exact: true }).click()
      await expect(page).toHaveURL(/\/diagnostics$/)

      await dataCy(page, 'diagnostics-run-level').click()
      await page.getByRole('option', { name: 'L3 · Release checks', exact: true }).click()
      await page
        .getByLabel('Filter tests')
        .fill('testDocumentRetrievalStoresOfficialFederalRulesPdf')
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
      expect(diagnosticsText, browserFailures.join('\n')).not.toContain('status: ERROR')
      expect(diagnosticsText).toMatch(/failed tests: 0\/1/i)

      expect(diagnosticsText, browserFailures.join('\n')).toContain('status: MODEL PASS')
      expect(diagnosticsText).toMatch(/model capability score: 1\/1/i)
      expect(diagnosticsText).toContain('websearch auto is supplied by the chain builder')
      expect(diagnosticsText).toMatch(/sha256:\s+sha256:[A-Za-z0-9_-]{43}/i)
      expect(diagnosticsText).toContain('finished all tests!')
    } finally {
      await trace?.finish()
    }
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

  test('plans separate weather and animated-clock tool tasks', async ({ page }) => {
    test.info().annotations.push({
      type: 'model-based',
      description: 'Scores whether the selected model completes a multi-tool workflow.',
    })
    test.setTimeout(toolWorkflowTimeoutMs + 30_000)
    if (!onlineEnv) throw new Error('online env missing')
    const trace = await captureBrowserChatCompletionTrace(page)
    await page.goto('/settings/sandbox-network')
    await dataCy(page, 'sandbox-fetch-transport').click()
    await page.getByRole('option', { name: 'Direct host fetch', exact: true }).click()
    const stopCapabilityDialogs = startCapabilityDialogHandler(page)
    await page.goto('/')
    await expect(page.getByPlaceholder('Describe what you want to build')).toBeVisible()
    await expectTaskyonReady(page)

    await addAiServices(page, onlineEnv)
    await page.getByLabel('go to chat').click()
    await selectLlmModel(page, clockProvider, clockModelId)
    await trace?.saveRuntimeConfig()
    await page.goto('/diagnostics')

    await dataCy(page, 'diagnostics-run-level').click()
    await page.getByRole('option', { name: 'L3 · Release checks', exact: true }).click()
    await page.getByLabel('Filter tests').fill('testTaskyonUiListsAndUsesAvailableTools')
    await page.getByText('guiTests', { exact: true }).click()
    await page.getByText('Tests', { exact: true }).click()
    const diagnosticButton = page
      .getByRole('button', { name: 'Test Taskyon Ui Lists And Uses Available Tools', exact: true })
      .first()
    await expect(diagnosticButton).toBeVisible()

    await diagnosticButton.click()
    await expect(dataCy(page, 'test-finished')).toContainText('Test Finished', {
      timeout: toolWorkflowTimeoutMs,
    })
    const diagnosticsResult = dataCy(page, 'diagnostics-result')
    const diagnosticsText = (await diagnosticsResult.textContent()) ?? ''
    await trace?.finish()
    test.skip(
      diagnosticsText.includes('status: MODEL MISS'),
      'The selected model did not satisfy this capability evaluation.',
    )
    await expect(diagnosticsResult).toContainText('status: MODEL PASS')
    await expect(diagnosticsResult).toContainText('newWindowOpener')
    await expect(diagnosticsResult).toContainText('finished all tests!')
    stopCapabilityDialogs()
  })
})
