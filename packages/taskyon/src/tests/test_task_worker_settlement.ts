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
    const lastAllFinishedIndex = events.findLastIndex((event) => event.stage === 'all finished')
    const hasActiveEventAfterSettlement =
      lastAllFinishedIndex >= 0 &&
      events.slice(lastAllFinishedIndex + 1).some((event) => activeStages.has(event.stage))

    if (lastAllFinishedIndex >= 0 && !hasActiveEventAfterSettlement) {
      settledSince ??= Date.now()
      if (Date.now() - settledSince >= 100) return
    } else {
      settledSince = undefined
    }
    await sleep(10)
  }
  throw new Error(
    `Expected worker to stay settled after all finished, observed stages: ${events
      .map((event) => event.stage)
      .join(', ')}`,
  )
}

export const testTaskWorkerSettlesAfterPriorFunctionCreatesSubtasks = async () => {
  const dataDir = join(tmpdir(), `taskyon-worker-settlement-${Date.now()}`)
  await mkdir(dataDir, { recursive: true })
  const ty = await tyCore(
    () => ({
      selectedApi: 'test',
      llmApis: {},
      siteUrl: 'https://taskyon.space',
      entryFunction: 'entryNode',
    }),
    () => toolCall({ name: 'entryNode', arguments: {} }),
    () => ({}),
    undefined,
    { indexTaskVectors: false, nodePgLiteDataDir: dataDir },
  )
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
  const afterPriorTool = createTool({
    name: 'afterPriorTerminalSubtask',
    description: 'Create a terminal subtask after its prior function task finishes.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {},
    } as const,
    function: () =>
      createSubtasksResult({
        role: 'system',
        content: { type: 'return', data: 'after prior complete' },
      }),
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
  } finally {
    unsubscribeWorkerStream()
    registration.destroy()
    ty.workerStop('task worker settlement diagnostic complete')
  }
}

testTaskWorkerSettlesAfterPriorFunctionCreatesSubtasks.description =
  'Ensures dependency waiters settle after a prior function creates subtasks late in execution.'
