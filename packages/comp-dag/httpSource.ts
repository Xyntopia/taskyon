/** Portable authored source; both hosts persist this exact code through the graph resolver. */
export const httpSourceDeclaration = `export default {
  formatVersion: 3,
  version: 1,
  effect: 'source',
  timeoutMs: 30000,
  localParamsSchema: {
    type: 'object', additionalProperties: false,
    properties: {
      url: { type: 'string', format: 'uri' },
      query: { type: 'object', additionalProperties: { type: 'string' }, default: {} },
    },
    required: ['url'],
  },
  outputSchema: {
    type: 'object', additionalProperties: false,
    description: 'Pinned HTTP response bytes and content type acquired through mediated GET.',
    properties: {
      url: { type: 'string' }, status: { type: 'integer' },
      contentType: { type: 'string' }, bodyBytes: { type: 'array', items: { type: 'integer', minimum: 0, maximum: 255 } },
    },
    required: ['url', 'status', 'contentType', 'bodyBytes'],
  },
  ids: { httpFetch: { inputs: {} } },
  run: async ({ params, services }) => {
    const query = Object.entries(params.query ?? {}).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([key, value]) => encodeURIComponent(key) + '=' + encodeURIComponent(value)).join('&')
    const base = params.url.replace(/#.*$/, '')
    const url = base + (query ? (base.includes('?') ? '&' : '?') + query : '')
    const response = await services.fetch(url, { method: 'GET' })
    if (!response.ok) throw new Error('HTTP source returned status ' + response.status)
    const bytes = new Uint8Array(await response.arrayBuffer())
    return { url, status: response.status, contentType: response.headers.get('content-type') ?? '', bodyBytes: Array.from(bytes) }
  },
}
`
