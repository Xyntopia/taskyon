import {
  createCustomProxyFetch,
  createHostNetwork,
  resolveHostTransport,
  resolveToolHostTransport,
} from '../hostNetwork'

export const testPrivateToolTargetAlwaysUsesDirectHostFetch = () => {
  for (const configured of ['wss', 'custom-proxy', 'cors-proxy', 'direct'] as const) {
    const selected = resolveToolHostTransport({
      request: new Request('http://127.0.0.1:4321/mcp'),
      configured,
      policy: 'proxy',
      preferProxy: true,
      customProxyTemplate: 'https://proxy.example/?url={url}',
    })
    assert(selected === 'direct', 'Private targets must always use direct host fetch')
  }
  return { success: true }
}

export const testConfiguredCorsProxyRoutesPublicToolRequests = () => {
  const selected = resolveToolHostTransport({
    request: new Request('https://example.com/page'),
    configured: 'cors-proxy',
    policy: 'proxy',
  })
  assert(selected === 'cors-proxy', 'A configured CORS proxy must route public tool requests')

  const direct = resolveToolHostTransport({
    request: new Request('https://example.com/page'),
    configured: 'cors-proxy',
    policy: 'direct',
  })
  assert(direct === 'direct', 'An explicit direct policy must override the CORS proxy')
  return { success: true }
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

export const testHostNetworkPromptsOncePerProvider = async () => {
  let saved: 'auto' | 'direct' | 'wss' | 'custom-proxy' | undefined
  let prompts = 0
  let directCalls = 0
  let wssCalls = 0
  const network = createHostNetwork({
    directFetch: async () => {
      directCalls += 1
      return new Response('direct')
    },
    getWssFetch: () => async () => {
      wssCalls += 1
      return new Response('wss')
    },
    getAppProxyTemplate: () => undefined,
    getProviderProxyTemplate: () => undefined,
    getProviderSelection: () => saved,
    chooseProviderSelection: async () => {
      prompts += 1
      saved = 'auto'
      return saved
    },
  })
  const providerFetch = network.providerFetch({ providerId: 'codex', recommendation: 'wss' })
  const [first, second] = await Promise.all([
    providerFetch('https://provider.example/one'),
    providerFetch('https://provider.example/two'),
  ])
  assert(
    (await first.text()) === 'wss' && (await second.text()) === 'wss',
    'Codex recommendation must route through WSS',
  )
  assert(prompts === 1, 'Concurrent first requests must share one provider prompt')
  await providerFetch('https://provider.example/three')
  assert(
    prompts === 1 && directCalls === 0 && wssCalls === 3,
    'Saved provider choice must be reused',
  )
  return { success: true }
}

export const testHostTransportUsesSavedChoiceAndGlobalProxy = () => {
  assert(
    resolveHostTransport({ recommendation: 'wss', selection: 'auto' }) === 'wss',
    'Auto should use the provider recommendation without an app proxy',
  )
  assert(
    resolveHostTransport({
      recommendation: 'wss',
      selection: 'auto',
      appProxyTemplate: 'https://proxy.example/?url={url}',
    }) === 'custom-proxy',
    'Auto should use an app-wide custom proxy for every provider',
  )
  assert(
    resolveHostTransport({
      recommendation: 'wss',
      selection: 'direct',
      appProxyTemplate: 'https://proxy.example/?url={url}',
    }) === 'direct',
    'A provider choice should override the app-wide proxy',
  )
  return { success: true }
}

export const testCustomProxyPreservesProviderRequestAndStream = async () => {
  let forwarded: Request | undefined
  const fetchImpl: typeof fetch = async (input, init) => {
    forwarded = new Request(input, init)
    return new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: first\n\n'))
          controller.enqueue(new TextEncoder().encode('data: second\n\n'))
          controller.close()
        },
      }),
      { headers: { 'content-type': 'text/event-stream' } },
    )
  }
  const proxyFetch = createCustomProxyFetch('https://proxy.example/fetch?target={url}', fetchImpl)
  const response = await proxyFetch('https://provider.example/v1/chat', {
    method: 'POST',
    headers: { Authorization: 'Bearer synthetic-token' },
    body: 'synthetic-body',
  })
  assert(
    forwarded?.url.includes('https%3A%2F%2Fprovider.example%2Fv1%2Fchat') === true,
    'The proxy URL must encode the original destination',
  )
  assert(forwarded.method === 'POST', 'The proxy must preserve the method')
  assert(
    forwarded.headers.get('authorization') === 'Bearer synthetic-token',
    'The proxy must preserve the provider credential',
  )
  assert((await forwarded.text()) === 'synthetic-body', 'The proxy must preserve the body')
  assert(response.body !== null, 'The response must retain its stream')
  assert(
    (await response.text()).includes('data: second'),
    'The response stream must remain readable',
  )
  return { success: true }
}
