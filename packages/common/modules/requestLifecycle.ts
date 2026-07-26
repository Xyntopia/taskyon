export type RequestUnsubscribe = () => void

export type RequestResult<T> = { ok: true; value: T } | { ok: false; error: Error }

const normalizeError = (error: unknown) =>
  error instanceof Error ? error : new Error(String(error))

const errorWithCause = (error: Error, cause: unknown) => {
  const combined = new Error(error.message, { cause })
  combined.name = error.name
  if (error.stack !== undefined) combined.stack = error.stack
  return combined
}

const interruptionError = (name: 'AbortError' | 'TimeoutError', message: string) => {
  const error = new Error(message)
  error.name = name
  return error
}

export function awaitRequestResponse<TReceive, TResult>(options: {
  subscribe(receive: (message: TReceive) => void): RequestUnsubscribe
  sendRequest(): void
  sendCancel?: ((reason: string) => void) | undefined
  timeoutMs?: number | undefined
  signal?: AbortSignal | undefined
  readResponse(message: TReceive): RequestResult<TResult> | undefined
}): Promise<TResult> {
  return new Promise<TResult>((resolve, reject) => {
    let finished = false
    let timeout: ReturnType<typeof setTimeout> | undefined
    let unsubscribe: RequestUnsubscribe = () => undefined

    const cleanup = (): Error | undefined => {
      if (timeout !== undefined) clearTimeout(timeout)
      options.signal?.removeEventListener('abort', abort)
      try {
        unsubscribe()
      } catch (error) {
        return normalizeError(error)
      }
      return undefined
    }
    const finish = (result: RequestResult<TResult>) => {
      if (finished) return
      finished = true
      const cleanupError = cleanup()
      if (result.ok) {
        if (cleanupError) reject(cleanupError)
        else resolve(result.value)
        return
      }
      reject(cleanupError ? errorWithCause(result.error, cleanupError) : result.error)
    }
    const cancel = (error: Error) => {
      try {
        options.sendCancel?.(error.message)
        finish({ ok: false, error })
      } catch (sendError) {
        finish({ ok: false, error: errorWithCause(error, sendError) })
      }
    }
    const abort = () => {
      const reason =
        options.signal?.reason instanceof Error
          ? options.signal.reason.message
          : String(options.signal?.reason ?? 'Request aborted')
      cancel(interruptionError('AbortError', reason))
    }

    if (options.signal?.aborted) {
      abort()
      return
    }
    try {
      unsubscribe = options.subscribe((message) => {
        try {
          const result = options.readResponse(message)
          if (result) finish(result)
        } catch (error) {
          finish({ ok: false, error: normalizeError(error) })
        }
      })
      options.signal?.addEventListener('abort', abort, { once: true })
      if (options.timeoutMs !== undefined) {
        timeout = setTimeout(
          () =>
            cancel(
              interruptionError('TimeoutError', `Request timed out after ${options.timeoutMs}ms`),
            ),
          options.timeoutMs,
        )
      }
      options.sendRequest()
    } catch (error) {
      finish({ ok: false, error: normalizeError(error) })
    }
  })
}
