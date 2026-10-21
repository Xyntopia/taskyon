import type { JSONSchema7 } from 'json-schema'
import { z } from 'zod'
import type { FetchWithPolicy } from '@taskyon/common/modules/webFetching/mediatedFetch'
import { createTool } from '../types/toolApi'

export const WEB_SEARCH_SETUP_SECRET = 'webSearch provider setup'
export const WEB_SEARCH_PROVIDERS = [
  {
    id: 'tinyfish',
    label: 'TinyFish',
    pricing: 'Free · 30/min and 500/hour per account',
    keyUrl: 'https://agent.tinyfish.ai/api-keys',
  },
  {
    id: 'jina',
    label: 'Jina Search',
    pricing: 'Token-based · free starting credits',
    keyUrl: 'https://jina.ai/api-dashboard/key-manager',
  },
] as const

export type WebSearchProvider = (typeof WEB_SEARCH_PROVIDERS)[number]['id']

export const isWebSearchProvider = (value: string): value is WebSearchProvider =>
  WEB_SEARCH_PROVIDERS.some((provider) => provider.id === value)

export const webSearchKeyName = (provider: WebSearchProvider) => `webSearch ${provider} API key`

const SearchHit = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  snippet: z.string().optional(),
  url: z.string(),
})
const JinaResponse = z.object({ data: z.array(SearchHit) })
const TinyFishResponse = z.object({ results: z.array(SearchHit) })

const canonicalUrl = (input: string) => {
  try {
    const url = new URL(input.startsWith('http') ? input : `https://${input}`)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    if (url.username || url.password) return null
    return url.href
  } catch {
    return null
  }
}

const normalizeResults = (entries: z.infer<typeof SearchHit>[], limit: number) => {
  const seen = new Set<string>()
  return entries.flatMap((entry) => {
    const url = canonicalUrl(entry.url)
    if (!url || seen.has(url) || seen.size >= limit) return []
    seen.add(url)
    return [
      {
        title: entry.title ?? '',
        description: entry.snippet ?? entry.description ?? '',
        url,
      },
    ]
  })
}

export async function requestWebSearch(
  provider: WebSearchProvider,
  query: string,
  maxResults: number,
  apiKey: string,
  fetch: FetchWithPolicy,
) {
  const normalizedQuery = query.trim()
  if (!normalizedQuery) throw new Error('webSearch requires a non-empty query.')
  const limit = Math.min(Math.max(Math.trunc(maxResults), 1), 20)
  const tinyfish = provider === 'tinyfish'
  const url = tinyfish
    ? `https://api.search.tinyfish.ai/?query=${encodeURIComponent(normalizedQuery)}`
    : `https://s.jina.ai/?q=${encodeURIComponent(normalizedQuery)}`
  const response = await fetch(
    url,
    {
      method: 'GET',
      headers: tinyfish
        ? { Accept: 'application/json', 'X-API-Key': apiKey }
        : {
            Accept: 'application/json',
            Authorization: `Bearer ${apiKey}`,
            'X-Respond-With': 'no-content',
          },
    },
    { policy: 'direct' },
  )
  if (!response.ok) {
    if (response.status === 401 || response.status === 403)
      throw new Error(`${provider} rejected the API key (HTTP ${response.status}).`)
    if (response.status === 429)
      throw new Error(`${provider} rate limit exceeded (HTTP 429). Try again later.`)
    throw new Error(`${provider} search failed (HTTP ${response.status}).`)
  }
  const payload: unknown = await response.json()
  const entries = tinyfish
    ? TinyFishResponse.parse(payload).results
    : JinaResponse.parse(payload).data
  return {
    query: normalizedQuery,
    provider,
    retrievedAt: new Date().toISOString(),
    results: normalizeResults(entries, limit),
  }
}

export type WebSearchArgs = {
  query: string
  maxResults?: number
  provider?: WebSearchProvider
  bashFallback?: boolean
}

export const webSearch = createTool({
  name: 'webSearch',
  description:
    'Search live websites independently of the selected language model using a user-configured search provider.',
  longDescription: `Use this tool to discover source URLs and snippets when model-native search is unavailable or an explicit tool result is needed. On first use the browser asks the user to configure a search provider and their own API key. Supported providers: TinyFish (free) and Jina (token-based); results do not imply the pages were read. Use webReader to open sources. Requests use authorized direct-CORS host fetch, not the default WSS tunnel.

When bashFallback is enabled (CLI and Tauri hosts) and no provider key is configured, the tool returns guidance to use the bash tool instead of prompting for a provider. The model may then choose an authorized search service and command for that environment.`,
  parameters: {
    type: 'object',
    required: ['query'],
    additionalProperties: false,
    properties: {
      query: { type: 'string', description: 'The web search query.' },
      maxResults: {
        type: 'integer',
        minimum: 1,
        maximum: 20,
        default: 5,
        description: 'Maximum number of search results to return.',
      },
      provider: {
        type: 'string',
        enum: ['tinyfish', 'jina'],
        default: 'tinyfish',
        description: 'Preferred search provider; browser first-use setup can select another.',
      },
      bashFallback: {
        type: 'boolean',
        default: false,
        description:
          'When true and no provider key is configured, return guidance to use the bash tool instead of prompting for provider setup.',
      },
    },
  } as const satisfies JSONSchema7,
  function: async (
    { query, maxResults = 5, provider = 'tinyfish', bashFallback = false }: WebSearchArgs,
    context,
  ) => {
    if (!context.fetch) throw new Error('Mediated fetch is unavailable.')
    const normalizedQuery = query.trim()
    if (!normalizedQuery) throw new Error('webSearch requires a non-empty query.')
    let selectedProvider = provider
    let apiKey = await context.getSecret(webSearchKeyName(selectedProvider), false)
    if (!apiKey && selectedProvider === 'jina') {
      // Read the existing Jina-only fallback key without migrating unrelated secrets.
      apiKey = await context.getSecret('webSearch API key', false)
    }
    if (!apiKey && bashFallback) {
      return {
        query: normalizedQuery,
        status: 'fallback',
        message:
          'No web search provider is configured. Use the bash tool to perform this web search, then use webReader to read the selected result URLs. Choose an authorized search service and command that are appropriate for this environment. Do not call webSearch again for this request.',
      }
    }
    if (!apiKey) {
      const requestedProvider = await context.getSecret(
        WEB_SEARCH_SETUP_SECRET,
        'Choose a web search provider, open its registration page, and enter your API key.',
        false,
      )
      if (!requestedProvider || !isWebSearchProvider(requestedProvider)) {
        throw new Error('Web search provider setup was cancelled.')
      }
      selectedProvider = requestedProvider
      apiKey = await context.getSecret(webSearchKeyName(selectedProvider), false)
    }
    if (!apiKey) {
      const providerInfo = WEB_SEARCH_PROVIDERS.find((entry) => entry.id === selectedProvider)
      if (!providerInfo) throw new Error('Unsupported web search provider.')
      apiKey = await context.getSecret(
        webSearchKeyName(selectedProvider),
        `Enter your ${providerInfo.label} API key (register at ${providerInfo.keyUrl}).`,
        true,
      )
    }
    if (!apiKey) throw new Error(`No API key configured for ${selectedProvider} web search.`)
    return await requestWebSearch(selectedProvider, query, maxResults, apiKey, context.fetch)
  },
})
