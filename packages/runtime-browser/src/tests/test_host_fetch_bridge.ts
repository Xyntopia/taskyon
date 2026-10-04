import { createHostFetchRequester, startHostFetchResponder } from '../hostFetchBridge'

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

export const testHostFetchBridgeStreamsProviderResponse = async () => {
  const channel = new MessageChannel()
  let receivedMethod = ''
  let receivedBody = ''
  let finishBody = () => {}
  const stop = startHostFetchResponder(channel.port1, {
    fetch: async (_context, request) => {
      receivedMethod = request.method
      receivedBody = await request.text()
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('first'))
            finishBody = () => {
              controller.enqueue(new TextEncoder().encode('second'))
              controller.close()
            }
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
    const reader = response.body!.getReader()
    try {
      const first = await reader.read()
      assert(
        new TextDecoder().decode(first.value) === 'first',
        'First chunk must arrive before the host finishes',
      )
      finishBody()
      const second = await reader.read()
      assert(
        new TextDecoder().decode(second.value) === 'second',
        'Second chunk must remain a separate streamed read',
      )
      assert((await reader.read()).done, 'Host completion must close the response stream')
    } finally {
      reader.releaseLock()
    }
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
  let resolveHostAbort: () => void = () => {}
  const hostAbort = new Promise<void>((resolve) => {
    resolveHostAbort = resolve
  })
  const stop = startHostFetchResponder(channel.port1, {
    fetch: (_context, request) => {
      request.signal.addEventListener(
        'abort',
        () => {
          aborted = true
          resolveHostAbort()
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
    await hostAbort
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

export const testHostFetchBridgeStopCancelsHostRequest = async () => {
  for (const receiveHeaders of [false, true]) {
    const channel = new MessageChannel()
    let started!: () => void
    let aborted!: () => void
    const hostStarted = new Promise<void>((resolve) => {
      started = resolve
    })
    const hostAborted = new Promise<void>((resolve) => {
      aborted = resolve
    })
    const stop = startHostFetchResponder(channel.port1, {
      fetch: (_context, request) => {
        request.signal.addEventListener('abort', aborted, { once: true })
        started()
        return receiveHeaders
          ? Promise.resolve(new Response(new ReadableStream<Uint8Array>()))
          : new Promise<Response>((_resolve, reject) => {
              request.signal.addEventListener('abort', () => reject(new Error('Aborted')), {
                once: true,
              })
            })
      },
      authorize: () => Promise.resolve(true),
    })
    const requester = createHostFetchRequester(channel.port2)
    try {
      const response = requester.fetch({ kind: 'tool' }, 'https://synthetic.example/stream')
      const settled = receiveHeaders
        ? (await response)
            .body!.getReader()
            .read()
            .then(
              () => false,
              () => true,
            )
        : response.then(
            () => false,
            () => true,
          )
      await hostStarted
      requester.stop()
      assert(await settled, 'Stopping must reject the pending fetch or body read')
      await hostAborted
      await requester.fetch({ kind: 'tool' }, 'https://synthetic.example/closed').then(
        () => {
          throw new Error('A stopped requester must reject new work')
        },
        () => undefined,
      )
    } finally {
      requester.stop()
      stop()
      channel.port1.close()
      channel.port2.close()
    }
  }
  return { success: true }
}
