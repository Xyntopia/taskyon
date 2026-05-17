import {
  defaultMcpCapableWebProvider,
  mcpCapableWebProviderIds,
  proxyWebReaderProviderIds,
  resolveProxyWebReaderArgs,
} from '@taskyon/shared/modules/webFetching'
import {
  buildBrowserMcpImportChain,
  buildEnsureBrowserMcpImportRetryChain,
  buildWebResearchTaskGroups,
  webResearchPlanner,
} from '../tools/webResearchTool'

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message)
}

const getFunctionCall = (task: unknown) => {
  if (!task || typeof task !== 'object' || !('content' in task)) return undefined
  const content = task.content
  if (!content || typeof content !== 'object' || !('type' in content) || !('data' in content)) {
    return undefined
  }
  return content.type === 'functioncall' ? content.data : undefined
}

export const testWebResearchBuildsParallelQueryGroups = () => {
  const groups = buildWebResearchTaskGroups({
    objective: 'Collect solar cell spec sheets',
    searchQueries: ['Aiko solar ABC datasheet pdf', 'LONGi Hi-MO X10 datasheet pdf'],
    browserTools: ['browser_search', 'browser_visit'],
    maxSourcesPerQuery: 4,
    mustDownload: true,
    fileTypeHints: ['pdf'],
    deliverable: 'manufacturer, model, direct PDF URL',
  })

  assert(groups.length === 2, `Expected 2 parallel research groups, got ${groups.length}`)
  assert(groups[0]?.length === 2, `Expected each group to contain 2 sequential tasks`)
  assert(
    groups[0]?.[0]?.allowedTools?.includes('browser_search'),
    'Expected imported browser tools to be forwarded to delegated subtasks',
  )
  assert(
    groups[0]?.[0]?.allowedTools?.includes('tauriHttpWebReader'),
    'Expected support tools to include the built-in direct web reader by default',
  )
  assert(
    groups[0]?.[0]?.task.includes('Aiko solar ABC datasheet pdf'),
    'Expected the first delegated task to reference the search query',
  )
  assert(
    groups[0]?.[1]?.task.includes('download the spec sheets'),
    'Expected the second delegated task to request download or direct asset capture',
  )

  return { success: true }
}

export const testBrowserMcpImportChainBuildsImportCall = () => {
  const chain = buildBrowserMcpImportChain({
    serverUrl: 'http://127.0.0.1:8931/mcp',
    serverName: 'browser-mcp',
    toolNames: ['browser_search'],
  })

  assert(chain.length === 2, `Expected 2 tasks in browser MCP import chain, got ${chain.length}`)
  assert(
    chain[0]?.content.type === 'message' &&
      chain[0].content.data.includes('browser-mcp') &&
      chain[0].content.data.includes('http://127.0.0.1:8931/mcp'),
    'Expected first import step to summarize the MCP endpoint',
  )

  const importCall = getFunctionCall(chain[1])
  assert(
    importCall &&
      typeof importCall === 'object' &&
      'name' in importCall &&
      importCall.name === 'importMcpTools',
    'Expected second import step to call importMcpTools',
  )
  assert(
    importCall &&
      typeof importCall === 'object' &&
      'arguments' in importCall &&
      importCall.arguments &&
      typeof importCall.arguments === 'object' &&
      'toolNames' in importCall.arguments &&
      Array.isArray(importCall.arguments.toolNames) &&
      importCall.arguments.toolNames[0] === 'browser_search',
    'Expected import chain to forward requested browser MCP tool names',
  )

  return { success: true }
}

export const testEnsureBrowserMcpImportRetryChainBuildsImportCall = () => {
  const chain = buildEnsureBrowserMcpImportRetryChain({
    serverUrl: 'http://127.0.0.1:8931/mcp',
    serverName: 'browser-mcp',
    toolNames: ['browser_search'],
  })

  assert(chain.length === 3, `Expected 3 tasks in ensure/import retry chain, got ${chain.length}`)
  assert(
    chain[0]?.content.type === 'message' &&
      chain[0].content.data.includes('Browser MCP endpoint is reachable'),
    'Expected first ensure step to confirm endpoint reachability',
  )

  const importCall = getFunctionCall(chain[2])
  assert(
    importCall &&
      typeof importCall === 'object' &&
      'name' in importCall &&
      importCall.name === 'importMcpTools',
    'Expected final ensure step to call importMcpTools',
  )

  return { success: true }
}

export const testProxyWebReaderProviderCatalogAndPresetResolution = () => {
  assert(
    proxyWebReaderProviderIds.length >= 40,
    `Expected at least 40 proxy provider presets, got ${proxyWebReaderProviderIds.length}`,
  )

  const resolved = resolveProxyWebReaderArgs({
    url: 'https://example.com/spec.pdf',
    providerPreset: 'evomi_core_residential',
  })

  assert(
    resolved.providerLabel === 'Evomi Core Residential',
    `Expected provider label to come from preset, got ${resolved.providerLabel}`,
  )
  assert(
    resolved.pricingUrl === 'https://evomi.com/pricing',
    `Expected pricing URL to come from preset, got ${resolved.pricingUrl}`,
  )
  assert(
    resolved.apiKeyLocation === 'header',
    `Expected default API key location to remain header, got ${resolved.apiKeyLocation}`,
  )

  return { success: true }
}

export const testMcpCapableWebProviderCatalog = () => {
  assert(
    mcpCapableWebProviderIds.length >= 10,
    `Expected at least 10 MCP-capable providers, got ${mcpCapableWebProviderIds.length}`,
  )
  assert(
    defaultMcpCapableWebProvider?.providerId === 'scraperapi',
    `Expected ScraperAPI to be the current default MCP-capable provider, got ${defaultMcpCapableWebProvider?.providerId}`,
  )
  assert(
    mcpCapableWebProviderIds.includes('geonode_scraper_api'),
    'Expected Geonode Scraper API to be saved in the MCP-capable provider list',
  )
  assert(
    !mcpCapableWebProviderIds.includes('evomi_core_residential'),
    'Expected raw residential-only proxy networks to stay out of the MCP-capable provider list',
  )

  return { success: true }
}

export const testWebResearchPlannerEnablesBrowserSetupAndWebSearchByDefault = () => {
  const baseContext = {
    taskChain: [],
    getSecret: () => Promise.resolve(null),
    setSecret: () => Promise.resolve(),
    stopSignal: new AbortController().signal,
    toolId: 'test-tool',
  }

  const initialResult = webResearchPlanner.function?.(
    {
      objective: 'Collect solar cell spec sheets',
      searchQueries: ['Aiko solar ABC datasheet pdf'],
      browserTools: ['browser_search', 'browser_visit'],
    },
    baseContext,
  )

  assert(
    initialResult && typeof initialResult === 'object' && 'taskChainList' in initialResult,
    'Expected webResearchPlanner to return a task result',
  )

  const ensureCall = getFunctionCall(initialResult.taskChainList[0]?.[1])
  assert(
    ensureCall &&
      typeof ensureCall === 'object' &&
      'name' in ensureCall &&
      ensureCall.name === 'ensureBrowserMcpTools',
    'Expected research planner to ensure browser MCP access by default',
  )

  const delegatedResult = webResearchPlanner.function?.(
    {
      objective: 'Collect solar cell spec sheets',
      searchQueries: ['Aiko solar ABC datasheet pdf'],
      browserTools: ['browser_search', 'browser_visit'],
      ensureBrowserMcp: false,
    },
    baseContext,
  )

  assert(
    delegatedResult && typeof delegatedResult === 'object' && 'taskChainList' in delegatedResult,
    'Expected delegated research task result after browser MCP setup',
  )

  const delegatedEntryNodeCall = getFunctionCall(delegatedResult.taskChainList[1]?.[3])
  assert(
    delegatedEntryNodeCall &&
      typeof delegatedEntryNodeCall === 'object' &&
      'arguments' in delegatedEntryNodeCall &&
      delegatedEntryNodeCall.arguments &&
      typeof delegatedEntryNodeCall.arguments === 'object' &&
      'websearch' in delegatedEntryNodeCall.arguments &&
      typeof delegatedEntryNodeCall.arguments.websearch === 'object' &&
      delegatedEntryNodeCall.arguments.websearch?.enabled === true,
    'Expected delegated research branches to enable chatCompletion web search by default',
  )

  return { success: true }
}

testWebResearchBuildsParallelQueryGroups.description =
  'Builds parallel web-research branches where each query expands into sequential discovery and validation tasks with explicit browser-capable tool restrictions.'
testBrowserMcpImportChainBuildsImportCall.description =
  'Builds the browser MCP import bootstrap chain and forwards the selected MCP tool names into importMcpTools.'
testEnsureBrowserMcpImportRetryChainBuildsImportCall.description =
  'Builds the browser MCP ensure/import retry chain after endpoint reachability has been confirmed.'
testProxyWebReaderProviderCatalogAndPresetResolution.description =
  'Exposes a large proxy provider catalog and resolves proxyWebReader metadata from a selected provider preset.'
testMcpCapableWebProviderCatalog.description =
  'Saves a dedicated MCP-capable web-provider catalog derived from the shared proxy provider source of truth.'
testWebResearchPlannerEnablesBrowserSetupAndWebSearchByDefault.description =
  'Ensures browser MCP setup runs before research by default and delegated research branches enable chatCompletion web search for discovery.'
testWebResearchPlannerEnablesBrowserSetupAndWebSearchByDefault.requiresLargeTokens = true
