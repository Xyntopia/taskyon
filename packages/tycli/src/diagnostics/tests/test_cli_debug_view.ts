import type { TaskNode } from '@taskyon/taskyon'
import { renderTaskProgress, renderWorkerProgress } from '../../cli/taskRenderer'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const createFunctionTask = (): TaskNode => ({
  id: 'debug-view-task',
  role: 'function',
  content: {
    type: 'functioncall',
    data: {
      name: 'exploration',
      arguments: { action: 'view', path: 'src', limit: 10 },
    },
  },
})

const renderFunctionAndWorker = (detailedViewEnabled: boolean) => {
  const lines: string[] = []
  const debugLines: string[] = []
  const state = {
    detailedViewEnabled: () => detailedViewEnabled,
    showRoleTag: () => true,
    showFullFunctionResults: () => false,
    isFunctionHiddenInChat: () => false,
    clearThinkingPanel: () => {},
    renderThinkingPanel: () => {},
    writeDebugLine: (text: string) => debugLines.push(text),
    writeLine: (text: string) => lines.push(text),
  }
  const task = createFunctionTask()

  renderTaskProgress(state, task, false)
  renderWorkerProgress(state, { stage: 'processing', task })
  return { output: lines.join('\n'), debugOutput: debugLines.join('\n') }
}

export const testCliDebugKeepsChatCompactUntilDetailedViewIsRequested = () => {
  const compact = renderFunctionAndWorker(false)
  assert(compact.output.includes('[function|functioncall] exploration action=view'), 'compact call')
  assert(!compact.output.includes('arguments:'), 'compact view should omit YAML arguments')
  assert(!compact.output.includes('[worker yaml]'), 'compact view should omit worker YAML')
  assert(compact.debugOutput.includes('arguments:'), 'debug log should include YAML arguments')
  assert(compact.debugOutput.includes('[worker yaml]'), 'debug log should include worker YAML')

  const detailed = renderFunctionAndWorker(true)
  assert(detailed.output.includes('[task] [function|functioncall]'), 'detailed task prefix')
  assert(detailed.output.includes('arguments:'), 'detailed view should include YAML arguments')
  assert(detailed.output.includes('[worker yaml]'), 'detailed view should include worker YAML')
}

testCliDebugKeepsChatCompactUntilDetailedViewIsRequested.description =
  'Keeps --debug-style rendering compact until an explicit detailed chat view is enabled.'
