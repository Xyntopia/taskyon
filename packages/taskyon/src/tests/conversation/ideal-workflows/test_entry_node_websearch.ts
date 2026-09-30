import type { DiagnosticsTestContext } from '@taskyon/common/modules/diagnosticsRunner'
import { hasRecordedProviderWebSearch, hasSearchSource } from './workflowTestSupport'
import { runVerifiedWorkflow } from './test_time_question_conversation'

export const testEntryNodeWebsearchProducesHostedSearchUsage = async (
  context?: DiagnosticsTestContext,
  model = context?.model,
) => {
  const result = await runVerifiedWorkflow(context, model, {
    label: 'websearch',
    prompt: 'What is one current AI headline today? Keep it to one short sentence.',
    mode: 'message',
    expectedWorkflows: () => [['chatCompletion', 'assistant', 'return']],
    timeoutMs: 75_000,
  })
  if (!result.success) return result

  const { tasks, flow, completionMetas } = result
  if (!completionMetas.some(hasRecordedProviderWebSearch) && !hasSearchSource(tasks)) {
    throw new Error('Expected hosted search usage in metadata or source annotations')
  }
  const assistant = tasks.find(
    (task) => task.role === 'assistant' && task.content.type === 'message',
  )
  return {
    success: true,
    model: result.model,
    selectedApi: context?.selectedApi,
    assistantMessage: assistant?.content.type === 'message' ? assistant.content.data : '',
    flow,
  }
}

testEntryNodeWebsearchProducesHostedSearchUsage.description =
  'Runs the normal chat workflow with provider web search and verifies a searched source.'
testEntryNodeWebsearchProducesHostedSearchUsage.modelBased = true
testEntryNodeWebsearchProducesHostedSearchUsage.requiresLongRun = true
testEntryNodeWebsearchProducesHostedSearchUsage.timeoutMs = 90_000
