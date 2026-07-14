import { mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { processTasksDetailed } from '../api'
import { tyCore } from '../core/init'
import type { TyTaskStreamData } from '../core/taskWorker'
import { registerToolRpcTools } from '../core/toolRpc'
import { createSubtasksResult, createTool, toolCall } from '../types/toolApi'
import { sleep } from '../utils/asyncUtils'

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message)
}

const createTaskWorkerTestRuntime = async (label: string) => {
  const dataDir = join(tmpdir(), `taskyon-worker-${label}-${Date.now()}`)
  await mkdir(dataDir, { recursive: true })
  return await tyCore(
    () => ({
      selectedApi: 'test',
      llmApis: {},
      siteUrl: 'https://taskyon.space',
      entryFunction: 'entryNode',
      taskWorker: { maxConcurrency: 4 },
    }),
    () => toolCall({ name: 'entryNode', arguments: {} }),
    () => ({}),
    undefined,
    { indexTaskVectors: false, nodePgLiteDataDir: dataDir },
  )
}

const waitForWorkerSettlement = async (events: TyTaskStreamData[], timeoutMs: number) => {
  const startedAt = Date.now()
  let settledSince: number | undefined
  const activeStages = new Set<TyTaskStreamData['stage']>([
    'queued',
    'in loop',
    'processing',
    'subtasks',
  ])

  while (Date.now() - startedAt < timeoutMs) {
    const lastAllProcessedIndex = events.findLastIndex((event) => event.stage === 'all processed')
    const hasActiveEventAfterSettlement =
      lastAllProcessedIndex >= 0 &&
      events.slice(lastAllProcessedIndex + 1).some((event) => activeStages.has(event.stage))

    if (lastAllProcessedIndex >= 0 && !hasActiveEventAfterSettlement) {
      settledSince ??= Date.now()
      if (Date.now() - settledSince >= 100) return
    } else {
      settledSince = undefined
    }
    await sleep(10)
  }
  throw new Error(
    `Expected worker to stay settled after all processed, observed stages: ${events
      .map((event) => event.stage)
      .join(', ')}`,
  )
}

const findEventIndex = (
  events: TyTaskStreamData[],
  stage: TyTaskStreamData['stage'],
  taskId?: string,
) =>
  events.findIndex(
    (event) => event.stage === stage && (!taskId || (event.taskId ?? event.task?.id) === taskId),
  )

const assertEventOrder = (
  events: TyTaskStreamData[],
  earlier: { stage: TyTaskStreamData['stage']; taskId?: string },
  later: { stage: TyTaskStreamData['stage']; taskId?: string },
) => {
  const earlierIndex = findEventIndex(events, earlier.stage, earlier.taskId)
  const laterIndex = findEventIndex(events, later.stage, later.taskId)
  assert(
    earlierIndex >= 0 && laterIndex >= 0 && earlierIndex < laterIndex,
    `Expected ${earlier.stage} before ${later.stage}, got stages: ${events
      .map((event) => `${event.stage}:${event.taskId ?? event.task?.id ?? ''}`)
      .join(', ')}`,
  )
}

export const testTaskWorkerEmitsProcessedBeforeFinishedForMessageSubtask = async () => {
  const ty = await createTaskWorkerTestRuntime('message-subtask-order')
  const events: TyTaskStreamData[] = []
  const unsubscribeWorkerStream = ty.workerStream((event) => {
    events.push(event)
  })

  const messageTool = createTool({
    name: 'taskWorkerMessageSubtask',
    description: 'Create a terminal assistant message subtask.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {},
    } as const,
    function: (args, ctx) =>
      ctx.createSubtasksResult({
        role: 'assistant',
        content: { type: 'message', data: 'worker message complete' },
      }),
  })
  const registration = await registerToolRpcTools({ port: ty.port, tools: [messageTool] })

  try {
    const result = await processTasksDetailed(ty.port)(
      [[toolCall({ name: 'taskWorkerMessageSubtask', arguments: {} })]],
      (task) => task.role === 'assistant' && task.content.type === 'message',
      { timeoutMs: 5_000 },
    )

    assert(result.status === 'matched', `Expected matched result, got ${result.status}`)
    await waitForWorkerSettlement(events, 1_000)
    const functionTaskId = result.initialIds[0]
    if (!functionTaskId) throw new Error('Expected an initial function task id')
    assertEventOrder(
      events,
      { stage: 'processing', taskId: functionTaskId },
      { stage: 'processed', taskId: functionTaskId },
    )
    assertEventOrder(
      events,
      { stage: 'processed', taskId: functionTaskId },
      { stage: 'finished', taskId: functionTaskId },
    )
    assertEventOrder(events, { stage: 'finished' }, { stage: 'all processed' })
  } finally {
    unsubscribeWorkerStream()
    registration.destroy()
    ty.workerStop('task worker message subtask diagnostic complete')
  }
}

testTaskWorkerEmitsProcessedBeforeFinishedForMessageSubtask.description =
  'Ensures worker streams distinguish processed function calls from semantic task completion.'

export const testTaskWorkerSettlesAfterPriorFunctionCreatesSubtasks = async () => {
  const ty = await createTaskWorkerTestRuntime('settlement')
  const events: TyTaskStreamData[] = []
  const unsubscribeWorkerStream = ty.workerStream((event) => {
    events.push(event)
  })

  const slowPriorTool = createTool({
    name: 'slowPriorCreatesTerminalSubtask',
    description: 'Create a terminal subtask after a short delay.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {},
    } as const,
    function: async () => {
      await sleep(50)
      return createSubtasksResult({
        role: 'system',
        content: { type: 'return', data: 'slow prior complete' },
      })
    },
  })
  let afterPriorCallCount = 0
  const afterPriorTool = createTool({
    name: 'afterPriorTerminalSubtask',
    description: 'Create a terminal subtask after its prior function task finishes.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {},
    } as const,
    function: () => {
      afterPriorCallCount += 1
      return createSubtasksResult({
        role: 'system',
        content: { type: 'return', data: 'after prior complete' },
      })
    },
  })
  const registration = await registerToolRpcTools({
    port: ty.port,
    tools: [slowPriorTool, afterPriorTool],
  })

  try {
    const result = await processTasksDetailed(ty.port)(
      [
        [
          toolCall({ name: 'slowPriorCreatesTerminalSubtask', arguments: {} }),
          toolCall({ name: 'afterPriorTerminalSubtask', arguments: {} }),
        ],
      ],
      (task) => task.content.type === 'return' && task.content.data === 'after prior complete',
      { timeoutMs: 5_000 },
    )

    assert(result.status === 'matched', `Expected matched result, got ${result.status}`)
    await waitForWorkerSettlement(events, 1_000)
    const priorTaskId = result.initialIds[0]
    const dependentTaskId = result.initialIds[1]
    if (!priorTaskId || !dependentTaskId) {
      throw new Error('Expected initial prior and dependent task ids')
    }
    assertEventOrder(
      events,
      { stage: 'waiting', taskId: dependentTaskId },
      { stage: 'finished', taskId: priorTaskId },
    )
    assertEventOrder(
      events,
      { stage: 'finished', taskId: priorTaskId },
      { stage: 'processing', taskId: dependentTaskId },
    )
    assert(
      events.some((event) => event.stage === 'finished'),
      `Expected at least one semantic finished event, got stages: ${events
        .map((event) => event.stage)
        .join(', ')}`,
    )
    assert(
      afterPriorCallCount === 1,
      `Expected dependent task to run once, got ${afterPriorCallCount} calls`,
    )
  } finally {
    unsubscribeWorkerStream()
    registration.destroy()
    ty.workerStop('task worker settlement diagnostic complete')
  }
}

testTaskWorkerSettlesAfterPriorFunctionCreatesSubtasks.description =
  'Ensures dependency waiters settle after a prior function creates subtasks late in execution.'

export const testTaskWorkerWaitsForParallelSubtreeBeforeSequentialReducer = async () => {
  const ty = await createTaskWorkerTestRuntime('parallel-subtree-reducer')
  const events: TyTaskStreamData[] = []
  const unsubscribeWorkerStream = ty.workerStream((event) => {
    events.push(event)
  })
  const branchNames = ['researchBranchA', 'researchBranchB', 'researchBranchC']
  const branchTools = branchNames.map((name, index) =>
    createTool({
      name,
      description: `Complete parallel research branch ${index + 1}.`,
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {},
      } as const,
      function: async () => {
        await sleep(20 * (index + 1))
        return createSubtasksResult({
          role: 'system',
          content: { type: 'return', data: `${name} complete` },
        })
      },
    }),
  )
  const parallelResearchTool = createTool({
    name: 'parallelResearch',
    description: 'Delegate independent research branches in parallel.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {},
    } as const,
    function: (_args, ctx) =>
      ctx.createSubtasksResult(branchNames.map((name) => [toolCall({ name, arguments: {} })])),
  })
  const reducerTool = createTool({
    name: 'reduceParallelResearch',
    description: 'Reduce all completed parallel research branches.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {},
    } as const,
    function: (_args, ctx) =>
      ctx.createSubtasksResult({
        role: 'system',
        content: { type: 'return', data: 'parallel research reduced' },
      }),
  })
  const registration = await registerToolRpcTools({
    port: ty.port,
    tools: [parallelResearchTool, reducerTool, ...branchTools],
  })

  try {
    const result = await processTasksDetailed(ty.port)(
      [
        [
          toolCall({ name: 'parallelResearch', arguments: {} }),
          toolCall({ name: 'reduceParallelResearch', arguments: {} }),
        ],
      ],
      (task) => task.content.type === 'return' && task.content.data === 'parallel research reduced',
      { timeoutMs: 5_000 },
    )

    assert(result.status === 'matched', `Expected matched result, got ${result.status}`)
    await waitForWorkerSettlement(events, 1_000)
    const reducerTaskId = result.initialIds[1]
    if (!reducerTaskId) throw new Error('Expected a reducer task id')
    const reducerProcessingIndex = findEventIndex(events, 'processing', reducerTaskId)
    assert(reducerProcessingIndex >= 0, 'Expected the reducer to start processing')

    for (const branchName of branchNames) {
      const branchEvent = events.find(
        (event) =>
          event.task?.content.type === 'functioncall' &&
          event.task.content.data.name === branchName,
      )
      const branchTaskId = branchEvent?.taskId ?? branchEvent?.task?.id
      if (!branchTaskId) throw new Error(`Expected a task id for ${branchName}`)
      const branchFinishedIndex = findEventIndex(events, 'finished', branchTaskId)
      assert(
        branchFinishedIndex >= 0 && branchFinishedIndex < reducerProcessingIndex,
        `Expected ${branchName} to finish before the reducer started`,
      )
    }
  } finally {
    unsubscribeWorkerStream()
    registration.destroy()
    ty.workerStop('parallel subtree reducer diagnostic complete')
  }
}

testTaskWorkerWaitsForParallelSubtreeBeforeSequentialReducer.description =
  'Ensures a sequential reducer waits for every branch in the prior parallel subtree.'
