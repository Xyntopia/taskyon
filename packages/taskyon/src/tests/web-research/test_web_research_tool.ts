import {
  defaultMcpCapableWebProvider,
  mcpCapableWebProviderIds,
  proxyWebReaderProviderIds,
  resolveProxyWebReaderArgs,
} from '@taskyon/common/modules/webFetching/index'
import { DEFAULT_POLITE_HTTP_MIN_DELAY_MS } from '../../utils/politeHttp'
import { processTasksDetailed } from '../../api'
import { tyCore } from '../../core/init'
import { createDefaultTaskyonToolSetup } from '../../tools'
import { createStorageTool } from '../../tools/fileTools'
import { readPublicWebPageAsMarkdown } from '../../tools/helperCollection'
import { createProtocolPort } from '@taskyon/common/modules/frpBus'
import { createStorageClient, taskyonStorageProtocol } from '../../api/storageProtocol'
import type { TaskyonStorageClient } from '../../api/storageProtocol'
import { extractStorageTarget } from '../../tools/researchStorageTarget'
import {
  buildBrowserMcpImportChain,
  buildEnsureBrowserMcpImportRetryChain,
  buildWebResearchStartChain,
  normalizeWebResearchCandidates,
  proxyWebReader,
  validateWebResearchCandidates,
  webResearchPlanner,
  webResearchTools,
} from '../../tools/webResearchTool'
import type { TaskNode } from '../../types/taskNode'
import {
  createSubtasksResult,
  createTool,
  taskResult,
  toolCall,
  type InternalTool,
} from '../../types/toolApi'
import { registerToolRpcTools } from '../../core/toolRpc'
import { FunctionCall } from '../../types/tools'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const requestUrl = (input: RequestInfo | URL) =>
  input instanceof Request ? input.url : new URL(input).href

const storagePort = createProtocolPort(taskyonStorageProtocol)
const storageTool = createStorageTool(
  createStorageClient(storagePort.x, {
    namespacePrefix: 'taskyon-test',
    distribution: 'local-only',
  }),
)

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

const isExplicitResearchSearch = (task: TaskNode) => {
  if (task.content.type !== 'functioncall' || task.content.data.name !== 'chatCompletion')
    return false
  const args = task.content.data.arguments
  return (
    !!args &&
    typeof args === 'object' &&
    !Array.isArray(args) &&
    'websearch' in args &&
    args.websearch !== null &&
    typeof args.websearch === 'object' &&
    !Array.isArray(args.websearch) &&
    args.websearch.mode === 'required'
  )
}

export const testWebResearchBuildsAnExplicitTypedPipeline = () => {
  const chain = buildWebResearchStartChain({
    objective: 'Find the current official Federal Rules of Civil Procedure PDF.',
    searchQueries: ['official Federal Rules of Civil Procedure PDF', 'current FRCP PDF'],
    mustDownload: true,
    storageNamespace: 'research/frcp',
    storageObjectId: 'rules.pdf',
    storageExpectedFileType: 'pdf',
  })
  const searchCall = getFunctionCall(
    chain.find((task) => getFunctionCall(task)?.name === 'chatCompletion'),
  )
  const continuationCall = getFunctionCall(
    chain.find((task) => getFunctionCall(task)?.name === 'webResearchPipeline'),
  )

  assert(searchCall?.name === 'chatCompletion', 'Expected a direct search completion')
  assert(
    searchCall.arguments.websearch &&
      typeof searchCall.arguments.websearch === 'object' &&
      !Array.isArray(searchCall.arguments.websearch) &&
      searchCall.arguments.websearch.mode === 'required',
    'Expected each research query to require provider-native web search',
  )
  assert(
    Array.isArray(searchCall.arguments.allowedTools) &&
      searchCall.arguments.allowedTools.length === 0,
    'Expected search stages to expose no ordinary tools',
  )
  assert(
    searchCall.arguments.reasoning_effort === 'low',
    'Expected research stages to use the cheapest broadly supported reasoning effort',
  )
  assert(
    continuationCall?.arguments.$use &&
      typeof continuationCall.arguments.$use === 'object' &&
      !Array.isArray(continuationCall.arguments.$use) &&
      continuationCall.arguments.$use.searchResult === '$previousResult',
    'Expected a typed relative-result handoff into the pipeline continuation',
  )
  assert(
    !chain.some((task) => getFunctionCall(task)?.name === 'entryNode'),
    'Expected no delegated EntryNode agent inside the research pipeline',
  )
  return { success: true }
}

export const testWebResearchNormalizesAndCapsCandidates = () => {
  const normalized = normalizeWebResearchCandidates(
    [
      {
        title: 'Official rules',
        sourcePageUrl: 'https://www.uscourts.gov/rules-policies/current-rules-practice-procedure',
        directArtifactUrl:
          'https://www.uscourts.gov/sites/default/files/rules-of-civil-procedure.pdf',
        evidence: 'Official source.',
      },
      {
        title: 'Duplicate official rules',
        sourcePageUrl: 'https://www.uscourts.gov/rules-policies/current-rules-practice-procedure',
        evidence: 'Duplicate URL.',
      },
      ...Array.from({ length: 8 }, (_, index) => ({
        title: `Candidate ${index}`,
        sourcePageUrl: `https://example${index}.test/rules`,
        evidence: 'Candidate evidence.',
      })),
    ],
    5,
  )
  assert(normalized.length === 5, `Expected five candidates, got ${normalized.length}`)
  assert(
    normalized.filter((candidate) => candidate.sourcePageUrl.includes('uscourts.gov')).length === 1,
    'Expected duplicate source URLs to be removed',
  )
  return { success: true }
}

export const testWebResearchFetchesEveryShortlistedCandidate = async () => {
  const active = new Set<string>()
  let maximumConcurrency = 0
  const visited: string[] = []
  const candidates = Array.from({ length: 3 }, (_, index) => ({
    title: `Candidate ${index}`,
    sourcePageUrl: `https://example${index}.test/source`,
    evidence: `Evidence ${index}`,
  }))
  const result = await validateWebResearchCandidates(candidates, async (url) => {
    active.add(url)
    visited.push(url)
    maximumConcurrency = Math.max(maximumConcurrency, active.size)
    await new Promise((resolve) => setTimeout(resolve, 5))
    active.delete(url)
    return `Verified page for ${url}`
  })

  assert(result.length === 3, `Expected three validation records, got ${result.length}`)
  assert(visited.length === 3, `Expected every shortlisted candidate to be fetched`)
  assert(maximumConcurrency > 1, 'Expected candidate page fetches to run concurrently')
  assert(
    result.every((candidate) => candidate.status === 'verified'),
    'Expected verified records',
  )
  return { success: true }
}

export const testWebResearchValidatesSourcePagesInsteadOfArtifacts = async () => {
  const sourcePageUrl = 'https://example.test/source'
  const directArtifactUrl = 'https://example.test/document.pdf'
  const visited: string[] = []
  const [result] = await validateWebResearchCandidates(
    [{ title: 'Document', sourcePageUrl, directArtifactUrl, evidence: 'Official source.' }],
    (url) => {
      visited.push(url)
      return Promise.resolve('Official source page evidence')
    },
  )
  assert(visited[0] === sourcePageUrl, 'Expected validation to fetch the source page')
  assert(result?.fetchedUrl === sourcePageUrl, 'Expected the source page as fetched evidence URL')
  return { success: true }
}

export const testWebResearchRejectsBrokenArtifactsBeforeStorage = async () => {
  const sourcePageUrl = 'https://example.test/source'
  const directArtifactUrl = 'https://example.test/missing.pdf'
  const visited: string[] = []
  const [result] = await validateWebResearchCandidates(
    [{ title: 'Document', sourcePageUrl, directArtifactUrl, evidence: 'Official source.' }],
    (url) => {
      visited.push(url)
      if (url === directArtifactUrl) throw new Error('HTTP 404')
      return Promise.resolve('Official source page evidence')
    },
    true,
  )

  assert(
    visited.join('|') === `${sourcePageUrl}|${directArtifactUrl}`,
    'Expected source-page validation before direct-artifact preflight',
  )
  assert(result?.status === 'failed', 'Expected a broken direct artifact to be rejected')
  return { success: true }
}

export const testPublicWebReaderFallsBackToDirectFetch = async () => {
  const requestedUrls: string[] = []
  const result = await readPublicWebPageAsMarkdown(
    'https://example.test/source',
    undefined,
    (url) => {
      requestedUrls.push(requestUrl(url))
      return Promise.resolve(
        requestedUrls.length === 1
          ? new Response('Unauthorized', { status: 401, statusText: 'Unauthorized' })
          : new Response('Official source page evidence', {
              status: 200,
              headers: { 'content-type': 'text/html' },
            }),
      )
    },
  )
  assert(
    requestedUrls.join('|') ===
      'https://r.jina.ai/https://example.test/source|https://example.test/source',
    'Expected Jina first and a direct source-page fallback second',
  )
  assert(result === 'Official source page evidence', 'Expected direct fallback response text')
  return { success: true }
}

export const testWebResearchCandidateValidatorUsesMediatedFetch = async () => {
  const validator: InternalTool | undefined = webResearchTools.find(
    ({ name }) => name === 'webResearchCandidateValidator',
  )
  assert(validator?.function, 'Expected the internal research candidate validator')
  const requestedUrls: string[] = []
  const result = await validator.function(
    {
      candidates: [
        {
          title: 'Official source',
          sourcePageUrl: 'https://official.example/rules',
          evidence: 'Official current rules.',
        },
      ],
      requireArtifact: false,
    },
    {
      getExecutionTaskChain: () => Promise.resolve([]),
      createSubtasksResult,
      getSecret: () => Promise.resolve(null),
      setSecret: () => Promise.resolve(),
      stopSignal: new AbortController().signal,
      toolId: 'research-validator-test',
      fetch: (input) => {
        requestedUrls.push(requestUrl(input))
        return Promise.resolve(new Response('Official source evidence'))
      },
    },
  )
  assert(
    requestedUrls.join('|') === 'https://r.jina.ai/https://official.example/rules',
    'Expected candidate validation to use the mediated tool fetch capability',
  )
  assert(
    result && typeof result === 'object' && 'candidates' in result,
    'Expected candidate validation results',
  )
  return { success: true }
}

export const testWebResearchPipelineRetriesOnceAndDownloadsDeterministically = async () => {
  const pipeline: InternalTool | undefined = webResearchTools.find(
    ({ name }) => name === 'webResearchPipeline',
  )
  assert(pipeline?.function, 'Expected the internal research continuation tool')
  const context = {
    getExecutionTaskChain: () => Promise.resolve([]),
    createSubtasksResult,
    getSecret: () => Promise.resolve(null),
    setSecret: () => Promise.resolve(),
    stopSignal: new AbortController().signal,
    toolId: 'research-pipeline-test',
  }
  const common = {
    objective: 'Find and store the official rules PDF.',
    queries: ['official rules PDF'],
    candidates: [],
    artifactRoot: 'research/rules/',
    maxSources: 5,
    mustDownload: true,
    fileTypeHints: ['pdf'],
    siteHints: [],
    storageNamespace: 'research/rules',
    storageObjectId: 'rules.pdf',
    storageExpectedFileType: 'pdf' as const,
  }
  const retry = await pipeline.function(
    {
      stage: 'search',
      ...common,
      queryIndex: 0,
      retryCount: 0,
      searchResult: { candidates: [] },
    },
    context,
  )
  assert(
    retry && typeof retry === 'object' && 'taskChainList' in retry,
    'Expected a retry task chain',
  )
  const retryTasks = taskResult.parse(retry)
  const retryPipeline = getFunctionCall(
    retryTasks.taskChainList[0]?.find(
      (task) => getFunctionCall(task)?.name === 'webResearchPipeline',
    ),
  )
  assert(retryPipeline?.arguments.retryCount === 1, 'Expected exactly one corrected search retry')

  const sufficientSearch = await pipeline.function(
    {
      ...common,
      queries: ['official rules PDF', 'current rules PDF', 'Rule 4 rules PDF'],
      candidates: [
        {
          title: 'Official rules',
          sourcePageUrl: 'https://official.example/rules',
          evidence: 'Official source.',
        },
      ],
      stage: 'search',
      queryIndex: 1,
      retryCount: 0,
      searchResult: {
        candidates: [
          {
            title: 'Independent rules source',
            sourcePageUrl: 'https://independent.example/rules',
            evidence: 'Independent source.',
          },
        ],
      },
    },
    context,
  )
  const sufficientSearchTasks = taskResult.parse(sufficientSearch)
  const sufficientSearchCalls = (sufficientSearchTasks.taskChainList[0] ?? []).flatMap((task) => {
    const call = getFunctionCall(task)
    return call ? [call] : []
  })
  assert(
    sufficientSearchCalls[0]?.name === 'webResearchCandidateValidator' &&
      !sufficientSearchCalls.some((call) => call.name === 'chatCompletion'),
    'Expected two successful searches with independent URLs to proceed to validation',
  )

  const validatedSource = 'https://official.example/rules'
  const validation = await pipeline.function(
    {
      stage: 'validation',
      ...common,
      candidates: [
        {
          title: 'Official rules',
          sourcePageUrl: validatedSource,
          evidence: 'Official current rules.',
        },
      ],
      validationResult: {
        candidates: [
          {
            title: 'Official rules',
            sourcePageUrl: validatedSource,
            evidence: 'Official current rules.',
            fetchedUrl: validatedSource,
            status: 'verified',
            excerpt: 'Fetched official source evidence.',
          },
        ],
      },
    },
    context,
  )
  assert(
    validation && typeof validation === 'object' && 'taskChainList' in validation,
    'Expected a verification task chain after source validation',
  )
  const validationTasks = taskResult.parse(validation)
  const verificationPipeline = getFunctionCall(
    validationTasks.taskChainList[0]?.find(
      (task) => getFunctionCall(task)?.name === 'webResearchPipeline',
    ),
  )
  const carriedCandidate = Array.isArray(verificationPipeline?.arguments.candidates)
    ? verificationPipeline.arguments.candidates[0]
    : undefined
  assert(
    carriedCandidate &&
      typeof carriedCandidate === 'object' &&
      !('status' in carriedCandidate) &&
      !('excerpt' in carriedCandidate),
    'Expected validated evidence to remain in history while continuation state uses raw candidates',
  )

  const selectedUrl = 'https://official.example/rules.pdf'
  const download = await pipeline.function(
    {
      stage: 'verification',
      ...common,
      retryCount: 0,
      candidates: [
        {
          title: 'Official rules',
          sourcePageUrl: 'https://official.example/rules',
          directArtifactUrl: selectedUrl,
          evidence: 'Official current rules.',
        },
      ],
      verificationResult: {
        selectedUrl,
        verificationSummary: 'Verified.',
      },
    },
    context,
  )
  assert(
    download && typeof download === 'object' && 'taskChainList' in download,
    'Expected an artifact task chain',
  )
  const downloadTasks = taskResult.parse(download)
  const calls = (downloadTasks.taskChainList[0] ?? []).flatMap((task) => {
    const call = getFunctionCall(task)
    return call ? [call] : []
  })
  assert(
    calls[0]?.name === 'storage' &&
      calls[0].arguments.action === 'download' &&
      calls[0].arguments.url === selectedUrl &&
      calls[1]?.name === 'storage' &&
      calls[1].arguments.action === 'read' &&
      calls.some((call) => call.name === 'chatCompletion') &&
      calls.at(-1)?.name === 'webResearchPipeline',
    'Expected deterministic storage download/read followed by typed artifact verification',
  )
  assert(
    !calls.some((call) => call.name === 'entryNode'),
    'Expected no generic EntryNode inside artifact execution or synthesis',
  )
  const synthesis = await pipeline.function(
    {
      stage: 'artifact',
      ...common,
      artifactResult: { verified: true, evidence: 'PDF title and requested rules verified.' },
    },
    context,
  )
  assert(
    synthesis && typeof synthesis === 'object' && 'taskChainList' in synthesis,
    'Expected a synthesis task chain',
  )
  const synthesisTasks = taskResult.parse(synthesis)
  const synthesisCalls = (synthesisTasks.taskChainList[0] ?? []).flatMap((task) => {
    const call = getFunctionCall(task)
    return call ? [call] : []
  })
  assert(
    synthesisCalls.length === 1 &&
      synthesisCalls[0]?.name === 'chatCompletion' &&
      Array.isArray(synthesisCalls[0].arguments.allowedTools) &&
      synthesisCalls[0].arguments.allowedTools.length === 0,
    'Expected evidence-only final synthesis after artifact verification',
  )
  const synthesisPrompt = synthesisTasks.taskChainList[0]?.find(
    (task) => task.role === 'user' && task.content.type === 'message',
  )
  assert(
    synthesisPrompt?.content.type === 'message' &&
      synthesisPrompt.content.data.includes('research/rules') &&
      synthesisPrompt.content.data.includes('rules.pdf'),
    'Expected final synthesis to receive the exact storage namespace and object id',
  )
  return { success: true }
}

export const testWebResearchPreservesScopeInTypedPipeline = () => {
  const args = {
    objective: 'Build a client for The Trivia API using its official documentation.',
    searchQueries: ['The Trivia API official documentation'],
  }
  const pipeline = (input: typeof args) =>
    buildWebResearchStartChain(input)
      .map(getFunctionCall)
      .find((call) => call?.name === 'webResearchPipeline')
  const first = pipeline(args)
  const repeated = pipeline(args)
  assert(
    first?.arguments.objective === args.objective,
    'Expected the exact requested source identity',
  )
  assert(
    JSON.stringify(first.arguments.queries) === JSON.stringify(args.searchQueries),
    'Expected unchanged explicit search queries',
  )
  assert(
    typeof first.arguments.artifactRoot === 'string' &&
      first.arguments.artifactRoot.startsWith('research/'),
    'Expected a bounded research artifact namespace',
  )
  assert(
    first.arguments.artifactRoot === repeated?.arguments.artifactRoot,
    'Expected stable artifact placement across repeated planning',
  )
  const explicit = buildWebResearchStartChain({ ...args, artifactRoot: 'research/explicit' })
    .map(getFunctionCall)
    .find((call) => call?.name === 'webResearchPipeline')
  assert(
    explicit?.arguments.artifactRoot === 'research/explicit/',
    'Expected the explicit artifact root to be preserved',
  )
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
    .find(
      (call) =>
        call && typeof call === 'object' && 'name' in call && call.name === 'chatCompletion',
    )
  assert(
    firstCall &&
      typeof firstCall === 'object' &&
      'name' in firstCall &&
      firstCall.name === 'chatCompletion',
    'Expected default research mode to launch a direct structured search without browser MCP setup',
  )

  assert(
    firstCall &&
      typeof firstCall === 'object' &&
      'arguments' in firstCall &&
      firstCall.arguments &&
      typeof firstCall.arguments === 'object' &&
      'allowedTools' in firstCall.arguments &&
      Array.isArray(firstCall.arguments.allowedTools) &&
      firstCall.arguments.allowedTools.length === 0 &&
      'websearch' in firstCall.arguments &&
      typeof firstCall.arguments.websearch === 'object' &&
      firstCall.arguments.websearch !== null &&
      'enabled' in firstCall.arguments.websearch &&
      firstCall.arguments.websearch.enabled === true &&
      'mode' in firstCall.arguments.websearch &&
      firstCall.arguments.websearch.mode === 'required',
    'Expected the direct search stage to require provider web search without ordinary tools',
  )

  const workflow = initialResult.taskChainList[0] ?? []
  assert(
    workflow.some((task) => getFunctionCall(task)?.name === 'webResearchPipeline') &&
      !workflow.some((task) => getFunctionCall(task)?.name === 'entryNode'),
    'Expected an explicit typed continuation instead of delegated research or synthesis EntryNodes',
  )

  return { success: true }
}

export const testWebResearchPlannerAcceptsProviderResponseLength = () => {
  const properties = webResearchPlanner.parameters.properties
  assert(
    'response_length' in properties,
    'Expected webResearchPlanner to accept provider-compatible response_length arguments',
  )
  const responseLength = properties.response_length
  assert(
    typeof responseLength === 'object' &&
      responseLength !== null &&
      'enum' in responseLength &&
      Array.isArray(responseLength.enum) &&
      responseLength.enum.includes('short'),
    'Expected response_length to accept provider-native response length values',
  )
  return { success: true }
}

export const testWebResearchPlannerUsesTheActiveEntryNodeName = async () => {
  const result = await webResearchPlanner.function?.(
    {
      objective: 'Collect one official PDF',
      searchQueries: ['official PDF'],
      enableWebSearch: false,
    },
    {
      getExecutionTaskChain: () =>
        Promise.resolve([
          {
            id: 'user',
            role: 'user',
            content: { type: 'message', data: 'Collect one official PDF.' },
          },
          {
            id: 'cli-entry',
            role: 'function',
            content: { type: 'functioncall', data: { name: 'cliFlow', arguments: {} } },
          },
          {
            id: 'planner-call',
            role: 'function',
            content: { type: 'functioncall', data: { name: 'webResearchPlanner', arguments: {} } },
          },
        ]),
      createSubtasksResult,
      getSecret: () => Promise.resolve(null),
      setSecret: () => Promise.resolve(),
      stopSignal: new AbortController().signal,
      toolId: 'entry-node-name-test',
    },
  )
  assert(
    result && typeof result === 'object' && 'taskChainList' in result,
    'Expected the active-entry planner call to return a task result',
  )
  const calls = (result.taskChainList[0] ?? []).flatMap((task) => {
    const call = getFunctionCall(task)
    return call ? [call] : []
  })
  assert(
    calls.some((call) => call.name === 'chatCompletion') &&
      calls.some((call) => call.name === 'webResearchPipeline') &&
      !calls.some((call) => call.name === 'cliFlow' || call.name === 'entryNode'),
    'Expected the explicit pipeline to remain independent of any host EntryNode name',
  )
  return { success: true }
}

export const testWebResearchPlannerInfersExplicitStorageTarget = async () => {
  const fileTypeSchema = webResearchPlanner.parameters.properties?.storageExpectedFileType
  assert(
    typeof fileTypeSchema === 'object' &&
      fileTypeSchema.description?.includes('literal value') &&
      webResearchPlanner.longDescription?.includes('prior task result'),
    'Expected storage targets to be documented as literals unless they come from a prior task.',
  )
  const result = await webResearchPlanner.function?.(
    {
      objective: 'Find the current official Federal Rules of Civil Procedure PDF.',
      searchQueries: ['Federal Rules of Civil Procedure PDF official site'],
      supportTools: ['storage'],
    },
    {
      getExecutionTaskChain: () =>
        Promise.resolve([
          {
            id: 'user',
            role: 'user',
            content: {
              type: 'message',
              data: `Find the PDF and save it in the storage namespace research with the exact object ID federal-rules-civil-
procedure.pdf.`,
            },
          },
        ]),
      createSubtasksResult,
      getSecret: () => Promise.resolve(null),
      setSecret: () => Promise.resolve(),
      stopSignal: new AbortController().signal,
      toolId: 'storage-target-test',
    },
  )

  assert(
    result && typeof result === 'object' && 'taskChainList' in result,
    'Expected the storage-target planner call to return a task result',
  )
  const pipelineCall = (result.taskChainList[0] ?? [])
    .map(getFunctionCall)
    .find((call) => call?.name === 'webResearchPipeline')
  assert(
    pipelineCall?.arguments.storageNamespace === 'research' &&
      pipelineCall.arguments.storageObjectId === 'federal-rules-civil-procedure.pdf' &&
      pipelineCall.arguments.storageExpectedFileType === 'pdf' &&
      pipelineCall.arguments.mustDownload === true,
    'Expected the planner to infer and preserve the exact typed storage target from the original user request',
  )
  return { success: true }
}

export const testWebResearchPlannerExtractsExplicitNamespaceFromDiagnosticPrompt = () => {
  const target = extractStorageTarget(
    'Store the PDF in the diagnostics storage namespace under the exact object id federal-rules-civil-procedure.pdf. The exact logical storage namespace is diagnostics/document-retrieval/v1.',
  )
  assert(
    target?.namespace === 'diagnostics/document-retrieval/v1' &&
      target.objectId === 'federal-rules-civil-procedure.pdf' &&
      target.expectedFileType === 'pdf',
    'Expected the explicit logical storage namespace to win over the descriptive storage phrase',
  )
  return { success: true }
}

export const testWebResearchPlannerProcessTasksKeepsSaveTool = async () => {
  const continuationTool = createTool({
    name: 'entryNode',
    description: 'Test continuation tool.',
    parameters: { type: 'object', additionalProperties: false },
    function: () => undefined,
  })
  const defaultToolSetup = createDefaultTaskyonToolSetup()
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
    {
      indexTaskVectors: false,
      toolSetup: {
        ...defaultToolSetup,
        baseTools: [...defaultToolSetup.baseTools, continuationTool],
      },
    },
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
              mustDownload: true,
              deliverable: 'Markdown file with 5 solar cell spec sheets and direct URLs',
            },
          }),
        ],
      ],
      isExplicitResearchSearch,
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
      throw new Error(`Expected explicit research search task, got ${result.status}`)
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
        args.allowedTools.length === 0,
      'Expected processTasks-generated research search to expose no ordinary support tools',
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
        task.content.data.includes('Research objective:'),
    )
    const delegatedBootstrap =
      delegatedBootstrapTask?.content.type === 'message' &&
      typeof delegatedBootstrapTask.content.data === 'string'
        ? delegatedBootstrapTask.content.data
        : ''
    assert(delegatedBootstrap.length > 0, 'Expected a visible research objective before searching')
  } finally {
    toolRpcExecutor.destroy()
    await ty.dispose('web research planner diagnostic complete')
  }

  return { success: true }
}

export const testWebResearchPlannerIgnoresLegacyBrowserRouting = async () => {
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

  const calls = (result.taskChainList[0] ?? []).flatMap((task) => {
    const call = getFunctionCall(task)
    return call ? [call] : []
  })
  assert(
    calls.some((call) => call.name === 'chatCompletion') &&
      !calls.some((call) => call.name === 'ensureBrowserMcpTools'),
    'Expected legacy browser-routing arguments to remain accepted without changing the runtime-neutral pipeline',
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

export const testStorageToolUsesInjectedDownloadTransport = async () => {
  let fetchedUrl = ''
  let storedData: Uint8Array | undefined
  const storageClient = {
    setBlob: ({ data }: { data: Uint8Array }) => {
      storedData = data
      return Promise.resolve({ size: data.byteLength })
    },
  } as unknown as TaskyonStorageClient
  const storage = createStorageTool(storageClient, (input) => {
    fetchedUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    return Promise.resolve(
      new Response('%PDF-test', { headers: { 'content-type': 'application/pdf' } }),
    )
  })

  const result = await storage.function?.({
    action: 'download',
    namespace: 'diagnostics',
    id: 'document.pdf',
    url: 'https://example.test/document.pdf',
    expectedFileType: 'pdf',
  })

  assert(fetchedUrl === 'https://example.test/document.pdf', 'Expected injected download transport')
  assert(storedData && new TextDecoder().decode(storedData) === '%PDF-test', 'Expected PDF bytes')
  assert(
    typeof result === 'object' &&
      result !== null &&
      'metadata' in result &&
      typeof result.metadata === 'object' &&
      result.metadata !== null &&
      'size' in result.metadata &&
      result.metadata.size === 9,
    'Expected storage to return the saved object metadata directly',
  )
  return { fetchedUrl }
}

export const testStorageToolReadReportsSuccessfulDownloadUrl = async () => {
  const storage = createStorageTool({
    getBlob: () =>
      Promise.resolve({
        data: new TextEncoder().encode('verified contents'),
        metadata: {
          id: 'document.txt',
          size: 17,
          contentType: 'text/plain',
          modifiedAt: new Date(0).toISOString(),
        },
      }),
  } as unknown as TaskyonStorageClient)
  const sourceUrl = 'https://example.test/verified.pdf'
  const result = await storage.function?.(
    { action: 'read', namespace: 'research', id: 'document.txt' },
    {
      getExecutionTaskChain: () =>
        Promise.resolve([
          {
            id: 'download-result',
            role: 'system',
            content: {
              type: 'toolresult',
              data: { success: true, url: sourceUrl },
            },
          },
        ]),
    } as unknown as Parameters<NonNullable<typeof storage.function>>[1],
  )

  assert(
    typeof result === 'object' &&
      result !== null &&
      'sourceUrl' in result &&
      result.sourceUrl === sourceUrl,
    `Expected storage read to retain the successful source URL, got ${JSON.stringify(result)}`,
  )
  return { sourceUrl }
}

export const testStorageToolInfersPdfValidationFromObjectId = async () => {
  const storage = createStorageTool(
    {
      setBlob: () => Promise.resolve({ size: 1 }),
    } as unknown as TaskyonStorageClient,
    () =>
      Promise.resolve(
        new Response('<html>blocked</html>', {
          headers: { 'content-type': 'text/html' },
        }),
      ),
  )
  let message = ''
  try {
    await storage.function?.({
      action: 'download',
      namespace: 'research',
      id: 'document.pdf',
      url: 'https://example.test/document.pdf',
    })
  } catch (error) {
    message = error instanceof Error ? error.message : String(error)
  }

  assert(
    message.includes('did not return PDF bytes'),
    `Expected PDF object IDs to trigger byte validation, got ${message || '(no error)'}`,
  )
  return { success: true }
}

export const testStorageToolUsesArtifactRootWhenNamespaceIsOmitted = async () => {
  let savedNamespace = ''
  const storage = createStorageTool({
    setBlob: ({ namespace }: { namespace: string }) => {
      savedNamespace = namespace
      return Promise.resolve({ size: 5 })
    },
  } as unknown as TaskyonStorageClient)

  const result = await storage.function?.({
    action: 'save',
    artifactRoot: 'research',
    id: 'document.pdf',
    content: 'JVBERi0=',
    mimeType: 'application/pdf',
  })

  assert(savedNamespace === 'research', 'Expected omitted namespace to follow artifactRoot')
  assert(
    typeof result === 'object' &&
      result !== null &&
      'namespace' in result &&
      result.namespace === 'research',
    'Expected storage to report the effective artifact namespace',
  )
  return { namespace: savedNamespace }
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

testBrowserMcpImportChainBuildsImportCall.description =
  'Builds the browser MCP import bootstrap chain and forwards the selected MCP tool names into importMcpTools.'
testEnsureBrowserMcpImportRetryChainBuildsImportCall.description =
  'Builds the browser MCP ensure/import retry chain after endpoint reachability has been confirmed.'
testProxyWebReaderProviderCatalogAndPresetResolution.description =
  'Exposes a large proxy provider catalog and resolves proxyWebReader metadata from a selected provider preset.'
testMcpCapableWebProviderCatalog.description =
  'Saves a dedicated MCP-capable web-provider catalog derived from the shared proxy provider source of truth.'
testWebResearchPlannerUsesWebSearchFirstByDefault.description =
  'Starts research with a direct structured provider-web-search call and no ordinary tool window.'
testWebResearchCandidateValidatorUsesMediatedFetch.description =
  'Routes candidate validation through the host-provided mediated fetch capability.'
testWebResearchPlannerAcceptsProviderResponseLength.description =
  'Accepts and ignores provider-compatible response_length arguments emitted by small models.'
testWebResearchPlannerInfersExplicitStorageTarget.description =
  'Infers an explicit browser storage target at the planner boundary and forwards it as typed pipeline arguments.'
testWebResearchPlannerProcessTasksKeepsSaveTool.description =
  'Exercises webResearchPlanner through processTasks and verifies its first search stage remains explicit and tool-free.'
testWebResearchPlannerIgnoresLegacyBrowserRouting.description =
  'Accepts legacy browser-routing arguments without leaking runtime-specific routing into the explicit research pipeline.'
testStorageToolSupportsBrowserDownloads.description =
  'Exposes a browser storage download action so research can save accessible URLs without local filesystem access.'
testStorageToolUsesInjectedDownloadTransport.description =
  'Uses the injected browser download transport and returns storage metadata to the task worker for normal entry-node continuation.'
testStorageToolInfersPdfValidationFromObjectId.description =
  'Infers PDF byte validation from a .pdf storage object ID even when the model omits expectedFileType.'
testLocalBrowsingToolsExposePoliteHttpPolicy.description =
  'Exposes a default polite HTTP policy on low-level local browsing tools.'
testWebResearchPlannerUsesWebSearchFirstByDefault.requiresLargeTokens = true
