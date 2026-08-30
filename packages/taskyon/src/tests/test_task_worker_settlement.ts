import { processTasksDetailed } from '../api'
import { tyCore } from '../core/init'
import type { TyTaskStreamData } from '../core/taskWorker'
import { registerToolRpcTools } from '../core/toolRpc'
import type { TaskyonStorageClient } from '../api/storageProtocol'
import { createSubtasksResult, createTool, toolCall } from '../types/toolApi'
import { createStorageTool } from '../tools/fileTools'
import { sleep } from '../utils/asyncUtils'
import { createPortableTestStorage } from '../testSupport/portableTestStorage'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const createTaskWorkerTestRuntime = async () => {
  const storage = createPortableTestStorage()
  const ty = await tyCore(
    () => ({
      entryFunction: 'entryNode',
      taskWorker: { maxConcurrency: 4 },
    }),
    () => toolCall({ name: 'entryNode', arguments: {} }),
    {},
    undefined,
    {
      indexTaskVectors: false,
      taskManagerStorageFactory: storage.taskManagerStorageFactory,
    },
  )
  return { ty, storage }
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

export const testStorageResultContinuesThroughConfiguredEntryNode = async () => {
  const { ty, storage } = await createTaskWorkerTestRuntime()
  const storageClient = {
    setBlob: ({ data }: { data: Uint8Array }) =>
      Promise.resolve({
        namespace: 'diagnostics',
        id: 'document.pdf',
        size: data.byteLength,
        contentType: 'application/pdf',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
  } as unknown as TaskyonStorageClient
  const storageTool = createStorageTool(storageClient, () =>
    Promise.resolve(new Response('%PDF-test', { headers: { 'content-type': 'application/pdf' } })),
  )
  let entryCalls = 0
  const entryNode = createTool({
    name: 'entryNode',
    description: 'Verify ordinary tool results return through the configured entry node.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {},
    } as const,
    function: () => {
      entryCalls += 1
      return createSubtasksResult({
        role: 'system',
        content: { type: 'return', data: 'storage entry continuation complete' },
      })
    },
  })
  const registration = await registerToolRpcTools({
    port: ty.port,
    tools: [storageTool, entryNode],
  })

  try {
    const result = await processTasksDetailed(ty.port)(
      [
        [
          toolCall({
            name: 'storage',
            arguments: {
              action: 'download',
              namespace: 'diagnostics',
              id: 'document.pdf',
              url: 'https://example.test/document.pdf',
              expectedFileType: 'pdf',
            },
          }),
        ],
      ],
      (task) =>
        task.content.type === 'return' &&
        task.content.data === 'storage entry continuation complete',
      { timeoutMs: 5_000, throwOnError: false },
    )

    assert(result.status === 'matched', `Expected matched result, got ${result.status}`)
    assert(entryCalls === 1, `Expected one entry-node continuation, got ${entryCalls}`)
    const entryTask = result.observedTasks.find(
      (task) => task.content.type === 'functioncall' && task.content.data.name === 'entryNode',
    )
    assert(entryTask, 'Expected storage completion to create the configured entry-node task.')
    const previousTask = result.observedTasks.find((task) => task.id === entryTask.priorID)
    assert(
      previousTask?.content.type === 'toolresult',
      `Expected entry-node re-entry after a tool result, got ${previousTask?.content.type}.`,
    )
  } finally {
    registration.destroy()
    await ty.dispose('storage entry continuation diagnostic complete')
    storage.destroy()
  }
}

testStorageResultContinuesThroughConfiguredEntryNode.description =
  "Routes ordinary storage results through Taskyon's configured default entry node instead of directly invoking chatCompletion."

export const testTaskWorkerEmitsProcessedBeforeFinishedForMessageSubtask = async () => {
  const { ty, storage } = await createTaskWorkerTestRuntime()
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
    await ty.dispose('task worker message subtask diagnostic complete')
    storage.destroy()
  }
}

testTaskWorkerEmitsProcessedBeforeFinishedForMessageSubtask.description =
  'Ensures worker streams distinguish processed function calls from semantic task completion.'

export const testTaskWorkerSettlesAfterPriorFunctionCreatesSubtasks = async () => {
  const { ty, storage } = await createTaskWorkerTestRuntime()
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
    await ty.dispose('task worker settlement diagnostic complete')
    storage.destroy()
  }
}

testTaskWorkerSettlesAfterPriorFunctionCreatesSubtasks.description =
  'Ensures dependency waiters settle after a prior function creates subtasks late in execution.'

export const testTaskWorkerReleasesFunctionAfterDependentMessage = async () => {
  const { ty, storage } = await createTaskWorkerTestRuntime()
  const priorTool = createTool({
    name: 'priorWithMessageDependency',
    description: 'Create a terminal result before a dependent message.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {},
    } as const,
    function: () => createSubtasksResult([]),
  })
  const reducerTool = createTool({
    name: 'reducerAfterMessageDependency',
    description: 'Run after the dependent message becomes finished.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {},
    } as const,
    function: () =>
      createSubtasksResult({
        role: 'system',
        content: { type: 'return', data: 'message dependency reduced' },
      }),
  })
  const registration = await registerToolRpcTools({
    port: ty.port,
    tools: [priorTool, reducerTool],
  })

  try {
    const result = await processTasksDetailed(ty.port)(
      [
        [
          toolCall({ name: 'priorWithMessageDependency', arguments: {} }),
          { role: 'user', content: { type: 'message', data: 'Reducer objective.' } },
          toolCall({ name: 'reducerAfterMessageDependency', arguments: {} }),
        ],
      ],
      (task) =>
        task.content.type === 'return' && task.content.data === 'message dependency reduced',
      { timeoutMs: 5_000 },
    )

    assert(result.status === 'matched', `Expected matched result, got ${result.status}`)
  } finally {
    registration.destroy()
    await ty.dispose('message dependency settlement diagnostic complete')
    storage.destroy()
  }
}

testTaskWorkerReleasesFunctionAfterDependentMessage.description =
  'Runs a sequential function after an intervening message whose prior function completed with an empty explicit task result.'

export const testTaskWorkerDoesNotAddDefaultAfterExplicitSuccessor = async () => {
  const { ty, storage } = await createTaskWorkerTestRuntime()
  const events: TyTaskStreamData[] = []
  const unsubscribeWorkerStream = ty.workerStream((event) => {
    events.push(event)
  })
  let implicitEntryCalls = 0
  let readCalls = 0
  const downloadTool = createTool({
    name: 'precompiledDownload',
    description: 'Return ordinary data before a precompiled successor task.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {},
    } as const,
    function: () => ({ downloaded: true }),
  })
  const readTool = createTool({
    name: 'precompiledRead',
    description: 'Complete the precompiled successor task.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {},
    } as const,
    function: () => {
      readCalls += 1
      return createSubtasksResult({
        role: 'system',
        content: { type: 'return', data: 'explicit successor complete' },
      })
    },
  })
  const entryNode = createTool({
    name: 'entryNode',
    description: 'Detect an unexpected implicit continuation.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {},
    } as const,
    function: () => {
      implicitEntryCalls += 1
      return createSubtasksResult([])
    },
  })
  const registration = await registerToolRpcTools({
    port: ty.port,
    tools: [downloadTool, readTool, entryNode],
  })

  try {
    const result = await processTasksDetailed(ty.port)(
      [
        [
          toolCall({ name: 'precompiledDownload', arguments: {} }),
          toolCall({ name: 'precompiledRead', arguments: {} }),
        ],
      ],
      (task) =>
        task.content.type === 'return' && task.content.data === 'explicit successor complete',
      { timeoutMs: 5_000, throwOnError: false },
    )

    assert(result.status === 'matched', `Expected matched result, got ${result.status}`)
    await waitForWorkerSettlement(events, 1_000)
    assert(readCalls === 1, `Expected one explicit successor call, got ${readCalls}`)
    assert(
      implicitEntryCalls === 0,
      `Expected no implicit entry-node continuation, got ${implicitEntryCalls}`,
    )
  } finally {
    unsubscribeWorkerStream()
    registration.destroy()
    await ty.dispose('explicit successor continuation diagnostic complete')
    storage.destroy()
  }
}

testTaskWorkerDoesNotAddDefaultAfterExplicitSuccessor.description =
  'Avoids adding the generic entry-node continuation when a function task already has a precompiled successor.'

export const testTaskWorkerWaitsForParallelSubtreeBeforeSequentialReducer = async () => {
  const { ty, storage } = await createTaskWorkerTestRuntime()
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
    await ty.dispose('parallel subtree reducer diagnostic complete')
    storage.destroy()
  }
}

testTaskWorkerWaitsForParallelSubtreeBeforeSequentialReducer.description =
  'Ensures a sequential reducer waits for every branch in the prior parallel subtree.'

export const testTaskWorkerCompletesDeterministicErrorRecovery = async () => {
  const { ty, storage } = await createTaskWorkerTestRuntime()
  let recoveryCalls = 0
  const failingTool = createTool({
    name: 'deterministicFailure',
    description: 'Fail once so worker recovery can be verified without a model.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {},
    } as const,
    function: () => {
      throw new Error('deterministic patch mismatch')
    },
  })
  const recoveryTool = createTool({
    name: 'entryNode',
    description: 'Return a deterministic terminal result for the recovery regression.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {},
    } as const,
    function: () => {
      recoveryCalls += 1
      return createSubtasksResult({
        role: 'system',
        content: { type: 'return', data: 'deterministic recovery complete' },
      })
    },
  })
  const registration = await registerToolRpcTools({
    port: ty.port,
    tools: [failingTool, recoveryTool],
  })

  try {
    const result = await processTasksDetailed(ty.port)(
      [[toolCall({ name: 'deterministicFailure', arguments: {} })]],
      (task) =>
        task.content.type === 'return' && task.content.data === 'deterministic recovery complete',
      { timeoutMs: 5_000, throwOnError: false },
    )

    assert(result.status === 'matched', `Expected matched recovery result, got ${result.status}`)
    assert(recoveryCalls === 1, `Expected one recovery call, got ${recoveryCalls}`)
    assert(
      result.observedTasks.some(
        (task) =>
          task.content.type === 'error' &&
          JSON.stringify(task.content.data).includes('deterministic patch mismatch'),
      ),
      'Expected the failed call to remain inspectable as an error task',
    )
  } finally {
    registration.destroy()
    await ty.dispose('deterministic worker recovery diagnostic complete')
    storage.destroy()
  }
}

testTaskWorkerCompletesDeterministicErrorRecovery.description =
  'Proves worker error recovery reaches its queued continuation without invoking a model.'
