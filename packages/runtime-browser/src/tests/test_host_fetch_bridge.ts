import { createHostFetchRequester, startHostFetchResponder } from '../hostFetchBridge'

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

export const testHostFetchBridgeStreamsProviderResponse = async () => {
  const channel = new MessageChannel()
  let receivedMethod = ''
  let receivedBody = ''
  const stop = startHostFetchResponder(channel.port1, {
    fetch: async (_context, request) => {
      receivedMethod = request.method
      receivedBody = await request.text()
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('first'))
            controller.enqueue(new TextEncoder().encode('second'))
            controller.close()
          },
        }),
        { headers: { 'content-type': 'text/event-stream' } },
      )
    },
    authorize: () => Promise.resolve(true),
  })
  const requester = createHostFetchRequester(channel.port2)
  try {
    const response = await requester.fetch(
      { kind: 'provider', providerId: 'synthetic', recommendation: 'direct' },
      'https://provider.example/chat',
      { method: 'POST', body: 'synthetic-request' },
    )
    assert(receivedMethod === 'POST', 'Host must receive the request method')
    assert(receivedBody === 'synthetic-request', 'Host must receive the request body')
    assert(
      response.headers.get('content-type') === 'text/event-stream',
      'Host must preserve headers',
    )
    assert(
      (await response.text()) === 'firstsecond',
      'Response body must stream back to the worker',
    )
    return { success: true }
  } finally {
    requester.stop()
    stop()
    channel.port1.close()
    channel.port2.close()
  }
}

export const testHostFetchBridgeAbortsStreamingRequest = async () => {
  const channel = new MessageChannel()
  let aborted = false
  const stop = startHostFetchResponder(channel.port1, {
    fetch: (_context, request) => {
      request.signal.addEventListener(
        'abort',
        () => {
          aborted = true
        },
        { once: true },
      )
      return Promise.resolve(
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('first'))
            },
          }),
        ),
      )
    },
    authorize: () => Promise.resolve(true),
  })
  const requester = createHostFetchRequester(channel.port2)
  try {
    const controller = new AbortController()
    const response = await requester.fetch(
      { kind: 'provider', providerId: 'synthetic', recommendation: 'direct' },
      'https://provider.example/stream',
      { signal: controller.signal },
    )
    const reader = response.body?.getReader()
    assert(reader !== undefined, 'Expected a response stream')
    await reader.read()
    controller.abort()
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert(aborted, 'Aborting after response headers must reach the host request')
    return { success: true }
  } finally {
    requester.stop()
    stop()
    channel.port1.close()
    channel.port2.close()
  }
}

export const testHostFetchBridgeChecksToolCapability = async () => {
  const channel = new MessageChannel()
  let checkedOrigin = ''
  const stop = startHostFetchResponder(channel.port1, {
    fetch: () => Promise.resolve(new Response('ok')),
    authorize: (_tool, capability) => {
      checkedOrigin = capability.origin
      return Promise.resolve(capability.preferProxy === true)
    },
  })
  const requester = createHostFetchRequester(channel.port2)
  try {
    const allowed = await requester.authorize(
      { publisherId: 'synthetic', name: 'reader', revision: 'sha256:synthetic' },
      { action: 'fetch', origin: 'https://example.com', access: 'read', preferProxy: true },
    )
    if (!allowed || checkedOrigin !== 'https://example.com') {
      throw new Error('Worker tool authorization must reach the host with the proxy recommendation')
    }
    return { success: true }
  } finally {
    requester.stop()
    stop()
    channel.port1.close()
    channel.port2.close()
  }
}
