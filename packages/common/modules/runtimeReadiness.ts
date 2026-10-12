import { promiseTimeout } from '@vueuse/core'

/**
 * Wait for the Taskyon runtime to finish initializing.
 *
 * A failed initialization rejects immediately with its original error, so diagnostics report the
 * real cause instead of a generic readiness timeout. A runtime that is still not ready after
 * `timeoutMs` also rejects, so callers fail with the readiness problem instead of continuing
 * without a runtime and reporting unrelated downstream errors.
 */
export const awaitRuntimeReadiness = async (
  initialization: Promise<unknown>,
  timeoutMs = 30_000,
): Promise<void> => {
  const readinessTimeout = promiseTimeout(timeoutMs).then(() => {
    throw new Error(`Taskyon runtime was not ready within ${timeoutMs} ms`)
  })
  await Promise.race([readinessTimeout, initialization])
}
