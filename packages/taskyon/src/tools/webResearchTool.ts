import type { JSONSchema7 } from 'json-schema'
import {
  proxyWebReaderProviderIds,
  resolveProxyWebReaderArgs,
  type ResolvedProxyWebReaderArgs,
} from '@taskyon/common/modules/webFetching/index'
import { createChatCompletionTask } from '../api'
import { createTool, toolCall, type toolContext } from '../types/toolApi'
import type { partialTaskDraft, TaskNode } from '../types/taskNode'
import {
  resolveStorageTargetFromTaskChain,
  storageTargetFromArguments,
} from './researchStorageTarget'
import {
  parsePoliteHttpPolicy,
  politeFetch,
  politeHttpPolicySchema,
  waitForPoliteHttpTurn,
} from '../utils/politeHttp'
import { readPublicWebPageAsMarkdown } from './helperCollection'

type BrowserMcpImportArgs = {
  serverUrl?: string
  serverName?: string
  toolNames?: string[]
}

type EnsureBrowserMcpToolsArgs = BrowserMcpImportArgs & {
  startupInstructions?: string
  onboardingToken?: string
}

type WebResearchPlannerArgs = {
  objective: string
  searchQueries?: string[]
  artifactRoot?: string
  storageNamespace?: string
  storageObjectId?: string
  storageExpectedFileType?: 'pdf'
  researchMode?: ResearchMode
  browserTools?: string[]
  supportTools?: string[]
  maxSourcesPerQuery?: number
  mustDownload?: boolean
  fileTypeHints?: string[]
  siteHints?: string[]
  deliverable?: string
  enableWebSearch?: boolean
  webSearchMaxResults?: number
  ensureBrowserMcp?: boolean
}

const researchModes = ['websearch-first', 'browser-mcp-first', 'websearch-only'] as const
type ResearchMode = (typeof researchModes)[number]

const defaultBrowserMcpStartupInstructions = [
  'Start your browser MCP server outside Taskyon so it exposes an HTTP MCP endpoint.',
  'A common pattern is to run a local container or local process that serves MCP on the configured port.',
  'After the server is reachable, click Continue so Taskyon can retry the MCP import.',
].join('\n')

const createProxyOnboardingButton = ({
  providerLabel,
  pricingUrl,
  docsUrl,
  onboardingToken,
}: {
  providerLabel: string
  pricingUrl?: string
  docsUrl?: string
  onboardingToken: string
}) => `
<div>
  <p>To use proxy-backed research, you first need credentials for <strong>${providerLabel}</strong>.</p>
  <p>1. Register with the provider.</p>
  <p>2. Create an API key.</p>
  <p>3. Click continue. Taskyon will then ask you for the credential and store it in your local secret store.</p>
  ${pricingUrl ? `<p><a href="${pricingUrl}" target="_blank" rel="noreferrer">Pricing</a></p>` : ''}
  ${docsUrl ? `<p><a href="${docsUrl}" target="_blank" rel="noreferrer">Documentation</a></p>` : ''}
  <button id="proxy-onboarding-continue">Continue</button>
</div>
<script>
  document.getElementById('proxy-onboarding-continue')
    ?.addEventListener('click', () => {
      window.parent.postMessage(
        {
          tool: 'proxyWebReader',
          token: '${onboardingToken}',
          decision: 'continue'
        },
        '*'
      )
    })
</script>
`

const waitForProxyOnboardingContinue = async (
  waitForInteraction: NonNullable<toolContext['waitForInteraction']>,
  onboardingToken: string,
): Promise<void> => {
  const payload = await waitForInteraction({ tool: 'proxyWebReader', token: onboardingToken })
  if (
    typeof payload !== 'object' ||
    payload === null ||
    Array.isArray(payload) ||
    (payload as { decision?: unknown }).decision !== 'continue'
  ) {
    throw new Error('Proxy onboarding returned an invalid decision.')
  }
}

const createContinueButtonMessage = ({
  toolName,
  onboardingToken,
  body,
}: {
  toolName: string
  onboardingToken: string
  body: string
}) => `${body}
<button id="${toolName}-continue">Continue</button>
<script>
  document.getElementById('${toolName}-continue')
    ?.addEventListener('click', () => {
      window.parent.postMessage(
        {
          tool: '${toolName}',
          token: '${onboardingToken}',
          decision: 'continue'
        },
        '*'
      )
    })
</script>
`

const waitForContinueDecision = async (
  waitForInteraction: NonNullable<toolContext['waitForInteraction']>,
  toolName: string,
  onboardingToken: string,
): Promise<void> => {
  const payload = await waitForInteraction({ tool: toolName, token: onboardingToken })
  if (
    typeof payload !== 'object' ||
    payload === null ||
    Array.isArray(payload) ||
    (payload as { decision?: unknown }).decision !== 'continue'
  ) {
    throw new Error(`${toolName} onboarding returned an invalid decision.`)
  }
}

const ensureNonEmptyString = (value: string | undefined, fieldName: string) => {
  const normalized = value?.trim() ?? ''
  if (normalized.length === 0) {
    throw new Error(`Missing required ${fieldName}.`)
  }
  return normalized
}

const trimNonEmptyStrings = (values: readonly string[] | undefined) =>
  (values ?? []).map((value) => value.trim()).filter((value) => value.length > 0)

const resolveRequestedStorageTarget = (
  args: WebResearchPlannerArgs,
  taskChain: readonly TaskNode[],
) => {
  const explicitTarget = storageTargetFromArguments(args)
  if (explicitTarget) return explicitTarget
  return resolveStorageTargetFromTaskChain(taskChain)
}

const slugifyResearchObjective = (value: string) => {
  const slug = value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[''`]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (!slug) return 'research-artifacts'
  if (slug.length <= 72) return slug
  const suffix = [...slug]
    .reduce(
      (hash, character) => Math.imul(hash ^ character.charCodeAt(0), 16_777_619),
      2_166_136_261,
    )
    .toString(36)
    .slice(0, 8)
  return `${slug.slice(0, 63).replace(/-+$/g, '')}-${suffix}`
}

const normalizeArtifactRoot = (value: string) => {
  const normalized = value
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '')
  if (normalized.length === 0 || normalized.includes('..')) {
    throw new Error('webResearchPlanner artifactRoot must be a relative directory path.')
  }
  return `${normalized}/`
}

const resolveResearchArtifactRoot = (args: WebResearchPlannerArgs, objective: string) =>
  normalizeArtifactRoot(args.artifactRoot ?? `research/${slugifyResearchObjective(objective)}`)

const formatStartupInstructions = (startupInstructions: string) =>
  startupInstructions
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => `<li>${line}</li>`)
    .join('')

const createBrowserMcpOnboardingMessage = ({
  serverName,
  serverUrl,
  startupInstructions,
  onboardingToken,
}: {
  serverName: string
  serverUrl: string
  startupInstructions: string
  onboardingToken: string
}) =>
  createContinueButtonMessage({
    toolName: 'ensureBrowserMcpTools',
    onboardingToken,
    body: `<div>
  <p>Taskyon could not reach the browser MCP server <strong>${serverName}</strong> at <code>${serverUrl}</code>.</p>
  <p>Start the browser MCP server manually, then click Continue so Taskyon can retry the import.</p>
  <ol>${formatStartupInstructions(startupInstructions)}</ol>
</div>`,
  })

export const buildBrowserMcpImportChain = (args: BrowserMcpImportArgs) => {
  const serverUrl = ensureNonEmptyString(args.serverUrl, 'serverUrl')
  const serverName = args.serverName?.trim() || 'local-browser-mcp'

  return [
    {
      role: 'assistant' as const,
      content: {
        type: 'message' as const,
        data: `Importing browser MCP tools from ${serverName} at ${serverUrl}.`,
      },
    },
    toolCall({
      name: 'importMcpTools',
      arguments: {
        serverUrl,
        serverName,
        ...(args.toolNames && args.toolNames.length > 0 ? { toolNames: args.toolNames } : {}),
      },
    }),
  ]
}

const createMcpRpcPayload = (id: number, method: string, params?: unknown) =>
  JSON.stringify({
    jsonrpc: '2.0',
    id,
    method,
    ...(params !== undefined ? { params } : {}),
  })

const requestMcpEndpoint = async (
  hostFetch: NonNullable<toolContext['fetch']>,
  url: string,
  id: number,
  method: string,
  params?: unknown,
) => {
  const response = await hostFetch(
    url,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: createMcpRpcPayload(id, method, params),
    },
    { preferProxy: true },
  )

  const body = (await response.json()) as Record<string, unknown>
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${JSON.stringify(body)}`)
  }
  if ('error' in body && body.error) {
    throw new Error(String(JSON.stringify(body.error)))
  }
  return body
}

const checkBrowserMcpEndpoint = async (
  hostFetch: NonNullable<toolContext['fetch']>,
  serverUrl: string,
) => {
  await requestMcpEndpoint(hostFetch, serverUrl, 1, 'initialize', {
    protocolVersion: '2024-11-05',
    clientInfo: { name: 'taskyon-browser-access', version: '0.5.3' },
    capabilities: {},
  })
  await requestMcpEndpoint(hostFetch, serverUrl, 2, 'notifications/initialized')
  await requestMcpEndpoint(hostFetch, serverUrl, 3, 'tools/list')
}

export const buildEnsureBrowserMcpImportRetryChain = (args: EnsureBrowserMcpToolsArgs) => [
  {
    role: 'assistant' as const,
    content: {
      type: 'message' as const,
      data: `Browser MCP endpoint is reachable. Importing tools now.`,
    },
  },
  ...buildBrowserMcpImportChain(args),
]

const buildProxyHeaders = (args: ResolvedProxyWebReaderArgs, apiKey: string) => {
  if (args.apiKeyLocation !== 'header') return {}
  const apiKeyHeader = ensureNonEmptyString(args.apiKeyHeader, 'apiKeyHeader')
  const apiKeyScheme = args.apiKeyScheme?.trim() ?? ''
  return {
    [apiKeyHeader]: apiKeyScheme.length > 0 ? `${apiKeyScheme} ${apiKey}` : apiKey,
    accept: 'text/html, text/plain, application/json;q=0.9, */*;q=0.8',
  }
}

const buildProxyRequestUrlWithAuth = (args: ResolvedProxyWebReaderArgs, apiKey: string) => {
  const requestUrl = new URL(args.serviceUrl)
  requestUrl.searchParams.set(args.targetUrlParam, args.url)
  if (args.apiKeyLocation === 'query') {
    requestUrl.searchParams.set(
      ensureNonEmptyString(args.apiKeyQueryParam, 'apiKeyQueryParam'),
      apiKey,
    )
  }
  return requestUrl.toString()
}

const requestProxyText = async (
  requestUrl: string,
  headers: Record<string, string>,
  httpPolicy: { minDelayMs?: number } | undefined,
  hostFetch: NonNullable<toolContext['fetch']>,
) => {
  const response = await politeFetch(
    requestUrl,
    { method: 'GET', headers },
    httpPolicy,
    (input, init) => hostFetch(input, init, { preferProxy: true }),
  )
  return {
    status: response.status,
    statusText: response.statusText,
    headers: Array.from(response.headers.entries()),
    body: await response.text(),
  }
}

export const importBrowserMcpTools = createTool({
  name: 'importBrowserMcpTools',
  renderOptions: { hideVector: true, hideVectorResult: true, hideToolSearch: false },
  description:
    'Import tools from a browser MCP server that is already running on a local or reachable HTTP endpoint.',
  longDescription: `This workflow delegates the MCP handshake and registry installation to Taskyon's general MCP importer. It connects only to an existing HTTP endpoint; browser-neutral Taskyon core never spawns the MCP server process.`,
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      serverUrl: {
        type: 'string',
        description: 'HTTP MCP endpoint, for example http://127.0.0.1:8931/mcp.',
      },
      serverName: {
        type: 'string',
        description: 'Optional label shown in imported tool descriptions.',
      },
      toolNames: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional subset of browser MCP tool names to import.',
      },
    },
    required: [],
  } as const satisfies JSONSchema7,
  function: (args, ctx) => ctx.createSubtasksResult([[...buildBrowserMcpImportChain(args)]]),
})

export const ensureBrowserMcpTools = createTool({
  name: 'ensureBrowserMcpTools',
  renderOptions: { hideVector: true, hideVectorResult: true, hideToolSearch: false },
  description:
    'Ensure that a configured browser MCP endpoint is reachable, guide manual startup if needed, and then import its tools.',
  longDescription: `This visible onboarding workflow probes the endpoint first. When unavailable, it presents startup instructions, pauses for user continuation, retries the same endpoint, and imports the selected MCP tools after connectivity succeeds. It does not spawn local processes.`,
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      serverUrl: {
        type: 'string',
        description: 'HTTP MCP endpoint, for example http://127.0.0.1:8931/mcp.',
      },
      serverName: {
        type: 'string',
        description: 'Optional human label for the browser MCP endpoint.',
      },
      toolNames: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Optional subset of browser MCP tool names to import after the endpoint is ready.',
      },
      startupInstructions: {
        type: 'string',
        description:
          'Manual startup instructions shown in chat when the browser MCP endpoint is not reachable yet.',
      },
      onboardingToken: {
        type: 'string',
        description: 'Internal reentry token for the browser MCP onboarding flow.',
      },
    },
    required: [],
  } as const satisfies JSONSchema7,
  function: async (args, ctx) => {
    const serverUrl = ensureNonEmptyString(args.serverUrl, 'serverUrl')
    const serverName = args.serverName?.trim() || 'local-browser-mcp'
    const startupInstructions =
      args.startupInstructions?.trim() || defaultBrowserMcpStartupInstructions
    const taskChain = await ctx.getExecutionTaskChain()
    const previousCall = taskChain.at(-3)
    const thisMessage = taskChain.at(-1)
    const onboardingToken = typeof args.onboardingToken === 'string' ? args.onboardingToken : ''
    const isOnboardingReentry =
      onboardingToken.length > 0 &&
      previousCall?.content.type === 'functioncall' &&
      previousCall.content.data.name === 'ensureBrowserMcpTools' &&
      previousCall.content.data.arguments.onboardingToken === onboardingToken &&
      thisMessage?.parentID === previousCall.id

    const hostFetch = ctx.fetch
    if (!hostFetch) throw new Error('Browser MCP requires mediated host fetch.')

    try {
      await checkBrowserMcpEndpoint(hostFetch, serverUrl)
      return ctx.createSubtasksResult([[...buildEnsureBrowserMcpImportRetryChain(args)]])
    } catch {
      if (isOnboardingReentry) {
        if (!ctx.waitForInteraction) {
          throw new Error('Browser MCP onboarding interaction is unavailable.')
        }
        await waitForContinueDecision(
          ctx.waitForInteraction,
          'ensureBrowserMcpTools',
          onboardingToken,
        )
        await checkBrowserMcpEndpoint(hostFetch, serverUrl)
        return ctx.createSubtasksResult([[...buildEnsureBrowserMcpImportRetryChain(args)]])
      }

      const nextToken = `browser-mcp-onboarding-${Date.now().toString(36)}`
      const message = createBrowserMcpOnboardingMessage({
        serverName,
        serverUrl,
        startupInstructions,
        onboardingToken: nextToken,
      })
      return ctx.createSubtasksResult([
        [
          {
            role: 'assistant',
            content: {
              type: 'message',
              data: message,
            },
          },
          toolCall({
            name: 'ensureBrowserMcpTools',
            arguments: {
              ...args,
              onboardingToken: nextToken,
            },
          }),
        ],
      ])
    }
  },
})

type WebResearchCandidate = {
  title: string
  sourcePageUrl: string
  directArtifactUrl?: string
  publisher?: string
  evidence: string
}

type ValidatedWebResearchCandidate = WebResearchCandidate & {
  fetchedUrl: string
  status: 'verified' | 'failed'
  excerpt?: string
  error?: string
}

const researchCandidateSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: { type: 'string' },
    sourcePageUrl: { type: 'string' },
    directArtifactUrl: { type: 'string' },
    publisher: { type: 'string' },
    evidence: { type: 'string' },
  },
  required: ['title', 'sourcePageUrl', 'evidence'],
} as const satisfies JSONSchema7

const researchSearchResultSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    candidates: {
      type: 'array',
      maxItems: 5,
      items: researchCandidateSchema,
    },
  },
  required: ['candidates'],
} as const satisfies JSONSchema7

const researchVerificationSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    acceptedCandidates: {
      type: 'array',
      maxItems: 5,
      items: researchCandidateSchema,
      description:
        'Optional accepted subset. If omitted, the selected URL is resolved against the validated candidate list.',
    },
    selectedUrl: { type: 'string' },
    verificationSummary: { type: 'string' },
  },
  required: ['selectedUrl', 'verificationSummary'],
} as const satisfies JSONSchema7

const queryGenerationSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    queries: {
      type: 'array',
      minItems: 2,
      maxItems: 4,
      items: { type: 'string' },
    },
  },
  required: ['queries'],
} as const satisfies JSONSchema7

const artifactVerificationSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    verified: { type: 'boolean' },
    title: { type: 'string' },
    revision: { type: 'string' },
    evidence: { type: 'string' },
  },
  required: ['verified', 'evidence'],
} as const satisfies JSONSchema7

const isWebResearchCandidate = (value: unknown): value is WebResearchCandidate => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Partial<WebResearchCandidate>
  return (
    typeof candidate.title === 'string' &&
    typeof candidate.sourcePageUrl === 'string' &&
    typeof candidate.evidence === 'string' &&
    (candidate.directArtifactUrl === undefined ||
      typeof candidate.directArtifactUrl === 'string') &&
    (candidate.publisher === undefined || typeof candidate.publisher === 'string')
  )
}

const isVerifiedWebResearchCandidate = (value: unknown): value is ValidatedWebResearchCandidate =>
  isWebResearchCandidate(value) &&
  'status' in value &&
  value.status === 'verified' &&
  'fetchedUrl' in value &&
  typeof value.fetchedUrl === 'string'

const normalizeCandidateUrl = (value: string) => {
  const url = new URL(value.trim())
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Research candidate URL must use HTTP or HTTPS: ${value}`)
  }
  url.hash = ''
  return url.href
}

export const normalizeWebResearchCandidates = (
  values: readonly WebResearchCandidate[],
  limit = 5,
) => {
  const candidates = new Map<string, WebResearchCandidate>()
  for (const value of values) {
    try {
      const sourcePageUrl = normalizeCandidateUrl(value.sourcePageUrl)
      const directArtifactUrl = value.directArtifactUrl
        ? normalizeCandidateUrl(value.directArtifactUrl)
        : undefined
      if (candidates.has(sourcePageUrl)) continue
      candidates.set(sourcePageUrl, {
        title: value.title.trim(),
        sourcePageUrl,
        evidence: value.evidence.trim(),
        ...(directArtifactUrl ? { directArtifactUrl } : {}),
        ...(value.publisher?.trim() ? { publisher: value.publisher.trim() } : {}),
      })
    } catch {
      continue
    }
    if (candidates.size >= Math.max(1, Math.trunc(limit))) break
  }
  return [...candidates.values()]
}

export const validateWebResearchCandidates = async (
  candidates: readonly WebResearchCandidate[],
  readPage: (url: string) => Promise<string>,
  requireArtifact = false,
): Promise<ValidatedWebResearchCandidate[]> =>
  await Promise.all(
    candidates.map(async (candidate) => {
      const fetchedUrl = candidate.sourcePageUrl
      try {
        const page = await readPage(fetchedUrl)
        const sourceExcerpt = page.trim()
        if (!sourceExcerpt) throw new Error('The fetched page was empty.')
        const artifactExcerpt = requireArtifact
          ? await (async () => {
              if (!candidate.directArtifactUrl) {
                throw new Error('The candidate did not provide a direct artifact URL.')
              }
              const artifact = (await readPage(candidate.directArtifactUrl)).trim()
              if (!artifact) throw new Error('The fetched artifact was empty.')
              return `\n\nDirect artifact preflight:\n${artifact}`
            })()
          : ''
        const excerpt = `${sourceExcerpt}${artifactExcerpt}`.slice(0, 12_000)
        return { ...candidate, fetchedUrl, status: 'verified' as const, excerpt }
      } catch (error) {
        return {
          ...candidate,
          fetchedUrl,
          status: 'failed' as const,
          error: error instanceof Error ? error.message : String(error),
        }
      }
    }),
  )

const parseSearchCandidates = (value: unknown) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !('candidates' in value)) {
    throw new Error('Research search output did not contain a candidates array.')
  }
  const candidates = value.candidates
  if (!Array.isArray(candidates)) {
    throw new Error('Research search output candidates must be an array.')
  }
  return candidates.filter(isWebResearchCandidate)
}

const parseGeneratedQueries = (value: unknown) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !('queries' in value)) {
    throw new Error('Research query generation did not return queries.')
  }
  return trimNonEmptyStrings(
    Array.isArray(value.queries)
      ? value.queries.filter((item): item is string => typeof item === 'string')
      : [],
  ).slice(0, 4)
}

const researchStateArguments = (
  args: WebResearchPlannerArgs,
  queries: readonly string[],
  candidates: readonly WebResearchCandidate[],
) => ({
  objective: args.objective,
  queries: [...queries],
  candidates: [...candidates],
  artifactRoot: resolveResearchArtifactRoot(args, args.objective),
  maxSources: Math.min(5, Math.max(1, Math.trunc(args.maxSourcesPerQuery ?? 5))),
  mustDownload: args.mustDownload ?? false,
  fileTypeHints: trimNonEmptyStrings(args.fileTypeHints),
  siteHints: trimNonEmptyStrings(args.siteHints),
  ...(args.storageNamespace ? { storageNamespace: args.storageNamespace } : {}),
  ...(args.storageObjectId ? { storageObjectId: args.storageObjectId } : {}),
  ...(args.storageExpectedFileType
    ? { storageExpectedFileType: args.storageExpectedFileType }
    : {}),
  ...(args.deliverable ? { deliverable: args.deliverable } : {}),
})

const buildResearchSearchStage = (
  state: ReturnType<typeof researchStateArguments>,
  queryIndex: number,
  retryCount = 0,
): partialTaskDraft[] => {
  const query = state.queries[queryIndex]
  if (!query) throw new Error(`Missing research query at index ${queryIndex}.`)
  return [
    {
      role: 'user',
      content: {
        type: 'message',
        data: [
          `Research objective: ${state.objective}`,
          `Run this web search now: ${query}`,
          state.fileTypeHints.length > 0
            ? `Preferred file types: ${state.fileTypeHints.join(', ')}.`
            : '',
          state.siteHints.length > 0 ? `Preferred sites: ${state.siteHints.join(', ')}.` : '',
          'Return up to five strong candidates. Preserve exact source and direct artifact URLs.',
          'Output the requested object with a candidates array; do not output or describe its JSON schema.',
          retryCount > 0
            ? 'The previous result had no valid candidates. Correct that exact failure once.'
            : '',
        ]
          .filter(Boolean)
          .join('\n'),
      },
    },
    createChatCompletionTask({
      allowedTools: [],
      reasoning_effort: 'low',
      schema: researchSearchResultSchema,
      websearch: { enabled: true, mode: 'required', max_results: state.maxSources },
    }),
    toolCall({
      name: 'webResearchPipeline',
      arguments: {
        stage: 'search',
        ...state,
        queryIndex,
        retryCount,
        $use: { searchResult: '$previousResult' },
      },
    }),
  ]
}

const buildResearchVerificationStage = (
  state: ReturnType<typeof researchStateArguments>,
  retryCount = 0,
): partialTaskDraft[] => [
  {
    role: 'user',
    content: {
      type: 'message',
      data: [
        `Verify the fetched candidates against this objective: ${state.objective}`,
        'Accept only candidates supported by the fetched page evidence. Copy candidate URLs exactly.',
        state.mustDownload
          ? 'Select a direct artifact URL suitable for the requested download.'
          : 'Select the strongest accepted source URL.',
        state.fileTypeHints.length > 0
          ? `Required or preferred file types: ${state.fileTypeHints.join(', ')}.`
          : '',
        retryCount > 0
          ? 'The previous selection was not present in the validated candidate set. Correct it once.'
          : '',
      ]
        .filter(Boolean)
        .join('\n'),
    },
  },
  createChatCompletionTask({
    allowedTools: [],
    reasoning_effort: 'low',
    schema: researchVerificationSchema,
  }),
  toolCall({
    name: 'webResearchPipeline',
    arguments: {
      stage: 'verification',
      ...state,
      retryCount,
      $use: { verificationResult: '$previousResult' },
    },
  }),
]

const objectIdFromResearchUrl = (url: string) => {
  try {
    return (
      decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).at(-1) ?? '') ||
      'artifact'
    )
  } catch {
    return 'artifact'
  }
}

const buildResearchSynthesisStage = (
  state: ReturnType<typeof researchStateArguments>,
): partialTaskDraft[] => [
  {
    role: 'user',
    content: {
      type: 'message',
      data: [
        `Answer the original research objective now: ${state.objective}`,
        state.deliverable ? `Requested deliverable: ${state.deliverable}` : '',
        state.storageNamespace && state.storageObjectId
          ? `Stored artifact location: namespace "${state.storageNamespace}", object ID "${state.storageObjectId}". Include both values exactly in the answer.`
          : '',
        'Use only the validated evidence and completed artifact operations visible above.',
        'Include exact source URLs. If evidence is incomplete, say precisely what could not be verified.',
      ]
        .filter(Boolean)
        .join('\n'),
    },
  },
  createChatCompletionTask({ allowedTools: [], reasoning_effort: 'low' }),
]

const buildArtifactVerificationStage = (
  state: ReturnType<typeof researchStateArguments>,
  retryCount = 0,
): partialTaskDraft[] => [
  {
    role: 'user',
    content: {
      type: 'message',
      data: [
        `Verify the downloaded and read artifact against this objective: ${state.objective}`,
        'Confirm its identity, expected file type, title, revision or date when available, and required content from the storage read result.',
        retryCount > 0
          ? 'The previous artifact verification was invalid or unsupported. Correct it once from the stored evidence.'
          : '',
      ]
        .filter(Boolean)
        .join('\n'),
    },
  },
  createChatCompletionTask({
    allowedTools: [],
    reasoning_effort: 'low',
    schema: artifactVerificationSchema,
  }),
  toolCall({
    name: 'webResearchPipeline',
    arguments: {
      stage: 'artifact',
      ...state,
      retryCount,
      $use: { artifactResult: '$previousResult' },
    },
  }),
]

export const buildWebResearchStartChain = (args: WebResearchPlannerArgs): partialTaskDraft[] => {
  const objective = ensureNonEmptyString(args.objective, 'objective')
  const queries = trimNonEmptyStrings(args.searchQueries)
  if (queries.length === 0) {
    return [
      {
        role: 'user',
        content: {
          type: 'message',
          data: `Create two to four focused, non-duplicate web-search queries for this research objective: ${objective}`,
        },
      },
      createChatCompletionTask({
        allowedTools: [],
        reasoning_effort: 'low',
        schema: queryGenerationSchema,
      }),
      toolCall({
        name: 'webResearchPipeline',
        arguments: {
          stage: 'queries',
          ...researchStateArguments({ ...args, objective }, [], []),
          $use: { queryResult: '$previousResult' },
        },
      }),
    ]
  }
  return buildResearchSearchStage(
    researchStateArguments({ ...args, objective }, queries.slice(0, 8), []),
    0,
  )
}

const webResearchCandidateValidator = createTool({
  name: 'webResearchCandidateValidator',
  description: 'Fetch and normalize the shortlisted sources for a web-research workflow.',
  renderOptions: {
    hideChat: true,
    hideLlm: false,
    hideVector: true,
    hideToolSearch: true,
  },
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      candidates: { type: 'array', maxItems: 5, items: researchCandidateSchema },
      requireArtifact: { type: 'boolean', default: false },
    },
    required: ['candidates'],
  } as const satisfies JSONSchema7,
  function: async ({ candidates, requireArtifact }, context) => {
    if (!context.fetch) throw new Error('Web research validation requires a fetch capability.')
    const validated = await validateWebResearchCandidates(
      candidates,
      async (url) => await readPublicWebPageAsMarkdown(url, undefined, context.fetch),
      requireArtifact,
    )
    await context.reportProgress?.({
      message: `Validated ${validated.filter(({ status }) => status === 'verified').length} of ${validated.length} research candidates.`,
      completed: validated.length,
      total: validated.length,
      checkpoint: true,
    })
    return { candidates: validated }
  },
})

const webResearchPipeline = createTool({
  name: 'webResearchPipeline',
  description: 'Advance one typed stage of an active web-research workflow.',
  renderOptions: {
    hideChat: true,
    hideLlm: true,
    hideVector: true,
    hideVectorResult: true,
    hideToolSearch: true,
  },
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      stage: {
        type: 'string',
        enum: ['queries', 'search', 'validation', 'verification', 'artifact'],
      },
      objective: { type: 'string' },
      queries: { type: 'array', items: { type: 'string' } },
      candidates: { type: 'array', maxItems: 5, items: researchCandidateSchema },
      artifactRoot: { type: 'string' },
      maxSources: { type: 'integer', minimum: 1, maximum: 5 },
      mustDownload: { type: 'boolean' },
      fileTypeHints: { type: 'array', items: { type: 'string' } },
      siteHints: { type: 'array', items: { type: 'string' } },
      storageNamespace: { type: 'string' },
      storageObjectId: { type: 'string' },
      storageExpectedFileType: { type: 'string', enum: ['pdf'] },
      deliverable: { type: 'string' },
      queryIndex: { type: 'integer', minimum: 0 },
      retryCount: { type: 'integer', minimum: 0, maximum: 1 },
      queryResult: { type: 'object', additionalProperties: true },
      searchResult: { type: 'object', additionalProperties: true },
      validationResult: { type: 'object', additionalProperties: true },
      verificationResult: { type: 'object', additionalProperties: true },
      artifactResult: { type: 'object', additionalProperties: true },
    },
    required: [
      'stage',
      'objective',
      'queries',
      'candidates',
      'artifactRoot',
      'maxSources',
      'mustDownload',
      'fileTypeHints',
      'siteHints',
    ],
  } as const satisfies JSONSchema7,
  function: (args, context) => {
    const state = researchStateArguments(
      {
        objective: args.objective,
        searchQueries: args.queries,
        artifactRoot: args.artifactRoot,
        maxSourcesPerQuery: args.maxSources,
        mustDownload: args.mustDownload,
        fileTypeHints: args.fileTypeHints,
        siteHints: args.siteHints,
        ...(args.storageNamespace ? { storageNamespace: args.storageNamespace } : {}),
        ...(args.storageObjectId ? { storageObjectId: args.storageObjectId } : {}),
        ...(args.storageExpectedFileType
          ? { storageExpectedFileType: args.storageExpectedFileType }
          : {}),
        ...(args.deliverable ? { deliverable: args.deliverable } : {}),
      },
      args.queries,
      args.candidates,
    )

    switch (args.stage) {
      case 'queries': {
        const queries = parseGeneratedQueries(args.queryResult)
        if (queries.length < 2)
          throw new Error('Research query generation returned fewer than two valid queries.')
        return context.createSubtasksResult([buildResearchSearchStage({ ...state, queries }, 0)])
      }
      case 'search': {
        const queryIndex = args.queryIndex ?? 0
        const retryCount = args.retryCount ?? 0
        const found = normalizeWebResearchCandidates(
          parseSearchCandidates(args.searchResult),
          state.maxSources,
        )
        if (found.length === 0) {
          if (retryCount >= 1)
            throw new Error(
              `Research search ${queryIndex + 1} returned no valid candidates after one retry.`,
            )
          return context.createSubtasksResult([buildResearchSearchStage(state, queryIndex, 1)])
        }
        const candidates = normalizeWebResearchCandidates([...state.candidates, ...found], 5)
        const hasEnoughIndependentEvidence =
          queryIndex >= 1 && new Set(candidates.map(({ sourcePageUrl }) => sourcePageUrl)).size >= 2
        if (!hasEnoughIndependentEvidence && queryIndex + 1 < state.queries.length) {
          return context.createSubtasksResult([
            buildResearchSearchStage({ ...state, candidates }, queryIndex + 1),
          ])
        }
        return context.createSubtasksResult([
          [
            toolCall({
              name: 'webResearchCandidateValidator',
              arguments: { candidates, requireArtifact: state.mustDownload },
            }),
            toolCall({
              name: 'webResearchPipeline',
              arguments: {
                stage: 'validation',
                ...state,
                candidates,
                $use: { validationResult: '$previousResult' },
              },
            }),
          ],
        ])
      }
      case 'validation': {
        const validated =
          args.validationResult &&
          typeof args.validationResult === 'object' &&
          !Array.isArray(args.validationResult) &&
          'candidates' in args.validationResult &&
          Array.isArray(args.validationResult.candidates)
            ? args.validationResult.candidates.filter(isVerifiedWebResearchCandidate)
            : []
        if (validated.length === 0)
          throw new Error(
            'None of the shortlisted research candidates could be fetched and verified.',
          )
        const candidates = normalizeWebResearchCandidates(validated, 5)
        return context.createSubtasksResult([
          buildResearchVerificationStage({ ...state, candidates }),
        ])
      }
      case 'verification': {
        const retryCount = args.retryCount ?? 0
        const result = args.verificationResult
        if (
          !result ||
          typeof result !== 'object' ||
          Array.isArray(result) ||
          !('selectedUrl' in result) ||
          typeof result.selectedUrl !== 'string' ||
          !('verificationSummary' in result) ||
          typeof result.verificationSummary !== 'string'
        ) {
          if (retryCount >= 1)
            throw new Error('Research verification returned no selected URL after one retry.')
          return context.createSubtasksResult([buildResearchVerificationStage(state, 1)])
        }
        const selectedUrl = normalizeCandidateUrl(result.selectedUrl)
        const candidateUrls = new Set(
          state.candidates.flatMap((candidate) =>
            [candidate.sourcePageUrl, candidate.directArtifactUrl].filter(
              (url): url is string => !!url,
            ),
          ),
        )
        const acceptedCandidates = normalizeWebResearchCandidates(
          'acceptedCandidates' in result && Array.isArray(result.acceptedCandidates)
            ? result.acceptedCandidates.filter(isWebResearchCandidate)
            : state.candidates.filter(
                (candidate) =>
                  candidate.sourcePageUrl === selectedUrl ||
                  candidate.directArtifactUrl === selectedUrl,
              ),
          5,
        )
        const acceptedUrlsAreValidated =
          acceptedCandidates.length > 0 &&
          acceptedCandidates.every(
            (candidate) =>
              candidateUrls.has(candidate.sourcePageUrl) &&
              (!candidate.directArtifactUrl || candidateUrls.has(candidate.directArtifactUrl)),
          )
        const artifactUrls = new Set(
          state.candidates.flatMap((candidate) =>
            candidate.directArtifactUrl ? [candidate.directArtifactUrl] : [],
          ),
        )
        if (
          !candidateUrls.has(selectedUrl) ||
          !acceptedUrlsAreValidated ||
          (state.mustDownload && !artifactUrls.has(selectedUrl))
        ) {
          if (retryCount >= 1)
            throw new Error(
              'Research verification selected a URL outside the validated candidate set.',
            )
          return context.createSubtasksResult([buildResearchVerificationStage(state, 1)])
        }
        if (!state.mustDownload)
          return context.createSubtasksResult([buildResearchSynthesisStage(state)])
        const namespace = args.storageNamespace ?? state.artifactRoot.replace(/\/+$/, '')
        const objectId = args.storageObjectId ?? objectIdFromResearchUrl(selectedUrl)
        return context.createSubtasksResult([
          [
            toolCall({
              name: 'storage',
              arguments: {
                action: 'download',
                namespace,
                id: objectId,
                url: selectedUrl,
                ...(args.storageNamespace ? {} : { artifactRoot: state.artifactRoot }),
                ...(args.storageExpectedFileType
                  ? { expectedFileType: args.storageExpectedFileType }
                  : {}),
              },
            }),
            toolCall({ name: 'storage', arguments: { action: 'read', namespace, id: objectId } }),
            ...buildArtifactVerificationStage(state),
          ],
        ])
      }
      case 'artifact': {
        const retryCount = args.retryCount ?? 0
        const result = args.artifactResult
        const verified =
          result &&
          typeof result === 'object' &&
          !Array.isArray(result) &&
          'verified' in result &&
          result.verified === true &&
          'evidence' in result &&
          typeof result.evidence === 'string' &&
          result.evidence.trim().length > 0
        if (!verified) {
          if (retryCount >= 1) {
            throw new Error(
              'The downloaded artifact could not be semantically verified after one retry.',
            )
          }
          return context.createSubtasksResult([buildArtifactVerificationStage(state, 1)])
        }
        return context.createSubtasksResult([buildResearchSynthesisStage(state)])
      }
    }
  },
})

export const webResearchPlanner = createTool({
  name: 'webResearchPlanner',
  renderOptions: { hideVector: true, hideToolSearch: false },
  description:
    'For a research-only leaf that needs multiple queries, source validation, downloads, saved artifacts, or synthesis; skip it for one narrow lookup.',
  longDescription: `This tool creates a visible, typed research pipeline. It runs bounded web searches, fetches the shortlisted sources, verifies their evidence, optionally downloads an explicitly requested artifact, and synthesizes the result without delegating open-ended sub-agents.

Pass user-specified storageNamespace, storageObjectId, and storageExpectedFileType as literal values. Use Taskyon $use only when an argument must come from a prior task result.

Use it when research itself is the current objective and needs durable evidence or multiple source families. Keep later building, installation, or verification work in separate planned tasks. Exact named products, providers, domains, and URLs remain identity constraints throughout discovery and validation.`,
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      objective: {
        type: 'string',
        description: 'Broad research objective, for example "collect solar cell spec sheets".',
      },
      searchQueries: {
        type: 'array',
        maxItems: 8,
        items: { type: 'string' },
        description:
          'Optional focused queries. When omitted, the pipeline asks the active model for two to four queries before searching.',
      },
      artifactRoot: {
        type: 'string',
        description:
          'Optional relative output directory for all research artifacts. Defaults to research/<objective-slug>/. All delegated branches must use the same root.',
      },
      storageNamespace: {
        type: 'string',
        description:
          'Optional exact logical storage namespace explicitly requested by the user. Preserve it for the final downloaded object.',
      },
      storageObjectId: {
        type: 'string',
        description:
          'Optional exact storage object ID explicitly requested by the user. Preserve it for the final downloaded object.',
      },
      storageExpectedFileType: {
        type: 'string',
        enum: ['pdf'],
        description:
          'Optional expected type for an explicitly requested storage download. Pass the literal value "pdf"; only use Taskyon $use if deriving the type from an earlier task.',
      },
      researchMode: {
        type: 'string',
        enum: [...researchModes],
        default: 'websearch-first',
        description:
          'Research execution mode. websearch-first starts immediately with chatCompletion web search; browser-mcp-first ensures browser MCP before branching; websearch-only never uses browser MCP tools.',
      },
      browserTools: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Imported browser MCP tool names that may browse pages, click links, or download files.',
      },
      supportTools: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Additional explicit helper tools for each delegated branch. Defaults to updateFiles, downloadFile, bash, and jinaMarkdownReader for tycli/local runtimes; browser profiles should provide storage and jinaMarkdownReader so browser downloads and page validation use the available storage boundary.',
      },
      enableWebSearch: {
        type: 'boolean',
        default: true,
        description:
          'When true, delegated research branches explicitly enable chatCompletion-based web search for discovery.',
      },
      webSearchMaxResults: {
        type: 'integer',
        default: 5,
        minimum: 1,
        description:
          'Maximum number of chatCompletion web results to retrieve per delegated research branch when web search is enabled.',
      },
      ensureBrowserMcp: {
        type: 'boolean',
        description:
          'Explicitly ensure browser MCP before research. In websearch-first mode this only applies when browserTools are configured.',
      },
      maxSourcesPerQuery: {
        type: 'integer',
        default: 5,
        minimum: 1,
        description: 'Upper bound for strong candidate sources to collect per query.',
      },
      mustDownload: {
        type: 'boolean',
        default: false,
        description:
          'Download and inspect the selected artifact through storage. Set this only when the user explicitly requested a file or durable saved artifact.',
      },
      fileTypeHints: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional preferred file types such as pdf, xls, csv.',
      },
      siteHints: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional site filters or manufacturer hints.',
      },
      response_length: {
        type: 'string',
        enum: ['short', 'medium', 'long'],
        description:
          'Provider-native response length accepted for compatibility and ignored by the research pipeline.',
      },
      deliverable: {
        type: 'string',
        description:
          'Optional expected output, for example "manufacturer, model, spec URL, direct PDF URL".',
      },
    },
    required: ['objective'],
  } as const satisfies JSONSchema7,
  function: async (args, context) => {
    const scopedArgs = args
    const requestedStorageTarget = resolveRequestedStorageTarget(
      scopedArgs,
      await context.getExecutionTaskChain(),
    )
    const effectiveArgs = requestedStorageTarget
      ? {
          ...scopedArgs,
          storageNamespace: requestedStorageTarget.namespace,
          storageObjectId: requestedStorageTarget.objectId,
          mustDownload: true,
          ...(requestedStorageTarget.expectedFileType
            ? { storageExpectedFileType: requestedStorageTarget.expectedFileType }
            : {}),
        }
      : scopedArgs
    return context.createSubtasksResult([buildWebResearchStartChain(effectiveArgs)])
  },
})

export const proxyWebReader = createTool({
  name: 'proxyWebReader',
  description:
    'Fetch a target page through a configurable proxy or unblocker HTTP service using a secret API key.',
  longDescription: `Use this only when direct retrieval is blocked and the user has chosen a proxy provider. The API key is requested through Taskyon's secret boundary and sent only using the configured provider authentication method. Built-in provider presets supply known endpoint conventions while still allowing an explicit custom service.`,
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      url: {
        type: 'string',
        description: 'Absolute http(s) URL to fetch through the proxy service.',
      },
      providerPreset: {
        type: 'string',
        enum: [...proxyWebReaderProviderIds],
        description:
          'Optional provider preset. This fills provider metadata and any known defaults from the built-in provider catalog.',
      },
      serviceUrl: {
        type: 'string',
        description:
          'Base URL of the proxy or unblocker API. Override this when the selected preset does not include a concrete endpoint.',
      },
      providerLabel: {
        type: 'string',
        description: 'Human label used in the secret prompt and result metadata.',
      },
      pricingUrl: {
        type: 'string',
        description: 'Optional pricing page URL shown in returned metadata.',
      },
      docsUrl: {
        type: 'string',
        description: 'Optional provider documentation URL shown in the secret prompt.',
      },
      apiKeySecretName: {
        type: 'string',
        description: 'Secret name to request from the user interface.',
      },
      apiKeyHeader: {
        type: 'string',
        description:
          'Header name used to send the API key to the proxy service when apiKeyLocation is "header".',
      },
      apiKeyScheme: {
        type: 'string',
        description: 'Optional prefix for the API key header value, for example "Bearer".',
      },
      apiKeyLocation: {
        type: 'string',
        enum: ['header', 'query'],
        description: 'Whether the API key is sent as a header or query parameter.',
      },
      apiKeyQueryParam: {
        type: 'string',
        description:
          'Query parameter used for the API key when apiKeyLocation is "query", for example apikey.',
      },
      onboardingToken: {
        type: 'string',
        description: 'Internal reentry token for the first-run proxy onboarding flow.',
      },
      targetUrlParam: {
        type: 'string',
        description: 'Query parameter name used by the service for the final target URL.',
      },
      httpPolicy: politeHttpPolicySchema,
    },
    required: ['url'],
  } as const satisfies JSONSchema7,
  function: async (args, ctx) => {
    const resolvedArgs = resolveProxyWebReaderArgs(args)
    const targetUrl = resolvedArgs.url
    if (!/^https?:\/\//i.test(targetUrl)) {
      throw new Error(`Invalid URL '${targetUrl}'. Please provide an absolute http(s) URL.`)
    }

    const providerLabel = resolvedArgs.providerLabel
    const serviceUrl = ensureNonEmptyString(resolvedArgs.serviceUrl, 'serviceUrl')
    const secretName = resolvedArgs.apiKeySecretName
    const docsUrl = resolvedArgs.docsUrl?.trim()
    const taskChain = await ctx.getExecutionTaskChain()
    const previousCall = taskChain.at(-3)
    const thisMessage = taskChain.at(-1)
    const onboardingToken = typeof args.onboardingToken === 'string' ? args.onboardingToken : ''
    const isOnboardingReentry =
      onboardingToken.length > 0 &&
      previousCall?.content.type === 'functioncall' &&
      previousCall.content.data.name === 'proxyWebReader' &&
      previousCall.content.data.arguments.onboardingToken === onboardingToken &&
      thisMessage?.parentID === previousCall.id

    let apiKey = await ctx.getSecret(secretName, false)
    if (!apiKey && !isOnboardingReentry) {
      const nextToken = `proxy-onboarding-${Date.now().toString(36)}`
      return ctx.createSubtasksResult([
        [
          {
            role: 'assistant',
            content: {
              type: 'message',
              data: createProxyOnboardingButton({
                providerLabel,
                ...(resolvedArgs.pricingUrl ? { pricingUrl: resolvedArgs.pricingUrl } : {}),
                ...(docsUrl ? { docsUrl } : {}),
                onboardingToken: nextToken,
              }),
            },
          },
          toolCall({
            name: 'proxyWebReader',
            arguments: {
              ...args,
              onboardingToken: nextToken,
            },
          }),
        ],
      ])
    }

    if (!apiKey && isOnboardingReentry) {
      if (!ctx.waitForInteraction) {
        throw new Error('Proxy onboarding interaction is unavailable.')
      }
      await waitForProxyOnboardingContinue(ctx.waitForInteraction, onboardingToken)
      apiKey = await ctx.getSecret(
        secretName,
        `Please enter the API key for ${providerLabel}.${docsUrl ? ` Documentation: ${docsUrl}` : ''}`,
        true,
      )
    }
    if (!apiKey) {
      throw new Error(`No API key was provided for ${providerLabel}.`)
    }

    const httpPolicy = parsePoliteHttpPolicy(args.httpPolicy)
    await waitForPoliteHttpTurn(targetUrl, httpPolicy)
    const requestUrl = buildProxyRequestUrlWithAuth(
      { ...resolvedArgs, serviceUrl, targetUrlParam: resolvedArgs.targetUrlParam },
      apiKey,
    )
    if (!ctx.fetch) throw new Error('Mediated fetch is unavailable.')
    const response = await requestProxyText(
      requestUrl,
      buildProxyHeaders(resolvedArgs, apiKey),
      httpPolicy,
      ctx.fetch,
    )
    if (response.status < 200 || response.status >= 300) {
      throw new Error(
        `Proxy request failed: ${response.status} ${response.statusText} while fetching ${targetUrl}.`,
      )
    }

    return {
      providerPreset: resolvedArgs.providerPreset,
      provider: providerLabel,
      pricingUrl: resolvedArgs.pricingUrl,
      docsUrl: resolvedArgs.docsUrl,
      requestUrl,
      targetUrl,
      status: response.status,
      body: response.body,
    }
  },
})

export const webResearchTools = [
  importBrowserMcpTools,
  ensureBrowserMcpTools,
  webResearchPlanner,
  webResearchPipeline,
  webResearchCandidateValidator,
  proxyWebReader,
]
