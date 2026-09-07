import type { TaskNode, TaskNodeRecord } from '../types/taskNode'
import { walkTaskLineage, addTaskRelation, removeTaskRelation } from '../utils/taskTree'

/** A client-owned, disposable projection. Providers exchange facts, never chat selections. */
export type ClientTaskSource = {
  get: (request: { id: string }) => Promise<TaskNode | null>
  getMany?: ((request: { ids: string[] }) => Promise<TaskNode[]>) | undefined
  readRecords?: (
    request:
      | { mode: 'ids'; ids: string[] }
      | { mode: 'children'; parentID: string; after?: string },
  ) => Promise<{ records: TaskNodeRecord[]; next: string | null }>
}

export const createClientTaskModel = (source: ClientTaskSource) => {
  const records = new Map<string, TaskNodeRecord | TaskNode>()
  const tasks = new Map<string, TaskNode>()
  const children = new Map<string, Set<string>>()
  const completeParents = new Set<string>()
  const listeners = new Set<() => void>()
  const requests = new Map<string, Promise<void>>()
  let generation = 0
  const pins = new Map<string, number>()
  const notify = () => listeners.forEach((listener) => listener())

  const ingestRecord = (task: TaskNodeRecord | TaskNode) => {
    records.set(task.id, task)
    addTaskRelation(children, task.parentID, task.id)
  }
  const ingest = (task: TaskNode) => {
    ingestRecord(task)
    tasks.set(task.id, task)
    trim()
    notify()
  }
  const remove = (id: string) => {
    const parent = records.get(id)?.parentID
    if (parent) {
      removeTaskRelation(children, parent, id)
      completeParents.delete(parent)
    }
    records.delete(id)
    tasks.delete(id)
    completeParents.delete(id)
    notify()
  }
  const run = (key: string, action: (current: () => boolean) => Promise<void>) => {
    const pending = requests.get(key)
    if (pending) return pending
    const version = generation
    const request = action(() => version === generation).finally(() => {
      if (requests.get(key) === request) requests.delete(key)
    })
    requests.set(key, request)
    return request
  }
  const loadTask = async (id: string) => {
    if (!tasks.has(id))
      await run(`task:${id}`, async (current) => {
        const task = await source.get({ id })
        if (!current()) return
        if (!task) throw new Error('A task is currently unavailable.')
        ingest(task)
      })
    return tasks.get(id)
  }
  const lineageIds = (id: string) => {
    const ids: string[] = []
    const walk = walkTaskLineage(id)
    let step = walk.next()
    while (!step.done) {
      ids.push(step.value)
      step = walk.next(records.get(step.value))
    }
    return ids.reverse()
  }
  const lineage = (id: string) => lineageIds(id).flatMap((key) => tasks.get(key) ?? [])
  const loadLineage = (id: string) =>
    run(`lineage:${id}`, async (current) => {
      const walk = walkTaskLineage(id)
      let step = walk.next()
      while (!step.done && current()) {
        step = walk.next(await loadTask(step.value))
      }
      if (step.done && step.value === 'cycle') throw new Error('The task lineage contains a cycle.')
    })
  const loadTasks = async (ids: string[]) => {
    for (let offset = 0; offset < ids.length; offset += 100) {
      const batch = ids.slice(offset, offset + 100)
      const version = generation
      const loaded = source.getMany
        ? await source.getMany({ ids: batch })
        : (await Promise.all(batch.map((id) => source.get({ id })))).filter((task) => task !== null)
      if (version !== generation) throw new Error('The task session changed.')
      const returned = new Set(loaded.map((task) => task.id))
      if (batch.some((id) => !returned.has(id)))
        throw new Error('Some task contents are unavailable.')
      loaded.forEach(ingest)
    }
  }
  const loadChildren = (id: string) =>
    run(`children:${id}`, async (current) => {
      if (completeParents.has(id)) return
      if (!source.readRecords) throw new Error('Task record storage is unavailable to this client.')
      let after: string | undefined
      do {
        const page = await source.readRecords({
          mode: 'children',
          parentID: id,
          ...(after ? { after } : {}),
        })
        if (!current()) return
        page.records.forEach(ingestRecord)
        after = page.next ?? undefined
        notify()
      } while (after)
      for (const child of children.get(id) ?? []) {
        const prior = records.get(child)?.priorID
        if (prior && !children.get(id)?.has(prior)) throw new Error('A child chain is incomplete.')
      }
      completeParents.add(id)
      trim()
    })

  // A selected prior edge wins over alternative continuations. Independent child roots remain.
  const selectedChildren = (id: string, spine: ReadonlySet<string>, terminal?: string) => {
    const available = [...(children.get(id) ?? [])].flatMap((key) => records.get(key) ?? [])
    const continuations = new Map<string, typeof available>()
    for (const task of available) {
      if (!task.priorID) continue
      const siblings = continuations.get(task.priorID) ?? []
      siblings.push(task)
      continuations.set(task.priorID, siblings)
    }
    for (const siblings of continuations.values()) {
      siblings.sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0) || a.id.localeCompare(b.id))
    }
    const selected: string[] = []
    const seen = new Set<string>()
    const pending = available
      .filter((task) => !task.priorID)
      .sort((a, b) => (a.created_at ?? 0) - (b.created_at ?? 0) || a.id.localeCompare(b.id))
      .reverse()
    while (pending.length) {
      const task = pending.pop()!
      if (seen.has(task.id)) continue
      seen.add(task.id)
      selected.push(task.id)
      if (task.id === terminal) continue
      const next = continuations.get(task.id) ?? []
      const continuation = next.find((candidate) => spine.has(candidate.id)) ?? next[0]
      if (continuation) pending.push(continuation)
    }
    return selected
  }
  const selectionIds = (id: string) => {
    const spineIds = lineageIds(id)
    const spine = new Set(spineIds)
    const selected = new Set<string>()
    const pending = spineIds.reverse()
    while (pending.length) {
      const key = pending.pop()!
      if (selected.has(key)) continue
      selected.add(key)
      pending.push(...selectedChildren(key, spine, id).reverse())
    }
    return [...selected]
  }
  const selection = (id: string) => selectionIds(id).flatMap((key) => tasks.get(key) ?? [])
  const discover = (id: string) =>
    run(`discover:${id}`, async (current) => {
      await loadLineage(id)
      const visited = new Set<string>()
      while (current()) {
        const pending = selectionIds(id).filter((key) => !visited.has(key))
        if (!pending.length) return
        for (const key of pending) {
          if (!current()) return
          visited.add(key)
          await loadChildren(key)
          const record = records.get(key)
          if (record && record.role !== 'system') await loadTask(key)
        }
      }
    })
  const loadResults = async (id: string, selectedId: string) => {
    const version = generation
    await loadChildren(id)
    if (version !== generation) throw new Error('The task session changed.')
    const spine = new Set(lineageIds(selectedId))
    const pending = [...selectedChildren(id, spine, selectedId)]
    const seen = new Set<string>()
    const results: TaskNode[] = []
    while (pending.length) {
      const key = pending.shift()!
      if (seen.has(key)) continue
      seen.add(key)
      const task = await loadTask(key)
      if (version !== generation) throw new Error('The task session changed.')
      if (!task) continue
      if (['toolresult', 'structured', 'error'].includes(task.content.type)) results.push(task)
    }
    return results
  }
  const exportSelection = async (id: string) => {
    const version = generation
    pins.set(id, (pins.get(id) ?? 0) + 1)
    try {
      completeParents.clear()
      await discover(id)
      const ids = selectionIds(id)
      await loadTasks(ids)
      if (version !== generation || ids.some((key) => !tasks.has(key)))
        throw new Error('The complete task selection is unavailable.')
      return ids.map((key) => tasks.get(key)!)
    } finally {
      const count = (pins.get(id) ?? 1) - 1
      if (count) pins.set(id, count)
      else pins.delete(id)
      trim()
    }
  }
  const clear = () => {
    generation++
    records.clear()
    tasks.clear()
    children.clear()
    completeParents.clear()
    requests.clear()
    notify()
  }
  const trim = () => {
    const retained = new Set([...pins.keys()].flatMap(selectionIds))
    for (const id of records.keys()) {
      if (records.size <= 5000) break
      if (!retained.has(id)) remove(id)
    }
  }
  return {
    ingest,
    remove,
    lineage,
    selection,
    loadLineage,
    discover,
    loadResults,
    exportSelection,
    clear,
    setSource: (next: ClientTaskSource) => {
      source = next
      clear()
    },
    get: (id: string) => tasks.get(id),
    retain: (id: string) => {
      pins.set(id, (pins.get(id) ?? 0) + 1)
      return () => {
        const count = (pins.get(id) ?? 1) - 1
        if (count) pins.set(id, count)
        else pins.delete(id)
        trim()
      }
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

export type ClientTaskModel = ReturnType<typeof createClientTaskModel>
