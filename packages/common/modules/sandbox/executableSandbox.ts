import { hydrateRemoteError } from '../remoteError.ts'
import type {
  SandboxExecuteOptions,
  SandboxHostToRuntimeMessage,
  SandboxRuntimeToHostMessage,
} from './workerSandboxTypes.ts'

type SandboxMessageTransport<TSend, TReceive> = {
  send(message: TSend): void
  subscribe(receive: (message: TReceive) => void): () => void
}

export type SandboxTransport = SandboxMessageTransport<
  SandboxHostToRuntimeMessage,
  SandboxRuntimeToHostMessage
> & {
  terminate(): void
}

export type SandboxChannel<TSend = unknown, TReceive = unknown> = SandboxMessageTransport<
  TSend,
  TReceive
> & {
  readonly channelId: string
  close(): void
}

export type ExecutableSandbox = {
  installModule(moduleId: string, source: string, sourceURL?: string): Promise<void>
  execute<R>(source: string, args: readonly unknown[], options?: SandboxExecuteOptions): Promise<R>
  /** Executes the function's source text. Captured closures are not transferred. */
  execFunc<TArgs extends unknown[], R>(
    fn: (...args: TArgs) => R,
    args: TArgs,
    options?: SandboxExecuteOptions,
  ): Promise<Awaited<R>>
  executeModule<R>(
    moduleId: string,
    args: readonly unknown[],
    options?: SandboxExecuteOptions,
  ): Promise<R>
  openChannel(
    installerSource: string,
    args?: readonly unknown[],
    options?: SandboxExecuteOptions,
  ): Promise<SandboxChannel>
  terminate(reason?: string): void
}

type PendingExecution = {
  resolve(value: unknown): void
  reject(error: Error): void
  cleanup(): void
  maxOutputBytes: number
}

let sandboxRequestCounter = 0
let sandboxChannelCounter = 0

const nextRequestId = () => `sandbox-${Date.now()}-${sandboxRequestCounter++}`
const safeSourceURL = (value: string) => value.replace(/[\\`\r\n]/g, '_')
const outputByteLength = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value) ?? '').byteLength

export function createExecutableSandboxClient(
  transport: SandboxTransport,
  options: {
    onDiagnostic?: (message: string, details?: unknown) => void
    onTerminate?: () => void
  } = {},
): ExecutableSandbox {
  const pending = new Map<string, PendingExecution>()
  const channels = new Map<string, Set<(message: unknown) => void>>()
  let terminated = false
  const diagnostic = options.onDiagnostic ?? ((message, details) => console.warn(message, details))
  const sendControl = (message: SandboxHostToRuntimeMessage) => transport.send(message)

  const finish = (requestId: string, result: { value: unknown } | { error: Error }) => {
    const entry = pending.get(requestId)
    if (!entry) {
      diagnostic('Ignoring a late or unknown sandbox response.', { requestId })
      return
    }
    pending.delete(requestId)
    entry.cleanup()
    if ('error' in result) entry.reject(result.error)
    else entry.resolve(result.value)
  }

  const unsubscribe = transport.subscribe((message) => {
    if (message.kind === 'channel-message') {
      channels.get(message.channelId)?.forEach((listener) => listener(message.payload))
      return
    }
    if (message.kind === 'channel-close') {
      channels.delete(message.channelId)
      return
    }
    if (message.kind === 'runtime-error') {
      const error = hydrateRemoteError(message.error)
      for (const requestId of [...pending.keys()]) finish(requestId, { error })
      terminate(error.message)
      return
    }
    if (message.kind === 'result') {
      const entry = pending.get(message.requestId)
      if (!entry) {
        diagnostic('Ignoring a late or unknown sandbox response.', {
          requestId: message.requestId,
        })
        return
      }
      let outputSize: number
      try {
        outputSize = outputByteLength(message.result)
      } catch (error) {
        const serializationError = new Error('Sandbox output could not be measured safely', {
          cause: error,
        })
        finish(message.requestId, { error: serializationError })
        terminate(serializationError.message)
        return
      }
      if (outputSize > entry.maxOutputBytes) {
        const outputError = new Error('Sandbox output exceeds the configured limit')
        finish(message.requestId, { error: outputError })
        terminate(outputError.message)
        return
      }
      finish(message.requestId, { value: message.result })
    } else if (message.kind === 'error') {
      finish(message.requestId, { error: hydrateRemoteError(message.error) })
    } else {
      const error = new Error(message.reason || 'Sandbox execution cancelled')
      error.name = 'AbortError'
      finish(message.requestId, { error })
    }
  })

  const request = <R>(
    createMessage: (requestId: string) => SandboxHostToRuntimeMessage,
    executeOptions: SandboxExecuteOptions,
  ): Promise<R> => {
    if (terminated) return Promise.reject(new Error('Sandbox has been terminated'))
    const requestId = nextRequestId()
    return new Promise<R>((resolve, reject) => {
      const abort = () => {
        const reason = String(executeOptions.signal?.reason ?? 'Execution interrupted')
        let error = new Error(reason)
        error.name = 'AbortError'
        try {
          sendControl({ kind: 'cancel', requestId, reason })
        } catch (sendError) {
          error = new Error(reason, { cause: sendError })
          error.name = 'AbortError'
        }
        finish(requestId, { error })
      }
      const timer = setTimeout(() => {
        const error = new Error('Sandbox execution timed out')
        finish(requestId, { error })
        terminate(error.message)
      }, executeOptions.maxExecutionMs ?? 60_000)
      pending.set(requestId, {
        resolve: (value) => resolve(value as R),
        reject,
        cleanup: () => {
          clearTimeout(timer)
          executeOptions.signal?.removeEventListener('abort', abort)
        },
        maxOutputBytes: executeOptions.maxOutputBytes ?? 2 * 1024 * 1024,
      })
      if (executeOptions.signal?.aborted) {
        abort()
        return
      }
      executeOptions.signal?.addEventListener('abort', abort, { once: true })
      try {
        transport.send(createMessage(requestId))
      } catch (error) {
        finish(requestId, {
          error: error instanceof Error ? error : new Error(String(error)),
        })
      }
    })
  }

  const execute = <R>(
    source: string,
    args: readonly unknown[],
    executeOptions: SandboxExecuteOptions = {},
  ) =>
    request<R>(
      (requestId) => ({
        kind: 'execute',
        requestId,
        code: source,
        args: [...args],
        sourceURL: safeSourceURL(executeOptions.sourceURL ?? 'worker-sandbox.js'),
        channelId: executeOptions.channel?.channelId,
      }),
      executeOptions,
    )

  const terminate = (reason = 'Sandbox terminated') => {
    if (terminated) return
    terminated = true
    try {
      unsubscribe()
    } catch (error) {
      diagnostic('Sandbox transport subscription could not be removed.', error)
    }
    try {
      transport.terminate()
    } catch (error) {
      diagnostic('Sandbox transport could not terminate cleanly.', error)
    }
    options.onTerminate?.()
    channels.clear()
    for (const requestId of [...pending.keys()]) {
      finish(requestId, { error: new SandboxTerminatedError(reason) })
    }
  }

  return {
    installModule: (moduleId, source, sourceURL = `${moduleId}.sandbox.js`) =>
      request<void>(
        (requestId) => ({
          kind: 'install',
          requestId,
          moduleId,
          code: source,
          sourceURL: safeSourceURL(sourceURL),
        }),
        {},
      ),
    execute,
    execFunc: (fn, args, executeOptions = {}) => execute(fn.toString(), args, executeOptions),
    executeModule: <R>(
      moduleId: string,
      args: readonly unknown[],
      executeOptions: SandboxExecuteOptions = {},
    ) =>
      request<R>(
        (requestId) => ({
          kind: 'execute',
          requestId,
          moduleId,
          args: [...args],
          sourceURL: safeSourceURL(executeOptions.sourceURL ?? `${moduleId}.sandbox.js`),
          channelId: executeOptions.channel?.channelId,
        }),
        executeOptions,
      ),
    openChannel: async (installerSource, args = [], executeOptions = {}) => {
      const channelId = `channel-${Date.now()}-${sandboxChannelCounter++}`
      const listeners = new Set<(message: unknown) => void>()
      channels.set(channelId, listeners)
      try {
        await request<void>(
          (requestId) => ({
            kind: 'open-channel',
            requestId,
            channelId,
            installerCode: installerSource,
            args: [...args],
            sourceURL: safeSourceURL(executeOptions.sourceURL ?? `${channelId}.sandbox.js`),
          }),
          executeOptions,
        )
      } catch (error) {
        channels.delete(channelId)
        throw error
      }
      return {
        channelId,
        send: (payload) => transport.send({ kind: 'channel-message', channelId, payload }),
        subscribe: (listener) => {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
        close: () => {
          if (!channels.delete(channelId)) return
          transport.send({ kind: 'channel-close', channelId })
        },
      }
    },
    terminate,
  }
}

export class SandboxTerminatedError extends Error {
  override name = 'SandboxTerminatedError'
}
