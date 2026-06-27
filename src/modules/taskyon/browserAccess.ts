import type { JSONSchema7 } from 'json-schema'
import { proxyWebReaderProviderIds } from '@taskyon/shared/modules/webFetching'
import type { TaskNode } from '@taskyon/taskyon'

export type BrowserAccessActivity = {
  id: string
  taskId: string
  toolName: string
  kind: 'mcp' | 'proxy' | 'websearch' | 'research' | 'browser'
  status: 'running' | 'done'
  summary: string
  timestamp: number
  url?: string
  query?: string
  previewImageUrl?: string
}

export const browserAccessMcpDefaults = {
  serverUrl: 'http://127.0.0.1:8931/mcp',
  serverName: 'local-browser-mcp',
  toolNames: [] as string[],
}

export const browserAccessEnsureDefaults = {
  serverUrl: browserAccessMcpDefaults.serverUrl,
  serverName: browserAccessMcpDefaults.serverName,
  toolNames: [] as string[],
  startupInstructions: [
    'Start your browser MCP server manually so it exposes an HTTP MCP endpoint.',
    'This can be a local process or a container such as Podman, as long as it binds to the configured MCP URL.',
    'After the endpoint is reachable, click Continue in chat or retry import from this page.',
  ].join('\n'),
}

export const browserAccessResearchDefaults = {
  researchMode: 'websearch-first',
  supportTools: ['opfsStorage', 'jinaMarkdownReader'],
  maxSourcesPerQuery: 5,
  mustDownload: true,
  fileTypeHints: ['pdf'],
  deliverable:
    'task-specific saved artifacts with manufacturer, product name, source page URL, direct document URL, and saved OPFS path when available',
  enableWebSearch: true,
  webSearchMaxResults: 5,
}

export const browserAccessProxyDefaults = {
  providerPreset: 'scraperapi',
  providerLabel: 'ScraperAPI',
  docsUrl: 'https://docs.scraperapi.com/',
  pricingUrl: 'https://www.scraperapi.com/pricing/',
  serviceUrl: 'https://api.scraperapi.com/',
  apiKeySecretName: 'API_KEY',
  apiKeyHeader: '',
  apiKeyScheme: '',
  apiKeyLocation: 'query',
  apiKeyQueryParam: 'api_key',
  targetUrlParam: 'url',
}

export const browserAccessMcpSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    serverUrl: {
      type: 'string',
      description: 'HTTP MCP endpoint, for example http://127.0.0.1:8931/mcp.',
    },
    serverName: {
      type: 'string',
      description: 'Human label used for browser MCP imports.',
    },
    toolNames: {
      type: 'array',
      items: { type: 'string' },
      description: 'Optional subset of browser MCP tools to import. Leave empty to import all.',
    },
  },
  required: ['serverUrl'],
} as const satisfies JSONSchema7

export const browserAccessEnsureSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    serverUrl: {
      type: 'string',
      description: 'HTTP MCP endpoint, for example http://127.0.0.1:8931/mcp.',
    },
    serverName: {
      type: 'string',
      description: 'Human label used for browser MCP imports.',
    },
    toolNames: {
      type: 'array',
      items: { type: 'string' },
      description: 'Optional subset of browser MCP tools to import. Leave empty to import all.',
    },
    startupInstructions: {
      type: 'string',
      description:
        'Manual startup instructions shown in chat when the browser MCP endpoint is missing.',
    },
  },
  required: [],
} as const satisfies JSONSchema7

export const browserAccessResearchSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    researchMode: {
      type: 'string',
      enum: ['websearch-first', 'browser-mcp-first', 'websearch-only'],
      description:
        'Research mode. Start with chatCompletion web search, require browser MCP first, or avoid browser MCP entirely.',
    },
    supportTools: {
      type: 'array',
      items: { type: 'string' },
      description: 'Fallback helper tools for research branches.',
    },
    maxSourcesPerQuery: {
      type: 'integer',
      minimum: 1,
      description: 'Maximum number of candidate sources per query.',
    },
    mustDownload: {
      type: 'boolean',
      description:
        'Whether validated sources or generated artifacts should be saved when local or OPFS storage is available.',
    },
    fileTypeHints: {
      type: 'array',
      items: { type: 'string' },
      description: 'Preferred file types such as pdf or csv.',
    },
    deliverable: {
      type: 'string',
      description: 'Expected structured research output.',
    },
    enableWebSearch: {
      type: 'boolean',
      description: 'Enable chatCompletion web search for discovery in research branches.',
    },
    webSearchMaxResults: {
      type: 'integer',
      minimum: 1,
      description: 'Maximum number of chatCompletion web-search results per branch.',
    },
  },
  required: [],
} as const satisfies JSONSchema7

export const browserAccessProxySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    providerPreset: {
      type: 'string',
      enum: [...proxyWebReaderProviderIds],
      description: 'Selected proxy or unblocker preset.',
    },
    providerLabel: {
      type: 'string',
      description: 'Human label shown during onboarding and status reporting.',
    },
    docsUrl: {
      type: 'string',
      description: 'Provider documentation URL.',
    },
    pricingUrl: {
      type: 'string',
      description: 'Provider pricing URL.',
    },
    serviceUrl: {
      type: 'string',
      description: 'Base proxy or unblocker HTTP endpoint.',
    },
    apiKeySecretName: {
      type: 'string',
      description: 'Secret name requested from the local secret store.',
    },
    apiKeyHeader: {
      type: 'string',
      description: 'Header name used when the provider expects header auth.',
    },
    apiKeyScheme: {
      type: 'string',
      description: 'Optional auth scheme, for example Bearer.',
    },
    apiKeyLocation: {
      type: 'string',
      enum: ['header', 'query'],
      description: 'Whether the provider expects the API key in a header or query parameter.',
    },
    apiKeyQueryParam: {
      type: 'string',
      description: 'Query parameter used for query-based API key auth.',
    },
    targetUrlParam: {
      type: 'string',
      description: 'Query parameter that carries the final target URL.',
    },
  },
  required: [],
} as const satisfies JSONSchema7

const readRecord = (value: unknown) =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined

const readString = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined

const readStringList = (value: unknown) =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []

const looksLikeUrl = (value: string) => /^https?:\/\//i.test(value)

const extractActivityFromFunctionCall = (task: TaskNode): BrowserAccessActivity | undefined => {
  if (task.content.type !== 'functioncall') return undefined
  const args = readRecord(task.content.data.arguments) ?? {}
  const toolName = task.content.data.name
  const timestamp = task.created_at ?? Date.now()

  if (toolName === 'chatCompletion') {
    const websearch = readRecord(args.websearch)
    if (websearch?.enabled === true) {
      return {
        id: task.id,
        taskId: task.id,
        toolName,
        kind: 'websearch',
        status: 'running',
        summary: 'Running chatCompletion web search discovery.',
        timestamp,
      }
    }
    return undefined
  }

  if (toolName === 'webResearchPlanner') {
    const query = readStringList(args.searchQueries)[0]
    return {
      id: task.id,
      taskId: task.id,
      toolName,
      kind: 'research',
      status: 'running',
      summary: `Research objective: ${readString(args.objective) ?? 'research task'}`,
      timestamp,
      ...(query ? { query } : {}),
    }
  }

  if (toolName === 'proxyWebReader') {
    const url = readString(args.url)
    return {
      id: task.id,
      taskId: task.id,
      toolName,
      kind: 'proxy',
      status: 'running',
      summary: `Fetching via proxy${url ? `: ${url}` : ''}`,
      timestamp,
      ...(url ? { url } : {}),
    }
  }

  if (
    toolName === 'importBrowserMcpTools' ||
    toolName === 'ensureBrowserMcpTools' ||
    toolName === 'importMcpTools'
  ) {
    const serverUrl = readString(args.serverUrl)
    return {
      id: task.id,
      taskId: task.id,
      toolName,
      kind: 'mcp',
      status: 'running',
      summary: `Connecting to browser MCP at ${serverUrl ?? 'configured endpoint'}`,
      timestamp,
      ...(serverUrl ? { url: serverUrl } : {}),
    }
  }

  const url = readString(args.url) ?? readString(args.href)
  const query = readString(args.query) ?? readString(args.search)
  if (!url && !query) return undefined

  return {
    id: task.id,
    taskId: task.id,
    toolName,
    kind: 'browser',
    status: 'running',
    summary: url ? `Browser activity on ${url}` : `Browser search: ${query}`,
    timestamp,
    ...(url ? { url } : {}),
    ...(query ? { query } : {}),
  }
}

const extractActivityFromReturnTask = (task: TaskNode): BrowserAccessActivity | undefined => {
  const data = readRecord(task.content.data)
  if (!data) return undefined
  const timestamp = task.created_at ?? Date.now()
  const url =
    readString(data.targetUrl) ?? readString(data.requestUrl) ?? readString(data.serverUrl)
  const previewImageUrl = readString(data.previewImageUrl) ?? readString(data.screenshotDataUrl)

  if (typeof data.importedToolsCount === 'number' || typeof data.totalToolsOnServer === 'number') {
    const importedToolsCount =
      typeof data.importedToolsCount === 'number' ? data.importedToolsCount : 0
    return {
      id: task.id,
      taskId: task.id,
      toolName: 'importMcpTools',
      kind: 'mcp',
      status: 'done',
      summary: `Imported ${importedToolsCount} browser MCP tools.`,
      timestamp,
      ...(url ? { url } : {}),
    }
  }

  if (readString(data.provider) || readString(data.providerPreset)) {
    return {
      id: task.id,
      taskId: task.id,
      toolName: 'proxyWebReader',
      kind: 'proxy',
      status: 'done',
      summary: `Proxy fetch completed${url ? `: ${url}` : ''}`,
      timestamp,
      ...(url ? { url } : {}),
    }
  }

  if (previewImageUrl || (url && looksLikeUrl(url))) {
    return {
      id: task.id,
      taskId: task.id,
      toolName: 'browser',
      kind: 'browser',
      status: 'done',
      summary: url ? `Browser result: ${url}` : 'Browser activity completed.',
      timestamp,
      ...(url ? { url } : {}),
      ...(previewImageUrl ? { previewImageUrl } : {}),
    }
  }

  return undefined
}

export const extractBrowserAccessActivity = (task: TaskNode): BrowserAccessActivity | undefined => {
  if (task.content.type === 'functioncall') {
    return extractActivityFromFunctionCall(task)
  }
  if (
    task.content.type === 'return' ||
    task.content.type === 'structured' ||
    task.content.type === 'toolresult'
  ) {
    return extractActivityFromReturnTask(task)
  }
  return undefined
}
