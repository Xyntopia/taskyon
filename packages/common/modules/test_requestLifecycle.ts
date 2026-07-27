import { awaitRequestResponse, type RequestResult } from './requestLifecycle.ts'

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message)
}

const caughtError = async (promise: Promise<unknown>) => {
  try {
    await promise
  } catch (error) {
    if (error instanceof Error) return error
    throw new Error(`Expected an Error, received ${String(error)}`)
  }
  throw new Error('Expected the request to reject.')
}

const createRequestHarness = <T>() => {
  let receive: ((message: T) => void) | undefined
  let unsubscribeCount = 0
  return {
    subscribe: (listener: (message: T) => void) => {
      receive = listener
      return () => {
        unsubscribeCount++
        receive = undefined
      }
    },
    receive: (message: T) => receive?.(message),
    unsubscribeCount: () => unsubscribeCount,
  }
}

export const testRequestLifecycleSubscribesBeforeSending = async () => {
  const harness = createRequestHarness<number>()
  const result = await awaitRequestResponse({
    subscribe: harness.subscribe,
    sendRequest: () => harness.receive(42),
    readResponse: (value): RequestResult<number> => ({ ok: true, value }),
  })
  assert(result === 42, 'Expected a synchronous response emitted during send.')
  assert(harness.unsubscribeCount() === 1, 'Expected one subscription cleanup.')
  return { success: true }
}

export const testRequestLifecycleRejectsParserErrors = async () => {
  const harness = createRequestHarness<number>()
  const request = awaitRequestResponse({
    subscribe: harness.subscribe,
    sendRequest: () => harness.receive(42),
    readResponse: () => {
      throw new Error('Invalid response')
    },
  })
  const error = await caughtError(request)
  assert(error.message === 'Invalid response', 'Expected the parser error to reject the request.')
  assert(harness.unsubscribeCount() === 1, 'Expected cleanup after a parser error.')
  return { success: true }
}

export const testRequestLifecyclePreservesCancellationSendErrors = async () => {
  const controller = new AbortController()
  controller.abort('Stopped by caller')
  const error = await caughtError(
    awaitRequestResponse({
      subscribe: () => () => undefined,
      sendRequest: () => undefined,
      sendCancel: () => {
        throw new Error('Transport unavailable')
      },
      signal: controller.signal,
      readResponse: () => undefined,
    }),
  )
  assert(error.name === 'AbortError', 'Expected cancellation to remain an AbortError.')
  assert(error.message === 'Stopped by caller', 'Expected the original cancellation reason.')
  assert(error.cause instanceof Error, 'Expected the cancellation-send failure as the cause.')
  if (!(error.cause instanceof Error)) throw new Error('Expected an Error cause.')
  assert(error.cause.message === 'Transport unavailable', 'Expected the transport error details.')
  return { success: true }
}

export const testRequestLifecycleTimesOutAndCleansUp = async () => {
  const harness = createRequestHarness<number>()
  const error = await caughtError(
    awaitRequestResponse({
      subscribe: harness.subscribe,
      sendRequest: () => undefined,
      requestLabel: 'example.request-1',
      timeoutMs: 1,
      readResponse: () => undefined,
    }),
  )
  assert(error.name === 'TimeoutError', 'Expected an explicit timeout error.')
  assert(error.message.includes('example.request-1'), 'Expected the request label in the error.')
  assert(harness.unsubscribeCount() === 1, 'Expected cleanup after a timeout.')
  return { success: true }
}

testRequestLifecycleSubscribesBeforeSending.description =
  'Subscribes before sending so synchronous transports cannot lose a response.'
testRequestLifecycleRejectsParserErrors.description =
  'Rejects response parsing errors and cleans up the request subscription.'
testRequestLifecyclePreservesCancellationSendErrors.description =
  'Keeps cancellation errors explicit while retaining transport failures as their cause.'
testRequestLifecycleTimesOutAndCleansUp.description =
  'Rejects timed-out requests and releases their response subscription.'
