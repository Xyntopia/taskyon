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
      body: ReadableStream<Uint8Array> | null
    }
  | { type: 'error'; id: string; message: string }
  | { type: 'cancel'; id: string }
  | { type: 'authorize'; id: string; tool: ToolIdentity; capability: FetchCapability }
  | { type: 'authorization'; id: string; allowed: boolean }

export function createHostFetchRequester(port: MessagePort) {
  const pending = new Map<
    string,
    { resolve: (value: Response | boolean) => void; reject: (error: Error) => void }
  >()
  const onMessage = (event: MessageEvent<HostFetchMessage>) => {
    const message = event.data
    const entry = pending.get(message.id)
    if (!entry) return
    if (message.type === 'error') {
      pending.delete(message.id)
      entry.reject(new Error(message.message))
    } else if (message.type === 'authorization') {
      pending.delete(message.id)
      entry.resolve(message.allowed)
    } else if (message.type === 'result') {
      pending.delete(message.id)
      entry.resolve(
        new Response(message.body, {
          status: message.status,
          statusText: message.statusText,
          headers: message.headers,
        }),
      )
    }
  }
  port.addEventListener('message', onMessage)
  port.start()

  return {
    fetch: async (context: HostFetchContext, input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init)
      if (request.signal.aborted) throw new DOMException('The request was aborted.', 'AbortError')
      const id = crypto.randomUUID()
      const body = request.body ? await request.arrayBuffer() : null
      const response = new Promise<Response>((resolve, reject) => {
        pending.set(id, { resolve: (value) => resolve(value as Response), reject })
      })
      const onAbort = () => port.postMessage({ type: 'cancel', id } satisfies HostFetchMessage)
      request.signal.addEventListener('abort', onAbort, { once: true })
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
      let result: Response
      try {
        result = await response
      } catch (error) {
        request.signal.removeEventListener('abort', onAbort)
        throw error
      }
      if (!result.body) {
        request.signal.removeEventListener('abort', onAbort)
        return result
      }
      const reader = result.body.getReader()
      const bodyStream = new ReadableStream<Uint8Array>({
        pull: async (controller) => {
          try {
            const chunk = await reader.read()
            if (chunk.done) {
              request.signal.removeEventListener('abort', onAbort)
              controller.close()
            } else {
              controller.enqueue(chunk.value)
            }
          } catch (error) {
            request.signal.removeEventListener('abort', onAbort)
            controller.error(error)
          }
        },
        cancel: async (reason) => {
          onAbort()
          request.signal.removeEventListener('abort', onAbort)
          await reader.cancel(reason)
        },
      })
      return new Response(bodyStream, {
        status: result.status,
        statusText: result.statusText,
        headers: result.headers,
      })
    },
    authorize: (tool: ToolIdentity, capability: FetchCapability) => {
      const id = crypto.randomUUID()
      const response = new Promise<boolean>((resolve, reject) => {
        pending.set(id, { resolve: (value) => resolve(value as boolean), reject })
      })
      port.postMessage({ type: 'authorize', id, tool, capability } satisfies HostFetchMessage)
      return response
    },
    stop: () => {
      port.removeEventListener('message', onMessage)
      for (const entry of pending.values()) entry.reject(new Error('Host fetch bridge stopped.'))
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
  const controllers = new Map<string, AbortController>()
  const onMessage = (event: MessageEvent<HostFetchMessage>) => {
    const message = event.data
    if (message.type === 'cancel') {
      controllers.get(message.id)?.abort()
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
    controllers.set(message.id, controller)
    void (async () => {
      try {
        const request = new Request(message.url, {
          method: message.method,
          headers: message.headers,
          ...(message.body ? { body: message.body } : {}),
          signal: controller.signal,
        })
        const response = await handlers.fetch(message.context, request)
        const reader = response.body?.getReader()
        const body = reader
          ? new ReadableStream<Uint8Array>({
              pull: async (streamController) => {
                try {
                  const chunk = await reader.read()
                  if (chunk.done) {
                    controllers.delete(message.id)
                    streamController.close()
                  } else {
                    streamController.enqueue(chunk.value)
                  }
                } catch (error) {
                  controllers.delete(message.id)
                  streamController.error(error)
                }
              },
              cancel: async (reason) => {
                controller.abort()
                controllers.delete(message.id)
                await reader.cancel(reason)
              },
            })
          : null
        port.postMessage(
          {
            type: 'result',
            id: message.id,
            status: response.status,
            statusText: response.statusText,
            headers: [...response.headers],
            body,
          } satisfies HostFetchMessage,
          body ? [body] : [],
        )
        if (!body) controllers.delete(message.id)
      } catch (error) {
        controllers.delete(message.id)
        port.postMessage({
          type: 'error',
          id: message.id,
          message: error instanceof Error ? error.message : String(error),
        } satisfies HostFetchMessage)
      }
    })()
  }
  port.addEventListener('message', onMessage)
  port.start()
  return () => {
    port.removeEventListener('message', onMessage)
    for (const controller of controllers.values()) controller.abort()
    controllers.clear()
  }
}
