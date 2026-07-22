import {
  runTycSession,
  testTaskRendererDoesNotPrintTransientWorkerProgress as runTaskRendererDoesNotPrintTransientWorkerProgress,
  testTaskRendererHidesHiddenWorkerProgress as runTaskRendererHidesHiddenWorkerProgress,
  testWorkerStatusTextHidesHiddenTools as runWorkerStatusTextHidesHiddenTools,
  testCliConcurrentSessionsStartWithSharedHome as runCliConcurrentSessionsStartWithSharedHome,
  testPromptHistoryCyclesPreviousInputWithArrowKeys as runPromptHistoryCyclesPreviousInputWithArrowKeys,
  testQuitPromptCtrlCCancelsAndCtrlDExits as runQuitPromptCtrlCCancelsAndCtrlDExits,
  testCliOverpassMapToolPrintsHtmlPreviewLink as runCliOverpassMapToolPrintsHtmlPreviewLink,
  testTaskRendererWritesHtmlPreviewForAssistantHtml as runTaskRendererWritesHtmlPreviewForAssistantHtml,
} from '../../tests/cliE2eDiagnostics'

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message)
}

const forbiddenStartupRegressions = [
  'does not provide an export named',
  'getExecutionTaskChain is not implemented',
  'getExecutionTaskChain is not available for this external tool client',
  '[function|functioncall]\n  name: entryNode',
]

export const testCliHelloWorldProducesAssistantResponse = async () => {
  const result = await runTycSession({
    testName: 'testCliHelloWorldProducesAssistantResponse',
    steps: [
      { waitFor: 'tycli ready.', input: 'hello world\n' },
      {
        waitFor: '[assistant|message]',
        failOn: [
          '[system|error]',
          'Cannot connect to API',
          'No key configured',
          'does not provide an export named',
          'getExecutionTaskChain is not implemented',
          'getExecutionTaskChain is not available for this external tool client',
        ],
        input: '/exit\n',
      },
    ],
    env: { TYCLI_HOTKEY_MENUS: '0' },
    timeoutMs: 90_000,
    runner: 'pty',
  })

  assert(result.code === 0, `Expected exit code 0, got ${String(result.code)}\n${result.output}`)
  assert(
    result.output.includes('[assistant|message]'),
    `Expected assistant response in CLI output.\n${result.output}`,
  )
  for (const forbidden of forbiddenStartupRegressions) {
    assert(
      !result.output.includes(forbidden),
      `Unexpected CLI regression output "${forbidden}".\n${result.output}`,
    )
  }

  return { success: true }
}

testCliHelloWorldProducesAssistantResponse.description =
  'Starts yarn tycli, sends hello world through the configured provider, and expects an assistant response.'
testCliHelloWorldProducesAssistantResponse.timeoutMs = 110_000

export const testCliToolsListsDocumentationTools = async () => {
  const result = await runTycSession({
    testName: 'testCliToolsListsDocumentationTools',
    steps: [
      { waitFor: 'tycli ready.', input: '/tools\n' },
      {
        waitFor: 'documentationIndex',
        failOn: ['Fatal error', 'does not provide an export named'],
        input: '/exit\n',
      },
    ],
    env: { TYCLI_HOTKEY_MENUS: '0' },
    timeoutMs: 60_000,
    runner: 'pty',
  })

  assert(result.code === 0, `Expected exit code 0, got ${String(result.code)}\n${result.output}`)
  assert(
    result.output.includes('taskyonDocumentation'),
    `Expected taskyonDocumentation in CLI /tools output.\n${result.output}`,
  )
  assert(
    result.output.includes('documentationIndex'),
    `Expected documentationIndex in CLI /tools output.\n${result.output}`,
  )

  return { success: true }
}

testCliToolsListsDocumentationTools.description =
  'Starts yarn tycli, runs /tools, and verifies both runtime documentation tools are registered.'
testCliToolsListsDocumentationTools.timeoutMs = 70_000

export const testCliDocumentationQuestionCompletesWithoutFatal = async () => {
  const result = await runTycSession({
    testName: 'testCliDocumentationQuestionCompletesWithoutFatal',
    steps: [
      {
        waitFor: 'tycli ready.',
        input:
          'cool... According to the Taskyon docs, what is the difference between parentID and priorID in a tasknode?\n',
      },
      {
        waitFor: 'taskyonDocumentation',
        failOn: [
          'Fatal error',
          "Cannot find module '/workspace/src/register.ts'",
          'No key configured',
          'Cannot connect to API',
        ],
        input: '',
      },
      {
        waitFor: '| finished]',
        failOn: ['Fatal error', "Cannot find module '/workspace/src/register.ts'"],
        input: '/exit\n',
      },
    ],
    env: {
      TYCLI_HOTKEY_MENUS: '0',
      NODE_OPTIONS: '--import ./src/register.ts',
    },
    isolateHome: false,
    timeoutMs: 180_000,
    runner: 'pipe',
  })

  assert(result.code === 0, `Expected exit code 0, got ${String(result.code)}\n${result.output}`)
  assert(
    result.output.includes('taskyonDocumentation'),
    `Expected taskyonDocumentation to be called.\n${result.output}`,
  )
  assert(
    result.output.includes('parentID') && result.output.includes('priorID'),
    `Expected final answer to mention parentID and priorID.\n${result.output}`,
  )
  assert(!result.output.includes('Fatal error'), `Unexpected fatal error.\n${result.output}`)

  return { success: true }
}

testCliDocumentationQuestionCompletesWithoutFatal.description =
  'Starts yarn tycli, asks a Taskyon docs question through the real CLI, and verifies it exits without the inherited loader fatal.'
testCliDocumentationQuestionCompletesWithoutFatal.timeoutMs = 200_000

export const testCliQuitPromptCtrlCCancelsAndCtrlDExits = async () =>
  await runQuitPromptCtrlCCancelsAndCtrlDExits()

testCliQuitPromptCtrlCCancelsAndCtrlDExits.description =
  'Starts yarn tycli and verifies Ctrl+C cancels the quit prompt while Ctrl+D still exits.'
testCliQuitPromptCtrlCCancelsAndCtrlDExits.timeoutMs = 40_000

export const testCliPromptHistoryCyclesPreviousInputWithArrowKeys = async () =>
  await runPromptHistoryCyclesPreviousInputWithArrowKeys()

testCliPromptHistoryCyclesPreviousInputWithArrowKeys.description =
  'Starts yarn tycli and verifies Up replays persisted prompt history without literal escape bytes.'
testCliPromptHistoryCyclesPreviousInputWithArrowKeys.timeoutMs = 60_000

export const testCliTaskRendererDoesNotPrintTransientWorkerProgress = () =>
  runTaskRendererDoesNotPrintTransientWorkerProgress()

testCliTaskRendererDoesNotPrintTransientWorkerProgress.description =
  'Verifies tycli does not print transient worker progress as repeated transcript lines.'

export const testCliTaskRendererWritesHtmlPreviewForAssistantHtml = async () =>
  await runTaskRendererWritesHtmlPreviewForAssistantHtml()

testCliTaskRendererWritesHtmlPreviewForAssistantHtml.description =
  'Verifies tycli writes assistant HTML messages to a temporary preview file and prints a file URL.'

export const testCliOverpassMapToolPrintsHtmlPreviewLink = async () =>
  await runCliOverpassMapToolPrintsHtmlPreviewLink()

testCliOverpassMapToolPrintsHtmlPreviewLink.description =
  'Runs overpassMapTool through tycli client mode with a local Overpass mock and verifies the CLI prints an HTML preview file URL.'
testCliOverpassMapToolPrintsHtmlPreviewLink.timeoutMs = 100_000

export const testCliTaskRendererHidesHiddenWorkerProgress = () =>
  runTaskRendererHidesHiddenWorkerProgress()

testCliTaskRendererHidesHiddenWorkerProgress.description =
  'Verifies tycli suppresses worker progress for tools hidden from chat.'

export const testCliWorkerStatusTextHidesHiddenTools = () => runWorkerStatusTextHidesHiddenTools()

testCliWorkerStatusTextHidesHiddenTools.description =
  'Verifies tycli does not keep a stale visible spinner label when hidden tools are processing.'

export const testCliConcurrentSessionsStartWithSharedHome = async () =>
  await runCliConcurrentSessionsStartWithSharedHome()

testCliConcurrentSessionsStartWithSharedHome.description =
  'Starts two tycli processes with one shared CLI home and verifies both reach the prompt without PGlite storage contention.'
testCliConcurrentSessionsStartWithSharedHome.timeoutMs = 100_000
