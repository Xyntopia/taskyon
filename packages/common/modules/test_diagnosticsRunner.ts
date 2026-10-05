import {
  runDiagnosticsTests,
  selectDiagnosticsTestBatch,
  type TaskyonTestFn,
} from './diagnosticsRunner'

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

export const testDiagnosticsRunnerSelectsOrderedBatches = () => {
  const tests = {
    first: () => 'first',
    second: () => 'second',
    third: () => 'third',
  }
  const selected = selectDiagnosticsTestBatch(tests, 1, 1)
  const remaining = selectDiagnosticsTestBatch(tests, 2)

  assert(Object.keys(selected).join(',') === 'second', 'Expected the selected batch to keep order')
  assert(Object.keys(remaining).join(',') === 'third', 'Expected the final batch to be selectable')
  assert(
    Object.keys(tests).join(',') === 'first,second,third',
    'Expected source tests to remain intact',
  )
}

testDiagnosticsRunnerSelectsOrderedBatches.description =
  'Headless diagnostics batches preserve registry order without mutating the full test set.'

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

export const testDiagnosticsRunnerSignalsTimedOutTest = async () => {
  let signaled = false
  const slowTest: TaskyonTestFn = (context) => {
    context?.abortSignal?.addEventListener('abort', () => {
      signaled = true
    })
    return new Promise<void>(() => undefined)
  }
  slowTest.timeoutMs = 5

  const [result] = await runDiagnosticsTests({ slowTest })
  assert(result?.ok === false, 'Expected the slow diagnostic to time out')
  assert(signaled, 'Expected the timed-out test to receive cancellation')
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

export const testDiagnosticsRunnerPreparesOnlyTheSelectedTest = async () => {
  const prepared: string[] = []
  const [result] = await runDiagnosticsTests(
    { selected: (context) => context?.model, unselected: () => 'unselected' },
    {
      contextForTest: (name) => {
        prepared.push(name)
        return Promise.resolve({ model: 'prepared' })
      },
      shouldAbort: () => prepared.length > 0,
    },
  )
  assert(result?.ok === true, 'Expected the selected test to pass')
  assert(prepared.join(',') === 'selected', 'Preparation must only run for the selected test')
  return { success: true }
}

export const testDiagnosticsRunnerReportsPreparationFailureAndContinues = async () => {
  let nextRan = false
  const results = await runDiagnosticsTests(
    {
      broken: () => {
        throw new Error('Test should not run after preparation fails')
      },
      next: () => {
        nextRan = true
      },
    },
    {
      contextForTest: (name) => {
        if (name === 'broken') throw new Error('runtime unavailable')
        return {}
      },
    },
  )
  assert(results[0]?.ok === false, 'Expected preparation failure to belong to its test')
  assert(results[0]?.preparationFailed === true, 'Expected preparation failure to be identified')
  assert(results[1]?.ok === true && nextRan, 'Expected the next diagnostic to run')
  return { success: true }
}

export const testDiagnosticsRunnerBoundsPreparationByTestTimeout = async () => {
  const modelTest = (() => undefined) as TaskyonTestFn
  modelTest.modelBased = true
  modelTest.timeoutMs = 5
  const [result] = await runDiagnosticsTests(
    { modelTest },
    { contextForTest: () => new Promise<never>(() => undefined) },
  )
  assert(result?.ok === false, 'Expected preparation to time out')
  assert(result.preparationFailed === true, 'Expected timeout to be classified as preparation')
  return { success: true }
}

export const testDiagnosticsRunnerAwaitsResultHandlerBeforeNextTest = async () => {
  let resultHandled = false
  const results = await runDiagnosticsTests(
    {
      first: () => undefined,
      second: () => {
        assert(resultHandled, 'Expected result cleanup to finish before the next diagnostic')
      },
    },
    {
      onResult: async (result) => {
        if (result.name === 'first') {
          await new Promise<void>((resolve) => {
            setTimeout(() => {
              resultHandled = true
              resolve()
            }, 0)
          })
        }
      },
    },
  )

  assert(results.length === 2, 'Expected both diagnostics to complete')
  assert(
    results.every((result) => result.ok),
    'Expected async result cleanup to be awaited',
  )
  return { success: true }
}

export const testDiagnosticsRunnerAwaitsProgressHandlerBeforeNextTest = async () => {
  let releaseProgress!: () => void
  let secondTestStarted = false
  const progressGate = new Promise<void>((resolve) => {
    releaseProgress = resolve
  })
  const resultsPromise = runDiagnosticsTests(
    {
      first: () => undefined,
      second: () => {
        secondTestStarted = true
      },
    },
    {
      onProgress: async (progress) => {
        if (progress.phase === 'finish' && progress.test === 'first') {
          await progressGate
        }
      },
    },
  )

  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  const progressedBeforeCallbackFinished = secondTestStarted
  releaseProgress()
  const results = await resultsPromise

  assert(
    !progressedBeforeCallbackFinished,
    'Expected async progress delivery to finish before the next diagnostic',
  )
  assert(results.length === 2, 'Expected both diagnostics to complete')
  assert(
    results.every((result) => result.ok),
    'Expected async progress diagnostics to pass',
  )
  return { success: true }
}
