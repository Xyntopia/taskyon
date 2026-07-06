import type { JSONSchema7 } from 'json-schema'
import {
  proxyWebReaderProviderIds,
  resolveProxyWebReaderArgs,
  type ResolvedProxyWebReaderArgs,
} from '@taskyon/common/modules/webFetching'
import { buildTaskPlannerTaskChains } from './TaskPlannerTool'
import { createTool, toolCall } from '../types/toolApi'
import type { partialTaskDraft } from '../types/taskNode'
import {
  parsePoliteHttpPolicy,
  politeFetch,
  politeHttpPolicySchema,
  waitForPoliteHttpTurn,
} from '../utils/politeHttp'
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
  artifactRoot?: string
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

const defaultResearchSupportTools = ['updateFiles', 'downloadFile', 'bash', 'jinaMarkdownReader']
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

const slugifyResearchObjective = (value: string) => {
  const slug = value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[''`]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'research-artifacts'
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

const resolveResearchMode = (mode: ResearchMode | undefined): ResearchMode => {
  if (mode === 'browser-mcp-first' || mode === 'websearch-only') return mode
  return 'websearch-first'
}

const buildResearchTaskToolset = (args: WebResearchPlannerArgs) => {
  const researchMode = resolveResearchMode(args.researchMode)
  const useBrowserTools = researchMode === 'browser-mcp-first' || args.ensureBrowserMcp === true
  const browserTools =
    researchMode === 'websearch-only' || !useBrowserTools
      ? []
      : trimNonEmptyStrings(args.browserTools)
  const configuredSupportTools = trimNonEmptyStrings(args.supportTools)
  const supportTools = uniqueStrings(
    configuredSupportTools.length > 0 ? configuredSupportTools : defaultResearchSupportTools,
  )
  const allowedTools = uniqueStrings([...browserTools, ...supportTools])
  if (allowedTools.length === 0 && args.enableWebSearch === false) {
    throw new Error(
      'webResearchPlanner needs web search enabled or at least one browserTools/supportTools entry so delegated subtasks stay explicit.',
    )
  }
  return { browserTools, supportTools, allowedTools }
}

const shouldEnsureBrowserMcp = (args: WebResearchPlannerArgs) => {
  const researchMode = resolveResearchMode(args.researchMode)
  if (researchMode === 'websearch-only') return false
  if (researchMode === 'browser-mcp-first') return args.ensureBrowserMcp !== false
  return args.ensureBrowserMcp === true && trimNonEmptyStrings(args.browserTools).length > 0
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
  artifactRoot: string,
  maxSourcesPerQuery: number,
  fileTypeHints: readonly string[],
  siteHints: readonly string[],
  deliverable?: string,
) =>
  [
    `Research objective: ${objective}.`,
    `Use this search query: ${query}.`,
    `Use exactly this artifact root for the whole request: ${artifactRoot}.`,
    `Find up to ${maxSourcesPerQuery} strong candidate sources.`,
    'Use chatCompletion web search first for discovery when it is enabled.',
    'Prioritize official manufacturer pages, product pages, and direct specification documents.',
    'For each candidate, capture manufacturer, product or model name, source page URL, direct document URL when available, and a short evidence note.',
    'Avoid duplicate products and prefer current official documents over reposted PDFs.',
    joinHints('Preferred file types', fileTypeHints),
    joinHints('Site hints', siteHints),
    deliverable ? `Target output: ${deliverable}.` : '',
  ]
    .filter((line) => line.length > 0)
    .join(' ')

const buildValidationTask = (
  objective: string,
  query: string,
  artifactRoot: string,
  mustDownload: boolean,
  fileTypeHints: readonly string[],
  deliverable?: string,
) =>
  [
    `Validate the best candidates for "${objective}" found via "${query}".`,
    `The only output directory for this research request is ${artifactRoot}. Save every downloaded file, generated text file, manifest, index, and note under this directory. Do not create sibling directories such as task_artifacts, task_battery_specs, taskyon, or alternate spellings of the task name.`,
    'Open the pages with browser tooling when available, confirm the source is relevant, and extract the strongest direct source URLs.',
    'Deduplicate products before returning results; do not count the same product or document twice.',
    'Keep raw source downloads budgeted. For HTML, article pages, or documentation pages, save extracted notes, citations, and a manifest instead of a full raw page unless the user explicitly requested a raw archive. If downloadFile is used for raw text or HTML, set a reasonable maxBytes limit.',
    mustDownload
      ? 'The requested deliverable includes saved research artifacts, not just links. Use whichever storage or download tool is available in this runtime. In tycli or other local runtimes, prefer downloadFile for accessible URL downloads because it validates file bytes, then use bash only as a fallback when downloadFile is unavailable or clearly unsuitable. If bash is used to download a requested PDF, verify the saved file starts with the %PDF- magic bytes before counting it; delete, rename, or mark any HTML/access-denied/error response as blocked instead of leaving it with a .pdf filename. Use updateFiles for text artifacts such as Markdown, JSON, CSV, or manifests. In browser runtimes, use opfsStorage download with expectedFileType set to pdf for accessible PDF URLs, or opfsStorage save for generated artifacts and file bytes that browser tooling exposes as base64. Verify each saved artifact exists and is non-empty when the tool supports verification. For PDF requests, count a saved artifact only when it is confirmed to be real PDF content, not an HTML error page or URL-only entry. If a requested artifact cannot be saved, record it as a blocked download with the reason; do not treat URL-only entries as completed downloads.'
      : 'Capture the strongest direct source URLs exactly.',
    [
      'If the original user asked to save the results, save them without asking for extra confirmation.',
      mustDownload
        ? `Use this single shared task-specific layout for the whole user request: files live below ${artifactRoot}; multiple artifacts should include ${artifactRoot}index.md or a manifest with every local path or OPFS path. Do not create competing branch-specific directories.`
        : `Use this single task-specific layout: files live below ${artifactRoot}. For a small single-file result, save one clear Markdown file under ${artifactRoot}; for multiple files, put the files plus an index.md there.`,
      `Use stable descriptive filenames under ${artifactRoot} and record each local path or OPFS path next to the source URL. When using updateFiles or downloadFile, pass artifactRoot: ${artifactRoot} and make filePath start with ${artifactRoot}. When using opfsStorage, pass artifactRoot: ${artifactRoot} and make directory start with ${artifactRoot}.`,
      'For OPFS saves, base64-encode file content, set the best matching MIME type, and keep text formats such as Markdown, JSON, CSV, and HTML readable when loaded back.',
      'If a page reader such as jinaMarkdownReader is available, use it to validate candidate pages and find direct artifact URLs before falling back to shell-only guesses. If a file-writing tool such as updateFiles or opfsStorage is available, create or update the index or manifest with the validated results and saved artifact paths.',
    ].join(' '),
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
  const artifactRoot = resolveResearchArtifactRoot(args, objective)

  return searchQueries.map((query) => [
    {
      task: buildDiscoveryTask(
        objective,
        query,
        artifactRoot,
        maxSourcesPerQuery,
        fileTypeHints,
        siteHints,
        args.deliverable,
      ),
      allowedTools,
    },
    {
      task: buildValidationTask(
        objective,
        query,
        artifactRoot,
        mustDownload,
        fileTypeHints,
        args.deliverable,
      ),
      allowedTools,
    },
  ])
}

const formatResearchBreakdown = (taskGroups: ReturnType<typeof buildWebResearchTaskGroups>) =>
  taskGroups
    .map((group, index) => `Branch ${index + 1}: ${group.map((task) => task.task).join(' -> ')}`)
    .join('\n')

const buildResearchSynthesisTaskChain = (args: WebResearchPlannerArgs): partialTaskDraft[] => {
  const objective = ensureNonEmptyString(args.objective, 'objective')
  const artifactRoot = resolveResearchArtifactRoot(args, objective)
  const entryNodeArguments = buildResearchEntryNodeArguments({
    ...args,
    supportTools: ['updateFiles', 'bash'],
    enableWebSearch: false,
  })

  return [
    {
      role: 'user',
      content: {
        type: 'message',
        data: [
          'Research synthesis checkpoint.',
          '',
          `Original research objective: ${objective}.`,
          `Shared artifact root: ${artifactRoot}.`,
          args.deliverable ? `Requested deliverable: ${args.deliverable}.` : '',
          '',
          'Review the completed research notes and saved artifacts in the task tree and local artifact root.',
          'Create the final user-facing deliverable requested by the original objective instead of leaving only branch-local notes.',
          'If the task asks for a memo, report, comparison, summary, or recommendation, write one clear final Markdown file under the shared artifact root and update or create an index that points to it.',
          'Also create a top-level README.md with one simple command a human can run from the project root to inspect the result.',
          'If the requested deliverable includes a visual artifact, make the README command open, render, or verify that visual artifact directly, not only print the text report. In headless/local CLI contexts, a small python or shell command that parses or checks the visual file is acceptable.',
          'When using updateFiles for both artifact-root files and top-level README.md, omit artifactRoot and use full relative paths for every file, or split the README.md write into a separate updateFiles call. Do not pass artifactRoot while writing README.md.',
          'Use a command that works locally without login; for research artifacts this is usually a cat command for the final Markdown file.',
          'Finish with concise verification evidence and the human-check command.',
        ]
          .filter((line) => line.length > 0)
          .join('\n'),
      },
    },
    toolCall({
      name: 'entryNode',
      arguments: entryNodeArguments ?? {
        allowedTools: ['updateFiles', 'bash'],
      },
    }),
  ]
}

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

const requestProxyText = async (
  requestUrl: string,
  headers: Record<string, string>,
  httpPolicy: { minDelayMs?: number } | undefined,
) => {
  if (canUseTauriHttpPlugin()) {
    return await tauriHttpRequestText(requestUrl, {
      method: 'GET',
      headers,
      ...(httpPolicy ? { httpPolicy } : {}),
    })
  }

  const response = await politeFetch(requestUrl, { method: 'GET', headers }, httpPolicy)
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
  function: (args, ctx) => ctx.createSubtasksResult([[...buildBrowserMcpImportChain(args)]]),
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

    try {
      await checkBrowserMcpEndpoint(serverUrl)
      return ctx.createSubtasksResult([[...buildEnsureBrowserMcpImportRetryChain(args)]])
    } catch {
      if (isOnboardingReentry) {
        await waitForContinueDecision(ctx.messagePort, 'ensureBrowserMcpTools', onboardingToken)
        await checkBrowserMcpEndpoint(serverUrl)
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

export const webResearchPlanner = createTool({
  name: 'webResearchPlanner',
  description:
    'Launch parallel research branches that search, crawl, validate, and save task-specific artifacts.',
  longDescription: `Use this for structured research where the work should branch by query.

Each search query becomes its own parallel research branch. Inside each branch, Taskyon first searches for likely sources and then validates or downloads the strongest candidates.

This tool is useful for research tasks that need saved outputs such as reports, spec sheets, datasets, images, PDFs, JSON, CSV, Markdown, or other task-specific files.

Taskyon first uses chatCompletion web search for discovery when enabled. In browser-mcp-first mode it ensures browser MCP tools before branching; websearch-first can opt into browser MCP by setting ensureBrowserMcp; websearch-only avoids browser MCP entirely. updateFiles supports local text artifacts in tycli, downloadFile supports verified local URL downloads in tycli, bash is a local fallback for unusual downloads, jinaMarkdownReader supports page validation, opfsStorage supports browser OPFS artifacts when explicitly enabled, and proxy/browser readers stay opt-in for blocked pages or direct fetches.`,
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
        maxItems: 4,
        items: { type: 'string' },
        description:
          'One query per research packet. Use 1-3 queries for normal reports or memos; use 4 only when the requested output truly needs distinct source families.',
      },
      artifactRoot: {
        type: 'string',
        description:
          'Optional relative output directory for all research artifacts. Defaults to research/<objective-slug>/. All delegated branches must use the same root.',
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
          'Additional explicit helper tools for each delegated branch. Defaults to updateFiles, downloadFile, bash, and jinaMarkdownReader so local save requests, verified local downloads, shell fallback, and page validation work in tycli/local runtimes; browser OPFS and browser/proxy fetchers stay opt-in.',
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
        default: true,
        description:
          'When true, delegated tasks should save requested source files or artifacts to the local filesystem or browser OPFS when tooling supports it, otherwise record the blocker next to the direct URL.',
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
  function: async (args, context) => {
    const browserTools = trimNonEmptyStrings(args.browserTools)
    if (shouldEnsureBrowserMcp(args)) {
      return context.createSubtasksResult([
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
    const delegatedChains = buildTaskPlannerTaskChains(
      taskGroups,
      await context.getExecutionTaskChain(),
      { includeReview: false },
    ).map((chain) => {
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
    })
    const researchWorkflow = [...delegatedChains.flat(), ...buildResearchSynthesisTaskChain(args)]

    return context.createSubtasksResult([
      [
        {
          role: 'assistant',
          content: {
            type: 'message',
            data: `Research Breakdown:\n${breakdown}`,
          },
        },
      ],
      researchWorkflow,
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

    const httpPolicy = parsePoliteHttpPolicy(args.httpPolicy)
    await waitForPoliteHttpTurn(targetUrl, httpPolicy)
    const requestUrl = buildProxyRequestUrlWithAuth(
      { ...resolvedArgs, serviceUrl, targetUrlParam: resolvedArgs.targetUrlParam },
      apiKey,
    )
    const response = await requestProxyText(
      requestUrl,
      buildProxyHeaders(resolvedArgs, apiKey),
      httpPolicy,
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
  proxyWebReader,
]
