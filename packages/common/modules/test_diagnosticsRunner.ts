import { runDiagnosticsTests, type TaskyonTestFn } from './diagnosticsRunner'

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

export const testDiagnosticsRunnerStartsTimeoutBeforeInvokingTest = async () => {
  const slowTest = (() => new Promise((resolve) => setTimeout(resolve, 25))) as TaskyonTestFn
  slowTest.timeoutMs = 5

  const [result] = await runDiagnosticsTests({ slowTest })
  assert(result !== undefined, 'Expected a result for the slow diagnostic')
  assert(result.ok === false, 'Expected the slow diagnostic to time out')
  assert(
    typeof result.error === 'object' &&
      result.error !== null &&
      'message' in result.error &&
      typeof result.error.message === 'string' &&
      result.error.message.includes('Test timed out after 5ms'),
    'Expected the timeout error to include the configured limit',
  )
  return { success: true }
}

export const testDiagnosticsRunnerSkipsLongRunWithoutPermission = async () => {
  const longTest = (() => {
    throw new Error('Long-running diagnostic should not start')
  }) as TaskyonTestFn
  longTest.requiresLongRun = true

  const [result] = await runDiagnosticsTests({ longTest })
  assert(result !== undefined, 'Expected a result for the long-running diagnostic')
  assert(result.ok === true, 'Expected the long-running diagnostic to be skipped')
  assert(
    typeof result.details === 'object' &&
      result.details !== null &&
      'skipped' in result.details &&
      result.details.skipped === true,
    'Expected the skip result to identify a long-running diagnostic',
  )
  return { success: true }
}
