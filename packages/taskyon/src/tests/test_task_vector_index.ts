import { shouldSkipTaskVectorIndex } from '../core/taskManager'
import type { TaskNode } from '../types/taskNode'
import { createTool } from '../types/toolApi'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

export const testTaskVectorIndexSeparatesCallsFromResults = async () => {
  const tool = createTool({
    name: 'taskSearcher',
    description: 'Find prior tasks.',
    parameters: { type: 'object', properties: {} },
    renderOptions: { hideVector: true, hideVectorResult: true },
  })
  const call: TaskNode = {
    id: 'call',
    role: 'function',
    content: { type: 'functioncall', data: { name: tool.name, arguments: {} } },
  }
  const result: TaskNode = {
    id: 'result',
    parentID: call.id,
    role: 'system',
    content: { type: 'toolresult', data: { results: [{ taskId: 'old-task' }] } },
  }
  const getTask = (id: string) => Promise.resolve(id === call.id ? call : null)
  const resolveTool = () => Promise.resolve({ tool })
  assert(await shouldSkipTaskVectorIndex(call, getTask, resolveTool), 'Expected call excluded')
  assert(await shouldSkipTaskVectorIndex(result, getTask, resolveTool), 'Expected result excluded')
  assert(
    !(await shouldSkipTaskVectorIndex(
      { id: 'answer', role: 'assistant', content: { type: 'message', data: 'Found it.' } },
      getTask,
      resolveTool,
    )),
    'Expected assistant answer retained',
  )
}

testTaskVectorIndexSeparatesCallsFromResults.description =
  'Omits repetitive tool calls and results while retaining conversation answers.'

export const testTaskVectorIndexRetainsContentResults = async () => {
  const tool = createTool({
    name: 'webReader',
    description: 'Read an article.',
    parameters: { type: 'object', properties: {} },
    renderOptions: { hideVector: true, hideVectorResult: false },
  })
  const call: TaskNode = {
    id: 'call',
    role: 'function',
    content: { type: 'functioncall', data: { name: tool.name, arguments: {} } },
  }
  const result: TaskNode = {
    id: 'result',
    parentID: call.id,
    role: 'system',
    content: { type: 'toolresult', data: 'A substantive article excerpt.' },
  }
  const getTask = (id: string) => Promise.resolve(id === call.id ? call : null)
  const resolveTool = () => Promise.resolve({ tool })
  assert(await shouldSkipTaskVectorIndex(call, getTask, resolveTool), 'Expected call excluded')
  assert(
    !(await shouldSkipTaskVectorIndex(result, getTask, resolveTool)),
    'Expected useful result retained independently of call',
  )
}

testTaskVectorIndexRetainsContentResults.description =
  'Retains useful tool results even when their function calls are omitted.'

export const testTaskVectorIndexHonorsScopedToolSettings = async () => {
  const definition: TaskNode = {
    id: 'definition',
    role: 'assistant',
    content: {
      type: 'tooldefinition',
      data: {
        name: 'scopedSearch',
        description: 'Internal catalog search binding.',
        parameters: { type: 'object', properties: {} },
        code: '() => ({ matches: [] })',
        renderOptions: { hideVector: true, hideVectorResult: true },
      },
    },
  }
  const call: TaskNode = {
    id: 'call',
    priorID: definition.id,
    role: 'function',
    content: { type: 'functioncall', data: { name: 'scopedSearch', arguments: {} } },
  }
  const result: TaskNode = {
    id: 'result',
    parentID: call.id,
    role: 'system',
    content: { type: 'toolresult', data: { matches: [] } },
  }
  const getTask = (id: string) =>
    Promise.resolve([definition, call, result].find((task) => task.id === id) ?? null)
  const resolveTool = () => Promise.resolve({})
  assert(
    await shouldSkipTaskVectorIndex(call, getTask, resolveTool),
    'Expected scoped call excluded',
  )
  assert(
    await shouldSkipTaskVectorIndex(result, getTask, resolveTool),
    'Expected scoped result excluded',
  )
}

testTaskVectorIndexHonorsScopedToolSettings.description =
  'Applies scoped tool index settings without requiring central registration.'

export const testTaskVectorRebuildUsesCurrentRegisteredToolSettings = async () => {
  const oldTool = createTool({
    name: 'taskSearcher',
    description: 'Find prior tasks.',
    parameters: { type: 'object', properties: {} },
  })
  const currentTool = createTool({
    ...oldTool,
    renderOptions: { hideVector: true, hideVectorResult: true },
  })
  const call: TaskNode = {
    id: 'old-call',
    role: 'function',
    content: {
      type: 'functioncall',
      data: { name: oldTool.name, arguments: {}, toolRevision: 'sha256:old-revision' },
    },
  }
  const result: TaskNode = {
    id: 'old-result',
    parentID: call.id,
    role: 'system',
    content: { type: 'toolresult', data: { results: [] } },
  }
  const getTask = (id: string) => Promise.resolve(id === call.id ? call : null)
  const resolveTool = (_name: string, revision?: string) =>
    Promise.resolve({ tool: revision ? oldTool : currentTool })
  assert(
    await shouldSkipTaskVectorIndex(result, getTask, resolveTool),
    'Expected re-indexing to apply the current registered tool policy to old results',
  )
}

testTaskVectorRebuildUsesCurrentRegisteredToolSettings.description =
  'Rebuilds the disposable task index using current inclusion rules for old registered calls.'
