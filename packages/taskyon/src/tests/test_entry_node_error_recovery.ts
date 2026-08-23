import type { DiagnosticsTestContext } from '@taskyon/common/modules/diagnosticsRunner'
import { tyCore } from '../core/init'
import { createExternalToolContext, registerToolRpcTools } from '../core/toolRpc'
import { createTaskyonClient } from '../api'
import { createSubtasksResult, createTool, toolCall } from '../types/toolApi'
import type { TaskNode } from '../types/taskNode'
import {
  buildEntryNodePromptAugmentations,
  createStandardEntryNodeTool,
  normalizeEntryNodeSettings,
} from '../tools/entryNode'
import { createDefaultTaskyonToolSetup } from '../tools'
import { CLARIFICATION_TOOL_NAME } from '../tools/clarificationTool'
import { createPortableTestStorage } from '../testSupport/portableTestStorage'
import {
  buildLinkedTaskChain,
  resolveDiagnosticsRuntimeConfig,
} from '../testSupport/onlineProviderSupport'
import { FunctionCall } from '../types/tools'
import type { ToolBase } from '../types/tools'
import { humanizeError } from '../utils/error'
import {
  resolveInitialAgentToolCatalog,
  resolveTaskTreeAgentToolWindow,
  searchAgentToolCatalog,
} from '../tools/toolTools'
import type { EntryNodePromptTemplates } from '../tools/entryNode'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const testPromptTemplates: EntryNodePromptTemplates = {
  basePrompt: 'BASE',
  message: 'MESSAGE',
  toolResult: 'TOOL RESULT: {toolResult}',
  error: 'ERROR: {error}',
  retryExhausted: 'STOP AFTER {retryCount}',
}

export const testEntryNodeRequiresConfiguredPromptTemplates = () => {
  const entryNodeTool = createStandardEntryNodeTool({
    name: 'entryNode',
    renderOptions: {},
  })
  const required = new Set(entryNodeTool.parameters.required ?? [])
  assert(
    !('useToolShortlist' in entryNodeTool.parameters.properties),
    'Expected the removed shortlist setting to stay out of the EntryNode schema',
  )
  assert(required.has('prompt_templates'), 'Expected prompt_templates to be required by the tool')

  let error: unknown
  try {
    normalizeEntryNodeSettings(undefined)
  } catch (caught) {
    error = caught
  }
  assert(error instanceof Error, 'Expected missing prompt templates to fail configuration')
}

testEntryNodeRequiresConfiguredPromptTemplates.description =
  'Requires complete host-configured EntryNode prompt templates instead of applying hidden code defaults.'

export const testInitialCatalogIncludesOrdinaryAndRecentDagTools = () => {
  const tools: Record<string, ToolBase> = {
    ordinary: {
      name: 'ordinary',
      description: 'An ordinary tool.',
      parameters: { type: 'object', properties: {} },
    },
    recentDag: {
      name: 'recentDag',
      description: 'A recently used DAG node.',
      parameters: { type: 'object', properties: {} },
      source: { kind: 'dag-node' as const, nodeName: 'recentDag', version: 1 },
    },
    unusedDag: {
      name: 'unusedDag',
      description: 'An unused DAG node.',
      parameters: { type: 'object', properties: {} },
      source: { kind: 'dag-node' as const, nodeName: 'unusedDag', version: 1 },
    },
  }
  const taskChain: TaskNode[] = [
    {
      id: 'recent-dag-call',
      role: 'function',
      content: { type: 'functioncall', data: { name: 'recentDag', arguments: {} } },
    },
  ]

  const catalog = resolveInitialAgentToolCatalog(tools, taskChain)
  assert(
    catalog.some((tool) => tool.name === 'ordinary'),
    'Expected ordinary tool in initial list',
  )
  assert(
    catalog.some((tool) => tool.name === 'recentDag'),
    'Expected recent DAG in initial list',
  )
  assert(!catalog.some((tool) => tool.name === 'unusedDag'), 'Expected unused DAG to stay hidden')
  const restrictedCatalog = resolveInitialAgentToolCatalog(tools, taskChain, new Set(), [
    'unusedDag',
  ])
  assert(
    restrictedCatalog.some((tool) => tool.name === 'unusedDag'),
    'Expected an explicitly allowed DAG even when it is not recent',
  )
  return {
    tools: catalog.map((tool) => tool.name),
    restrictedTools: restrictedCatalog.map((tool) => tool.name),
  }
}

testInitialCatalogIncludesOrdinaryAndRecentDagTools.description =
  'Builds the concise entry-node catalog from all ordinary tools and conversation-recent DAG nodes.'

export const testAgentToolWindowKeepsPinnedToolsAndFindsUnwindowedTools = () => {
  const tools: Record<string, ToolBase> = {
    bash: {
      name: 'bash',
      description: 'Run shell commands.',
      parameters: { type: 'object', properties: {} },
    },
    exploration: {
      name: 'exploration',
      description: 'Inspect workspace files.',
      parameters: { type: 'object', properties: {} },
    },
    updateFiles: {
      name: 'updateFiles',
      description: 'Write workspace files.',
      parameters: { type: 'object', properties: {} },
    },
    hiddenRequiredTool: {
      name: 'hiddenRequiredTool',
      description: 'Perform the capability required by the current task.',
      parameters: { type: 'object', properties: {} },
    },
  }
  const window = resolveTaskTreeAgentToolWindow(
    tools,
    [],
    new Set(),
    3,
    3,
    ['hiddenRequiredTool'],
    ['bash', 'exploration', 'updateFiles'],
  )
  const names = window.map((tool) => tool.name)
  assert(
    names.slice(0, 3).join(',') === 'bash,exploration,updateFiles',
    'Expected pinned tools first',
  )
  assert(
    names.includes('hiddenRequiredTool'),
    'Expected an unwindowed required tool to remain discoverable',
  )
  return { names }
}

testAgentToolWindowKeepsPinnedToolsAndFindsUnwindowedTools.description =
  'Keeps host-pinned tools in every callable window while allowing focused search to add an unwindowed tool.'

export const testTaskTreeToolWindowCombinesRecentAndFrequentTools = () => {
  const tools: Record<string, ToolBase> = Object.fromEntries(
    ['recent', 'frequent', 'other'].map((name) => [
      name,
      {
        name,
        description: `${name} tool`,
        parameters: { type: 'object', properties: {} },
      },
    ]),
  )
  const taskChain: TaskNode[] = [
    {
      id: 'one',
      role: 'function',
      content: { type: 'functioncall', data: { name: 'frequent', arguments: {} } },
    },
    {
      id: 'two',
      role: 'function',
      content: { type: 'functioncall', data: { name: 'other', arguments: {} } },
    },
    {
      id: 'three',
      role: 'function',
      content: { type: 'functioncall', data: { name: 'frequent', arguments: {} } },
    },
    {
      id: 'four',
      role: 'function',
      content: { type: 'functioncall', data: { name: 'recent', arguments: {} } },
    },
  ]
  const window = resolveTaskTreeAgentToolWindow(tools, taskChain, new Set(), 1, 1)
  assert(
    window.map((tool) => tool.name).join(',') === 'recent,frequent',
    'Expected recent and frequent tools in order',
  )
  return { tools: window.map((tool) => tool.name) }
}

testTaskTreeToolWindowCombinesRecentAndFrequentTools.description =
  'Derives the visible tool window from recent and frequent calls in the current task tree.'

export const testAgentToolCatalogSearchIncludesDagNodes = () => {
  const results = searchAgentToolCatalog(
    {
      clock: {
        name: 'clock',
        description: 'Shows the current time.',
        parameters: { type: 'object', properties: {} },
      },
      constructionDecking: {
        name: 'constructionDecking',
        description: 'Calculates deck-board geometry for a framed construction.',
        parameters: { type: 'object', properties: {} },
        source: {
          kind: 'dag-node' as const,
          nodeName: 'constructionDecking',
          version: 1,
        },
      },
    },
    'deck geometry',
    10,
  )

  assert(results[0]?.name === 'constructionDecking', 'Expected DAG node in search results')
  return { results }
}

testAgentToolCatalogSearchIncludesDagNodes.description =
  'Searches ordinary tools and DAG-node tools through one concise catalog.'

export const testEntryNodeToolSearchPassesOverviewResultsDirectly = async () => {
  const entryNodeTool = createStandardEntryNodeTool({
    name: 'entryNode',
    renderOptions: { hideChat: true, hideLlm: true },
  })
  const taskChain: TaskNode[] = [
    { id: 'user', role: 'user', content: { type: 'message', data: 'Calculate a deck.' } },
    {
      id: 'entry-search',
      role: 'function',
      priorID: 'user',
      content: {
        type: 'functioncall',
        data: {
          name: 'entryNode',
          arguments: {
            toolSearchMode: 'overview',
            toolSearchInput: {
              'Here are the matching tools': [
                {
                  name: 'constructionDecking',
                  description: 'Calculates deck-board geometry.',
                },
              ],
            },
          },
        },
      },
    },
  ]
  const result = await entryNodeTool.function?.(
    {
      toolSearchMode: 'overview',
      toolSearchInput: {
        'Here are the matching tools': [
          {
            name: 'constructionDecking',
            description: 'Calculates deck-board geometry.',
          },
        ],
      },
      prompt_templates: testPromptTemplates,
    },
    {
      getExecutionTaskChain: () => Promise.resolve(taskChain),
      createSubtasksResult,
      getSecret: () => Promise.resolve(null),
      setSecret: () => Promise.resolve(),
      stopSignal: new AbortController().signal,
      toolId: 'entry-search-test',
    },
  )
  assert(
    result && typeof result === 'object' && 'taskChainList' in result,
    'Expected continuation task',
  )
  const call = findFunctionCall(result.taskChainList[0], 'entryNode')
  assert(
    Array.isArray(call?.arguments.allowedTools) &&
      call.arguments.allowedTools.includes('constructionDecking'),
    'Expected overview search results to pass directly to the next entry node',
  )
  return { selected: 'constructionDecking' }
}

testEntryNodeToolSearchPassesOverviewResultsDirectly.description =
  'Passes explicit broad tool-overview results directly into the next EntryNode call.'

export const testEntryNodeFocusedToolSearchReturnsImmediateCallableWindow = async () => {
  const entryNodeTool = createStandardEntryNodeTool({
    name: 'entryNode',
    renderOptions: { hideChat: true, hideLlm: true },
  })
  const result = await entryNodeTool.function?.(
    {
      toolSearchMode: 'focused',
      toolSearchInput: {
        'Here are the matching tools': [
          {
            name: 'constructionDecking',
            description: 'Calculates deck-board geometry.',
          },
        ],
      },
      prompt_templates: testPromptTemplates,
    },
    {
      getExecutionTaskChain: () =>
        Promise.resolve([
          { id: 'user', role: 'user', content: { type: 'message', data: 'Calculate a deck.' } },
          {
            id: 'entry-search',
            role: 'function',
            priorID: 'user',
            content: {
              type: 'functioncall',
              data: { name: 'entryNode', arguments: { toolSearch: { query: 'deck geometry' } } },
            },
          },
        ]),
      createSubtasksResult,
      getSecret: () => Promise.resolve(null),
      setSecret: () => Promise.resolve(),
      stopSignal: new AbortController().signal,
      toolId: 'entry-focused-search-test',
    },
  )
  assert(
    result && typeof result === 'object' && 'taskChainList' in result,
    'Expected search continuation',
  )
  const entryCall = findFunctionCall(result.taskChainList[0], 'entryNode')
  assert(
    Array.isArray(entryCall?.arguments.allowedTools) &&
      entryCall.arguments.allowedTools.includes('constructionDecking'),
    'Expected focused search to pass its result directly to the next entry node',
  )
  assert(
    !findFunctionCall(result.taskChainList[0], 'chatCompletion'),
    'Expected focused search not to create a separate routing completion',
  )
  return { selected: entryCall?.arguments.allowedTools }
}

testEntryNodeFocusedToolSearchReturnsImmediateCallableWindow.description =
  'Passes focused full-catalog search results directly into the immediately following entry-node callable window.'

export const testEntryNodeSearchRunsAsVisibleTaskTreeContinuation = async () => {
  const entryNodeTool = createStandardEntryNodeTool({
    name: 'entryNode',
    renderOptions: { hideChat: true, hideLlm: true },
  })
  const entryResult = await entryNodeTool.function?.(
    {
      toolSearch: { query: 'deck geometry', limit: 3 },
      prompt_templates: testPromptTemplates,
    },
    {
      getExecutionTaskChain: () =>
        Promise.resolve([
          { id: 'user', role: 'user', content: { type: 'message', data: 'Calculate a deck.' } },
          {
            id: 'entry-search',
            role: 'function',
            priorID: 'user',
            content: {
              type: 'functioncall',
              data: { name: 'entryNode', arguments: { toolSearch: { query: 'deck geometry' } } },
            },
          },
        ]),
      createSubtasksResult,
      getSecret: () => Promise.resolve(null),
      setSecret: () => Promise.resolve(),
      stopSignal: new AbortController().signal,
      toolId: 'entry-search-task-tree-test',
    },
  )
  assert(
    entryResult && typeof entryResult === 'object' && 'taskChainList' in entryResult,
    'Expected the EntryNode search chain result',
  )
  const definition = entryResult.taskChainList[0]?.find(
    (task) => task.content.type === 'tooldefinition',
  )
  assert(definition, 'Expected EntryNode to emit a task-tree search binding definition')
  assert(
    definition.content.type === 'tooldefinition' &&
      'implementation' in definition.content.data &&
      definition.content.data.implementation.type === 'binding' &&
      definition.content.data.implementation.target === 'toolSearcher',
    'Expected the EntryNode search binding to delegate to regular toolSearcher',
  )
  const searchCall = findFunctionCall(entryResult.taskChainList[0], 'entryNodeToolSearch')
  assert(searchCall, 'Expected EntryNode to emit the scoped search binding call')
  assert(
    searchCall.arguments.query === 'deck geometry' && searchCall.arguments.limit === 3,
    'Expected the scoped binding call to carry the model search request',
  )
  const continuationEntryCall = findFunctionCall(entryResult.taskChainList[0], 'entryNode')
  assert(
    continuationEntryCall?.arguments.$use &&
      typeof continuationEntryCall.arguments.$use === 'object' &&
      (continuationEntryCall.arguments.$use as Record<string, unknown>).toolSearchInput ===
        '$previousResult',
    'Expected the follow-up EntryNode to consume the preceding terminal search result generically',
  )
  return {
    searchTool: searchCall.name,
    continuationTool: continuationEntryCall?.name,
  }
}

testEntryNodeSearchRunsAsVisibleTaskTreeContinuation.description =
  'Executes EntryNode search as an explicit task-tree tool call and preserves the direct follow-up EntryNode continuation.'

export const testAgentToolCatalogSearchUsesDocumentationAndSchema = () => {
  const tools: Record<string, ToolBase> = {
    contractReader: {
      name: 'contractReader',
      description: 'A general utility.',
      longDescription: 'Inspect directory entries and return the files in a workspace folder.',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            description: 'List files in a directory.',
          },
          path: {
            type: 'string',
            description: 'Workspace-relative directory path to inspect.',
          },
        },
        required: ['action'],
      },
    },
    directoryMetadata: {
      name: 'directoryMetadata',
      description: 'Read directory metadata.',
      parameters: { type: 'object', properties: {} },
    },
  }
  const results = searchAgentToolCatalog(tools, 'workspace files directory', 5)
  assert(
    results[0]?.name === 'contractReader',
    'Expected documentation and schema matches to rank the contract reader first',
  )
  return { results: results.map((tool) => tool.name) }
}

testAgentToolCatalogSearchUsesDocumentationAndSchema.description =
  'Ranks tools using their public documentation and JSON-schema fields rather than only short descriptions.'

export const testEntryNodeToolSearchEscapesPreviousToolWindow = async () => {
  const catalog: Record<string, ToolBase> = {
    documentationIndex: {
      name: 'documentationIndex',
      description: 'Search documentation.',
      parameters: { type: 'object', properties: {} },
    },
    exploration: {
      name: 'exploration',
      description: 'Discover and read workspace files.',
      parameters: { type: 'object', properties: {} },
    },
  }
  const entryNodeTool = createStandardEntryNodeTool({
    name: 'entryNode',
    renderOptions: { hideChat: true, hideLlm: true },
    getToolCatalog: ({ allowedTools }) => {
      const selected = allowedTools
        ? Object.fromEntries(
            allowedTools.flatMap((name) => (catalog[name] ? [[name, catalog[name]]] : [])),
          )
        : catalog
      return Promise.resolve({
        tools: Object.values(selected),
        total: Object.keys(catalog).length,
      })
    },
  })
  const taskChain: TaskNode[] = [
    {
      id: 'user',
      role: 'user',
      content: { type: 'message', data: 'List the files in this workspace.' },
    },
    {
      id: 'previous-completion',
      role: 'function',
      priorID: 'user',
      content: {
        type: 'functioncall',
        data: {
          name: 'chatCompletion',
          arguments: { allowedTools: ['documentationIndex'] },
        },
      },
    },
    {
      id: 'entry-search',
      role: 'function',
      priorID: 'previous-completion',
      content: {
        type: 'functioncall',
        data: {
          name: 'entryNode',
          arguments: {
            toolSearch: { query: 'list files in the workspace', limit: 5 },
          },
        },
      },
    },
  ]
  const result = await entryNodeTool.function?.(
    {
      toolSearchMode: 'focused',
      toolSearchInput: {
        'Here are the matching tools': [catalog.exploration],
      },
      prompt_templates: testPromptTemplates,
    },
    {
      getExecutionTaskChain: () => Promise.resolve(taskChain),
      createSubtasksResult,
      getSecret: () => Promise.resolve(null),
      setSecret: () => Promise.resolve(),
      stopSignal: new AbortController().signal,
      toolId: 'entry-node-search-window-test',
    },
  )
  assert(result && typeof result === 'object' && 'taskChainList' in result, 'Expected search task')
  const entryCall = findFunctionCall(result.taskChainList[0], 'entryNode')
  assert(
    Array.isArray(entryCall?.arguments.allowedTools) &&
      entryCall.arguments.allowedTools.includes('exploration'),
    'Expected tool search to return a tool outside the previous executor window',
  )
  assert(
    !findFunctionCall(result.taskChainList[0], 'chatCompletion'),
    'Expected focused search not to create a separate routing completion',
  )
  return { selected: 'exploration' }
}

testEntryNodeToolSearchEscapesPreviousToolWindow.description =
  'Allows an entry-node catalog search to find a required tool that was absent from the previous callable window.'

export const testEntryNodeCarriesSelectedSearchToolIntoLaterUsageWindow = async () => {
  const catalog: Record<string, ToolBase> = {
    exploration: {
      name: 'exploration',
      description: 'Discover and read workspace files.',
      parameters: { type: 'object', properties: {} },
    },
    other: {
      name: 'other',
      description: 'Perform another workspace action.',
      parameters: { type: 'object', properties: {} },
    },
  }
  const observedWindows: string[][] = []
  const observedLimits: Array<{ recent: number; frequent: number }> = []
  const entryNodeTool = createStandardEntryNodeTool({
    name: 'entryNode',
    renderOptions: { hideChat: true, hideLlm: true },
    getToolCatalog: ({ taskChain, allowedTools, recentToolCount, frequentToolCount }) => {
      const window = resolveTaskTreeAgentToolWindow(
        catalog,
        taskChain,
        new Set(),
        recentToolCount,
        frequentToolCount,
        allowedTools,
      )
      observedWindows.push(window.map((tool) => tool.name))
      observedLimits.push({ recent: recentToolCount, frequent: frequentToolCount })
      return Promise.resolve({ tools: window, total: Object.keys(catalog).length })
    },
  })
  const selectedTaskChain: TaskNode[] = [
    {
      id: 'user',
      role: 'user',
      content: { type: 'message', data: 'List the files in this workspace.' },
    },
    {
      id: 'initial-entry',
      role: 'function',
      priorID: 'user',
      content: {
        type: 'functioncall',
        data: { name: 'entryNode', arguments: { prompt_templates: testPromptTemplates } },
      },
    },
    {
      id: 'selector-completion',
      role: 'function',
      priorID: 'user',
      content: {
        type: 'functioncall',
        data: {
          name: 'chatCompletion',
          arguments: { allowedTools: ['selectTaskyonTools'] },
        },
      },
    },
    {
      id: 'selector-call',
      role: 'function',
      parentID: 'selector-completion',
      content: {
        type: 'functioncall',
        data: { name: 'selectTaskyonTools', arguments: { allowedTools: ['exploration'] } },
      },
    },
    {
      id: 'selected-entry',
      role: 'function',
      priorID: 'selector-call',
      content: {
        type: 'functioncall',
        data: { name: 'entryNode', arguments: { allowedTools: ['exploration'] } },
      },
    },
  ]
  const selectedResult = await entryNodeTool.function?.(
    { allowedTools: ['exploration'], prompt_templates: testPromptTemplates },
    {
      getExecutionTaskChain: () => Promise.resolve(selectedTaskChain),
      createSubtasksResult,
      getSecret: () => Promise.resolve(null),
      setSecret: () => Promise.resolve(),
      stopSignal: new AbortController().signal,
      toolId: 'entry-node-selected-search-tool-test',
    },
  )
  assert(
    selectedResult && typeof selectedResult === 'object' && 'taskChainList' in selectedResult,
    'Expected selected tool execution continuation',
  )
  const selectedArguments = findFunctionCall(
    selectedResult.taskChainList[0],
    'chatCompletion',
  )?.arguments
  assert(selectedArguments !== undefined, 'Expected selected chatCompletion arguments')
  assert(
    Array.isArray(selectedArguments.allowedTools) &&
      selectedArguments.allowedTools.includes('exploration'),
    'Expected the selected search result in the executor allowedTools list',
  )

  const subsequentTaskChain: TaskNode[] = [
    ...selectedTaskChain,
    {
      id: 'selected-completion',
      role: 'function',
      priorID: 'selected-entry',
      content: {
        type: 'functioncall',
        data: {
          name: 'chatCompletion',
          arguments: { allowedTools: ['exploration', 'selectTaskyonTools'] },
        },
      },
    },
    {
      id: 'exploration-call-one',
      role: 'function',
      parentID: 'selected-completion',
      content: { type: 'functioncall', data: { name: 'exploration', arguments: {} } },
    },
    {
      id: 'exploration-call-two',
      role: 'function',
      parentID: 'selected-completion',
      content: { type: 'functioncall', data: { name: 'exploration', arguments: {} } },
    },
    {
      id: 'other-call',
      role: 'function',
      parentID: 'selected-completion',
      content: { type: 'functioncall', data: { name: 'other', arguments: {} } },
    },
    {
      id: 'other-result',
      role: 'system',
      parentID: 'other-call',
      content: { type: 'toolresult', data: { ok: true } },
    },
    {
      id: 'subsequent-entry',
      role: 'function',
      priorID: 'other-result',
      content: { type: 'functioncall', data: { name: 'entryNode', arguments: {} } },
    },
  ]
  const subsequentResult = await entryNodeTool.function?.(
    { prompt_templates: testPromptTemplates },
    {
      getExecutionTaskChain: () => Promise.resolve(subsequentTaskChain),
      createSubtasksResult,
      getSecret: () => Promise.resolve(null),
      setSecret: () => Promise.resolve(),
      stopSignal: new AbortController().signal,
      toolId: 'entry-node-subsequent-usage-test',
    },
  )
  assert(
    subsequentResult && typeof subsequentResult === 'object' && 'taskChainList' in subsequentResult,
    'Expected subsequent entry-node continuation',
  )
  const latestWindow = observedWindows.at(-1) ?? []
  const latestLimits = observedLimits.at(-1)
  assert(
    latestWindow.includes('exploration') && latestWindow.includes('other'),
    'Expected recent and frequent tools in the subsequent entry-node window',
  )
  assert(
    latestLimits?.recent === 3 && latestLimits.frequent === 3,
    'Expected configured three-item recent and frequent limits to reach subsequent entry-node calls',
  )
  return { latestWindow, selected: 'exploration' }
}

testEntryNodeCarriesSelectedSearchToolIntoLaterUsageWindow.description =
  'Carries a selected search result into executor tools and derives later entry-node windows from recent and frequent calls.'

export const testEntryNodePromptTemplatesSelectTheCurrentMode = () => {
  const templates = {
    basePrompt: 'BASE',
    message: 'MESSAGE',
    toolResult: 'TOOL RESULT: {toolResult}',
    error: 'ERROR: {error}',
    retryExhausted: 'STOP AFTER {retryCount}',
  }
  const previousTask: TaskNode = {
    id: 'result',
    role: 'system',
    content: { type: 'toolresult', data: { stdout: 'done' } },
  }
  const augmentations = buildEntryNodePromptAugmentations({
    mode: 'toolresult',
    prompt: 'DYNAMIC CONTEXT',
    previousTask,
    templates,
    useBasePrompt: true,
  })

  assert(
    augmentations.prependSystemPrompts.join('\n') === 'BASE',
    'Expected the stable base prompt to be prepended once',
  )
  const appended = augmentations.appendSystemPrompts.join('\n')
  assert(appended.includes('TOOL RESULT:'), 'Expected the tool-result mode template')
  assert(appended.includes('stdout: done'), 'Expected runtime tool-result interpolation')
  assert(appended.includes('DYNAMIC CONTEXT'), 'Expected dynamic context after reusable prose')
  assert(!appended.includes('MESSAGE'), 'Expected only the current mode template')

  return { success: true }
}

testEntryNodePromptTemplatesSelectTheCurrentMode.description =
  'Selects one configured EntryNode prompt mode and interpolates only its runtime context.'

export const testEntryNodeDefaultsNullTaskContractResultToMessage = () => {
  const normalized = normalizeEntryNodeSettings({
    prompt_templates: testPromptTemplates,
    taskContract: {
      objective: 'Use the clock tool.',
      result: null,
    } as never,
  })

  assert(
    normalized.taskContract?.result.mode === 'message',
    'Expected a null provider-generated task result contract to default to message mode.',
  )
  return { success: true }
}
testEntryNodeDefaultsNullTaskContractResultToMessage.description =
  'Defaults a provider-generated null task contract result to message mode before entry-node execution.'

export const testEntryNodeNormalizesScalarMessageTaskContractResult = () => {
  const normalized = normalizeEntryNodeSettings({
    prompt_templates: testPromptTemplates,
    taskContract: {
      objective: 'Use the clock tool.',
      result: 'message',
    } as never,
  })

  assert(
    normalized.taskContract?.result.mode === 'message',
    'Expected a provider-generated scalar message result to normalize to message mode.',
  )
  return { success: true }
}
testEntryNodeNormalizesScalarMessageTaskContractResult.description =
  'Normalizes a provider-generated scalar message task result before entry-node execution.'

const getFunctionCall = (task: unknown): FunctionCall | undefined => {
  if (!task || typeof task !== 'object' || !('content' in task)) return undefined
  const content = task.content
  if (!content || typeof content !== 'object' || !('type' in content) || !('data' in content)) {
    return undefined
  }
  return content.type === 'functioncall' ? FunctionCall.parse(content.data) : undefined
}

const findFunctionCall = (tasks: readonly unknown[] | undefined, name: string) =>
  tasks?.map(getFunctionCall).find((call) => call?.name === name)

export const testEntryNodePropagatesTaskContractWithoutPromptDuplication = async () => {
  const entryNodeTool = createStandardEntryNodeTool({
    name: 'entryNode',
    renderOptions: { hideChat: true, hideLlm: true },
    defaultAllowedTools: ['bash'],
  })
  const completionCriterion = 'Every trust boundary has an evidence note.'
  const taskContract = {
    objective: 'Audit the authentication boundary.',
    agentInstructions: 'Act as a cybersecurity reviewer.',
    doneWhen: [completionCriterion],
    result: { mode: 'message' as const },
  }
  const taskChain: TaskNode[] = [
    {
      id: 'task-message',
      role: 'user',
      content: {
        type: 'message',
        data: [
          'Task objective:',
          taskContract.objective,
          '',
          'Complete when:',
          `- ${completionCriterion}`,
        ].join('\n'),
      },
    },
    {
      id: 'entry-node',
      role: 'function',
      priorID: 'task-message',
      content: {
        type: 'functioncall',
        data: {
          name: 'entryNode',
          arguments: { taskContract },
        },
      },
    },
  ]

  const result = await entryNodeTool.function?.(
    {
      taskContract,
      prompt_templates: testPromptTemplates,
    },
    {
      getExecutionTaskChain: () => Promise.resolve(taskChain),
      createSubtasksResult,
      getSecret: () => Promise.resolve(null),
      setSecret: () => Promise.resolve(),
      stopSignal: new AbortController().signal,
      toolId: 'entry-node-task-contract-test',
    },
  )

  assert(
    result && typeof result === 'object' && 'taskChainList' in result,
    'Expected entryNode to create a continuation chain',
  )
  const continuation = result.taskChainList[0]
  const chatCompletionCall = findFunctionCall(continuation, 'chatCompletion')
  const chatArguments = chatCompletionCall?.arguments
  const appendedPrompts =
    chatArguments &&
    typeof chatArguments === 'object' &&
    'appendSystemPrompts' in chatArguments &&
    Array.isArray(chatArguments.appendSystemPrompts)
      ? chatArguments.appendSystemPrompts.join('\n')
      : ''

  assert(
    !appendedPrompts.includes(taskContract.objective) &&
      !appendedPrompts.includes(taskContract.agentInstructions) &&
      !appendedPrompts.includes(completionCriterion),
    'Expected entryNode prompts not to duplicate visible task-contract information',
  )
  const scopedDefinition = continuation?.find((task) => task.content.type === 'tooldefinition')
  assert(
      continuation?.length === 2 &&
      scopedDefinition?.content.type === 'tooldefinition' &&
      'implementation' in scopedDefinition.content.data &&
      scopedDefinition.content.data.implementation.target === 'entryNode' &&
      chatArguments &&
      typeof chatArguments === 'object' &&
      Array.isArray(chatArguments.allowedTools) &&
      chatArguments.allowedTools.includes('bash') &&
      chatArguments.allowedTools.includes('selectTaskyonTools') &&
      !('toolChoice' in chatArguments) &&
      !('schema' in chatArguments) &&
      !('resultMode' in chatArguments),
    'Expected native tool calling with the task contract carried separately',
  )

  return { success: true }
}

export const testEntryNodeForwardsContractedResultSchema = async () => {
  const entryNodeTool = createStandardEntryNodeTool({
    name: 'entryNode',
    renderOptions: { hideChat: true, hideLlm: true },
    defaultAllowedTools: [],
  })
  const resultSchema = {
    type: 'object' as const,
    additionalProperties: false,
    properties: {
      findings: { type: 'array' as const, items: { type: 'string' as const } },
    },
    required: ['findings'],
  }
  const taskContract = {
    objective: 'Review the authentication boundary.',
    result: {
      mode: 'structured' as const,
      schema: resultSchema,
    },
  }
  const taskChain: TaskNode[] = [
    {
      id: 'task-message',
      role: 'user',
      content: { type: 'message', data: `Task objective:\n${taskContract.objective}` },
    },
    {
      id: 'entry-node',
      role: 'function',
      priorID: 'task-message',
      content: {
        type: 'functioncall',
        data: { name: 'entryNode', arguments: { taskContract } },
      },
    },
  ]

  const result = await entryNodeTool.function?.(
    { taskContract, prompt_templates: testPromptTemplates },
    {
      getExecutionTaskChain: () => Promise.resolve(taskChain),
      createSubtasksResult,
      getSecret: () => Promise.resolve(null),
      setSecret: () => Promise.resolve(),
      stopSignal: new AbortController().signal,
      toolId: 'entry-node-contracted-result-test',
    },
  )
  assert(
    result && typeof result === 'object' && 'taskChainList' in result,
    'Expected entryNode to create a contracted chat completion',
  )

  const chatCompletionCall = findFunctionCall(result.taskChainList[0], 'chatCompletion')
  const chatArguments = chatCompletionCall?.arguments
  assert(
    chatArguments &&
      typeof chatArguments === 'object' &&
      'schema' in chatArguments &&
      JSON.stringify(chatArguments.schema) === JSON.stringify(resultSchema) &&
      !('resultMode' in chatArguments),
    'Expected entryNode to forward the contract schema through the existing chatCompletion interface',
  )

  return { success: true }
}

export const testEntryNodeHonorsExplicitAllowedToolRestrictions = async () => {
  const entryNodeTool = createStandardEntryNodeTool({
    name: 'entryNode',
    renderOptions: { hideChat: true, hideLlm: true },
    defaultAllowedTools: [
      'bash',
      'taskSearcher',
      'gitlab',
      'downloadFile',
      'taskPlanner',
      'askClarifyingQuestions',
    ],
    stableContext: () => 'Stable project instructions for router and executor.',
    getToolCatalog: () =>
      Promise.resolve([
        { name: 'bash', description: 'Run a shell command.' },
        { name: 'taskSearcher', description: 'Search prior tasks.' },
        { name: 'gitlab', description: 'Use the GitLab API.' },
        { name: 'downloadFile', description: 'Download a file.' },
        { name: 'taskPlanner', description: 'Plan multi-step work.' },
        { name: 'askClarifyingQuestions', description: 'Ask blocking questions.' },
      ]),
  })
  const taskChain: TaskNode[] = [
    {
      id: 'task-message',
      role: 'user',
      content: { type: 'message', data: 'Summarize the prior handoff.' },
    },
    {
      id: 'entry-node',
      role: 'function',
      priorID: 'task-message',
      content: {
        type: 'functioncall',
        data: { name: 'entryNode', arguments: {} },
      },
    },
  ]
  const context = {
    getExecutionTaskChain: () => Promise.resolve(taskChain),
    createSubtasksResult,
    getSecret: () => Promise.resolve(null),
    setSecret: () => Promise.resolve(),
    stopSignal: new AbortController().signal,
    toolId: 'entry-node-allowed-tools-test',
  }

  const directResult = await entryNodeTool.function?.(
    { prompt_templates: testPromptTemplates },
    context,
  )
  assert(
    directResult && typeof directResult === 'object' && 'taskChainList' in directResult,
    'Expected entryNode to create a direct continuation',
  )
  const directArguments = findFunctionCall(
    directResult.taskChainList[0],
    'chatCompletion',
  )?.arguments
  assert(
    directArguments &&
      typeof directArguments === 'object' &&
      Array.isArray(directArguments.allowedTools) &&
      directArguments.allowedTools.includes('bash') &&
      directArguments.allowedTools.includes('askClarifyingQuestions') &&
      directArguments.allowedTools.includes('selectTaskyonTools') &&
      !('toolChoice' in directArguments) &&
      Array.isArray(directArguments.prependSystemPrompts) &&
      directArguments.prependSystemPrompts.includes(
        'Stable project instructions for router and executor.',
      ),
    'Expected direct chatCompletion to expose the configured callable window and optional search tool',
  )

  const noToolsResult = await entryNodeTool.function?.(
    { allowedTools: [], prompt_templates: testPromptTemplates },
    context,
  )
  assert(
    noToolsResult && typeof noToolsResult === 'object' && 'taskChainList' in noToolsResult,
    'Expected entryNode to create a tool-free continuation',
  )
  const noToolsArguments = findFunctionCall(
    noToolsResult.taskChainList[0],
    'chatCompletion',
  )?.arguments
  assert(
    noToolsArguments &&
      typeof noToolsArguments === 'object' &&
      Array.isArray(noToolsArguments.allowedTools) &&
      noToolsArguments.allowedTools.length === 1 &&
      noToolsArguments.allowedTools[0] === 'selectTaskyonTools',
    'Expected an explicit empty allowedTools override to expose only focused tool search',
  )

  const bashOnlyResult = await entryNodeTool.function?.(
    { allowedTools: ['bash'], prompt_templates: testPromptTemplates },
    context,
  )
  assert(
    bashOnlyResult && typeof bashOnlyResult === 'object' && 'taskChainList' in bashOnlyResult,
    'Expected entryNode to create a restricted continuation',
  )
  const bashOnlyArguments = findFunctionCall(
    bashOnlyResult.taskChainList[0],
    'chatCompletion',
  )?.arguments
  assert(
    bashOnlyArguments &&
      typeof bashOnlyArguments === 'object' &&
      'allowedTools' in bashOnlyArguments &&
      Array.isArray(bashOnlyArguments.allowedTools) &&
      bashOnlyArguments.allowedTools.includes('bash') &&
      bashOnlyArguments.allowedTools.includes('selectTaskyonTools') &&
      !bashOnlyArguments.allowedTools.includes('taskSearcher'),
    'Expected allowedTools to filter the configured tool catalog while retaining focused search',
  )

  const postToolResult = await entryNodeTool.function?.(
    { allowedTools: ['bash'], prompt_templates: testPromptTemplates },
    {
      ...context,
      getExecutionTaskChain: () =>
        Promise.resolve([
          taskChain[0] as TaskNode,
          taskChain[1] as TaskNode,
          {
            id: 'bash-call',
            role: 'function',
            parentID: 'entry-node',
            content: { type: 'functioncall', data: { name: 'bash', arguments: {} } },
          },
          {
            id: 'bash-result',
            role: 'system',
            parentID: 'bash-call',
            content: { type: 'toolresult', data: { stdout: 'done' } },
          },
          {
            id: 'post-tool-entry',
            role: 'function',
            priorID: 'bash-result',
            content: {
              type: 'functioncall',
              data: { name: 'entryNode', arguments: { allowedTools: ['bash'] } },
            },
          },
        ]),
    },
  )
  assert(
    postToolResult && typeof postToolResult === 'object' && 'taskChainList' in postToolResult,
    'Expected entryNode to continue after a tool result',
  )
  const postToolArguments = findFunctionCall(
    postToolResult.taskChainList[0],
    'chatCompletion',
  )?.arguments
  assert(
    postToolArguments &&
      typeof postToolArguments === 'object' &&
      'allowedTools' in postToolArguments &&
      !('toolChoice' in postToolArguments),
    'Expected a previously selected tool to remain available without forcing it again after its result',
  )

  return { success: true }
}

export const testEntryNodeSeparatesStructuredContractsFromNativeToolCalls = async () => {
  const entryNodeTool = createStandardEntryNodeTool({
    name: 'entryNode',
    renderOptions: { hideChat: true, hideLlm: true },
    defaultAllowedTools: ['bash'],
  })
  const taskContract = {
    objective: 'Inspect the CLI documentation.',
    result: {
      mode: 'structured' as const,
      schema: {
        type: 'object' as const,
        properties: { summary: { type: 'string' as const } },
        required: ['summary'],
        additionalProperties: false,
      },
    },
  }
  const taskChain: TaskNode[] = [
    {
      id: 'task-message',
      role: 'user',
      content: { type: 'message', data: `Task objective:\n${taskContract.objective}` },
    },
    {
      id: 'entry-node',
      role: 'function',
      priorID: 'task-message',
      content: {
        type: 'functioncall',
        data: {
          name: 'entryNode',
          arguments: {
            taskContract,
            trace: { enabled: true, label: 'contract-routing' },
          },
        },
      },
    },
  ]

  const result = await entryNodeTool.function?.(
    {
      taskContract,
      trace: { enabled: true, label: 'contract-routing' },
      prompt_templates: testPromptTemplates,
    },
    {
      getExecutionTaskChain: () => Promise.resolve(taskChain),
      createSubtasksResult,
      getSecret: () => Promise.resolve(null),
      setSecret: () => Promise.resolve(),
      stopSignal: new AbortController().signal,
      toolId: 'entry-node-structured-tool-decision-test',
    },
  )
  assert(
    result && typeof result === 'object' && 'taskChainList' in result,
    'Expected entryNode to create a structured native-tool continuation',
  )

  const continuation = result.taskChainList[0]
  const scopedDefinition = continuation?.find((task) => task.content.type === 'tooldefinition')
  const chatArguments = findFunctionCall(continuation, 'chatCompletion')?.arguments
  assert(
      scopedDefinition?.content.type === 'tooldefinition' &&
      'implementation' in scopedDefinition.content.data &&
      scopedDefinition.content.data.implementation.target === 'entryNode' &&
      chatArguments &&
      typeof chatArguments === 'object' &&
      Array.isArray(chatArguments.allowedTools) &&
      chatArguments.allowedTools.includes('bash') &&
      chatArguments.allowedTools.includes('selectTaskyonTools') &&
      !('toolChoice' in chatArguments) &&
      'schema' in chatArguments &&
      JSON.stringify(chatArguments.schema) === JSON.stringify(taskContract.result.schema) &&
      !('resultMode' in chatArguments),
    'Expected native tool calling and the structured result schema in the same completion',
  )

  const selectedToolResult = await entryNodeTool.function?.(
    { prompt_templates: testPromptTemplates },
    {
      getExecutionTaskChain: () =>
        Promise.resolve([
          taskChain[0] as TaskNode,
          taskChain[1] as TaskNode,
          {
            id: 'tool-decision-chat',
            role: 'function',
            parentID: 'entry-node',
            content: {
              type: 'functioncall',
              data: { name: 'chatCompletion', arguments: {} },
            },
          },
          {
            id: 'tool-decision-reentry',
            role: 'function',
            parentID: 'tool-decision-chat',
            content: {
              type: 'functioncall',
              data: { name: 'entryNode', arguments: { allowedTools: ['bash'] } },
            },
          },
        ]),
      createSubtasksResult,
      getSecret: () => Promise.resolve(null),
      setSecret: () => Promise.resolve(),
      stopSignal: new AbortController().signal,
      toolId: 'entry-node-selected-tool-test',
    },
  )
  assert(
    selectedToolResult &&
      typeof selectedToolResult === 'object' &&
      'taskChainList' in selectedToolResult,
    'Expected entryNode to continue with the selected native tool',
  )

  const selectedToolArguments = findFunctionCall(
    selectedToolResult.taskChainList[0],
    'chatCompletion',
  )?.arguments
  assert(
    selectedToolArguments &&
      typeof selectedToolArguments === 'object' &&
      'allowedTools' in selectedToolArguments &&
      Array.isArray(selectedToolArguments.allowedTools) &&
      selectedToolArguments.allowedTools[0] === 'bash' &&
      !('schema' in selectedToolArguments) &&
      'trace' in selectedToolArguments,
    'Expected the real entryNode to inherit deterministic settings from lineage without applying the contracted result schema during tool execution',
  )

  const postToolResult = await entryNodeTool.function?.(
    { prompt_templates: testPromptTemplates },
    {
      getExecutionTaskChain: () =>
        Promise.resolve([
          ...taskChain,
          {
            id: 'tool-decision-reentry',
            role: 'function',
            content: {
              type: 'functioncall',
              data: { name: 'entryNode', arguments: { allowedTools: ['bash'] } },
            },
          },
          {
            id: 'bash-result',
            role: 'system',
            content: { type: 'toolresult', data: { stdout: 'done' } },
          },
          {
            id: 'post-tool-entry',
            role: 'function',
            content: { type: 'functioncall', data: { name: 'entryNode', arguments: {} } },
          },
        ]),
      createSubtasksResult,
      getSecret: () => Promise.resolve(null),
      setSecret: () => Promise.resolve(),
      stopSignal: new AbortController().signal,
      toolId: 'entry-node-structured-post-tool-test',
    },
  )
  assert(
    postToolResult && typeof postToolResult === 'object' && 'taskChainList' in postToolResult,
    'Expected entryNode to decide whether more tool work is needed after a structured task tool result',
  )
  const postToolArguments = findFunctionCall(
    postToolResult.taskChainList[0],
    'chatCompletion',
  )?.arguments
  assert(
    postToolArguments &&
      typeof postToolArguments === 'object' &&
      'trace' in postToolArguments &&
      'schema' in postToolArguments &&
      JSON.stringify(postToolArguments.schema) === JSON.stringify(taskContract.result.schema) &&
      Array.isArray(postToolArguments.allowedTools) &&
      postToolArguments.allowedTools.includes('bash'),
    'Expected structured post-tool completion to preserve tracing, native tools, and schema',
  )

  return { success: true }
}

export const testEntryNodeDoesNotAskClarificationDuringErrorRecovery = async () => {
  const entryNodeTool = createStandardEntryNodeTool({
    name: 'entryNode',
    renderOptions: { hideChat: true, hideLlm: true },
    defaultAllowedTools: ['bash', CLARIFICATION_TOOL_NAME],
  })
  const taskChain: TaskNode[] = [
    {
      id: 'user',
      role: 'user',
      content: {
        type: 'message',
        data: 'Research this autonomously.',
      },
    },
    {
      id: 'failed-chat',
      role: 'function',
      priorID: 'user',
      content: {
        type: 'functioncall',
        data: {
          name: 'chatCompletion',
          arguments: {
            allowedTools: ['bash', CLARIFICATION_TOOL_NAME],
          },
        },
      },
    },
    {
      id: 'error',
      role: 'system',
      parentID: 'failed-chat',
      content: {
        type: 'error',
        data: {
          message: 'server_is_overloaded',
        },
      },
    },
    {
      id: 'entry-node',
      role: 'function',
      priorID: 'error',
      content: {
        type: 'functioncall',
        data: {
          name: 'entryNode',
          arguments: {},
        },
      },
    },
  ]

  const result = await entryNodeTool.function?.(
    { prompt_templates: testPromptTemplates },
    {
      getExecutionTaskChain: () => Promise.resolve(taskChain),
      createSubtasksResult,
      getSecret: () => Promise.resolve(null),
      setSecret: () => Promise.resolve(),
      stopSignal: new AbortController().signal,
      toolId: 'entry-node-error-test',
    },
  )

  assert(
    result && typeof result === 'object' && 'taskChainList' in result,
    'Expected entryNode to return a task result',
  )

  const chatCompletionCall = findFunctionCall(result.taskChainList[0], 'chatCompletion')
  const args =
    chatCompletionCall &&
    typeof chatCompletionCall === 'object' &&
    'arguments' in chatCompletionCall &&
    chatCompletionCall.arguments &&
    typeof chatCompletionCall.arguments === 'object'
      ? chatCompletionCall.arguments
      : undefined
  const allowedTools = args && 'allowedTools' in args ? args.allowedTools : undefined

  if (!Array.isArray(allowedTools)) {
    throw new Error('Expected error recovery chatCompletion to include allowed tools')
  }
  assert(
    allowedTools.includes('bash'),
    'Expected error recovery to preserve non-clarification tools',
  )
  assert(
    !allowedTools.includes(CLARIFICATION_TOOL_NAME),
    'Expected error recovery to filter askClarifyingQuestions from allowed tools',
  )

  return { success: true }
}

export const testEntryNodeRecoversFromMalformedPythonToolCall = async (
  context?: DiagnosticsTestContext,
) => {
  if (!context?.providerKey) {
    return {
      skipped: true,
      reason: 'No configured provider key/session was available from the diagnostics harness.',
    }
  }
  const runtimeConfig = resolveDiagnosticsRuntimeConfig(context)
  if (!runtimeConfig) {
    return {
      skipped: true,
      reason: 'No runtime llmSettings were provided by the diagnostics harness.',
    }
  }

  const storage = createPortableTestStorage()
  const entryNodeTool = createStandardEntryNodeTool({
    name: 'entryNode',
    renderOptions: { hideChat: true, hideLlm: true },
    defaultAllowedTools: ['executePythonScript'],
  })
  const executePythonScriptTool = createTool({
    name: 'executePythonScript',
    description: 'Execute Python code in the diagnostics runtime.',
    parameters: {
      type: 'object',
      properties: {
        code: { type: 'string' },
      },
      required: ['code'],
      additionalProperties: false,
    },
    function: ({ code }) => ({
      ok: true,
      stdout: code,
    }),
  })
  const defaultToolSetup = createDefaultTaskyonToolSetup()
  const toolSetup = {
    ...defaultToolSetup,
    baseTools: defaultToolSetup.baseTools.filter(
      (tool) => tool.name !== executePythonScriptTool.name,
    ),
  }

  const ty = await tyCore(
    () => runtimeConfig.settings,
    () =>
      toolCall({
        name: 'entryNode',
        arguments: {},
      }),
    {
      chatCompletion: runtimeConfig.providerSettings,
      entryNode: {},
    },
    undefined,
    {
      toolSetup,
      taskManagerStorageFactory: storage.taskManagerStorageFactory,
    },
  )
  const toolRpcExecutor = await registerToolRpcTools({
    port: ty.port,
    tools: [entryNodeTool, executePythonScriptTool],
    createContext: (call, stopSignal) =>
      createExternalToolContext(stopSignal, {
        getExecutionTaskChain: () => {
          if (!call.taskId) throw new Error('Expected task id for entryNode test')
          return createTaskyonClient(ty.port).task.getChain({ id: call.taskId })
        },
      }),
  })

  try {
    const selectedApi = runtimeConfig.providerSettings.provider
    const providerKey = context.providerKey
    await ty.updateChatCompletionApiKey(selectedApi, providerKey)

    const observed: TaskNode[] = []
    const byId = new Map<string, TaskNode>()
    const finish = await new Promise<{ assistant: TaskNode; tasks: TaskNode[] }>(
      (resolve, reject) => {
        const timeout = setTimeout(() => {
          unsubscribe()
          reject(new Error('Timed out waiting for entry-node recovery flow'))
        }, 180_000)
        const unsubscribe = ty.port.receive((msg) => {
          if (msg.type !== 'taskCreated' || !msg.task) return
          const task = msg.task
          observed.push(task)
          byId.set(task.id, task)
          if (task.role === 'assistant' && task.content.type === 'message') {
            const text = String(task.content.data ?? '')
            if (text.length > 0) {
              clearTimeout(timeout)
              unsubscribe()
              resolve({ assistant: task, tasks: observed })
            }
          }
        })
        void buildLinkedTaskChain([
          {
            role: 'user',
            content: {
              type: 'message',
              data: [
                'Use executePythonScript and do exactly this sequence:',
                '1) First call it with wrong parameters: {"script":"print(\\"broken\\")"} so it fails.',
                '2) Then recover and call it correctly with {"code":"print(\\"recovered-ok\\")"}.',
                '3) After successful execution, respond with a short assistant message.',
              ].join('\n'),
            },
          },
          toolCall({
            name: 'entryNode',
            arguments: {},
          }),
        ])
          .then((tasks) =>
            createTaskyonClient(ty.port).task.createChain({
              execute: true,
              show: false,
              tasks,
            }),
          )
          .catch(reject)
      },
    )

    const pythonCalls = finish.tasks.filter(
      (task) =>
        task.content.type === 'functioncall' && task.content.data.name === 'executePythonScript',
    )
    const pythonToolResults = finish.tasks.filter((task) => {
      if (task.content.type !== 'toolresult' || !task.parentID) return false
      const parent = byId.get(task.parentID)
      return (
        parent?.content.type === 'functioncall' &&
        parent.content.data.name === 'executePythonScript'
      )
    })
    const errorTasks = finish.tasks.filter((task) => task.content.type === 'error')
    const invalidArgumentsError = errorTasks.find((task) => {
      const message = humanizeError(task.content.data)
      return (
        message.includes('Invalid arguments for tool "executePythonScript"') &&
        message.includes("required property 'code'")
      )
    })
    const successfulPythonResult = pythonToolResults.find((task) => {
      const data = task.content.data as { ok?: unknown; stdout?: unknown }
      return (
        data.ok === true && typeof data.stdout === 'string' && data.stdout.includes('recovered-ok')
      )
    })

    assert(
      Boolean(invalidArgumentsError),
      'Expected malformed executePythonScript arguments to be rejected before task creation',
    )
    assert(pythonCalls.length === 1, 'Expected one corrected executePythonScript task call')
    assert(
      Boolean(successfulPythonResult),
      'Expected successful executePythonScript toolresult with "recovered-ok"',
    )

    return {
      success: true,
      model: context.model,
      selectedApi,
      assistantMessage:
        finish.assistant.content.type === 'message' ? finish.assistant.content.data : '',
      counts: {
        observedTasks: finish.tasks.length,
        pythonCalls: pythonCalls.length,
        pythonToolResults: pythonToolResults.length,
        invalidArgumentErrors: invalidArgumentsError ? 1 : 0,
      },
    }
  } finally {
    toolRpcExecutor.destroy()
    await ty.dispose('entry-node malformed Python recovery diagnostic complete')
    storage.destroy()
  }
}

testEntryNodeRecoversFromMalformedPythonToolCall.description =
  'EntryNode should recover from malformed executePythonScript parameters by retrying with corrected arguments.'
testEntryNodeRecoversFromMalformedPythonToolCall.modelBased = true
testEntryNodeRecoversFromMalformedPythonToolCall.timeoutMs = 210_000

testEntryNodeDoesNotAskClarificationDuringErrorRecovery.description =
  'EntryNode should not ask human clarification questions while recovering from a tool error.'
testEntryNodePropagatesTaskContractWithoutPromptDuplication.description =
  'EntryNode should carry task contracts through re-entry without repeating visible contract text in system prompts.'
testEntryNodeForwardsContractedResultSchema.description =
  'EntryNode should forward contracted structured result requirements to final chat completions.'
testEntryNodeHonorsExplicitAllowedToolRestrictions.description =
  'EntryNode should enforce empty and restricted allowedTools overrides against the configured tool catalog.'
