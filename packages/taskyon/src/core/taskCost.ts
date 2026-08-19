import { createLruCache } from '@taskyon/common/modules/lruCache'
import type { TaskNodeMeta } from '../types/chatCompletion'
import type { TaskGetter, TaskNode } from '../types/taskNode'

export type TaskCostScope = 'tree' | 'lineage'

export type TaskCostBucket = {
  amount: number
  source: string
  unit: string
}

export type TaskTokenSummary = {
  cachedInput: number
  cachePercent: number | null
  input: number
  output: number
  total: number
}

export type TaskCostSummary = {
  accumulated: TaskCostBucket[]
  complete: boolean
  current: TaskCostBucket[]
  missing: {
    costTaskIds: string[]
    metadataTaskIds: string[]
    taskIds: string[]
    usageTaskIds: string[]
  }
  scope: TaskCostScope
  tokens: TaskTokenSummary
  total: TaskCostBucket[]
}

type TaskCostContribution = {
  billable: boolean
  costs: TaskCostBucket[]
  createdAt: number
  missingCost: boolean
  missingMetadata: boolean
  missingUsage: boolean
  taskId: string
  tokens: TaskTokenSummary
}

type TaskCostAggregate = {
  costs: TaskCostBucket[]
  latest: TaskCostContribution | undefined
  missingCostTaskIds: string[]
  missingMetadataTaskIds: string[]
  missingTaskIds: string[]
  missingUsageTaskIds: string[]
  tokens: TaskTokenSummary
}

type TaskCostServiceOptions = {
  getDirectChildren: (taskId: string) => Promise<ReadonlySet<string>>
  getMeta: (taskId: string) => Promise<TaskNodeMeta | null>
  getNextSiblings: (taskId: string) => Promise<ReadonlySet<string>>
  getTask: TaskGetter
  maxCacheSize?: number
}

const CHAT_COMPLETION_TOOL_NAME = 'chatCompletion'

const emptyTokens = (): TaskTokenSummary => ({
  cachedInput: 0,
  cachePercent: null,
  input: 0,
  output: 0,
  total: 0,
})

const emptyAggregate = (): TaskCostAggregate => ({
  costs: [],
  latest: undefined,
  missingCostTaskIds: [],
  missingMetadataTaskIds: [],
  missingTaskIds: [],
  missingUsageTaskIds: [],
  tokens: emptyTokens(),
})

const finiteNumber = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined

const isBillableTask = (task: TaskNode) =>
  task.content.type === 'functioncall' && task.content.data.name === CHAT_COMPLETION_TOOL_NAME

const hasBillingMetadata = (meta: TaskNodeMeta) =>
  Boolean(
    meta.costs?.length ||
    finiteNumber(meta.taskCosts) !== undefined ||
    meta.providerRequest ||
    finiteNumber(meta.promptTokens) !== undefined ||
    finiteNumber(meta.taskTokens) !== undefined,
  )

const readCosts = (meta: TaskNodeMeta): TaskCostBucket[] => {
  const costs = [...(meta.costs ?? [])]
  if (
    finiteNumber(meta.taskCosts) !== undefined &&
    !costs.some((cost) => cost.source === 'taskyon' && cost.unit === 'credits')
  ) {
    costs.push({ amount: meta.taskCosts!, source: 'taskyon', unit: 'credits' })
  }
  return costs
}

const readTokens = (meta: TaskNodeMeta): { available: boolean; tokens: TaskTokenSummary } => {
  const usage = meta.providerRequest?.usage
  const input = finiteNumber(usage?.inputTokens.total) ?? finiteNumber(meta.promptTokens)
  const output = finiteNumber(usage?.outputTokens.total) ?? finiteNumber(meta.resultTokens)
  const total =
    finiteNumber(usage?.totalTokens) ??
    finiteNumber(meta.taskTokens) ??
    (input !== undefined && output !== undefined ? input + output : undefined)
  const cachedInput = finiteNumber(usage?.inputTokens.cacheRead) ?? 0
  return {
    available: input !== undefined || output !== undefined || total !== undefined,
    tokens: {
      cachedInput,
      cachePercent: input && input > 0 ? (cachedInput / input) * 100 : null,
      input: input ?? 0,
      output: output ?? 0,
      total: total ?? 0,
    },
  }
}

const contributionForTask = async (
  task: TaskNode,
  getMeta: TaskCostServiceOptions['getMeta'],
): Promise<TaskCostContribution> => {
  const expected = isBillableTask(task)
  const meta = (await getMeta(task.id)) ?? null
  const costs = meta ? readCosts(meta) : []
  const usage = meta ? readTokens(meta) : { available: false, tokens: emptyTokens() }
  const billable = expected || (meta !== null && hasBillingMetadata(meta))
  return {
    billable,
    costs,
    createdAt: task.created_at ?? 0,
    missingCost: billable && costs.length === 0,
    missingMetadata: billable && meta === null,
    missingUsage: billable && !usage.available,
    taskId: task.id,
    tokens: usage.tokens,
  }
}

const addUnique = (values: string[], additions: readonly string[]) => [
  ...new Set([...values, ...additions]),
]

const mergeCosts = (...lists: readonly TaskCostBucket[][]) => {
  const merged = new Map<string, TaskCostBucket>()
  for (const list of lists) {
    for (const cost of list) {
      const key = `${cost.source}\u0000${cost.unit}`
      const previous = merged.get(key)
      merged.set(key, {
        amount: (previous?.amount ?? 0) + cost.amount,
        source: cost.source,
        unit: cost.unit,
      })
    }
  }
  return [...merged.values()].sort((a, b) =>
    `${a.source}\u0000${a.unit}`.localeCompare(`${b.source}\u0000${b.unit}`),
  )
}

const mergeTokens = (left: TaskTokenSummary, right: TaskTokenSummary): TaskTokenSummary => {
  const input = left.input + right.input
  const cachedInput = left.cachedInput + right.cachedInput
  return {
    cachedInput,
    cachePercent: input > 0 ? (cachedInput / input) * 100 : null,
    input,
    output: left.output + right.output,
    total: left.total + right.total,
  }
}

const mergeAggregates = (left: TaskCostAggregate, right: TaskCostAggregate): TaskCostAggregate => ({
  costs: mergeCosts(left.costs, right.costs),
  latest:
    !left.latest || (right.latest && right.latest.createdAt >= left.latest.createdAt)
      ? (right.latest ?? left.latest)
      : left.latest,
  missingCostTaskIds: addUnique(left.missingCostTaskIds, right.missingCostTaskIds),
  missingMetadataTaskIds: addUnique(left.missingMetadataTaskIds, right.missingMetadataTaskIds),
  missingTaskIds: addUnique(left.missingTaskIds, right.missingTaskIds),
  missingUsageTaskIds: addUnique(left.missingUsageTaskIds, right.missingUsageTaskIds),
  tokens: mergeTokens(left.tokens, right.tokens),
})

const aggregateContribution = (contribution: TaskCostContribution): TaskCostAggregate => ({
  costs: contribution.costs,
  latest: contribution.billable ? contribution : undefined,
  missingCostTaskIds: contribution.missingCost ? [contribution.taskId] : [],
  missingMetadataTaskIds: contribution.missingMetadata ? [contribution.taskId] : [],
  missingTaskIds: [],
  missingUsageTaskIds: contribution.missingUsage ? [contribution.taskId] : [],
  tokens: contribution.tokens,
})

const subtractCosts = (
  total: readonly TaskCostBucket[],
  removed: readonly TaskCostBucket[],
): TaskCostBucket[] => {
  const removedByKey = new Map<string, number>()
  for (const cost of removed) {
    const key = `${cost.source}\u0000${cost.unit}`
    removedByKey.set(key, (removedByKey.get(key) ?? 0) + cost.amount)
  }
  return total
    .map((cost) => ({
      ...cost,
      amount: cost.amount - (removedByKey.get(`${cost.source}\u0000${cost.unit}`) ?? 0),
    }))
    .filter((cost) => cost.amount > 0)
}

const isComplete = (aggregate: TaskCostAggregate) =>
  aggregate.missingCostTaskIds.length === 0 &&
  aggregate.missingMetadataTaskIds.length === 0 &&
  aggregate.missingTaskIds.length === 0 &&
  aggregate.missingUsageTaskIds.length === 0

const toSummary = (scope: TaskCostScope, aggregate: TaskCostAggregate): TaskCostSummary => ({
  accumulated: subtractCosts(aggregate.costs, aggregate.latest?.costs ?? []),
  complete: isComplete(aggregate),
  current: aggregate.latest?.costs ?? [],
  missing: {
    costTaskIds: aggregate.missingCostTaskIds,
    metadataTaskIds: aggregate.missingMetadataTaskIds,
    taskIds: aggregate.missingTaskIds,
    usageTaskIds: aggregate.missingUsageTaskIds,
  },
  scope,
  tokens: aggregate.tokens,
  total: aggregate.costs,
})

export function createTaskCostService(options: TaskCostServiceOptions) {
  const cache = createLruCache<string, TaskCostAggregate>(options.maxCacheSize ?? 512)

  const readTask = async (taskId: string, missingTaskIds: Set<string>) => {
    try {
      const task = await options.getTask(taskId)
      if (!task) missingTaskIds.add(taskId)
      return task
    } catch {
      missingTaskIds.add(taskId)
      return null
    }
  }

  const findRootId = async (taskId: string, missingTaskIds: Set<string>) => {
    let currentId: string | undefined = taskId
    let rootId = taskId
    const visited = new Set<string>()
    while (currentId && !visited.has(currentId)) {
      visited.add(currentId)
      const task = await readTask(currentId, missingTaskIds)
      if (!task) return currentId
      rootId = task.id
      currentId = task.priorID ?? task.parentID
    }
    return currentId ?? rootId
  }

  const collectTree = async (rootId: string) => {
    const tasks: TaskNode[] = []
    const missingTaskIds = new Set<string>()
    const visited = new Set<string>()
    const taskById = new Map<string, TaskNode>()

    const visitNode = async (taskId: string): Promise<void> => {
      if (visited.has(taskId)) return
      const task = taskById.get(taskId) ?? (await readTask(taskId, missingTaskIds))
      if (!task) return
      taskById.set(task.id, task)
      visited.add(task.id)
      tasks.push(task)
      for (const childId of await options.getDirectChildren(task.id)) {
        await visitSiblingChain(childId)
      }
    }

    const visitSiblingChain = async (firstTaskId: string): Promise<void> => {
      const pending = [firstTaskId]
      const siblingVisited = new Set<string>()
      while (pending.length > 0) {
        const taskId = pending.pop()
        if (!taskId || siblingVisited.has(taskId)) continue
        siblingVisited.add(taskId)
        await visitNode(taskId)
        const task = taskById.get(taskId)
        if (!task) continue
        pending.push(...(await options.getNextSiblings(task.id)))
      }
    }

    await visitNode(rootId)
    return { missingTaskIds, tasks }
  }

  const aggregateTasks = async (
    tasks: readonly TaskNode[],
    missingTaskIds: ReadonlySet<string>,
  ) => {
    const contributions = await Promise.all(
      tasks.map((task) => contributionForTask(task, options.getMeta)),
    )
    let aggregate = emptyAggregate()
    for (const contribution of contributions) {
      aggregate = mergeAggregates(aggregate, aggregateContribution(contribution))
    }
    aggregate.missingTaskIds = [...missingTaskIds]
    return { aggregate, contributions }
  }

  const getLineageSummary = async (taskId: string): Promise<TaskCostSummary> => {
    const tasksNewestFirst: TaskNode[] = []
    const missingTaskIds = new Set<string>()
    const visited = new Set<string>()
    let currentId: string | undefined = taskId
    let cachedAggregate: TaskCostAggregate | undefined
    while (currentId && !visited.has(currentId)) {
      visited.add(currentId)
      const cached = cache.get(`lineage:${currentId}`)
      if (cached?.missingTaskIds.length === 0 && isComplete(cached)) {
        cachedAggregate = cached
        break
      }
      const task = await readTask(currentId, missingTaskIds)
      if (!task) break
      tasksNewestFirst.push(task)
      currentId = task.priorID ?? task.parentID
    }

    const { aggregate: localAggregate, contributions } = await aggregateTasks(
      tasksNewestFirst,
      missingTaskIds,
    )
    const combined = mergeAggregates(cachedAggregate ?? emptyAggregate(), localAggregate)
    if (isComplete(combined)) {
      const contributionById = new Map(contributions.map((item) => [item.taskId, item]))
      let prefix = cachedAggregate ?? emptyAggregate()
      for (const task of [...tasksNewestFirst].reverse()) {
        const contribution = contributionById.get(task.id)
        if (!contribution) continue
        prefix = mergeAggregates(prefix, aggregateContribution(contribution))
        if (isComplete(prefix)) cache.set(`lineage:${task.id}`, prefix)
      }
    }
    return toSummary('lineage', combined)
  }

  const getTreeSummary = async (taskId: string): Promise<TaskCostSummary> => {
    const taskCached = cache.get(`tree:${taskId}`)
    if (taskCached && isComplete(taskCached)) return toSummary('tree', taskCached)
    const missingRootTaskIds = new Set<string>()
    const rootId = await findRootId(taskId, missingRootTaskIds)
    const cached = cache.get(`tree:${rootId}`)
    if (cached && isComplete(cached)) return toSummary('tree', cached)
    const { tasks, missingTaskIds } = await collectTree(rootId)
    for (const missingId of missingRootTaskIds) missingTaskIds.add(missingId)
    const { aggregate } = await aggregateTasks(tasks, missingTaskIds)
    if (isComplete(aggregate)) {
      cache.set(`tree:${rootId}`, aggregate)
      tasks.forEach((task) => cache.set(`tree:${task.id}`, aggregate))
    }
    return toSummary('tree', aggregate)
  }

  return {
    clear: () => cache.clear(),
    getSummary: async (taskId: string, scope: TaskCostScope = 'tree') =>
      scope === 'lineage' ? await getLineageSummary(taskId) : await getTreeSummary(taskId),
  }
}
