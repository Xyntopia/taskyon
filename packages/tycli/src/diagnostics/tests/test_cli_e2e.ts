import { readFile } from 'node:fs/promises'
import type { DiagnosticsTestContext } from '@taskyon/common/modules/diagnosticsRunner'
import {
  runCliE2eSession,
  testTaskRendererDoesNotPrintTransientWorkerProgress as runTaskRendererDoesNotPrintTransientWorkerProgress,
  testTaskRendererHidesHiddenWorkerProgress as runTaskRendererHidesHiddenWorkerProgress,
  testTaskRendererSummarizesHiddenFunctionCallsBeforeVisibleTask as runTaskRendererSummarizesHiddenFunctionCallsBeforeVisibleTask,
  testDelegatedSubtaskCountsOnlyItsExecutableFunctionCalls as runDelegatedSubtaskCountsOnlyItsExecutableFunctionCalls,
  testWorkerStatusTextHidesHiddenTools as runWorkerStatusTextHidesHiddenTools,
  testCliConcurrentSessionsStartWithSharedHome as runCliConcurrentSessionsStartWithSharedHome,
  testEmptyCliSessionDoesNotCreateConversationFile as runEmptyCliSessionDoesNotCreateConversationFile,
  testResumeConversationReportsStorageAndLogs as runResumeConversationReportsStorageAndLogs,
  testPromptHistoryWithoutHotkeyMenus as runPromptHistoryWithoutHotkeyMenus,
  testPromptHistoryWithHotkeyMenus as runPromptHistoryWithHotkeyMenus,
  testQuitPromptCtrlDExits as runQuitPromptCtrlDExits,
  testQuitPromptCtrlCCanBeCompletedByCtrlD as runQuitPromptCtrlCCanBeCompletedByCtrlD,
  testQuitPromptCancellationReturnsToCtrlD as runQuitPromptCancellationReturnsToCtrlD,
  testCtrlCCancelsModelMenuAndKeepsPromptUsable as runCtrlCCancelsModelMenuAndKeepsPromptUsable,
  testEscapeCancelsModelMenuAndKeepsPromptUsable as runEscapeCancelsModelMenuAndKeepsPromptUsable,
  testCliOverpassMapToolPrintsHtmlPreviewLink as runCliOverpassMapToolPrintsHtmlPreviewLink,
  testTaskRendererWritesHtmlPreviewForAssistantHtml as runTaskRendererWritesHtmlPreviewForAssistantHtml,
  testTaskRendererDoesNotEchoUserPromptInput as runTaskRendererDoesNotEchoUserPromptInput,
  testCliClarificationToolAcceptsTypedAnswers as runCliClarificationToolAcceptsTypedAnswers,
  testBracketedPastePreservesMultilinePrompt as runBracketedPastePreservesMultilinePrompt,
} from '../../tests/cliE2eDiagnostics'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function assertNoSubmittedBlankLine(output: string, marker: string) {
  const markerIndex = output.indexOf(marker)
  assert(markerIndex >= 0, `Expected output to contain ${marker}.\n${output}`)
  const transition = output.slice(Math.max(0, markerIndex - 200), markerIndex)
  assert(
    !transition.includes('\r\r\n\u001b[1A'),
    `Expected menu selection not to leave a submitted blank line.\n${output}`,
  )
  assert(
    !transition.includes('\u001b[2K\r\n\u001b[?2004l'),
    `Expected menu selection not to leave a cleanup newline before the result.\n${output}`,
  )
}

const forbiddenStartupRegressions = [
  'does not provide an export named',
  'getExecutionTaskChain is not implemented',
  'getExecutionTaskChain is not available for this external tool client',
  '[function|functioncall]\n  name: cliFlow',
]

export const testTaskRendererDoesNotEchoUserPrompt = runTaskRendererDoesNotEchoUserPromptInput

testTaskRendererDoesNotEchoUserPrompt.description =
  'Renders function calls and tool results as compact single-line summaries.'

export const testCliBracketedPastePreservesMultilinePrompt =
  runBracketedPastePreservesMultilinePrompt
testCliBracketedPastePreservesMultilinePrompt.description =
  runBracketedPastePreservesMultilinePrompt.description
testCliBracketedPastePreservesMultilinePrompt.timeoutMs =
  runBracketedPastePreservesMultilinePrompt.timeoutMs

export const testCtrlCCancelsModelMenuAndKeepsPromptUsable = Object.assign(
  runCtrlCCancelsModelMenuAndKeepsPromptUsable,
  {
    description: 'Ctrl-C cancellation returns directly to a usable prompt.',
    timeoutMs: 60_000,
  },
)

export const testEscapeCancelsModelMenuAndKeepsPromptUsable = Object.assign(
  runEscapeCancelsModelMenuAndKeepsPromptUsable,
  {
    description: 'Escape cancellation returns directly to a usable prompt.',
    timeoutMs: 60_000,
  },
)

export const testCliSlashMenuSelectionDoesNotLeaveSubmittedBlankLine = async () => {
  const result = await runCliE2eSession({
    testName: 'testCliSlashMenuSelectionDoesNotLeaveSubmittedBlankLine',
    steps: [
      { waitFor: 'Slash commands:', input: '/' },
      { waitFor: 'filter:', input: 'cost' },
      { delayMs: 100, input: '\n' },
      { waitFor: 'No active chat tree yet.', input: '/exit\n' },
    ],
    env: { TYCLI_HOTKEY_MENUS: '1' },
    runner: 'pty',
  })

  assert(result.code === 0, `Expected exit code 0, got ${String(result.code)}\n${result.output}`)
  assertNoSubmittedBlankLine(result.output, 'No active chat tree yet.')
  return { success: true }
}

testCliSlashMenuSelectionDoesNotLeaveSubmittedBlankLine.description =
  'Selecting a slash command from the raw menu returns to the prompt without an extra blank line.'
testCliSlashMenuSelectionDoesNotLeaveSubmittedBlankLine.timeoutMs = 60_000

export const testCliFileMenuSelectionDoesNotLeaveSubmittedBlankLine = async () => {
  const result = await runCliE2eSession({
    testName: 'testCliFileMenuSelectionDoesNotLeaveSubmittedBlankLine',
    steps: [
      { waitFor: 'Slash commands:', input: '@' },
      { waitFor: 'Files (@)', input: 'package.json' },
      { waitFor: 'filter: package.json', input: '\n' },
      { waitFor: 'Added file context: package.json', input: '/exit\n' },
    ],
    env: { TYCLI_HOTKEY_MENUS: '1' },
    runner: 'pty',
  })

  assert(result.code === 0, `Expected exit code 0, got ${String(result.code)}\n${result.output}`)
  assertNoSubmittedBlankLine(result.output, 'Added file context: package.json')
  return { success: true }
}

testCliFileMenuSelectionDoesNotLeaveSubmittedBlankLine.description =
  'Selecting a file from the raw menu returns to the prompt without an extra blank line.'
testCliFileMenuSelectionDoesNotLeaveSubmittedBlankLine.timeoutMs = 60_000

export const testCliModelMenuNavigationDoesNotAccumulateBlankLines = async () => {
  const result = await runCliE2eSession({
    testName: 'testCliModelMenuNavigationDoesNotAccumulateBlankLines',
    steps: [
      { waitFor: 'Slash commands:', input: '/model\n' },
      { waitFor: 'Model menu', input: '\u001b[B\u001b[A' },
      { delayMs: 100, input: '\u0003' },
      { waitFor: 'Menu cancelled.', input: '' },
    ],
    env: { TYCLI_HOTKEY_MENUS: '0' },
    runner: 'pty',
  })

  assert(result.code === 0, `Expected exit code 0, got ${String(result.code)}\n${result.output}`)
  assert(
    /\| idle\]\r\n\r\n/.test(result.output),
    `Expected a blank line between the live status and prompt.\n${result.output}`,
  )
  const modelMenuStart = result.output.indexOf('Model menu')
  const cancellationStart = result.output.indexOf('Ctrl-C received.')
  const modelMenuOutput = result.output.slice(
    modelMenuStart >= 0 ? modelMenuStart : 0,
    cancellationStart >= 0 ? cancellationStart : result.output.length,
  )
  const cursorClearCommand = '\u001b[1A\r\u001b[2K'
  const clearCommandCount = modelMenuOutput.split(cursorClearCommand).length - 1
  assert(
    clearCommandCount === 21,
    `Expected two seven-line model menu redraws plus cleanup with cursor resets, got ${String(clearCommandCount)}.\n${result.output}`,
  )
  assert(
    result.output.includes('\x1b[2K\r\nCtrl-C received.'),
    `Expected a blank line between the closed menu and the cancellation message.\n${result.output}`,
  )
  return { success: true }
}

testCliModelMenuNavigationDoesNotAccumulateBlankLines.description =
  'Up and Down navigation redraws the model menu without accumulating blank lines.'
testCliModelMenuNavigationDoesNotAccumulateBlankLines.timeoutMs = 60_000

export const testCliHelloWorldProducesAssistantResponse = async (
  context?: DiagnosticsTestContext,
) => {
  const result = await runCliE2eSession({
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
        waitFor: '| finished',
        input: '/exit\n',
      },
    ],
    env: { TYCLI_HOTKEY_MENUS: '0' },
    isolateHome: false,
    timeoutMs: 90_000,
    runner: 'pty',
  })

  assert(result.code === 0, `Expected exit code 0, got ${String(result.code)}\n${result.output}`)
  assert(
    result.output.includes('[assistant|message]'),
    `Expected assistant response in CLI output.\n${result.output}`,
  )
  if (context?.selectedApi && context.model) {
    assert(
      result.output.includes(`[${context.selectedApi} | ${context.model} |`),
      `Expected CLI to reuse ${context.selectedApi} / ${context.model}.\n${result.output}`,
    )
  }
  for (const forbidden of forbiddenStartupRegressions) {
    assert(
      !result.output.includes(forbidden),
      `Unexpected CLI regression output "${forbidden}".\n${result.output}`,
    )
  }
  const saveMatch = result.output.match(/Conversation saved: (.+\.md)/)
  assert(saveMatch?.[1], `Expected a saved conversation path.\n${result.output}`)
  const savedConversationPath = saveMatch[1]
  const markdown = await readFile(savedConversationPath.trim(), 'utf8')
  assert(
    markdown.includes('role: assistant'),
    `Expected the saved conversation to contain the displayed assistant response.\n${markdown}`,
  )
  assert(
    !markdown.includes('type: error'),
    `Expected the saved conversation not to contain errors.\n${markdown}`,
  )

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
  const result = await runCliE2eSession({
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
        waitFor: 'Allow openMeteoWeatherTool to read https://api.open-meteo.com',
        failOn: ['Fatal error', '[system|error]'],
        input: 'y\r',
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

export const testCliFocusedSearchFindsANonPinnedTool = async () => {
  const prompt = [
    'Use the current weather capability for latitude 32.7157 and longitude -117.1611.',
    'The weather capability is intentionally not pinned in the initial tool window.',
    'Use focused tool search immediately if it is not already callable. Do not request a broad tool overview and do not use toolSearcher.',
    'After the weather tool succeeds, begin the final answer with WEATHER_NON_PINNED_COMPLETE.',
  ].join('\n\n')
  const result = await runCliE2eSession({
    testName: 'testCliFocusedSearchFindsANonPinnedTool',
    steps: [
      {
        waitFor: 'tycli ready.',
        input: `\u001b[200~${prompt}\u001b[201~`,
      },
      { delayMs: 200, input: '\r' },
      {
        waitFor: 'Allow openMeteoWeatherTool to read https://api.open-meteo.com',
        failOn: ['Fatal error', 'No key configured', 'Cannot connect to API', '[system|error]'],
        input: '',
      },
      { input: 'y\r' },
      {
        waitFor: 'WEATHER_NON_PINNED_COMPLETE',
        failOn: ['Fatal error', '[system|error]'],
        input: '',
      },
    ],
    acceptOutputAsExit: 'WEATHER_NON_PINNED_COMPLETE',
    env: { TYCLI_HOTKEY_MENUS: '0' },
    isolateHome: false,
    timeoutMs: 180_000,
    runner: 'pty',
  })

  assert(result.code === 0, `Expected exit code 0, got ${result.code}\n${result.output}`)
  assert(
    result.output.includes('[function|functioncall] openMeteoWeatherTool latitude=32.7157'),
    `Expected the non-pinned weather tool to be discovered and called.\n${result.output}`,
  )
  return { success: true }
}

testCliFocusedSearchFindsANonPinnedTool.description =
  'Verifies that CLI focused tool search discovers and executes a required tool absent from pinned tools.'
testCliFocusedSearchFindsANonPinnedTool.timeoutMs = 200_000

export const testCliToolsListsDocumentationTools = async () => {
  const result = await runCliE2eSession({
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
  assert(
    result.output.includes('dagGraphProject'),
    `Expected dagGraphProject in CLI /tools output.\n${result.output}`,
  )

  return { success: true }
}

testCliToolsListsDocumentationTools.description =
  'Starts yarn tycli, runs /tools, and verifies both runtime documentation tools are registered.'
testCliToolsListsDocumentationTools.timeoutMs = 70_000

export const testCliDocumentationQuestionCompletesWithoutFatal = async () => {
  const result = await runCliE2eSession({
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
  const result = await runCliE2eSession({
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

export const testCliAiWorkstationCreatesAndOptimizesDagGraph = async () => {
  const result = await runCliE2eSession({
    testName: 'testCliAiWorkstationCreatesAndOptimizesDagGraph',
    steps: [
      {
        waitFor: 'tycli ready.',
        input:
          'I want to design a local AI workstation. Please start by asking me the most important questions about my budget, target models, power limits, noise constraints, and what I want to run locally.\n',
      },
      {
        waitFor: '[assistant|message]',
        failOn: [
          '[system|error]',
          'Cannot connect to API',
          'No key configured',
          'does not provide an export named',
        ],
        input: '',
      },
      {
        waitFor: '| finished |',
        failOn: [
          '[system|error]',
          'Cannot connect to API',
          'No key configured',
          'does not provide an export named',
        ],
        input:
          'Budget is about 2600 USD before tax. I want to run 7B and 14B models locally, experiment with 32B quantized if possible, and do light coding agents. Power should stay under about 750W from the wall, noise should be office-friendly, and I prefer Linux-compatible commodity parts. Please now build this as a Taskyon DAG graph project using dagGraphProject: create fresh TypeScript nodes, patch at least one node after creating it, run a study over at least three GPU/CPU/RAM/storage variants, and recommend the best variant with the relevant hashes.\n',
      },
      {
        waitFor: 'dagGraphProject',
        failOn: [
          '[system|error]',
          'Cannot connect to API',
          'No key configured',
          'does not provide an export named',
        ],
        input: '',
      },
      {
        waitFor: 'createNode',
        failOn: ['[system|error]', 'Fatal error', 'does not provide an export named'],
        input: '',
      },
      {
        waitFor: 'patchNode',
        failOn: ['[system|error]', 'Fatal error', 'does not provide an export named'],
        input: '',
      },
      {
        waitFor: 'studyRoot',
        failOn: ['[system|error]', 'Fatal error', 'does not provide an export named'],
        input: '',
      },
      {
        waitFor: 'dagGraphStudyResult',
        failOn: ['[system|error]', 'Fatal error', 'does not provide an export named'],
        delayMs: 2_000,
        input: '/exit\n',
      },
    ],
    env: { TYCLI_HOTKEY_MENUS: '0' },
    isolateHome: false,
    timeoutMs: 320_000,
    runner: 'pty',
  })

  const output = result.output
  const lowerOutput = output.toLowerCase()
  assert(result.code === 0, `Expected exit code 0, got ${String(result.code)}\n${output}`)
  assert(output.includes('dagGraphProject'), `Expected dagGraphProject to be called.\n${output}`)
  assert(output.includes('createNode'), `Expected at least one createNode action.\n${output}`)
  assert(
    output.includes('patchNode') || output.includes('graphPatchResult'),
    `Expected the graph to be patched after initial creation.\n${output}`,
  )
  assert(
    output.includes('studyRoot') || output.includes('dagGraphStudyResult'),
    `Expected a studyRoot optimization run.\n${output}`,
  )
  assert(
    lowerOutput.includes('recommend') || lowerOutput.includes('best'),
    `Expected a final recommendation or best variant.\n${output}`,
  )

  return { success: true }
}

testCliAiWorkstationCreatesAndOptimizesDagGraph.description =
  'Starts tycli with the local AI workstation prompt and verifies the agent creates, patches, studies, and recommends from a persisted DAG graph.'
testCliAiWorkstationCreatesAndOptimizesDagGraph.timeoutMs = 340_000

export const testCliQuitPromptCtrlDExits = async () => await runQuitPromptCtrlDExits()
testCliQuitPromptCtrlDExits.description = 'Ctrl+D exits directly from the main prompt.'
testCliQuitPromptCtrlDExits.timeoutMs = 40_000

export const testCliQuitPromptCtrlCCanBeCompletedByCtrlD = async () =>
  await runQuitPromptCtrlCCanBeCompletedByCtrlD()
testCliQuitPromptCtrlCCanBeCompletedByCtrlD.description =
  'Ctrl+D completes the quit prompt opened by Ctrl+C.'
testCliQuitPromptCtrlCCanBeCompletedByCtrlD.timeoutMs = 40_000

export const testCliQuitPromptCancellationReturnsToCtrlD = async () =>
  await runQuitPromptCancellationReturnsToCtrlD()
testCliQuitPromptCancellationReturnsToCtrlD.description =
  'Cancelling the quit prompt returns to a main prompt that Ctrl+D can exit.'
testCliQuitPromptCancellationReturnsToCtrlD.timeoutMs = 40_000

export const testCliPromptHistoryWithoutHotkeyMenus = async () =>
  await runPromptHistoryWithoutHotkeyMenus()
testCliPromptHistoryWithoutHotkeyMenus.description =
  'Up replays persisted prompt history with hotkey menus disabled.'
testCliPromptHistoryWithoutHotkeyMenus.timeoutMs = 60_000

export const testCliPromptHistoryWithHotkeyMenus = async () =>
  await runPromptHistoryWithHotkeyMenus()
testCliPromptHistoryWithHotkeyMenus.description =
  'Up replays persisted prompt history with hotkey menus enabled.'
testCliPromptHistoryWithHotkeyMenus.timeoutMs = 60_000

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

export const testCliTaskRendererSummarizesHiddenFunctionCallsBeforeVisibleTask = () =>
  runTaskRendererSummarizesHiddenFunctionCallsBeforeVisibleTask()

testCliTaskRendererSummarizesHiddenFunctionCallsBeforeVisibleTask.description =
  'Verifies tycli prints one compact marker per hidden function-call node before the next visible task.'

export const testCliDelegatedSubtaskCountsOnlyItsExecutableFunctionCalls = () =>
  runDelegatedSubtaskCountsOnlyItsExecutableFunctionCalls()

testCliDelegatedSubtaskCountsOnlyItsExecutableFunctionCalls.description =
  'Verifies a delegated subtask summary counts its entry node and descendant function calls without counting messages or unrelated branches.'

export const testCliWorkerStatusTextHidesHiddenTools = () => runWorkerStatusTextHidesHiddenTools()

testCliWorkerStatusTextHidesHiddenTools.description =
  'Verifies tycli does not keep a stale visible spinner label when hidden tools are processing.'

export const testCliConcurrentSessionsStartWithSharedHome = async () =>
  await runCliConcurrentSessionsStartWithSharedHome()

testCliConcurrentSessionsStartWithSharedHome.description =
  'Starts two tycli processes with one shared CLI home and verifies both reach the prompt without PGlite storage contention.'
testCliConcurrentSessionsStartWithSharedHome.timeoutMs = 100_000

export const testCliEmptySessionDoesNotCreateConversationFile = async () =>
  await runEmptyCliSessionDoesNotCreateConversationFile()

testCliEmptySessionDoesNotCreateConversationFile.description =
  'Starts and exits tycli without a message and verifies no Markdown conversation file is created.'
testCliEmptySessionDoesNotCreateConversationFile.timeoutMs = 60_000

export const testCliResumeConversationReportsStorageAndLogs = async () =>
  await runResumeConversationReportsStorageAndLogs()

testCliResumeConversationReportsStorageAndLogs.description =
  'Imports a saved Markdown conversation and reports both the source and current session locations.'
testCliResumeConversationReportsStorageAndLogs.timeoutMs = 60_000
