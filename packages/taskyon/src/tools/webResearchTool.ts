import type { JSONSchema7 } from 'json-schema'
import {
  proxyWebReaderProviderIds,
  resolveProxyWebReaderArgs,
  type ResolvedProxyWebReaderArgs,
} from '@taskyon/shared/modules/webFetching'
import { buildTaskPlannerTaskChains } from './TaskPlannerTool'
import { createTool, makeTaskResult, toolCall } from '../types/toolApi'
import { canUseTauriHttpPlugin, tauriHttpRequestText } from '../utils/tauriHttpPlugin'

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
  searchQueries: string[]
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

const defaultResearchSupportTools = ['proxyWebReader', 'tauriHttpWebReader']
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
  messagePort: MessagePort | undefined,
  onboardingToken: string,
): Promise<void> => {
  if (!messagePort) {
    throw new Error('No message port is available for proxy onboarding.')
  }

  await new Promise<void>((resolve) => {
    messagePort.onmessage = (event) => {
      const payload = event.data?.payload ?? event.data
      if (!payload || payload.tool !== 'proxyWebReader' || payload.token !== onboardingToken) return
      if (payload.decision === 'continue') resolve()
    }
  })
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
  messagePort: MessagePort | undefined,
  toolName: string,
  onboardingToken: string,
): Promise<void> => {
  if (!messagePort) {
    throw new Error(`No message port is available for ${toolName} onboarding.`)
  }

  await new Promise<void>((resolve) => {
    messagePort.onmessage = (event) => {
      const payload = event.data?.payload ?? event.data
      if (!payload || payload.tool !== toolName || payload.token !== onboardingToken) return
      if (payload.decision === 'continue') resolve()
    }
  })
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

const uniqueStrings = (values: readonly string[]) => Array.from(new Set(values))

const joinHints = (label: string, hints: readonly string[]) =>
  hints.length > 0 ? `${label}: ${hints.join(', ')}.` : ''

const buildResearchTaskToolset = (args: WebResearchPlannerArgs) => {
  const browserTools = trimNonEmptyStrings(args.browserTools)
  const configuredSupportTools = trimNonEmptyStrings(args.supportTools)
  const supportTools = uniqueStrings(
    configuredSupportTools.length > 0 ? configuredSupportTools : defaultResearchSupportTools,
  )
  const allowedTools = uniqueStrings([...browserTools, ...supportTools])
  if (allowedTools.length === 0) {
    throw new Error(
      'webResearchPlanner needs at least one browserTools or supportTools entry so delegated subtasks stay explicit.',
    )
  }
  return { browserTools, supportTools, allowedTools }
}

const buildResearchEntryNodeArguments = (args: WebResearchPlannerArgs) => {
  if (args.enableWebSearch === false) return undefined
  return {
    websearch: {
      enabled: true,
      max_results: Math.max(1, Math.trunc(args.webSearchMaxResults ?? 5)),
    },
  }
}

const buildDiscoveryTask = (
  objective: string,
  query: string,
  maxSourcesPerQuery: number,
  fileTypeHints: readonly string[],
  siteHints: readonly string[],
  deliverable?: string,
) =>
  [
    `Research objective: ${objective}.`,
    `Use this search query: ${query}.`,
    `Find up to ${maxSourcesPerQuery} strong candidate sources.`,
    'Use chatCompletion web search first for discovery when it is enabled.',
    'Prioritize official manufacturer pages, product pages, and direct specification documents.',
    joinHints('Preferred file types', fileTypeHints),
    joinHints('Site hints', siteHints),
    deliverable ? `Target output: ${deliverable}.` : '',
  ]
    .filter((line) => line.length > 0)
    .join(' ')

const buildValidationTask = (
  objective: string,
  query: string,
  mustDownload: boolean,
  fileTypeHints: readonly string[],
  deliverable?: string,
) =>
  [
    `Validate the best candidates for "${objective}" found via "${query}".`,
    'Open the pages with browser tooling when available, confirm the source is relevant, and extract the strongest direct source URLs.',
    'If direct browsing is blocked, fall back to proxy-backed fetching.',
    mustDownload
      ? 'If the browser tooling supports downloads, download the spec sheets. Otherwise capture the direct download URLs exactly.'
      : 'Capture the strongest direct source URLs exactly.',
    joinHints('Preferred file types', fileTypeHints),
    deliverable ? `Keep the final material aligned with: ${deliverable}.` : '',
  ]
    .filter((line) => line.length > 0)
    .join(' ')

export const buildWebResearchTaskGroups = (args: WebResearchPlannerArgs) => {
  const objective = ensureNonEmptyString(args.objective, 'objective')
  const searchQueries = trimNonEmptyStrings(args.searchQueries)
  if (searchQueries.length === 0) {
    throw new Error('webResearchPlanner requires at least one non-empty search query.')
  }

  const { allowedTools } = buildResearchTaskToolset(args)
  const maxSourcesPerQuery = Math.max(1, Math.trunc(args.maxSourcesPerQuery ?? 5))
  const fileTypeHints = trimNonEmptyStrings(args.fileTypeHints)
  const siteHints = trimNonEmptyStrings(args.siteHints)
  const mustDownload = args.mustDownload ?? true

  return searchQueries.map((query) => [
    {
      task: buildDiscoveryTask(
        objective,
        query,
        maxSourcesPerQuery,
        fileTypeHints,
        siteHints,
        args.deliverable,
      ),
      allowedTools,
    },
    {
      task: buildValidationTask(objective, query, mustDownload, fileTypeHints, args.deliverable),
      allowedTools,
    },
  ])
}

const formatResearchBreakdown = (taskGroups: ReturnType<typeof buildWebResearchTaskGroups>) =>
  taskGroups
    .map((group, index) => `Branch ${index + 1}: ${group.map((task) => task.task).join(' -> ')}`)
    .join('\n')

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

const requestMcpEndpoint = async (url: string, id: number, method: string, params?: unknown) => {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: createMcpRpcPayload(id, method, params),
  })

  const body = (await response.json()) as Record<string, unknown>
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${JSON.stringify(body)}`)
  }
  if ('error' in body && body.error) {
    throw new Error(String(JSON.stringify(body.error)))
  }
  return body
}

const checkBrowserMcpEndpoint = async (serverUrl: string) => {
  await requestMcpEndpoint(serverUrl, 1, 'initialize', {
    protocolVersion: '2024-11-05',
    clientInfo: { name: 'taskyon-browser-access', version: '0.5.3' },
    capabilities: {},
  })
  await requestMcpEndpoint(serverUrl, 2, 'notifications/initialized')
  await requestMcpEndpoint(serverUrl, 3, 'tools/list')
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

const requestProxyText = async (requestUrl: string, headers: Record<string, string>) => {
  if (canUseTauriHttpPlugin()) {
    return await tauriHttpRequestText(requestUrl, { method: 'GET', headers })
  }

  const response = await fetch(requestUrl, { method: 'GET', headers })
  return {
    status: response.status,
    statusText: response.statusText,
    headers: Array.from(response.headers.entries()),
    body: await response.text(),
  }
}

export const importBrowserMcpTools = createTool({
  name: 'importBrowserMcpTools',
  description:
    'Import tools from a browser MCP server that is already running on a local or reachable HTTP endpoint.',
  longDescription: `Use this after you have already started a browser MCP server outside Taskyon.

This tool does not spawn a local process itself. That boundary belongs to Tauri/local-shell automation or an external companion service, because the Taskyon core package also runs in browser and headless environments where OS process spawning is not available.

After import, you can delegate browser-based research through webResearchPlanner.`,
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
  function: (args) => makeTaskResult([[...buildBrowserMcpImportChain(args)]]),
})

export const ensureBrowserMcpTools = createTool({
  name: 'ensureBrowserMcpTools',
  description:
    'Ensure that a configured browser MCP endpoint is reachable, guide manual startup if needed, and then import its tools.',
  longDescription: `Use this before browser-backed research.

This tool checks whether the configured browser MCP server is reachable. If it is not, Taskyon shows manual startup instructions in chat and waits for the user to continue. After continue, it retries the MCP connection and imports the browser tools.`,
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
    const previousCall = ctx.taskChain.at(-3)
    const thisMessage = ctx.taskChain.at(-1)
    const onboardingToken = typeof args.onboardingToken === 'string' ? args.onboardingToken : ''
    const isOnboardingReentry =
      onboardingToken.length > 0 &&
      previousCall?.content.type === 'functioncall' &&
      previousCall.content.data.name === 'ensureBrowserMcpTools' &&
      previousCall.content.data.arguments.onboardingToken === onboardingToken &&
      thisMessage?.parentID === previousCall.id

    try {
      await checkBrowserMcpEndpoint(serverUrl)
      return makeTaskResult([[...buildEnsureBrowserMcpImportRetryChain(args)]])
    } catch {
      if (isOnboardingReentry) {
        await waitForContinueDecision(ctx.messagePort, 'ensureBrowserMcpTools', onboardingToken)
        await checkBrowserMcpEndpoint(serverUrl)
        return makeTaskResult([[...buildEnsureBrowserMcpImportRetryChain(args)]])
      }

      const nextToken = `browser-mcp-onboarding-${Date.now().toString(36)}`
      const message = createBrowserMcpOnboardingMessage({
        serverName,
        serverUrl,
        startupInstructions,
        onboardingToken: nextToken,
      })
      return makeTaskResult([
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

export const webResearchPlanner = createTool({
  name: 'webResearchPlanner',
  description:
    'Launch parallel browser-research branches that search, crawl, validate, and optionally download source material.',
  longDescription: `Use this for structured research where the work should branch by query.

Each search query becomes its own parallel research branch. Inside each branch, Taskyon first searches for likely sources and then validates or downloads the strongest candidates.

This tool is especially useful for tasks like finding manufacturer spec sheets, datasheets, whitepapers, or product PDFs.

Taskyon first uses chatCompletion web search for discovery when enabled. It then uses browser MCP tools for validation, browsing, and downloads, with proxyWebReader and tauriHttpWebReader as fallbacks for blocked pages or direct fetches.`,
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
        items: { type: 'string' },
        description: 'One query per parallel research branch.',
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
          'Additional explicit helper tools for each delegated branch. Defaults to proxyWebReader and tauriHttpWebReader.',
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
        default: true,
        description:
          'When true, Taskyon first ensures that the configured browser MCP endpoint is reachable and imports the browser tools before research branches fan out.',
      },
      maxSourcesPerQuery: {
        type: 'integer',
        default: 5,
        minimum: 1,
        description: 'Upper bound for strong candidate sources to collect per query.',
      },
      mustDownload: {
        type: 'boolean',
        default: true,
        description:
          'When true, delegated tasks should download files if the browser tooling supports it, otherwise preserve the direct download URLs.',
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
      deliverable: {
        type: 'string',
        description:
          'Optional expected output, for example "manufacturer, model, spec URL, direct PDF URL".',
      },
    },
    required: ['objective', 'searchQueries'],
  } as const satisfies JSONSchema7,
  function: (args, context) => {
    const browserTools = trimNonEmptyStrings(args.browserTools)
    if (args.ensureBrowserMcp !== false) {
      return makeTaskResult([
        [
          {
            role: 'assistant',
            content: {
              type: 'message',
              data: 'Ensuring browser MCP access before launching the research branches.',
            },
          },
          toolCall({
            name: 'ensureBrowserMcpTools',
            arguments: browserTools.length > 0 ? { toolNames: browserTools } : {},
          }),
          toolCall({
            name: 'webResearchPlanner',
            arguments: {
              ...args,
              ensureBrowserMcp: false,
            },
          }),
        ],
      ])
    }

    const taskGroups = buildWebResearchTaskGroups(args)
    const breakdown = formatResearchBreakdown(taskGroups)
    const delegatedChains = buildTaskPlannerTaskChains(taskGroups, context.taskChain).map(
      (chain) => {
        const entryNodeArguments = buildResearchEntryNodeArguments(args)
        if (!entryNodeArguments) return chain
        return chain.map((task) => {
          if (task.content.type !== 'functioncall' || task.content.data.name !== 'entryNode') {
            return task
          }
          return toolCall({
            name: 'entryNode',
            arguments: {
              ...(task.content.data.arguments || {}),
              ...entryNodeArguments,
            },
          })
        })
      },
    )

    return makeTaskResult([
      [
        {
          role: 'assistant',
          content: {
            type: 'message',
            data: `Research Breakdown:\n${breakdown}`,
          },
        },
      ],
      ...delegatedChains,
    ])
  },
})

export const proxyWebReader = createTool({
  name: 'proxyWebReader',
  description:
    'Fetch a target page through a configurable proxy or unblocker HTTP service using a secret API key.',
  longDescription: `Use this when direct browser fetches are blocked and you have a proxy or unblocker service available.

The tool expects a simple HTTP API pattern:
- serviceUrl: base service endpoint
- targetUrlParam: query parameter name that carries the target URL
- apiKeyHeader or apiKeyQueryParam: where the secret is sent
- apiKeyScheme: optional prefix like "Bearer"

This tool includes a built-in provider catalog with 40 public vendors so a user can choose a preset and then override the exact endpoint/auth details when needed.`,
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
    const previousCall = ctx.taskChain.at(-3)
    const thisMessage = ctx.taskChain.at(-1)
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
      return makeTaskResult([
        [
          {
            role: 'assistant',
            content: {
              type: 'message',
              data: createProxyOnboardingButton({
                providerLabel,
                pricingUrl: resolvedArgs.pricingUrl,
                docsUrl,
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
      await waitForProxyOnboardingContinue(ctx.messagePort, onboardingToken)
      apiKey = await ctx.getSecret(
        secretName,
        `Please enter the API key for ${providerLabel}.${docsUrl ? ` Documentation: ${docsUrl}` : ''}`,
        true,
      )
    }
    if (!apiKey) {
      throw new Error(`No API key was provided for ${providerLabel}.`)
    }

    const requestUrl = buildProxyRequestUrlWithAuth(
      { ...resolvedArgs, serviceUrl, targetUrlParam: resolvedArgs.targetUrlParam },
      apiKey,
    )
    const response = await requestProxyText(requestUrl, buildProxyHeaders(resolvedArgs, apiKey))
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
  proxyWebReader,
]
