import type { ToolIdentity } from '@taskyon/taskyon'
import type {
  FetchCapability,
  SandboxFetchOptions,
} from '@taskyon/common/modules/webFetching/mediatedFetch'
import type { HostProviderNetwork } from './hostNetwork'

export type HostFetchContext =
  | ({ kind: 'provider' } & HostProviderNetwork)
  | { kind: 'tool'; options?: SandboxFetchOptions }

type HostFetchMessage =
  | {
      type: 'fetch'
      id: string
      context: HostFetchContext
      url: string
      method: string
      headers: [string, string][]
      body: ArrayBuffer | null
    }
  | {
      type: 'result'
      id: string
      status: number
      statusText: string
      headers: [string, string][]
      hasBody: boolean
    }
  | { type: 'pull'; id: string }
  | { type: 'chunk'; id: string; value: ArrayBuffer }
  | { type: 'end'; id: string }
  | { type: 'error'; id: string; message: string }
  | { type: 'cancel'; id: string }
  | { type: 'authorize'; id: string; tool: ToolIdentity; capability: FetchCapability }
  | { type: 'authorization'; id: string; allowed: boolean }

type PendingFetch = {
  kind: 'fetch'
  resolve: (response: Response) => void
  reject: (error: Error) => void
  signal: AbortSignal
  abortListener?: () => void
  responseReceived: boolean
  controller?: ReadableStreamDefaultController<Uint8Array>
  resolvePull?: () => void
}

type PendingAuthorization = {
  kind: 'authorization'
  resolve: (allowed: boolean) => void
  reject: (error: Error) => void
}

type PendingRequest = PendingFetch | PendingAuthorization

const abortError = () => new DOMException('The request was aborted.', 'AbortError')

export function createHostFetchRequester(port: MessagePort) {
  const pending = new Map<string, PendingRequest>()
  let stopped = false
  function cleanup(id: string, entry: PendingFetch) {
    pending.delete(id)
    if (entry.abortListener) entry.signal.removeEventListener('abort', entry.abortListener)
  }

  function onAbort(id: string, entry: PendingFetch) {
    try {
      port.postMessage({ type: 'cancel', id } satisfies HostFetchMessage)
    } catch {
      // The request still needs to reject locally if the worker has already closed the port.
    }
    cleanup(id, entry)
    const error = abortError()
    if (entry.responseReceived) entry.controller?.error(error)
    else entry.reject(error)
    entry.resolvePull?.()
  }

  const onMessage = (event: MessageEvent<HostFetchMessage>) => {
    const message = event.data
    const entry = pending.get(message.id)
    if (!entry) return
    if (message.type === 'error') {
      pending.delete(message.id)
      if (entry.kind === 'authorization') entry.reject(new Error(message.message))
      else if (entry.responseReceived) {
        cleanup(message.id, entry)
        entry.controller?.error(new Error(message.message))
        entry.resolvePull?.()
      } else {
        cleanup(message.id, entry)
        entry.reject(new Error(message.message))
      }
    } else if (message.type === 'authorization' && entry.kind === 'authorization') {
      pending.delete(message.id)
      entry.resolve(message.allowed)
    } else if (message.type === 'result' && entry.kind === 'fetch') {
      entry.responseReceived = true
      const body = message.hasBody
        ? new ReadableStream<Uint8Array>({
            start: (controller) => {
              entry.controller = controller
            },
            pull: async (controller) => {
              if (entry.signal.aborted) {
                controller.error(abortError())
                cleanup(message.id, entry)
                return
              }
              entry.controller = controller
              await new Promise<void>((resolve) => {
                entry.resolvePull = resolve
                try {
                  port.postMessage({ type: 'pull', id: message.id } satisfies HostFetchMessage)
                } catch (error) {
                  cleanup(message.id, entry)
                  controller.error(error)
                  resolve()
                }
              })
            },
            cancel: () => {
              try {
                port.postMessage({ type: 'cancel', id: message.id } satisfies HostFetchMessage)
              } finally {
                cleanup(message.id, entry)
                entry.resolvePull?.()
              }
            },
          })
        : null
      if (!message.hasBody) cleanup(message.id, entry)
      entry.resolve(
        new Response(body, {
          status: message.status,
          statusText: message.statusText,
          headers: message.headers,
        }),
      )
    } else if (entry.kind === 'fetch' && message.type === 'chunk') {
      entry.controller?.enqueue(new Uint8Array(message.value))
      entry.resolvePull?.()
      delete entry.resolvePull
    } else if (entry.kind === 'fetch' && message.type === 'end') {
      entry.controller?.close()
      cleanup(message.id, entry)
      entry.resolvePull?.()
      delete entry.resolvePull
    }
  }
  port.addEventListener('message', onMessage)
  port.start()

  return {
    fetch: async (context: HostFetchContext, input: RequestInfo | URL, init?: RequestInit) => {
      if (stopped) throw new Error('Host fetch bridge stopped.')
      const request = new Request(input, init)
      if (request.signal.aborted) throw abortError()
      const id = crypto.randomUUID()
      const body = request.body ? await request.arrayBuffer() : null
      if (request.signal.aborted) throw abortError()
      if (stopped) throw new Error('Host fetch bridge stopped.')
      const response = new Promise<Response>((resolve, reject) => {
        const entry: PendingFetch = {
          kind: 'fetch',
          resolve,
          reject,
          signal: request.signal,
          responseReceived: false,
        }
        entry.abortListener = () => onAbort(id, entry)
        pending.set(id, entry)
        request.signal.addEventListener('abort', entry.abortListener, { once: true })
        try {
          port.postMessage(
            {
              type: 'fetch',
              id,
              context,
              url: request.url,
              method: request.method,
              headers: [...request.headers],
              body,
            } satisfies HostFetchMessage,
            body ? [body] : [],
          )
        } catch (error) {
          cleanup(id, entry)
          reject(error instanceof Error ? error : new Error(String(error)))
        }
      })
      return await response
    },
    authorize: (tool: ToolIdentity, capability: FetchCapability) => {
      if (stopped) return Promise.reject(new Error('Host fetch bridge stopped.'))
      const id = crypto.randomUUID()
      const response = new Promise<boolean>((resolve, reject) => {
        pending.set(id, { kind: 'authorization', resolve, reject })
      })
      port.postMessage({ type: 'authorize', id, tool, capability } satisfies HostFetchMessage)
      return response
    },
    stop: () => {
      stopped = true
      port.removeEventListener('message', onMessage)
      for (const [id, entry] of pending) {
        if (entry.kind === 'authorization') entry.reject(new Error('Host fetch bridge stopped.'))
        else onAbort(id, entry)
      }
      pending.clear()
    },
  }
}

export function startHostFetchResponder(
  port: MessagePort,
  handlers: {
    fetch: (context: HostFetchContext, request: Request) => Promise<Response>
    authorize: (tool: ToolIdentity, capability: FetchCapability) => Promise<boolean>
  },
) {
  const activeFetches = new Map<
    string,
    {
      controller: AbortController
      reader?: ReadableStreamDefaultReader<Uint8Array>
      reading: boolean
    }
  >()
  const onMessage = (event: MessageEvent<HostFetchMessage>) => {
    const message = event.data
    if (message.type === 'cancel') {
      const active = activeFetches.get(message.id)
      activeFetches.delete(message.id)
      active?.controller.abort()
      void active?.reader?.cancel().catch(() => undefined)
      return
    }
    if (message.type === 'pull') {
      const active = activeFetches.get(message.id)
      if (!active?.reader || active.reading) return
      active.reading = true
      void active.reader
        .read()
        .then((chunk) => {
          if (activeFetches.get(message.id) !== active) return
          active.reading = false
          if (chunk.done) {
            activeFetches.delete(message.id)
            active.reader?.releaseLock()
            port.postMessage({ type: 'end', id: message.id } satisfies HostFetchMessage)
            return
          }
          const value = new Uint8Array(chunk.value)
          port.postMessage(
            { type: 'chunk', id: message.id, value: value.buffer } satisfies HostFetchMessage,
            [value.buffer],
          )
        })
        .catch((error: unknown) => {
          if (activeFetches.get(message.id) !== active) return
          activeFetches.delete(message.id)
          active.reader?.releaseLock()
          port.postMessage({
            type: 'error',
            id: message.id,
            message: String(error),
          } satisfies HostFetchMessage)
        })
      return
    }
    if (message.type === 'authorize') {
      void handlers.authorize(message.tool, message.capability).then(
        (allowed) =>
          port.postMessage({
            type: 'authorization',
            id: message.id,
            allowed,
          } satisfies HostFetchMessage),
        (error: unknown) =>
          port.postMessage({
            type: 'error',
            id: message.id,
            message: String(error),
          } satisfies HostFetchMessage),
      )
      return
    }
    if (message.type !== 'fetch') return
    const controller = new AbortController()
    const active: {
      controller: AbortController
      reader?: ReadableStreamDefaultReader<Uint8Array>
      reading: boolean
    } = { controller, reading: false }
    activeFetches.set(message.id, active)
    void (async () => {
      try {
        const request = new Request(message.url, {
          method: message.method,
          headers: message.headers,
          ...(message.body ? { body: message.body } : {}),
          signal: controller.signal,
        })
        const response = await handlers.fetch(message.context, request)
        if (controller.signal.aborted) {
          await response.body?.cancel()
          return
        }
        const reader = response.body?.getReader()
        if (reader) active.reader = reader
        else activeFetches.delete(message.id)
        port.postMessage({
          type: 'result',
          id: message.id,
          status: response.status,
          statusText: response.statusText,
          headers: [...response.headers],
          hasBody: reader !== undefined,
        } satisfies HostFetchMessage)
      } catch (error) {
        activeFetches.delete(message.id)
        if (!controller.signal.aborted) {
          port.postMessage({
            type: 'error',
            id: message.id,
            message: error instanceof Error ? error.message : String(error),
          } satisfies HostFetchMessage)
        }
      }
    })()
  }
  port.addEventListener('message', onMessage)
  port.start()
  return () => {
    port.removeEventListener('message', onMessage)
    for (const active of activeFetches.values()) {
      active.controller.abort()
      void active.reader?.cancel().catch(() => undefined)
    }
    activeFetches.clear()
  }
}
