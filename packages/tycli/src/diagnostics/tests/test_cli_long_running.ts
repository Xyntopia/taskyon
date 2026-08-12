import type { TaskNode } from '../../../../taskyon/src/types/taskNode'
import { TYCLI_ACTIVE_TASK_WAIT_TIMEOUT_MS, isInteractiveTaskResult } from '../../cli/taskWait'

export const testCliActiveTaskWaitCoversTransientProviderRecoveryWindow = () => {
  if (TYCLI_ACTIVE_TASK_WAIT_TIMEOUT_MS < 25 * 60 * 60_000) {
    throw new Error('Expected the CLI to remain attached throughout the 24-hour retry window.')
  }
}

testCliActiveTaskWaitCoversTransientProviderRecoveryWindow.description =
  'Keeps the CLI attached while chatCompletion performs visible retries for up to 24 hours.'

const terminalTask = (type: 'message' | 'error' | 'return'): TaskNode => ({
  id: type,
  role: 'system',
  created_at: 1,
  content:
    type === 'message'
      ? { type, data: 'done' }
      : type === 'error'
        ? { type, data: 'failed' }
        : { type, data: 'finished' },
})

export const testCliReturnsFinalProviderErrorAfterRecoveryWindow = () => {
  if (!isInteractiveTaskResult(terminalTask('error'))) {
    throw new Error('Expected the final provider error to release the interactive CLI wait.')
  }
  if (!isInteractiveTaskResult(terminalTask('message'))) {
    throw new Error('Expected successful assistant messages to release the interactive CLI wait.')
  }
  if (isInteractiveTaskResult(terminalTask('return'))) {
    throw new Error('Expected an internal return node not to replace the visible terminal result.')
  }
}

testCliReturnsFinalProviderErrorAfterRecoveryWindow.description =
  'Returns the visible final provider error after retries expire instead of waiting another day.'
