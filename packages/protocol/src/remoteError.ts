export type SerializedRemoteError = {
  message: string
  name?: string | undefined
  stack?: string | undefined
}

export function serializeRemoteError(error: unknown): SerializedRemoteError {
  if (!(error instanceof Error)) return { message: String(error), name: 'Error' }
  return {
    message: error.message || 'Unknown error',
    name: error.name || 'Error',
    stack: typeof error.stack === 'string' ? error.stack : undefined,
  }
}

export function hydrateRemoteError(error: SerializedRemoteError): Error {
  const hydrated = new Error(error.message || 'Remote execution failed')
  if (error.name) hydrated.name = error.name
  if (error.stack) hydrated.stack = error.stack
  return hydrated
}
