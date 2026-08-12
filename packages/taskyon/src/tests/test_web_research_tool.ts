import {
  defaultMcpCapableWebProvider,
  mcpCapableWebProviderIds,
  proxyWebReaderProviderIds,
  resolveProxyWebReaderArgs,
} from '@taskyon/common/modules/webFetching'
import { DEFAULT_POLITE_HTTP_MIN_DELAY_MS } from '../utils/politeHttp'
import { processTasksDetailed } from '../api'
import { tyCore } from '../core/init'
import { createDefaultTaskyonToolSetup } from '../tools'
import { createStorageTool } from '../tools/fileTools'
import { createProtocolPort } from '@taskyon/common/modules/frpBus'
import { createStorageClient, taskyonStorageProtocol } from '../api/storageProtocol'
import {
  buildBrowserMcpImportChain,
  buildEnsureBrowserMcpImportRetryChain,
  buildWebResearchTaskGroups,
  proxyWebReader,
  webResearchPlanner,
} from '../tools/webResearchTool'
import type { TaskNode } from '../types/taskNode'
import { createSubtasksResult, createTool, toolCall } from '../types/toolApi'
import { registerToolRpcTools } from '../core/toolRpc'
import { FunctionCall } from '../types/tools'

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message)
}

const storagePort = createProtocolPort(taskyonStorageProtocol)
const storageTool = createStorageTool(createStorageClient(storagePort.x))

const getFunctionCall = (task: unknown): FunctionCall | undefined => {
  if (!task || typeof task !== 'object' || !('content' in task)) return undefined
  const content = task.content
  if (!content || typeof content !== 'object' || !('type' in content) || !('data' in content)) {
    return undefined
  }
  return content.type === 'functioncall' ? FunctionCall.parse(content.data) : undefined
}

const updateFilesStub = createTool({
  name: 'updateFiles',
  description: 'Test stub for file updates.',
  parameters: {
    type: 'object',
    additionalProperties: true,
    properties: {},
  },
  function: () => ({ ok: true }),
})

const storageStub = createTool({
  name: 'storage',
  description: 'Test stub for browser storage file storage.',
  parameters: {
    type: 'object',
    additionalProperties: true,
    properties: {},
  },
  function: () => ({ ok: true }),
})

const bashStub = createTool({
  name: 'bash',
  description: 'Test stub for command-line downloads.',
  parameters: {
    type: 'object',
    additionalProperties: true,
    properties: {},
  },
  function: () => ({ ok: true }),
})

const downloadFileStub = createTool({
  name: 'downloadFile',
  description: 'Test stub for verified command-line downloads.',
  parameters: {
    type: 'object',
    additionalProperties: true,
    properties: {},
  },
  function: () => ({ ok: true }),
})

const jinaMarkdownReaderStub = createTool({
  name: 'jinaMarkdownReader',
  description: 'Test stub for page validation.',
  parameters: {
    type: 'object',
    additionalProperties: true,
    properties: {},
  },
  function: () => ({ ok: true }),
})

const isDelegatedResearchEntryNode = (task: TaskNode) => {
  if (task.content.type !== 'functioncall' || task.content.data.name !== 'entryNode') return false
  const args = task.content.data.arguments
  return (
    !!args &&
    typeof args === 'object' &&
    !Array.isArray(args) &&
    'allowedTools' in args &&
    Array.isArray(args.allowedTools) &&
    args.allowedTools[0] === 'updateFiles'
  )
}

export const testWebResearchBuildsParallelQueryGroups = () => {
  const groups = buildWebResearchTaskGroups({
    objective: 'Collect solar cell spec sheets',
    searchQueries: ['Aiko solar ABC datasheet pdf', 'LONGi Hi-MO X10 datasheet pdf'],
    researchMode: 'browser-mcp-first',
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
    !groups[0]?.[0]?.allowedTools?.includes('chatCompletion'),
    'Expected web-search-enabled research branches to avoid recursive chatCompletion tool calls',
  )
  assert(
    !groups[0]?.[0]?.allowedTools?.includes('proxyWebReader') &&
      !groups[0]?.[0]?.allowedTools?.includes('tauriHttpWebReader'),
    'Expected websearch-first research branches to keep fallback reader tools opt-in',
  )
  assert(
    groups[0]?.[0]?.allowedTools?.includes('updateFiles'),
    'Expected websearch-first research branches to keep updateFiles available for save requests',
  )
  assert(
    !groups[0]?.[0]?.allowedTools?.includes('storage'),
    'Expected generic websearch-first research branches to keep browser-only storage storage opt-in',
  )
  assert(
    groups[0]?.[0]?.allowedTools?.includes('downloadFile'),
    'Expected websearch-first research branches to keep verified local downloads available',
  )
  assert(
    groups[0]?.[0]?.allowedTools?.includes('bash'),
    'Expected websearch-first research branches to keep bash available as a download fallback',
  )
  assert(
    groups[0]?.[0]?.allowedTools?.includes('jinaMarkdownReader'),
    'Expected websearch-first research branches to keep a page reader available for validation',
  )
  assert(
    groups[0]?.[0]?.task.includes('Aiko solar ABC datasheet pdf'),
    'Expected the first delegated task to reference the search query',
  )
  assert(
    groups[0]?.[1]?.task.includes('The requested deliverable includes saved research artifacts'),
    'Expected the second delegated task to require saved research artifacts',
  )
  assert(
    groups[0]?.[1]?.task.includes('updateFiles or storage'),
    'Expected validation tasks to save requested deliverables when a file-writing tool is available',
  )
  assert(
    groups[0]?.[1]?.task.includes('local path or storage path'),
    'Expected validation tasks to choose a task-specific directory structure for multi-file saves',
  )
  assert(
    groups[0]?.[1]?.task.includes('Do not create competing branch-specific directories'),
    'Expected validation tasks to reject competing branch-specific directories',
  )
  assert(
    groups[0]?.[1]?.task.includes('storage download with expectedFileType set to pdf'),
    'Expected validation tasks to describe browser storage PDF URL validation',
  )
  assert(
    groups[0]?.[1]?.task.includes('For storage saves, base64-encode file content'),
    'Expected validation tasks to describe browser storage artifact saves',
  )
  assert(
    groups[0]?.[1]?.task.includes('use it to validate candidate pages'),
    'Expected validation tasks to prefer page-reader validation before shell-only guesses',
  )
  assert(
    groups[0]?.[1]?.task.includes('do not treat URL-only entries as completed downloads'),
    'Expected validation tasks to reject URL-only entries when artifact downloads are requested',
  )
  assert(
    groups[0]?.[1]?.task.includes('real PDF content'),
    'Expected validation tasks to reject HTML/error pages for PDF downloads',
  )
  assert(
    groups[0]?.[1]?.task.includes('starts with the %PDF- magic bytes'),
    'Expected validation tasks to require shell fallback PDF byte validation',
  )
  assert(
    groups[0]?.[1]?.task.includes('research/collect-solar-cell-spec-sheets/'),
    'Expected validation tasks to include a single planner-selected artifact root',
  )
  assert(
    groups[0]?.[1]?.task.includes('artifactRoot: research/collect-solar-cell-spec-sheets/'),
    'Expected delegated tasks to pass the artifact root into artifact-writing tools',
  )
  assert(
    groups[0]?.[1]?.task.includes(
      'When using storage, use research/collect-solar-cell-spec-sheets as both artifactRoot and namespace',
    ),
    'Expected delegated tasks to pass the artifact root into browser storage writes',
  )

  return { success: true }
}

export const testWebResearchArtifactRootSlugIsStable = () => {
  const args = {
    objective: "Find 10 home battery spec sheets that don't require a permit in California!",
    searchQueries: ['California no permit home battery datasheet pdf'],
  }
  const groups = buildWebResearchTaskGroups(args)
  const repeatedGroups = buildWebResearchTaskGroups(args)
  const discovery = groups[0]?.[0]?.task ?? ''
  const validation = groups[0]?.[1]?.task ?? ''
  const repeatedDiscovery = repeatedGroups[0]?.[0]?.task ?? ''
  const artifactRoot = discovery.match(
    /Use exactly this artifact root for the whole request: ([^ ]+)\./,
  )?.[1]

  assert(
    artifactRoot?.startsWith('research/find-10-home-battery-spec-sheets') &&
      artifactRoot.endsWith('/'),
    `Expected a readable bounded research artifact root, got ${artifactRoot ?? '(none)'}`,
  )
  if (!artifactRoot) throw new Error('Expected the discovery task to expose its artifact root')
  assert(
    validation.includes(artifactRoot) && repeatedDiscovery.includes(artifactRoot),
    'Expected discovery, validation, and repeated planning to reuse the identical artifact root',
  )

  return { success: true }
}

export const testWebResearchPreservesExactSourceIdentity = () => {
  const groups = buildWebResearchTaskGroups({
    objective: 'Build a client for The Trivia API using its official documentation.',
    searchQueries: ['The Trivia API official documentation'],
  })
  const discovery = groups[0]?.[0]?.task ?? ''
  const validation = groups[0]?.[1]?.task ?? ''

  assert(
    discovery.includes('hard identity constraint') && discovery.includes('exact product names'),
    'Expected discovery to preserve named products and providers as exact constraints',
  )
  assert(
    validation.includes('branding, provider, and domain') &&
      validation.includes('different service in the same category is not a match'),
    'Expected validation to reject same-category API substitutions',
  )
  assert(
    validation.includes('quoted exact name') && validation.includes('never describe'),
    'Expected source mismatch recovery to search the exact name without relabeling a substitute',
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

export const testWebResearchPlannerUsesWebSearchFirstByDefault = async () => {
  const baseContext = {
    getExecutionTaskChain: () => Promise.resolve([]),
    createSubtasksResult,
    getSecret: () => Promise.resolve(null),
    setSecret: () => Promise.resolve(),
    stopSignal: new AbortController().signal,
    toolId: 'test-tool',
  }

  const initialResult = await webResearchPlanner.function?.(
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

  const firstCall = initialResult.taskChainList
    .flat()
    .map((task) => getFunctionCall(task))
    .find((call) => call && typeof call === 'object' && 'name' in call && call.name === 'entryNode')
  assert(
    firstCall &&
      typeof firstCall === 'object' &&
      'name' in firstCall &&
      firstCall.name === 'entryNode',
    'Expected default research mode to launch delegated research without browser MCP setup',
  )

  assert(
    firstCall &&
      typeof firstCall === 'object' &&
      'arguments' in firstCall &&
      firstCall.arguments &&
      typeof firstCall.arguments === 'object' &&
      'allowedTools' in firstCall.arguments &&
      Array.isArray(firstCall.arguments.allowedTools) &&
      firstCall.arguments.allowedTools.length === 4 &&
      firstCall.arguments.allowedTools[0] === 'updateFiles' &&
      firstCall.arguments.allowedTools[1] === 'downloadFile' &&
      firstCall.arguments.allowedTools[2] === 'bash' &&
      firstCall.arguments.allowedTools[3] === 'jinaMarkdownReader' &&
      'websearch' in firstCall.arguments &&
      typeof firstCall.arguments.websearch === 'object' &&
      firstCall.arguments.websearch !== null &&
      'enabled' in firstCall.arguments.websearch &&
      firstCall.arguments.websearch.enabled === true,
    'Expected default delegated research branches to enable chatCompletion web search and expose local save, verified download, shell fallback, and page-validation tools only',
  )

  const workflow = initialResult.taskChainList[0] ?? []
  const synthesisMessage = workflow.find(
    (task) =>
      task.content.type === 'message' &&
      typeof task.content.data === 'string' &&
      task.content.data.includes('Research synthesis checkpoint.'),
  )
  const synthesisEntryNode = getFunctionCall(workflow.at(-1))
  const branchReviewMessage = workflow.find(
    (task) =>
      task.content.type === 'message' &&
      typeof task.content.data === 'string' &&
      task.content.data.includes('Planner review checkpoint.'),
  )

  assert(
    synthesisMessage,
    'Expected webResearchPlanner to append a final synthesis checkpoint after delegated research',
  )
  assert(
    synthesisEntryNode?.name === 'entryNode',
    'Expected webResearchPlanner synthesis checkpoint to re-enter entryNode',
  )
  assert(
    !branchReviewMessage,
    'Expected webResearchPlanner to skip branch-local planner reviews and rely on final synthesis',
  )

  return { success: true }
}

export const testWebResearchPlannerProcessTasksKeepsSaveTool = async () => {
  const ty = await tyCore(
    () => ({
      entryFunction: 'entryNode',
    }),
    () =>
      toolCall({
        name: 'entryNode',
        arguments: {},
      }),
    {
      chatCompletion: {
        provider: 'test',
        name: 'test',
        model: 'test',
        baseURL: 'https://example.test',
        streamSupport: true,
        routes: {
          chatCompletion: '/chat/completions',
          models: '/models',
        },
      },
    },
    undefined,
    { toolSetup: createDefaultTaskyonToolSetup() },
  )
  const toolRpcExecutor = await registerToolRpcTools({
    port: ty.port,
    tools: [updateFilesStub, storageStub, downloadFileStub, bashStub, jinaMarkdownReaderStub],
  })

  try {
    const result = await processTasksDetailed(ty.port)(
      [
        [
          {
            role: 'user',
            content: {
              type: 'message',
              data: 'hi! can you search for 5 spec sheets of solar cells for me and save them here?',
            },
          },
          toolCall({
            name: 'webResearchPlanner',
            arguments: {
              objective: 'Find 5 solar cell spec sheets and save them here.',
              searchQueries: ['solar cell datasheet pdf manufacturer spec sheet'],
              enableWebSearch: true,
              deliverable: 'Markdown file with 5 solar cell spec sheets and direct URLs',
            },
          }),
        ],
      ],
      isDelegatedResearchEntryNode,
      {
        show: false,
        timeoutMs: 10_000,
        throwOnError: false,
        interruptOnSettle: (reason) => {
          ty.cancelCurrentRun(reason)
        },
      },
    )

    if (result.status !== 'matched') {
      throw new Error(`Expected delegated entryNode task, got ${result.status}`)
    }
    const args =
      result.result.content.type === 'functioncall'
        ? result.result.content.data.arguments
        : undefined
    assert(
      args &&
        typeof args === 'object' &&
        !Array.isArray(args) &&
        'allowedTools' in args &&
        Array.isArray(args.allowedTools) &&
        args.allowedTools.length === 4 &&
        args.allowedTools[0] === 'updateFiles' &&
        args.allowedTools[1] === 'downloadFile' &&
        args.allowedTools[2] === 'bash' &&
        args.allowedTools[3] === 'jinaMarkdownReader',
      'Expected processTasks-generated research branch to expose local save, verified download, shell fallback, and page-validation tools only',
    )
    assert(
      args &&
        typeof args === 'object' &&
        !Array.isArray(args) &&
        'websearch' in args &&
        args.websearch &&
        typeof args.websearch === 'object' &&
        !Array.isArray(args.websearch) &&
        'enabled' in args.websearch &&
        args.websearch.enabled === true,
      'Expected processTasks-generated research branch to keep web search enabled',
    )
    const delegatedBootstrapTask = result.observedTasks.find(
      (task) =>
        task.content.type === 'message' &&
        typeof task.content.data === 'string' &&
        task.content.data.includes('Task objective:\nResearch objective:'),
    )
    const delegatedBootstrap =
      delegatedBootstrapTask?.content.type === 'message' &&
      typeof delegatedBootstrapTask.content.data === 'string'
        ? delegatedBootstrapTask.content.data
        : ''
    assert(
      delegatedBootstrap.includes('research/find-5-solar-cell-spec-sheets-and-save-them-here/'),
      'Expected processTasks-generated research branch to include one deterministic artifact root',
    )
  } finally {
    toolRpcExecutor.destroy()
    await ty.dispose('web research planner diagnostic complete')
  }

  return { success: true }
}

export const testWebResearchPlannerBrowserMcpFirstEnsuresBrowserSetup = async () => {
  const result = await webResearchPlanner.function?.(
    {
      objective: 'Collect solar cell spec sheets',
      searchQueries: ['Aiko solar ABC datasheet pdf'],
      browserTools: ['browser_search', 'browser_visit'],
      researchMode: 'browser-mcp-first',
    },
    {
      getExecutionTaskChain: () => Promise.resolve([]),
      createSubtasksResult,
      getSecret: () => Promise.resolve(null),
      setSecret: () => Promise.resolve(),
      stopSignal: new AbortController().signal,
      toolId: 'test-tool',
    },
  )

  assert(
    result && typeof result === 'object' && 'taskChainList' in result,
    'Expected browser MCP research mode to return a task result',
  )

  const ensureCall = getFunctionCall(result.taskChainList[0]?.[1])
  assert(
    ensureCall &&
      typeof ensureCall === 'object' &&
      'name' in ensureCall &&
      ensureCall.name === 'ensureBrowserMcpTools',
    'Expected browser-mcp-first research mode to ensure browser MCP access',
  )

  return { success: true }
}

export const testWebResearchPlannerWebSearchOnlyExcludesBrowserTools = () => {
  const groups = buildWebResearchTaskGroups({
    objective: 'Collect solar cell spec sheets',
    searchQueries: ['Aiko solar ABC datasheet pdf'],
    researchMode: 'websearch-only',
    browserTools: ['browser_search', 'browser_visit'],
    supportTools: ['proxyWebReader'],
  })

  assert(
    groups[0]?.[0]?.allowedTools?.includes('proxyWebReader'),
    'Expected websearch-only mode to preserve configured support tools',
  )
  assert(
    !groups[0]?.[0]?.allowedTools?.includes('browser_search'),
    'Expected websearch-only mode to exclude browser MCP tools',
  )

  return { success: true }
}

export const testStorageToolSupportsBrowserDownloads = () => {
  const parameters = storageTool.parameters
  assert(
    parameters.type === 'object' && parameters.properties,
    'Expected storage to expose object parameters',
  )

  const actionSchema = parameters.properties.action
  assert(
    typeof actionSchema === 'object' &&
      actionSchema !== null &&
      !Array.isArray(actionSchema) &&
      'enum' in actionSchema &&
      Array.isArray(actionSchema.enum) &&
      actionSchema.enum.includes('download'),
    'Expected storage action enum to include download',
  )
  assert(
    'url' in parameters.properties,
    'Expected storage download action to expose a url parameter',
  )
  assert(
    'expectedFileType' in parameters.properties,
    'Expected storage download action to support expected PDF validation',
  )
  assert(
    'artifactRoot' in parameters.properties,
    'Expected storage to expose an artifact root guard for browser research writes',
  )

  return { success: true }
}

export const testLocalBrowsingToolsExposePoliteHttpPolicy = () => {
  const storageProperties = storageTool.parameters.properties
  assert(
    'httpPolicy' in storageProperties,
    'Expected storage to expose polite HTTP controls for browser downloads',
  )

  const proxyProperties = proxyWebReader.parameters.properties
  assert(
    'httpPolicy' in proxyProperties,
    'Expected proxyWebReader to expose polite HTTP controls for proxy browsing',
  )

  const httpPolicy = proxyProperties.httpPolicy
  assert(
    typeof httpPolicy === 'object' &&
      httpPolicy !== null &&
      'properties' in httpPolicy &&
      typeof httpPolicy.properties === 'object' &&
      httpPolicy.properties !== null &&
      'minDelayMs' in httpPolicy.properties,
    'Expected proxyWebReader httpPolicy to expose minDelayMs',
  )
  const minDelay = httpPolicy.properties.minDelayMs
  assert(
    typeof minDelay === 'object' &&
      minDelay !== null &&
      'default' in minDelay &&
      minDelay.default === DEFAULT_POLITE_HTTP_MIN_DELAY_MS,
    'Expected polite HTTP minDelayMs to default to the shared polite delay',
  )

  return { success: true }
}

testWebResearchBuildsParallelQueryGroups.description =
  'Builds parallel web-research branches where each query expands into sequential discovery and validation tasks with explicit browser-capable tool restrictions.'
testWebResearchArtifactRootSlugIsStable.description =
  'Chooses one deterministic research artifact root from the objective and forwards it into every delegated branch.'
testWebResearchPreservesExactSourceIdentity.description =
  'Keeps exact product and provider identity in discovery and rejects same-category source substitutions during validation.'
testBrowserMcpImportChainBuildsImportCall.description =
  'Builds the browser MCP import bootstrap chain and forwards the selected MCP tool names into importMcpTools.'
testEnsureBrowserMcpImportRetryChainBuildsImportCall.description =
  'Builds the browser MCP ensure/import retry chain after endpoint reachability has been confirmed.'
testProxyWebReaderProviderCatalogAndPresetResolution.description =
  'Exposes a large proxy provider catalog and resolves proxyWebReader metadata from a selected provider preset.'
testMcpCapableWebProviderCatalog.description =
  'Saves a dedicated MCP-capable web-provider catalog derived from the shared proxy provider source of truth.'
testWebResearchPlannerUsesWebSearchFirstByDefault.description =
  'Starts research in websearch-first mode by default and enables chatCompletion web search in delegated research branches.'
testWebResearchPlannerProcessTasksKeepsSaveTool.description =
  'Exercises webResearchPlanner through processTasks and verifies delegated web-search branches retain local artifact storage and validation tools for save requests.'
testWebResearchPlannerBrowserMcpFirstEnsuresBrowserSetup.description =
  'Ensures browser MCP setup runs before research when researchMode is browser-mcp-first.'
testWebResearchPlannerWebSearchOnlyExcludesBrowserTools.description =
  'Excludes browser MCP tools from delegated branches when researchMode is websearch-only.'
testStorageToolSupportsBrowserDownloads.description =
  'Exposes a browser storage download action so research can save accessible URLs without local filesystem access.'
testLocalBrowsingToolsExposePoliteHttpPolicy.description =
  'Exposes a default polite HTTP policy on low-level local browsing tools.'
testWebResearchPlannerUsesWebSearchFirstByDefault.requiresLargeTokens = true
