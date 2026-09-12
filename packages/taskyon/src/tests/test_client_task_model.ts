import { createClientTaskModel } from '../api/clientTaskModel'
import type { TaskNode } from '../types/taskNode'
import { taskNodeToRecord } from '../core/createTasks'

export const testClientTaskModelImmediateAndBranchSelection = async () => {
  const tasks: TaskNode[] = [
    { id: 'user', role: 'user', content: { type: 'message', data: 'Question' } },
    {
      id: 'call',
      priorID: 'user',
      role: 'function',
      content: { type: 'functioncall', data: { name: 'custom', arguments: {} } },
    },
    {
      id: 'answer',
      parentID: 'call',
      role: 'assistant',
      content: { type: 'message', data: 'Answer' },
    },
    {
      id: 'end',
      parentID: 'call',
      priorID: 'answer',
      role: 'system',
      content: { type: 'return', data: 'done' },
    },
    {
      id: 'alternative',
      priorID: 'user',
      role: 'assistant',
      content: { type: 'message', data: 'Other version' },
    },
  ]
  let reads = 0
  const model = createClientTaskModel({
    get: ({ id }) => {
      reads++
      return Promise.resolve(tasks.find((task) => task.id === id) ?? null)
    },
    readRecords: (request) =>
      Promise.resolve({
        records: tasks
          .filter((task) =>
            request.mode === 'ids'
              ? request.ids.includes(task.id)
              : task.parentID === request.parentID,
          )
          .map(taskNodeToRecord),
        next: null,
      }),
  })
  tasks.forEach(model.ingest)
  if (
    model
      .lineage('end')
      .map((task) => task.id)
      .join(',') !== 'user,call,answer,end'
  )
    throw new Error('Cached lineage must be immediately available.')
  await model.loadLineage('end')
  if (reads !== 0) throw new Error('Cached lineage must not fetch task contents.')
  const exported = await model.exportSelection('end')
  if (exported.some((task) => task.id === 'alternative'))
    throw new Error('Export included another conversation version.')
  if (!exported.some((task) => task.id === 'answer')) throw new Error('Export omitted the answer.')
  model.clear()
  if (model.lineage('end').length) throw new Error('Session reset retained tasks.')
}

testClientTaskModelImmediateAndBranchSelection.description =
  'Client task model renders cached lineage without reads and exports only the selected conversation version.'

export const testClientTaskModelProgressiveReadsAndReset = async () => {
  const leaf: TaskNode = {
    id: 'leaf',
    priorID: 'missing',
    role: 'assistant',
    content: { type: 'message', data: 'Cached answer' },
  }
  let release: (task: TaskNode | null) => void = () => {}
  let reads = 0
  const model = createClientTaskModel({
    get: () => {
      reads++
      return new Promise((resolve) => {
        release = resolve
      })
    },
    readRecords: () => Promise.resolve({ records: [], next: null }),
  })
  model.ingest(leaf)
  const loading = model.loadLineage('leaf')
  const duplicate = model.loadLineage('leaf')
  await Promise.resolve()
  if (model.lineage('leaf')[0]?.content.data !== 'Cached answer')
    throw new Error('Missing ancestors blocked cached messages.')
  if (reads !== 1) throw new Error('Concurrent lineage requests were not deduplicated.')
  model.clear()
  release({ id: 'missing', role: 'user', content: { type: 'message', data: 'Old session' } })
  await Promise.all([loading, duplicate])
  if (model.get('missing')) throw new Error('A stale response repopulated the new session.')
}
testClientTaskModelProgressiveReadsAndReset.description =
  'Delayed ancestors do not block cached messages; duplicate reads and stale session responses are handled.'

export const testClientTaskModelKeepsSubtasksAndRejectsMissingExports = async () => {
  const tasks: TaskNode[] = [
    { id: 'root', role: 'user', content: { type: 'message', data: 'Compare' } },
    {
      id: 'call',
      priorID: 'root',
      role: 'function',
      content: { type: 'functioncall', data: { name: 'arbitraryWorkflow', arguments: {} } },
    },
    {
      id: 'data',
      parentID: 'call',
      role: 'system',
      content: { type: 'toolresult', data: { answer: 42 } },
    },
    {
      id: 'summary',
      parentID: 'call',
      role: 'assistant',
      content: { type: 'message', data: 'A user-facing summary' },
    },
    {
      id: 'continue',
      priorID: 'call',
      role: 'user',
      content: { type: 'message', data: 'Continue' },
    },
  ]
  let missing = false
  const model = createClientTaskModel({
    get: ({ id }) =>
      Promise.resolve(
        missing && id === 'data' ? null : (tasks.find((task) => task.id === id) ?? null),
      ),
    readRecords: (request) =>
      Promise.resolve({
        records: tasks
          .filter((task) =>
            request.mode === 'ids'
              ? request.ids.includes(task.id)
              : task.parentID === request.parentID,
          )
          .map(taskNodeToRecord),
        next: null,
      }),
  })
  await model.discover('continue')
  if (!model.selection('continue').some((task) => task.id === 'summary'))
    throw new Error('A subtask assistant message disappeared.')
  if (model.get('data')) throw new Error('Background message discovery eagerly hydrated raw data.')
  missing = true
  let failed = false
  try {
    await model.exportSelection('continue')
  } catch {
    failed = true
  }
  if (!failed) throw new Error('Export silently omitted missing contents.')
  missing = false
  const result = await model.exportSelection('continue')
  if (result.length !== tasks.length)
    throw new Error('Export omitted an independent result branch.')
}
testClientTaskModelKeepsSubtasksAndRejectsMissingExports.description =
  'Discovers assistant subtask messages without raw content reads and refuses incomplete exports.'

export const testClientTaskModelResultCache = async () => {
  const call: TaskNode = {
    id: 'call',
    role: 'function',
    content: { type: 'functioncall', data: { name: 'custom', arguments: {} } },
  }
  const result: TaskNode = {
    id: 'result',
    parentID: 'call',
    role: 'system',
    content: { type: 'structured', data: { value: 42 } },
  }
  let reads = 0
  const model = createClientTaskModel({
    get: ({ id }) => {
      reads++
      return Promise.resolve(id === result.id ? result : null)
    },
    readRecords: () => {
      reads++
      return Promise.resolve({ records: [taskNodeToRecord(result)], next: null })
    },
  })
  model.ingest(call)
  const first = await model.loadResults(call.id, call.id)
  if (first[0]?.id !== result.id) throw new Error('The structured result was not resolved.')
  const count = reads
  await model.loadResults(call.id, call.id)
  if (reads !== count) throw new Error('Reopening a cached result triggered more reads.')
  const next = { ...result, id: 'next', priorID: result.id }
  model.ingest(next)
  const updated = await model.loadResults(call.id, call.id)
  if (!updated.some((task) => task.id === next.id))
    throw new Error('A later result event was missed.')
}
testClientTaskModelResultCache.description =
  'Reopening a tool result reuses cached content and incorporates later result events.'
