import { createTaskCostService } from '../core/taskCost'
import type { TaskNode } from '../types/taskNode'
import type { TaskNodeMeta } from '../types/chatCompletion'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const messageTask = (id: string, created_at: number, parentID?: string): TaskNode => ({
  id,
  role: 'user',
  content: { type: 'message', data: id },
  created_at,
  ...(parentID ? { parentID } : {}),
})

const completionTask = (
  id: string,
  created_at: number,
  parentID?: string,
  priorID?: string,
): TaskNode => ({
  id,
  role: 'function',
  content: { type: 'functioncall', data: { name: 'chatCompletion', arguments: {} } },
  created_at,
  ...(parentID ? { parentID } : {}),
  ...(priorID ? { priorID } : {}),
})

const costMeta = (amount: number, cachedInput: number): TaskNodeMeta => ({
  costs: [{ amount, source: 'openrouter.ai', unit: 'USD' }],
  providerRequest: {
    provider: 'openrouter.ai',
    model: 'test-model',
    taskId: 'test',
    attempts: [],
    usage: {
      inputTokens: { total: 10, cacheRead: cachedInput },
      outputTokens: { total: 5 },
      totalTokens: 15,
    },
  },
})

export const testTaskCostServiceIncludesTreeBranchesAndSeparatesLineage = async () => {
  const root = messageTask('root', 100)
  const first = completionTask('first', 10, root.id)
  const second = completionTask('second', 20, root.id, first.id)
  const branch = completionTask('branch', 15, root.id)
  const tasks = new Map([root, first, second, branch].map((task) => [task.id, task]))
  const metadata = new Map<string, TaskNodeMeta>([
    [first.id, costMeta(1, 2)],
    [second.id, costMeta(0.5, 4)],
    [branch.id, costMeta(2, 6)],
  ])
  const service = createTaskCostService({
    getTask: (id) => Promise.resolve(tasks.get(id) ?? null),
    getMeta: (id) => Promise.resolve(metadata.get(id) ?? null),
    getDirectChildren: (id) =>
      Promise.resolve(
        new Set(
          [...tasks.values()]
            .filter((task) => task.parentID === id && !task.priorID)
            .map((task) => task.id),
        ),
      ),
    getNextSiblings: (id) =>
      Promise.resolve(
        new Set([...tasks.values()].filter((task) => task.priorID === id).map((task) => task.id)),
      ),
  })

  const tree = await service.getSummary(second.id)
  assert(tree.total[0]?.amount === 3.5, 'Expected the full tree cost')
  assert(tree.tokens.total === 45, 'Expected tokens from every costed branch')
  assert(tree.tokens.cachedInput === 12, 'Expected cached input tokens from every branch')
  assert(tree.tokens.cachePercent === (12 / 30) * 100, 'Expected the aggregate cache percentage')

  const lineage = await service.getSummary(second.id, 'lineage')
  assert(lineage.total[0]?.amount === 1.5, 'Expected lineage scope to exclude sibling branches')
  assert(lineage.current[0]?.amount === 0.5, 'Expected the latest billable lineage task as current')
  assert(lineage.accumulated[0]?.amount === 1, 'Expected accumulated lineage cost')
  return { success: true }
}

export const testTaskCostServiceMarksMissingBillableDataAndCachesCompleteTrees = async () => {
  const root = messageTask('root', 1)
  const completion = completionTask('completion', 2, root.id)
  const tasks = new Map([root, completion].map((task) => [task.id, task]))
  let taskReads = 0
  let metadataReads = 0
  const service = createTaskCostService({
    getTask: (id) => {
      taskReads += 1
      return Promise.resolve(tasks.get(id) ?? null)
    },
    getMeta: () => {
      metadataReads += 1
      return Promise.resolve(null)
    },
    getDirectChildren: (id) =>
      Promise.resolve(id === root.id ? new Set([completion.id]) : new Set<string>()),
    getNextSiblings: () => Promise.resolve(new Set<string>()),
  })

  const incomplete = await service.getSummary(completion.id)
  assert(!incomplete.complete, 'Expected missing completion metadata to be incomplete')
  assert(incomplete.missing.costTaskIds.includes(completion.id), 'Expected missing cost metadata')
  assert(incomplete.missing.usageTaskIds.includes(completion.id), 'Expected missing usage metadata')
  const readsAfterIncomplete = { metadataReads, taskReads }
  await service.getSummary(completion.id)
  assert(
    metadataReads > readsAfterIncomplete.metadataReads,
    'Expected incomplete results not to cache',
  )

  const completeService = createTaskCostService({
    getTask: (id) => {
      taskReads += 1
      return Promise.resolve(tasks.get(id) ?? null)
    },
    getMeta: (id) => {
      metadataReads += 1
      return Promise.resolve(id === completion.id ? costMeta(1, 0) : null)
    },
    getDirectChildren: (id) =>
      Promise.resolve(id === root.id ? new Set([completion.id]) : new Set<string>()),
    getNextSiblings: () => Promise.resolve(new Set<string>()),
  })
  await completeService.getSummary(completion.id)
  const readsAfterFirstComplete = { metadataReads, taskReads }
  await completeService.getSummary(completion.id)
  assert(
    metadataReads === readsAfterFirstComplete.metadataReads,
    'Expected complete tree metadata to be served from memory cache',
  )
  assert(
    taskReads === readsAfterFirstComplete.taskReads,
    'Expected complete tree tasks to be cached',
  )
  completeService.clear()
  await completeService.getSummary(completion.id)
  assert(
    metadataReads > readsAfterFirstComplete.metadataReads,
    'Expected clear to invalidate the LRU',
  )
  return { success: true }
}

testTaskCostServiceIncludesTreeBranchesAndSeparatesLineage.description =
  'Aggregates every reachable task branch by default while keeping an explicit lineage scope.'
testTaskCostServiceMarksMissingBillableDataAndCachesCompleteTrees.description =
  'Marks incomplete billable metadata and reuses only complete in-memory tree summaries.'
