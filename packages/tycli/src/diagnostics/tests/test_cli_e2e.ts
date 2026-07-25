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
  testCliClarificationToolAcceptsTypedAnswers as runCliClarificationToolAcceptsTypedAnswers,
  testBracketedPastePreservesMultilinePrompt as runBracketedPastePreservesMultilinePrompt,
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

export const testCliBracketedPastePreservesMultilinePrompt =
  runBracketedPastePreservesMultilinePrompt
testCliBracketedPastePreservesMultilinePrompt.description =
  runBracketedPastePreservesMultilinePrompt.description
testCliBracketedPastePreservesMultilinePrompt.timeoutMs =
  runBracketedPastePreservesMultilinePrompt.timeoutMs

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
        input: '',
      },
      {
        waitFor: '| finished]',
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

export const testCliListsAndUsesAvailableTools = async () => {
  const prompt = [
    'Complete these as two separate sequential delegated tasks.',
    'First, list every tool currently available to you using its exact tool name, with one name per line between AVAILABLE_TOOLS_BEGIN and AVAILABLE_TOOLS_END.',
    'Second, get the current weather for latitude 32.7157 and longitude -117.1611 and begin that result with WEATHER_TASK_COMPLETE.',
  ].join('\n\n')
  const result = await runTycSession({
    testName: 'testCliListsAndUsesAvailableTools',
    steps: [
      {
        waitFor: 'tycli ready.',
        input: `\u001b[200~${prompt}\u001b[201~`,
      },
      { delayMs: 200, input: '\r' },
      {
        waitFor: 'name: taskPlanner',
        failOn: ['Fatal error', 'No key configured', 'Cannot connect to API', '[system|error]'],
        input: '',
      },
      {
        waitFor: 'name: toolSearcher',
        failOn: ['Fatal error', '[system|error]', '| finished]'],
        input: '',
      },
      {
        waitFor: 'name: openMeteoWeatherTool',
        failOn: [
          'Fatal error',
          'No key configured',
          'Cannot connect to API',
          '[system|error]',
          'no live weather tool',
          'no live weather API',
          '| finished]',
        ],
        input: '',
      },
      {
        waitFor: 'WEATHER_TASK_COMPLETE',
        failOn: ['Fatal error', '[system|error]'],
        input: '',
      },
    ],
    acceptOutputAsExit: 'WEATHER_TASK_COMPLETE',
    env: { TYCLI_HOTKEY_MENUS: '0' },
    isolateHome: false,
    timeoutMs: 300_000,
    runner: 'pty',
  })

  assert(result.code === 0, `Expected exit code 0, got ${String(result.code)}\n${result.output}`)
  const toolListStart = result.output.lastIndexOf('AVAILABLE_TOOLS_BEGIN')
  const toolListEnd = result.output.indexOf('AVAILABLE_TOOLS_END', toolListStart)
  assert(
    toolListStart >= 0 && toolListEnd > toolListStart,
    `Expected a bounded available-tool list in the assistant response.\n${result.output}`,
  )
  const listedTools = result.output.slice(toolListStart, toolListEnd)
  for (const toolName of ['taskPlanner', 'gitlab', 'openMeteoWeatherTool']) {
    assert(
      listedTools.includes(toolName),
      `Expected available-tool answer to include ${toolName}.\n${result.output}`,
    )
  }
  assert(
    result.output.includes('name: openMeteoWeatherTool'),
    `Expected the weather request to call openMeteoWeatherTool.\n${result.output}`,
  )
  assert(
    result.output.includes('name: toolSearcher'),
    `Expected the available-tool request to call toolSearcher.\n${result.output}`,
  )
  assert(
    result.output.includes('name: taskPlanner'),
    `Expected taskPlanner to create two delegated tasks.\n${result.output}`,
  )

  return { success: true }
}

testCliListsAndUsesAvailableTools.description =
  'Starts tycli, verifies that Taskyon plans separate tool-list and weather tasks, and lets each delegated entry node choose its relevant tool.'
testCliListsAndUsesAvailableTools.timeoutMs = 320_000

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

export const testCliTaskPlannerUsesContractedSequentialHandoffs = async () => {
  const result = await runTycSession({
    testName: 'testCliTaskPlannerUsesContractedSequentialHandoffs',
    steps: [
      {
        waitFor: 'tycli ready.',
        input:
          [
            'Use taskPlanner exactly once with two sequential task objects.',
            'The first task must act as a system architect, set allowedTools to exactly [bash], call bash exactly once to inspect the first 40 lines of packages/tycli/README.md, and return a structured result with a summary string and evidence string array.',
            'The second task must set allowedTools to an empty array, use the first task handoff to explain the documented tycli workflow without reading the file or calling bash again, include the exact evidence phrase Node-first Taskyon CLI, and begin its final response with HANDOFF_ONLY_COMPLETE.',
            'Give both tasks explicit doneWhen criteria. Do not run the tasks in parallel.',
          ].join(' ') + '\n',
      },
      {
        waitFor: 'name: taskPlanner',
        failOn: ['Fatal error', 'No key configured', 'Cannot connect to API'],
        input: '',
      },
      {
        waitFor: '[queue]',
        failOn: ['Fatal error', '[system|error]'],
        input: '',
      },
      {
        waitFor: 'HANDOFF_ONLY_COMPLETE ',
        failOn: ['Fatal error', '[system|error]'],
        input: '',
      },
    ],
    acceptOutputAsExit: 'HANDOFF_ONLY_COMPLETE ',
    env: { TYCLI_HOTKEY_MENUS: '0' },
    isolateHome: false,
    timeoutMs: 300_000,
    runner: 'pty',
  })

  assert(result.code === 0, `Expected exit code 0, got ${String(result.code)}\n${result.output}`)
  assert(
    result.output.includes('agentInstructions') &&
      result.output.includes('doneWhen') &&
      result.output.includes('mode: structured') &&
      result.output.includes('allowedTools: []'),
    `Expected taskPlanner to receive explicit task contracts.\n${result.output}`,
  )
  assert(
    result.output.includes('[queue]'),
    `Expected tycli to show pending planner work above thinking output.\n${result.output}`,
  )
  const bashCalls = result.output.split('  name: bash').length - 1
  assert(
    bashCalls === 1,
    `Expected exactly one bash inspection across sequential tasks, got ${bashCalls}.\n${result.output}`,
  )
  const handoffResponse = result.output.slice(result.output.lastIndexOf('HANDOFF_ONLY_COMPLETE '))
  assert(
    handoffResponse.includes('Node-first Taskyon CLI') &&
      !handoffResponse.includes('handoff content in the visible context'),
    `Expected the tool-free second task to consume the structured first-task handoff.\n${result.output}`,
  )
  assert(!result.output.includes('Fatal error'), `Unexpected fatal error.\n${result.output}`)

  return { success: true, bashCalls }
}

testCliTaskPlannerUsesContractedSequentialHandoffs.description =
  'Starts tycli and verifies sequential task contracts hand off repository evidence without repeating discovery.'
testCliTaskPlannerUsesContractedSequentialHandoffs.timeoutMs = 320_000

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

export const testCliClarificationToolAcceptsTypedAnswers = async () =>
  await runCliClarificationToolAcceptsTypedAnswers()

testCliClarificationToolAcceptsTypedAnswers.description =
  'Starts tycli, calls askClarifyingQuestions through /client, and verifies typed option/custom answers complete cleanly.'
testCliClarificationToolAcceptsTypedAnswers.timeoutMs = 70_000

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
