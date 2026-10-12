import { awaitRuntimeReadiness } from './runtimeReadiness'

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

export const testRuntimeReadinessSurfacesInitializationFailure = async () => {
  const failure = new Error('Unavailable')
  const failureResult = await awaitRuntimeReadiness(Promise.reject(failure), 50).then(
    () => ({ rejected: false as const }),
    (error: unknown) => ({ rejected: true as const, error }),
  )
  assert(failureResult.rejected, 'Expected an initialization failure to reject the readiness wait')
  assert(failureResult.error === failure, 'Expected the original initialization error')

  const completion = await awaitRuntimeReadiness(Promise.resolve('ready'), 3_000).then(
    () => 'resolved' as const,
    () => 'rejected' as const,
  )
  assert(completion === 'resolved', 'Expected completed initialization to resolve the wait')

  const timeoutResult = await awaitRuntimeReadiness(new Promise<never>(() => {}), 20).then(
    () => ({ rejected: false as const }),
    (error: unknown) => ({ rejected: true as const, error }),
  )
  assert(timeoutResult.rejected, 'Expected a runtime that never becomes ready to fail its wait')
  assert(
    timeoutResult.error instanceof Error && timeoutResult.error.message.includes('20 ms'),
    'Expected the readiness timeout to name its own limit',
  )
}

testRuntimeReadinessSurfacesInitializationFailure.description =
  'Diagnostic preparation reports a Taskyon runtime initialization failure immediately and fails a runtime that never becomes ready instead of continuing without one.'
