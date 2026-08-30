import type { TaskNode } from '@taskyon/taskyon'
import { stripVTControlCharacters } from 'node:util'
import {
  formatCliLocalFilePath,
  renderTaskProgress,
  renderWorkerProgress,
} from '../../cli/taskRenderer'

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
  return {
    output: stripVTControlCharacters(lines.join('\n')),
    debugOutput: stripVTControlCharacters(debugLines.join('\n')),
  }
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

export const testCliFileResultShowsRemoteAndLocalPaths = () => {
  const lines: string[] = []
  const task: TaskNode = {
    id: 'download-file-result',
    parentID: 'download-file-call',
    role: 'system',
    content: {
      type: 'toolresult',
      data: {
        ok: true,
        filePath: 'research/federal-rules.pdf',
        url: 'https://example.test/federal-rules.pdf',
      },
    },
  }
  const sourceTask: TaskNode = {
    id: 'download-file-call',
    role: 'function',
    content: {
      type: 'functioncall',
      data: { name: 'downloadFile', arguments: {} },
    },
  }
  const tasks = new Map([[sourceTask.id, sourceTask]])
  renderTaskProgress(
    {
      detailedViewEnabled: () => false,
      showRoleTag: () => true,
      showFullFunctionResults: () => false,
      isFunctionHiddenInChat: () => false,
      getTaskById: (id: string) => tasks.get(id),
      clearThinkingPanel: () => {},
      renderThinkingPanel: () => {},
      writeLine: (text: string) => lines.push(text),
    },
    task,
    false,
  )
  const output = lines.join('\n')
  assert(output.includes('research/federal-rules.pdf'), 'expected the local file path')
  assert(output.includes('https://example.test/federal-rules.pdf'), 'expected the remote URL')
  assert(!output.includes('"filePath"'), 'must not print the generic result JSON')
}

testCliFileResultShowsRemoteAndLocalPaths.description =
  'Renders successful CLI file results as remote and local paths instead of generic JSON.'

export const testCliFailedDownloadStillShowsRemoteAndLocalPaths = () => {
  const lines: string[] = []
  const task: TaskNode = {
    id: 'failed-download-file-result',
    parentID: 'failed-download-file-call',
    role: 'system',
    content: {
      type: 'toolresult',
      data: {
        ok: false,
        filePath: 'research/missing-rules.pdf',
        url: 'https://example.test/missing-rules.pdf',
        error: 'HTTP 404',
      },
    },
  }
  const sourceTask: TaskNode = {
    id: 'failed-download-file-call',
    role: 'function',
    content: {
      type: 'functioncall',
      data: { name: 'downloadFile', arguments: {} },
    },
  }
  const tasks = new Map([[sourceTask.id, sourceTask]])
  renderTaskProgress(
    {
      detailedViewEnabled: () => false,
      showRoleTag: () => true,
      showFullFunctionResults: () => false,
      isFunctionHiddenInChat: () => false,
      getTaskById: (id: string) => tasks.get(id),
      clearThinkingPanel: () => {},
      renderThinkingPanel: () => {},
      writeLine: (text: string) => lines.push(text),
    },
    task,
    false,
  )
  const output = lines.join('\n')
  assert(output.includes('https://example.test/missing-rules.pdf'), 'expected the remote URL')
  assert(output.includes('research/missing-rules.pdf'), 'expected the local destination')
  assert(output.includes('HTTP 404'), 'expected the concise download error')
  assert(!output.includes('"filePath"'), 'must not print the generic result JSON')
}

testCliFailedDownloadStillShowsRemoteAndLocalPaths.description =
  'Renders failed CLI downloads with their remote URL, local destination, and error.'

export const testCliFileResultRemovesTerminalControls = () => {
  const renderedPath = formatCliLocalFilePath('research/\u001b]8;;injected.pdf')
  assert(
    Array.from(renderedPath).every((character) => {
      const codePoint = character.codePointAt(0) ?? 0
      return codePoint > 0x1f && codePoint !== 0x7f
    }),
    'file labels must not contain terminal controls',
  )
}

testCliFileResultRemovesTerminalControls.description =
  'Removes terminal control characters from CLI file labels.'

testCliDebugKeepsChatCompactUntilDetailedViewIsRequested.description =
  'Keeps --debug-style rendering compact until an explicit detailed chat view is enabled.'
