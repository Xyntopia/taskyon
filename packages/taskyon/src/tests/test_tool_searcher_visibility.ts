import { createToolManager, type ToolStorageRecord } from '../core/toolManager'
import { createSubtasksResult, type toolContext } from '../types/toolApi'
import { createMapCrudWrapper } from '../utils/crudWrapper'
import { createToolSearcher, resolveAgentToolCatalog } from '../tools/toolTools'
import { rankToolDefinitions } from '../tools/toolSearchRanking'

export const testFocusedToolSearchMatchesCamelCaseNames = () => {
  const matches = rankToolDefinitions(
    [
      {
        name: 'exportCalendar',
        description: 'Produce an ICS attachment.',
        parameters: { type: 'object', properties: {} },
      },
    ],
    'export calendar',
    5,
    { minimumMatchedTerms: 2, exactTermMatches: true },
  )
  assert(matches[0]?.name === 'exportCalendar', 'Expected name words to match focused searches')
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

export const testToolSearcherIsInternalOnly = () => {
  const toolManager = createToolManager(createMapCrudWrapper<ToolStorageRecord>(new Map()))
  const toolSearcher = createToolSearcher(toolManager)

  assert(toolSearcher.renderOptions?.hideChat === true, 'Expected toolSearcher hidden in chat')
  assert(
    toolSearcher.renderOptions?.hideLlm === true,
    'Expected toolSearcher hidden from LLM context',
  )
  assert(
    toolSearcher.renderOptions?.hideVector === true,
    'Expected toolSearcher excluded from the searchable tool catalog',
  )
  assert(
    resolveAgentToolCatalog({ toolSearcher }).length === 0,
    'Expected toolSearcher not to select itself as an agent tool',
  )
}

testToolSearcherIsInternalOnly.description =
  'Keeps the broad registered searcher internal while EntryNode exposes its narrow scoped binding.'

export const testToolSearcherReportsWhenAQueryFindsNoMatchingTool = async () => {
  const toolManager = createToolManager(createMapCrudWrapper<ToolStorageRecord>(new Map()))
  await toolManager.addDefaultTools([
    {
      name: 'knownTool',
      description: 'A known test tool.',
      parameters: { type: 'object', properties: {} },
    },
  ])
  const toolSearcher = createToolSearcher(toolManager)
  const context: toolContext = {
    getExecutionTaskChain: () => Promise.resolve([]),
    createSubtasksResult: (tasks) => createSubtasksResult(tasks),
    getSecret: () => Promise.resolve(null),
    setSecret: () => Promise.resolve(),
    stopSignal: new AbortController().signal,
    toolId: 'tool-searcher-no-match-test',
  }
  const result = await toolSearcher.function?.(
    { query: 'runGeoJSONTests', limit: 5, analyze: true },
    context,
  )

  assert(result && typeof result === 'object', 'Expected a catalog-search result object')
  const matches = Reflect.get(result, 'Here are the matching tools')
  assert(Array.isArray(matches) && matches.length === 0, 'Expected no matching tools')
  assert(
    Reflect.get(result, 'Search status') ===
      'No registered tool matched this query; no requested operation was executed.',
    'Expected the empty search result to state that no requested operation ran',
  )
  return { noMatch: true }
}

testToolSearcherReportsWhenAQueryFindsNoMatchingTool.description =
  'Explains that an empty catalog search did not execute the requested operation.'

export const testFocusedToolSearcherRejectsGenericPartialMatches = async () => {
  const toolManager = createToolManager(createMapCrudWrapper<ToolStorageRecord>(new Map()))
  await toolManager.addDefaultTools([
    {
      name: 'testSecretStore',
      description: 'Development-only check that writes and reads a Taskyon secret value.',
      parameters: { type: 'object', properties: {} },
    },
  ])
  const toolSearcher = createToolSearcher(toolManager)
  const context: toolContext = {
    getExecutionTaskChain: () => Promise.resolve([]),
    createSubtasksResult: (tasks) => createSubtasksResult(tasks),
    getSecret: () => Promise.resolve(null),
    setSecret: () => Promise.resolve(),
    stopSignal: new AbortController().signal,
    toolId: 'tool-searcher-focused-test',
  }
  const result = await toolSearcher.function?.(
    { query: 'geojson tests run', limit: 5, analyze: true, focused: true },
    context,
  )

  assert(result && typeof result === 'object', 'Expected a focused catalog-search result object')
  const matches = Reflect.get(result, 'Here are the matching tools')
  assert(
    Array.isArray(matches) && matches.length === 0,
    'Expected a generic one-term match to be rejected for focused search',
  )
  return { noGenericMatch: true }
}

testFocusedToolSearcherRejectsGenericPartialMatches.description =
  'Keeps focused EntryNode search from selecting an unrelated tool on one generic query term.'
