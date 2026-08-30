import type { DiagnosticsTestContext } from '@taskyon/common/modules/diagnosticsRunner'
import { testEntryNodeWebsearchProducesHostedSearchUsage } from './test_entry_node_websearch'
import {
  testCatalogSearchThenUsesDiscoveredTool,
  testSimpleGreetingConversationUsesNormalTaskyonFlow,
  testSimplePinnedToolConversationUsesNormalTaskyonFlow,
  testWebSearchThenToolUsesSearchedValue,
} from './test_time_question_conversation'

type IdealWorkflowCase = {
  name: string
  run: (context: DiagnosticsTestContext | undefined, model: string) => Promise<unknown>
}

type IdealWorkflowResult = {
  name: string
  model: string
  ok: boolean
  details?: unknown
  error?: string
}

const MATRIX_MODELS = ['openai/gpt-5.6-luna', 'z-ai/glm-5.3-flash'] as const
const MATRIX_CASE_TIMEOUT_MS = 90_000
const MATRIX_TIMEOUT_MS = 300_000

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : typeof error === 'string' ? error : String(error)

export const runIdealWorkflowMatrixCases = async (
  context: DiagnosticsTestContext,
  models: readonly string[],
  cases: readonly IdealWorkflowCase[],
  timeoutMs: number,
) => {
  const runModelCases = async (model: string) => {
    const results: IdealWorkflowResult[] = []

    for (const testCase of cases) {
      console.info(`[ideal-workflow-matrix] starting ${testCase.name} [${model}]`)
      if (context.abortSignal?.aborted) {
        throw new Error('Ideal workflow matrix was cancelled', {
          cause: context.abortSignal.reason,
        })
      }
      const controller = new AbortController()
      const forwardAbort = () => controller.abort(context.abortSignal?.reason)
      context.abortSignal?.addEventListener('abort', forwardAbort, { once: true })
      let timer: ReturnType<typeof setTimeout> | undefined
      let timedOut = false
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          timedOut = true
          const message = `Timed out after ${timeoutMs}ms`
          controller.abort(message)
          reject(new Error(message))
        }, timeoutMs)
      })
      const run = testCase.run({ ...context, abortSignal: controller.signal }, model)

      try {
        const details = await Promise.race([run, timeout])
        const skipped =
          typeof details === 'object' &&
          details !== null &&
          'skipped' in details &&
          details.skipped === true
        results.push({
          name: testCase.name,
          model,
          ok: !skipped,
          details,
          ...(skipped
            ? {
                error:
                  'reason' in details && typeof details.reason === 'string'
                    ? details.reason
                    : 'Workflow case was skipped.',
              }
            : {}),
        })
        console.info(`[ideal-workflow-matrix] finished ${testCase.name} [${model}]`)
      } catch (error) {
        if (timedOut) {
          console.warn(`[ideal-workflow-matrix] aborting ${testCase.name} [${model}]`)
          await Promise.race([
            run.catch(() => undefined),
            new Promise<void>((resolve) => {
              setTimeout(resolve, Math.min(timeoutMs, 5_000))
            }),
          ])
        }
        results.push({
          name: testCase.name,
          model,
          ok: false,
          error: errorMessage(error),
        })
      } finally {
        if (timer) clearTimeout(timer)
        context.abortSignal?.removeEventListener('abort', forwardAbort)
      }
    }

    return results
  }

  const results: IdealWorkflowResult[] = []
  for (const model of models) results.push(...(await runModelCases(model)))
  return results
}
runIdealWorkflowMatrixCases.helper = true

export const testIdealWorkflowMatrixWithLunaAndGlm = async (context?: DiagnosticsTestContext) => {
  if (!context?.providerSession) {
    return { success: false as const, skipped: true, reason: 'No provider session was available.' }
  }
  if (context.providerSession.provider !== 'taskyon') {
    return {
      success: false as const,
      skipped: true,
      reason: 'The ideal-workflow matrix requires the Taskyon provider.',
    }
  }

  const results = await runIdealWorkflowMatrixCases(
    context,
    MATRIX_MODELS,
    [
      {
        name: 'greeting',
        run: testSimpleGreetingConversationUsesNormalTaskyonFlow,
      },
      {
        name: 'websearch',
        run: testEntryNodeWebsearchProducesHostedSearchUsage,
      },
      {
        name: 'pinned tool',
        run: testSimplePinnedToolConversationUsesNormalTaskyonFlow,
      },
      {
        name: 'catalog search',
        run: testCatalogSearchThenUsesDiscoveredTool,
      },
      {
        name: 'search and tool',
        run: testWebSearchThenToolUsesSearchedValue,
      },
    ],
    MATRIX_CASE_TIMEOUT_MS,
  )
  const failures = results.filter((result) => !result.ok)
  if (failures.length > 0) {
    throw new Error(
      `Ideal workflow matrix failed:\n${failures
        .map((failure) => `- ${failure.name} [${failure.model}]: ${failure.error}`)
        .join('\n')}`,
    )
  }
  return { success: true, results }
}

testIdealWorkflowMatrixWithLunaAndGlm.description =
  'Runs all five ideal workflows with Luna and GLM and reports every model/workflow result.'
testIdealWorkflowMatrixWithLunaAndGlm.modelBased = true
testIdealWorkflowMatrixWithLunaAndGlm.requiresLongRun = true
testIdealWorkflowMatrixWithLunaAndGlm.timeoutMs = MATRIX_TIMEOUT_MS
