import { readFile } from 'node:fs/promises'
import { stripVTControlCharacters } from 'node:util'
import { testCodexOauthCliUsesBrowserWorkspaceWithoutSecondPrompt as codexWorkspaceTest } from '../../tests/codexOauthDiagnostics'
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

export const testCodexOauthCliUsesBrowserWorkspaceWithoutSecondPrompt = codexWorkspaceTest

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
      { waitFor: 'prompt ready.', input: 'hello world\n' },
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
    'Use openMeteoWeatherTool for latitude 32.7157 and longitude -117.1611.',
    'After it succeeds, begin the final answer with WEATHER_TASK_COMPLETE.',
  ].join('\n\n')
  const result = await runCliE2eSession({
    testName: 'testCliListsAndUsesAvailableTools',
    steps: [
      { waitFor: 'prompt ready.', input: '/tools\n' },
      {
        waitFor: 'openMeteoWeatherTool',
        input: `\u001b[200~${prompt}\u001b[201~`,
      },
      { delayMs: 200, input: '\r' },
      { waitFor: '[function|functioncall] openMeteoWeatherTool', input: '' },
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
    timeoutMs: 180_000,
    runner: 'pty',
  })

  assert(result.code === 0, `Expected exit code 0, got ${String(result.code)}\n${result.output}`)
  for (const toolName of ['taskPlanner', 'gitlab', 'openMeteoWeatherTool']) {
    assert(
      result.output.includes(toolName),
      `Expected CLI /tools output to include ${toolName}.\n${result.output}`,
    )
  }
  assert(
    result.output.includes('[function|functioncall] openMeteoWeatherTool'),
    `Expected the weather request to call openMeteoWeatherTool.\n${result.output}`,
  )

  return { success: true }
}

testCliListsAndUsesAvailableTools.description =
  'Starts tycli, lists registered tools with /tools, then uses the weather tool in a chat request.'
testCliListsAndUsesAvailableTools.timeoutMs = 190_000

export const testCliFocusedSearchFindsANonPinnedTool = async () => {
  const prompt = [
    'Use the current weather capability for latitude 32.7157 and longitude -117.1611.',
    'The weather capability is intentionally not pinned in the initial tool window.',
    'Call toolSearcher immediately if the weather capability is not already callable.',
    'After the weather tool succeeds, begin the final answer with WEATHER_NON_PINNED_COMPLETE.',
  ].join('\n\n')
  const result = await runCliE2eSession({
    testName: 'testCliFocusedSearchFindsANonPinnedTool',
    steps: [
      {
        waitFor: 'prompt ready.',
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
      { waitFor: 'prompt ready.', input: '/tools\n' },
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
        waitFor: 'prompt ready.',
        input:
          'Do not answer from memory. First use selectTaskyonTools with a focused search for the exact tool name taskyonDocumentation, then call taskyonDocumentation to look this up: what is the difference between parentID and priorID in a tasknode? Cite the documentation page.\n',
      },
      {
        waitFor: '[function|functioncall] taskyonDocumentation',
        failOn: [
          'Fatal error',
          "Cannot find module '/workspace/src/register.ts'",
          'No key configured',
          'Cannot connect to API',
        ],
        input: '',
      },
      {
        waitFor: '| finished',
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
    result.output.includes('[function|functioncall] taskyonDocumentation'),
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
        waitFor: 'prompt ready.',
        input:
          'Use taskPlanner exactly once. Its tasks argument must be a JSON array with exactly two strings, not a string containing JSON. The first task: use bash once to inspect the first 40 lines of packages/tycli/README.md and summarize them with the exact evidence phrase Node-first Taskyon CLI. The second task: use the first task handoff to explain the documented tycli workflow without rereading the file, and begin your final response with HANDOFF_ONLY_COMPLETE followed by a space and the response on the same line. Keep the tasks sequential.\n',
      },
      {
        waitFor: '[function|functioncall] taskPlanner',
        failOn: ['Fatal error', 'No key configured', 'Cannot connect to API', '| finished'],
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
      {
        waitFor: '| finished',
        failOn: ['Fatal error', '[system|error]'],
        input: '/exit\n',
      },
    ],
    env: { TYCLI_HOTKEY_MENUS: '0' },
    isolateHome: false,
    timeoutMs: 300_000,
    runner: 'pty',
  })

  assert(result.code === 0, `Expected exit code 0, got ${String(result.code)}\n${result.output}`)
  assert(
    result.output.includes('[function|functioncall] taskPlanner'),
    `Expected taskPlanner to create the delegated task chain.\n${result.output}`,
  )
  assert(
    result.output.includes('[queue]'),
    `Expected tycli to show pending planner work above thinking output.\n${result.output}`,
  )
  const bashReadCalls = result.output
    .split('\n')
    .filter(
      (line) =>
        line.includes('[function|functioncall] bash ') && line.includes('packages/tycli/README.md'),
    )
  assert(
    bashReadCalls.length === 1,
    `Expected the README to be inspected exactly once, got ${bashReadCalls.length} reads.\n${result.output}`,
  )
  const answerStart = result.output.lastIndexOf('[assistant|message]')
  const handoffResponse = result.output.slice(answerStart)
  assert(
    handoffResponse.includes('HANDOFF_ONLY_COMPLETE') &&
      handoffResponse.includes('Node-first Taskyon CLI') &&
      !handoffResponse.includes('handoff content in the visible context'),
    `Expected the tool-free second task to consume the structured first-task handoff.\n${result.output}`,
  )
  assert(!result.output.includes('Fatal error'), `Unexpected fatal error.\n${result.output}`)

  return { success: true, bashReads: bashReadCalls.length }
}

testCliTaskPlannerUsesContractedSequentialHandoffs.description =
  'Starts tycli and verifies sequential task contracts hand off repository evidence without repeating discovery.'
testCliTaskPlannerUsesContractedSequentialHandoffs.timeoutMs = 320_000

export const testCliCreatesAndRunsDagGraphProject = async () => {
  const projectId = `workstation-${Date.now()}`
  const prompt = [
    'Use dagGraphProject to create and run one small AI-workstation recommendation.',
    'Make exactly three calls, in order: createNode, createProject, then runInvocation. Do not call saveInvocation.',
    `Use projectId "${projectId}" for createProject. createNode writes to the global graph and does not take projectId.`,
    'For createNode, define a node with no parameters, an object output with numeric score and estimatedWallPowerW fields, and run: async () => ({ score: 16, estimatedWallPowerW: 510 }).',
    'For createProject, copy the exact nodeId returned by createNode into rootNodeId. Do not use $use or invent a hash. This node has no parameters, so omit variables, objectives, and constraints; use the default main invocation.',
    'For runInvocation, pass projectId and invocationName "main"; use the name returned by createProject, not its invocation hash.',
    'Run the project invocation and recommend the 16 GB option from its result. Begin the final answer with WORKSTATION_RECOMMENDATION followed by a space and your recommendation.',
  ].join('\n\n')
  const result = await runCliE2eSession({
    testName: 'testCliCreatesAndRunsDagGraphProject',
    steps: [
      {
        waitFor: 'prompt ready.',
        input: `\u001b[200~${prompt}\u001b[201~`,
      },
      { delayMs: 200, input: '\r' },
      {
        waitFor: '[function|functioncall] dagGraphProject action=createNode',
        failOn: [
          '[system|error]',
          'Cannot connect to API',
          'No key configured',
          'does not provide an export named',
        ],
        input: '',
      },
      {
        waitFor: '[function|functioncall] dagGraphProject action=createProject',
        failOn: ['[system|error]', 'Fatal error'],
        input: '',
      },
      {
        waitFor: '[function|functioncall] dagGraphProject action=runInvocation',
        failOn: ['[system|error]', 'Fatal error', 'does not provide an export named'],
        input: '',
      },
      {
        waitFor: 'WORKSTATION_RECOMMENDATION',
        failOn: ['[system|error]', 'Fatal error'],
        input: '',
      },
      {
        waitFor: '| finished',
        failOn: ['[system|error]', 'Fatal error'],
        input: '',
      },
      {
        waitFor: '\u001b[?2004h> ',
        input: '/exit\n',
      },
    ],
    env: { TYCLI_HOTKEY_MENUS: '0' },
    isolateHome: false,
    timeoutMs: 320_000,
    runner: 'pty',
  })

  const output = result.output
  assert(result.code === 0, `Expected exit code 0, got ${String(result.code)}\n${output}`)
  for (const action of ['createNode', 'createProject', 'runInvocation']) {
    const callMarker = `[function|functioncall] dagGraphProject action=${action}`
    assert(
      output.split(callMarker).length - 1 === 1,
      `Expected exactly one ${action} call.\n${output}`,
    )
  }
  const cleanOutput = stripVTControlCharacters(output)
  assert(
    /WORKSTATION_RECOMMENDATION[^\r\n]{0,100}\b16\s*GB/i.test(cleanOutput),
    `Expected the final answer to recommend 16 GB from the invocation result.\n${output}`,
  )

  return { success: true }
}

testCliCreatesAndRunsDagGraphProject.description =
  'Uses tycli to create a no-input design node, create a project from its hash, run the invocation, and report its result.'
testCliCreatesAndRunsDagGraphProject.timeoutMs = 340_000

export const testCliComparesDagGraphWorkstationOptions = async () => {
  const projectId = `workstation-options-${Date.now()}`
  const nodeSource =
    "export default { formatVersion: 2, id: '__TASKYON_SELF_HASH__', localName: 'workstation_score', label: 'Workstation Score', version: 1, localParamsSchema: { type: 'object', properties: { gpuMemoryGb: { type: 'number' } }, required: ['gpuMemoryGb'] }, outputSchema: { type: 'object', properties: { gpuMemoryGb: { type: 'number' }, score: { type: 'number' } }, required: ['gpuMemoryGb', 'score'] }, inputs: {}, run: async ({ params }) => ({ gpuMemoryGb: params.gpuMemoryGb, score: 100 - Math.abs(params.gpuMemoryGb - 16) * 4 }) }"
  const prompt = [
    'Use dagGraphProject to compare three AI-workstation GPU memory options, then recommend the highest-scoring one.',
    `First createNode with this exact nodeSource: ${nodeSource}`,
    `Then createProject with projectId "${projectId}", rootNodeId from createNode, variables {"gpuMemoryGb":{"kind":"list","values":[12,16,24]}}, and objectives [{"direction":"max","target":{"path":"score","op":"identity"}}].`,
    'Next runInvocation for that project and its main invocation.',
    'Then call readRunRows with the returned run.id and the same projectId. Read all three scored rows before answering.',
    'Begin the final answer with WORKSTATION_COMPARISON. State the score for each of 12 GB, 16 GB, and 24 GB, then recommend the highest score.',
  ].join('\n\n')
  const result = await runCliE2eSession({
    testName: 'testCliComparesDagGraphWorkstationOptions',
    steps: [
      { waitFor: 'prompt ready.', input: `\u001b[200~${prompt}\u001b[201~` },
      { delayMs: 200, input: '\r' },
      ...['createNode', 'createProject', 'runInvocation', 'readRunRows'].map((action) => ({
        waitFor: `[function|functioncall] dagGraphProject action=${action}`,
        failOn: ['[system|error]', 'Fatal error', 'does not provide an export named'],
        input: '',
      })),
      { waitFor: 'WORKSTATION_COMPARISON', failOn: ['[system|error]', 'Fatal error'], input: '' },
      { waitFor: '| finished', failOn: ['[system|error]', 'Fatal error'], input: '' },
      { waitFor: '\u001b[?2004h> ', input: '/exit\n' },
    ],
    env: { TYCLI_HOTKEY_MENUS: '0' },
    isolateHome: false,
    timeoutMs: 320_000,
    runner: 'pty',
  })

  const output = stripVTControlCharacters(result.output)
  assert(result.code === 0, `Expected exit code 0, got ${String(result.code)}\n${output}`)
  const answer = output.slice(output.lastIndexOf('[assistant|message]'))
  assert(answer.includes('WORKSTATION_COMPARISON'), `Expected a final comparison.\n${output}`)
  for (const [memory, score] of [
    [12, 84],
    [16, 100],
    [24, 68],
  ]) {
    assert(
      answer.includes(String(memory)) && answer.includes(String(score)),
      `Expected the answer to compare ${memory} GB with score ${score}.\n${answer}`,
    )
  }
  assert(
    /recommend[^\r\n]{0,100}\b16\s*GB/i.test(answer),
    `Expected a 16 GB recommendation.\n${answer}`,
  )
  return { success: true }
}

testCliComparesDagGraphWorkstationOptions.description =
  'Creates a three-option design invocation, reads the scored rows, and recommends the best workstation from the results.'
testCliComparesDagGraphWorkstationOptions.timeoutMs = 340_000

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
