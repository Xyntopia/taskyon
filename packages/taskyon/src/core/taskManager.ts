import { load } from 'js-yaml'
import type { PartialDeep } from 'type-fest'
import z from 'zod'
import { TaskNodeMeta } from '../types/chatCompletion'
import type { TaskTreeNode } from '../types/taskNode'
import { TaskNode, partialTaskDraft } from '../types/taskNode'
import type { InternalTool } from '../types/toolApi'
import {
  createProtocolStorageCrudWrapper,
  createStorageProtocolServer,
  createStorageRecordBackend,
  type StorageBlobBackend,
  type StorageRecordBackend,
  type StorageRecordCrud,
  type TaskyonStorageMessage,
} from '../api/storageProtocol'
import type { Port } from '@taskyon/common/modules/frpBus'
import { lockMap, sleep } from '../utils/asyncUtils'
import {
  createCombinedCrudWrapper,
  createMapCrudWrapper,
  createPgLiteCrudWrapper,
  createVectorStore,
  withImmutable,
  withKeyLockings,
} from '../utils/crudWrapper'
import type { TyPGDB } from '../utils/pglite.api'
import { createTaskNode } from './createTasks'
import { addMarkdownTaskChain } from './markdownTaskIO'
import {
  findContinuationLeafTaskIds,
  selectTaskChainIdSelection,
  type TaskChainSelection,
} from './taskChainSelection'
import type { ToolStorageRecord } from './toolManager'
import { ToolStorageRecord as ToolStorageRecordSchema } from './toolManager'
import type { ToolManager } from './toolManager'

export type TaskManagerStorage = {
  tasks: StorageRecordCrud<TaskNode>
  meta: StorageRecordCrud<TaskNodeMeta>
  tools: StorageRecordCrud<ToolStorageRecord>
}

const taskStorageTables = ['taskyonNodes', 'metaDb', 'toolRegistry'] as const
type TaskStorageTable = (typeof taskStorageTables)[number]

const isTaskStorageTable = (value: string): value is TaskStorageTable =>
  taskStorageTables.some((table) => table === value)

const taskManagerStorageNamespace = (sessionId: string, table: TaskStorageTable) =>
  `${sessionId}/${table}`

const parseTaskManagerStorageNamespace = (namespace: string) => {
  const separator = namespace.lastIndexOf('/')
  if (separator <= 0 || separator === namespace.length - 1) {
    throw new Error(`Invalid Taskyon task storage namespace: ${namespace}`)
  }
  const sessionId = namespace.slice(0, separator)
  const table = namespace.slice(separator + 1)
  if (!isTaskStorageTable(table)) {
    throw new Error(`Unknown Taskyon task storage table: ${table}`)
  }
  return { sessionId, table }
}

export const createPgLiteTaskManagerStorage = async (
  taskyonDb: TyPGDB,
): Promise<TaskManagerStorage> => {
  const withBatches = <T>(crud: Awaited<ReturnType<typeof createPgLiteCrudWrapper<T>>>) => ({
    ...crud,
    getMany: async (ids: readonly (string | number)[]) => {
      const rows: { id: string | number; data: T }[] = []
      for (const id of ids) {
        const data = await crud.get(id)
        if (data !== null) rows.push({ id, data })
      }
      return rows
    },
    setMany: async (rows: readonly { id: string | number; data: T }[]) => {
      await crud.batchInsert([...rows], 'overwrite')
    },
  })
  return {
    tasks: withBatches(
      await createPgLiteCrudWrapper<TaskNode>(taskyonDb, { tableName: 'taskyonNodes' }),
    ),
    meta: withBatches(
      await createPgLiteCrudWrapper<TaskNodeMeta>(taskyonDb, { tableName: 'metaDb' }),
    ),
    tools: withBatches(
      await createPgLiteCrudWrapper<ToolStorageRecord>(taskyonDb, { tableName: 'toolRegistry' }),
    ),
  }
}

export const connectTaskManagerStorageFromProtocol = (
  port: Port<TaskyonStorageMessage, TaskyonStorageMessage>,
  sessionId: string,
): TaskManagerStorage => {
  return {
    tasks: createProtocolStorageCrudWrapper(
      port,
      taskManagerStorageNamespace(sessionId, 'taskyonNodes'),
      TaskNode,
    ),
    meta: createProtocolStorageCrudWrapper(
      port,
      taskManagerStorageNamespace(sessionId, 'metaDb'),
      TaskNodeMeta,
    ),
    tools: createProtocolStorageCrudWrapper(
      port,
      taskManagerStorageNamespace(sessionId, 'toolRegistry'),
      ToolStorageRecordSchema,
    ),
  }
}

export const createPgLiteTaskManagerStorageService = (
  port: Port<TaskyonStorageMessage, TaskyonStorageMessage>,
  getDb: (sessionId: string) => Promise<TyPGDB>,
  resolveFallback?: (namespace: string) => Promise<StorageRecordBackend> | StorageRecordBackend,
  resolveBlobBackend?: (namespace: string) => Promise<StorageBlobBackend> | StorageBlobBackend,
) => {
  const sessionStorage = new Map<string, Promise<TaskManagerStorage>>()
  const backendCache = new Map<string, Promise<StorageRecordBackend>>()
  const storageForSession = (sessionId: string) => {
    const existing = sessionStorage.get(sessionId)
    if (existing) return existing
    const created = getDb(sessionId).then(createPgLiteTaskManagerStorage)
    sessionStorage.set(sessionId, created)
    return created
  }

  const resolveBackend = async (namespace: string): Promise<StorageRecordBackend> => {
    const cached = backendCache.get(namespace)
    if (cached) return cached
    const separator = namespace.lastIndexOf('/')
    const table = separator > 0 ? namespace.slice(separator + 1) : ''
    if (!isTaskStorageTable(table)) {
      if (!resolveFallback) throw new Error(`Unknown Taskyon storage namespace: ${namespace}`)
      const fallback = Promise.resolve(resolveFallback(namespace))
      backendCache.set(namespace, fallback)
      return await fallback
    }
    const created = storageForSession(parseTaskManagerStorageNamespace(namespace).sessionId).then(
      (storage) => {
        const { table } = parseTaskManagerStorageNamespace(namespace)
        switch (table) {
          case 'taskyonNodes':
            return createStorageRecordBackend(storage.tasks, TaskNode)
          case 'metaDb':
            return createStorageRecordBackend(storage.meta, TaskNodeMeta)
          case 'toolRegistry':
            return createStorageRecordBackend(storage.tools, ToolStorageRecordSchema)
        }
      },
    )
    backendCache.set(namespace, created)
    return created
  }

  return createStorageProtocolServer(
    port,
    { records: resolveBackend, ...(resolveBlobBackend ? { blobs: resolveBlobBackend } : {}) },
    { mode: 'trusted-local' },
  )
}

/**
 *
 * Finds the root task of a given task.
 *
 * @param {string} taskId - The ID of the task.
 * @returns {string} - The ID of the root task, or null if not found.
 */
export async function findRootTask(taskId: string, getTask: TyTaskManager['getTask']) {
  let currentTaskID = taskId

  while (currentTaskID) {
    const currentTask = await getTask(currentTaskID)
    if (!currentTask) return null // Return null if a task doesn't exist

    if (currentTask.priorID) {
      currentTaskID = currentTask.priorID // Trace back to the parent task
    } else {
      return currentTaskID // Return the current task ID if it has no parent
    }
  }

  return currentTaskID // Return null if the loop exits without finding a root task
}

async function useTaskVectors(
  db: TyPGDB,
  getAllTaskIds: () => Promise<(string | number)[]>,
  getTask: (taskId: string) => Promise<TaskNode | null>,
  getToolDefinition: (name: string) => Promise<{ tool?: InternalTool }>,
  vectorizer: 'static-multilingual' | 'transformer-minilm',
) {
  const vecDb = await createVectorStore<TaskNode>(db, 'tyTaskVectors', { vectorizer })

  async function shouldSkipVectorIndex(task: TaskNode) {
    if (task.content.type === 'return') {
      return task.content.data === 'assistant answered'
    }

    if (task.content.type !== 'functioncall') return false

    const { tool } = await getToolDefinition(task.content.data.name)
    return tool?.renderOptions?.hideVector === true
  }

  async function syncVectorIndexWithTasks(progressCallback: (done: number, total: number) => void) {
    let counter = 0
    //taskyonDB.vectormappings.exportJSON()
    const taskIDs = await getAllTaskIds()
    for (const taskId of taskIDs) {
      const task = await getTask(String(taskId))
      progressCallback(counter, taskIDs.length)
      // addtovectorDB checks if a task already exists...
      if (task) await addtoVectorDB(task)
      counter += 1
    }

    //await sleep(10);
    //await vectorIndex.writeIndex(vectorIndexName);
    progressCallback(taskIDs.length, taskIDs.length)

    console.log('Sync complete.')
  }

  // TODO: make sure, we also stringify tool calls etc...
  // TODO: try to get rid of unnecessary characters in the string...
  //       e.g. remove parenthesis from json etc..
  const task2Str = (t: Partial<TaskNode>) => JSON.stringify(t.content)

  async function addtoVectorDB(task: TaskNode) {
    const existingVector = await vecDb.get(task.id)
    if (existingVector) {
      console.log('vector already exists!', task.id)
    } else if (await shouldSkipVectorIndex(task)) {
      console.log('skip indexing of task', task.id)
    } else {
      console.log('create vector...', task.id)
      const txt = task2Str(task)
      // Save the task to the vector DB, but exclude content.data to save space...
      const taskWithoutData = { ...task, content: { type: task.content.type, data: undefined } }
      await vecDb.upsert(task.id, txt, taskWithoutData)
    }
  }

  /**
   * So here we use q MangoQuery "query", which we can use to pre-filter our vector search.
   *
   *
   *
   * @param searchTerm
   * @param query
   * @param k
   * @returns
   */
  async function filteredVectorSearch(
    searchTerm: string,
    k = 10,
    taskTemplate?: PartialDeep<TaskNode>,
  ): Promise<{ taskId: string; distance: number }[]> {
    const result = await vecDb.search(searchTerm, k, undefined, taskTemplate)
    return result.map((r) => ({ taskId: r.id, distance: r.distance }))
  }

  async function filterSearch(
    k = 10,
    taskTemplate?: PartialDeep<TaskNode>,
  ): Promise<{ taskId: string; distance: 0 }[]> {
    const res = await vecDb.find(taskTemplate, {
      limit: k,
      orderBy: { kind: 'dataKey', key: 'created_at' },
      orderDir: 'desc',
    })
    return Object.values(res).map((t) => ({ taskId: t.id, distance: 0 }))
  }

  async function searchSimilarTasks(task: Partial<TaskNode>, k = 10) {
    const searchStr = task2Str(task)
    return filteredVectorSearch(searchStr, k)
  }

  return {
    filterSearch,
    syncVectorIndexWithTasks,
    deleteTaskFromVectorStore: vecDb.delete,
    addtoVectorDB,
    filteredVectorSearch,
    resetTaskVectors: vecDb.clear,
    countVecs: vecDb.count,
    searchSimilarTasks,
  }
}

// we use this in order to lock tasks!
type LockItem = (id: string | number) => Promise<() => void>

const withLock =
  (lockItem: LockItem) =>
  async <F extends () => unknown>(
    func: F,
    id: string | number,
  ): Promise<Awaited<ReturnType<F>>> => {
    const unlock = await lockItem(id)
    try {
      return Promise.resolve(func() as ReturnType<F>)
    } finally {
      unlock()
    }
  }

// TODO:  break down  the individual parts of TaskManager this way into smaller parts:
//        - on top of that build a function which encapsulates all the "high-level  function such as getting files etc..."
//        - the vector store part
//        - the taskDB part
//        - he file search part etc...
// Function to create the database
/*
  TyTaskManager is build with reactivity in mind. you can supply a reactive map
  to the constructor. it will be kept in sync with the taskdb and supplies reactive changes
  to the UI. We could have used the function of RxDB for this. But this approach would have been
  less flexible...
*/
export async function useTyTaskManager(
  taskyonDb: TyPGDB,
  options: {
    indexTaskVectors: boolean
    resolveTool?: ToolManager['resolveTool']
    storage?: TaskManagerStorage
    taskSearchVectorizer?: 'static-multilingual' | 'transformer-minilm'
  } = {
    indexTaskVectors: true,
  },
) {
  console.log('Initialize task manager with db:', taskyonDb.name)
  const storage = options.storage ?? (await createPgLiteTaskManagerStorage(taskyonDb))

  // because our tasks only have parent IDs defined, we keep a cache of
  // child IDs in order to be able to do faster tree traversals...
  const nextSiblingMap = new Map<string, Set<string>>()
  const parentToChildMap = new Map<string, Set<string>>()
  const immediateChildrenMap = new Map<string, Set<string>>()

  function deleteFromChildAndSiblings(task: TaskNode) {
    if (task.priorID) {
      const siblings = nextSiblingMap.get(task.priorID)
      if (siblings) {
        siblings.delete(task.id)
        if (siblings.size === 0) {
          nextSiblingMap.delete(task.priorID)
        }
      }
    }
    if (task.parentID) {
      const children = parentToChildMap.get(task.parentID)
      if (children) {
        children.delete(task.id)
        if (children.size === 0) {
          parentToChildMap.delete(task.parentID)
        }
      }
    }
    if (!task.priorID && task.parentID) {
      const immediateChildren = immediateChildrenMap.get(task.parentID)
      if (immediateChildren) {
        immediateChildren.delete(task.id)
        if (immediateChildren.size === 0) {
          immediateChildrenMap.delete(task.parentID)
        }
      }
    }
  }

  function updateChildAndSiblingMap(task: TaskNode) {
    if (task.priorID) {
      const currentSiblings = nextSiblingMap.get(task.priorID) ?? new Set<string>()
      currentSiblings.add(task.id)
      nextSiblingMap.set(task.priorID, currentSiblings)
    }
    if (task.parentID) {
      const currentChildren = parentToChildMap.get(task.parentID) ?? new Set<string>()
      currentChildren.add(task.id)
      parentToChildMap.set(task.parentID, currentChildren)
    }
    if (task.parentID && !task.priorID) {
      const currentImmediateChildren = immediateChildrenMap.get(task.parentID) ?? new Set<string>()
      currentImmediateChildren.add(task.id)
      immediateChildrenMap.set(task.parentID, currentImmediateChildren)
    }
  }

  // make sure that we remove the "upsert" function for tyCrud in order
  // to make sure the data inside stays immutable...
  const mod = createCombinedCrudWrapper([
    createMapCrudWrapper(new Map<string, TaskNode>()),
    storage.tasks,
  ])
  const tyCrud = withImmutable(mod, {
    hash: (data: TaskNode) => {
      return data.id
    },
  })

  const getAllTaskIds = tyCrud.listIds

  // TODO: unify our tyCrudVec and useTaskVectors in one db...
  const resolveTool = options.resolveTool ?? (() => Promise.resolve({}))
  const taskVectors = await useTaskVectors(
    taskyonDb,
    getAllTaskIds,
    tyCrud.get,
    resolveTool,
    options.taskSearchVectorizer ?? 'static-multilingual',
  )

  // taskLocks
  const { lockItem, clearLocks } = lockMap('TaskLocks')
  const execWLock = withLock(lockItem)
  // add more enhanced, ty-specific functionality to our CRUD
  const taskDb = {
    ...tyCrud,
    get: async (id: string | number) =>
      await execWLock(async () => {
        //console.log('get task from db', taskyonDb.name)
        const task = await tyCrud.get(id)
        if (task) updateChildAndSiblingMap(task)
        return task
      }, id),
    add: async (
      task: partialTaskDraft,
      options: {
        createMeta?: 'missing' | 'overwrite'
        vectors?: boolean
      } = { createMeta: 'missing', vectors: false },
    ) => {
      const completeTask = await createTaskNode(task, { createMeta: options.createMeta })

      console.log('create new Task:', completeTask)
      await execWLock(async () => {
        await tyCrud.add(completeTask)
        if (options.vectors) {
          void taskVectors.addtoVectorDB(completeTask).catch((error: unknown) => {
            console.warn('vector indexing failed', {
              taskId: completeTask.id,
              error: error instanceof Error ? error.message : String(error),
            })
          })
        }
        // Update parent-child cache
        updateChildAndSiblingMap(completeTask)
      }, completeTask.id)
      return completeTask
    },
    delete: async (id: string | number) =>
      await execWLock(async () => {
        // Delete from local record/memorydb
        const task = await tyCrud.get(id)
        if (task) void deleteFromChildAndSiblings(task)
        void tyCrud.delete(id)
        void taskVectors.deleteTaskFromVectorStore(id.toString())
      }, id),
    clear: async () => {
      clearLocks()
      await tyCrud.clear()
      clearLocks()
    },
  }

  // we are using mapWrapper first, because it is the fastest
  const metaDb = withKeyLockings(
    createCombinedCrudWrapper([
      createMapCrudWrapper<TaskNodeMeta>(new Map<string, TaskNodeMeta>()),
      storage.meta,
    ]),
  )

  async function countTasks() {
    return (await taskDb.listIds()).length
  }

  function createCachedIdSearch(
    cache: Map<string, Set<string>>,
    findTaskIds: (key: string) => Promise<Set<string>>,
  ) {
    return async (key: string): Promise<Set<string>> => {
      const cached = cache.get(key)
      if (!cached) {
        const dbResults = await findTaskIds(key)
        cache.set(key, dbResults)
        return dbResults
      } else {
        return cached
      }
    }
  }

  const searchNextSibling = createCachedIdSearch(nextSiblingMap, async (priorID) => {
    const tasks = await storage.tasks.find({ priorID })
    return new Set(Object.keys(tasks))
  })

  const findSiblingLeafTasks = async (taskId: string) =>
    await findContinuationLeafTaskIds(taskId, taskDb.get, searchNextSibling)

  // direct children: parentID match AND (no priorID key OR priorID is null)
  const searchAllDirectChildren = createCachedIdSearch(
    immediateChildrenMap,
    async (parentID: string) => {
      const tasks = await storage.tasks.find({ parentID })
      return new Set(
        Object.values(tasks)
          .filter((task) => !task.priorID)
          .map((task) => task.id),
      )
    },
  )

  const invalidateTaskRelationCaches = (task: Pick<TaskNode, 'parentID' | 'priorID'>) => {
    if (task.parentID && !task.priorID) immediateChildrenMap.delete(task.parentID)
    if (task.priorID) nextSiblingMap.delete(task.priorID)
  }

  // all children: just parentID match
  const searchAllChildren = createCachedIdSearch(parentToChildMap, async (parentID: string) => {
    const tasks = await storage.tasks.find({ parentID })
    return new Set(Object.keys(tasks))
  })

  async function convertTaskIDs(taskIds: string[]) {
    const taskList = await Promise.all(
      taskIds.map(async (tid) => {
        const t = await taskDb.get(tid)
        if (t != null || t != undefined) return t
        console.log('no acces to task:', tid)
        return {
          id: tid,
          role: 'system',
          content: {
            type: 'error',
            data: `We can not access Task #${tid}`,
          },
        } satisfies TaskNode
      }),
    )

    // Check if any tasks are "null" or "undefined" and add an error task
    return taskList
  }

  const getTaskChain = async (
    taskId: string,
    maxFollow = 1e9,
    selection: TaskChainSelection = { method: 'flattened' },
  ): Promise<TaskNode[]> => await convertTaskIDs(await getTaskIdChain(taskId, maxFollow, selection))

  // first, get all immediate children and then, for each of them get all their leaf siblings
  // then from each leaf sibling go backwards through prior & parent IDs to create
  // a chain with the last task being the leaf.
  const getTaskResults = async (taskId: string) => {
    const immediateChildren = await searchAllDirectChildren(taskId)
    const leafTasks: string[] = []

    for (const childId of immediateChildren) {
      const siblingLeafTasks = await findSiblingLeafTasks(childId)
      leafTasks.push(...siblingLeafTasks)
    }

    return leafTasks
  }

  // Builds the task subtree rooted at the given task id.
  async function buildTaskTreeNode(taskId: string, maxDepth: number): Promise<TaskTreeNode> {
    const task = await taskDb.get(taskId)
    if (!task) throw new Error(`Task ${taskId} not found`)

    const children: TaskTreeNode[][] = []
    // Only fetch children if we haven't hit the depth limit.
    if (maxDepth > 0) {
      const directChildIds = await searchAllDirectChildren(taskId)
      for (const childId of directChildIds) {
        // For each direct child, build its sibling chain at the next depth.
        const siblingChain = await buildSiblingChain(childId, maxDepth - 1)
        children.push(siblingChain)
      }
    }

    return { task, children }
  }

  // Follows the next-sibling chain starting at taskId.
  async function buildSiblingChain(taskId: string, maxDepth: number): Promise<TaskTreeNode[]> {
    const chain: TaskTreeNode[] = []
    let currentId: string | undefined = taskId

    while (currentId) {
      const node = await buildTaskTreeNode(currentId, maxDepth)
      chain.push(node)

      // Find the next sibling using the priorID pointer.
      const siblingSet = await searchNextSibling(currentId)
      if (siblingSet.size > 0) {
        if (siblingSet.size > 1) {
          console.warn(
            `Multiple siblings found for task ${currentId}. Using the latest created task.`,
          )
          const siblingArray = Array.from(siblingSet)
          const siblingTasks = await Promise.all(siblingArray.map((id) => taskDb.get(id)))
          siblingTasks.sort((a, b) => (b?.created_at ?? 0) - (a?.created_at ?? 0))
          siblingTasks
            .slice(1)
            .forEach((task) => console.warn(`Ignoring sibling task: ${task?.id}`))
          currentId = siblingTasks[0]?.id
        } else {
          currentId = siblingSet.values().next().value
        }
      } else {
        currentId = undefined
      }
    }

    return chain
  }

  const getChildChains = async (taskId: string): Promise<TaskNode[][]> =>
    (await buildTaskTreeNode(taskId, 1)).children.map((chain) => chain.map((node) => node.task))

  async function getFlattenedChain(
    taskId: string,
    maxFollow: number,
    untilTaskID: string | undefined,
    onlyFirstChild: boolean,
    isLastTask: boolean,
  ): Promise<string[]> {
    if (maxFollow <= 0) return []
    // get all leaf children from prior task but only if we are not the last task..:
    const taskAndChildren: string[] = [taskId]
    if (!isLastTask) {
      const leafs = await getTaskResults(taskId)
      if (leafs[0] && onlyFirstChild) {
        const childChain = await getFlattenedChain(leafs[0], maxFollow - 1, taskId, true, false)
        taskAndChildren.push(...childChain)
      } else if (!onlyFirstChild) {
        // TODO: enable some method how we can merge multiple parallel subtask chains. E.g. only take the last message
        // results or something like that. Or assume, that we hade a "merger"
        // task which summarizes the results of some sort...
        throw new Error('we can not use multi task results yet!')
      }
    }

    // newMaxFollow will always be at max `maxFollow-1` because taskAndChildren includes the current TaskId.
    const newMaxFollow = maxFollow - taskAndChildren.length

    // we don't get children from this task, only from prior ones...
    const task = await taskDb.get(taskId)

    // get prior task chain...
    if (task?.priorID && !(task.priorID === untilTaskID)) {
      const priorTaskChain = await getFlattenedChain(
        task.priorID,
        newMaxFollow,
        untilTaskID,
        true,
        false,
      )
      return [...priorTaskChain, ...taskAndChildren]
    } else if (task?.parentID && !(task.parentID === untilTaskID)) {
      const priorParentTaskChain = await getFlattenedChain(
        task.parentID,
        newMaxFollow,
        untilTaskID,
        true,
        true,
      )
      return [...priorParentTaskChain, ...taskAndChildren]
    } else {
      return [...taskAndChildren]
    }
  }

  const taskChainSelectionAccess = {
    getTask: taskDb.get,
    getFlattenedChain: (
      rootTaskId: string,
      limit: number,
      stopTaskId: string | undefined,
      useOnlyFirstChild: boolean,
    ) => getFlattenedChain(rootTaskId, limit, stopTaskId, useOnlyFirstChild, true),
    searchAllDirectChildren,
    findSiblingLeafTasks,
  }

  const getTaskIdSelection = (
    taskId: string,
    maxFollow = 1e9, // by default we can follow 1mio. tasks...
    selection: TaskChainSelection = { method: 'flattened' },
  ) => selectTaskChainIdSelection(taskId, maxFollow, selection, taskChainSelectionAccess)

  const getTaskIdChain = (
    taskId: string,
    maxFollow = 1e9,
    selection: TaskChainSelection = { method: 'flattened' },
  ) => getTaskIdSelection(taskId, maxFollow, selection).then(({ taskIds }) => taskIds)

  const getTaskChainSelection = async (
    taskId: string,
    maxFollow = 1e9,
    selection: TaskChainSelection = { method: 'flattened' },
  ) => {
    const selected = await getTaskIdSelection(taskId, maxFollow, selection)
    return {
      tasks: await convertTaskIDs(selected.taskIds),
      includedSubtaskTaskIds: selected.includedSubtaskTaskIds,
    }
  }

  async function deleteAllTasks() {
    // TODO: also delete vectordb! (will be done automatically, once we transition to pglite)
    // TODO: manually re-initialized taskyondb after remove...
    await taskVectors.resetTaskVectors()
    await taskDb.clear()
    await metaDb.clear()
    // we are doing the sleep here because some parts
    // of our app re-load the browser and that prevents the
    // deletion from happening..
    await sleep(500)
  }

  // deletes tasks from the supplied leaf up to the first branch
  // "split", eliminating a branch
  // which is defined by the leaf and preceding, exclusive tasks to this branch
  async function deleteTaskThread(leafId: string) {
    let currentTaskId = leafId

    while (currentTaskId) {
      const currentTask = await taskDb.get(currentTaskId)
      if (!currentTask) break // Break if a task doesn't exist

      // Check if the parent task has more than one child
      if (currentTask.priorID) {
        const childrenIDs = await searchNextSibling(currentTask.priorID)
        if (childrenIDs.size > 1) {
          // in this case we need to update the parent with the fewer children
          break // Stop deletion if the parent task has more than one child. We only want to delete this branch...
        }
      }

      // Delete the current task
      void taskDb.delete(currentTaskId)

      if (currentTask.priorID) {
        // Move to the parent task
        currentTaskId = currentTask.priorID
      } else {
        break
      }
    }
  }

  const searchTasks: (where: PartialDeep<TaskNode>) => Promise<Record<string, TaskNode>> =
    storage.tasks.find

  async function getJsonTaskBackup() {
    // TODO: give this a callback so that we can save it in "chunks"
    console.log('exporting json backup db!')
    const allNodes = await taskDb.listAll()
    return JSON.stringify(allNodes.map((r) => r.data))
  }

  // import tasks from json! :)
  // TODO: remove this function and replace this with a list of tasknode json functions!!
  //       we want to get rid of our rxdb dependency here... we could even backup tass as markdown!  that might be even better :)
  async function addTaskBackup(jsonObjString: string) {
    const jsonObj = JSON.parse(jsonObjString)
    if (Array.isArray(jsonObj)) {
      await Promise.all(
        jsonObj.map(async (obj) => {
          const res = TaskNode.safeParse(obj)
          if (res.success) {
            await taskDb.add(res.data)
          } else {
            console.warn('Could not add data:', res.data, res.error)
          }
        }),
      )
    }
  }

  // add a task to the db. Adding some default information such as timestamps etc...
  // whats important here is that the TaskNode can only have one type of content
  // so when calling the function, we need to pre-select which type of task
  // we want to have.
  const addPartialTask2Tree = (task: partialTaskDraft) =>
    taskDb.add(task, { createMeta: 'missing', vectors: options.indexTaskVectors !== false })

  async function addTaskChain(
    taskList: partialTaskDraft[],
    priorID: string | undefined = undefined,
    parentID: string | undefined = undefined,
  ) {
    let lastTaskId = priorID
    const addedTaskList: TaskNode[] = []
    for (const task of taskList) {
      const addedTask = await addPartialTask2Tree({ ...task, priorID: lastTaskId, parentID })
      invalidateTaskRelationCaches(addedTask)
      lastTaskId = addedTask.id
      addedTaskList.push(addedTask)
    }
    return addedTaskList
  }

  // TODO: also move this outside of taskmanager!
  async function loadYamlConversation(input: File | string): Promise<string | undefined> {
    console.log('adding tasknodes & conversations from yaml input!')

    let taskListRaw: unknown
    if (typeof input === 'string') {
      taskListRaw = load(input)
    } else {
      const fileStr = await input.text()
      taskListRaw = load(fileStr)
    }

    const taskList = await z.array(partialTaskDraft).parseAsync(taskListRaw)
    const newTaskList = await addTaskChain(taskList)
    return newTaskList.at(-1)?.id
  }

  // TODO: move outside taskmanager as a separate function which returns partialTaskNodes
  async function addMdTaskChain(markdown?: string) {
    console.log('adding new Markdown tasks!!')
    if (markdown) {
      let lastTaskId: string | undefined
      const newTaskList = await addMarkdownTaskChain(markdown, async (task) => {
        const addedTask = await addPartialTask2Tree({ ...task, priorID: lastTaskId })
        lastTaskId = addedTask.id
        return addedTask
      })
      return newTaskList.at(-1)?.id
    }
    return undefined
  }

  const defaultMode = {
    getTask: taskDb.get,
    deleteTask: taskDb.delete,
    searchTasks,
    taskStream: taskDb.liveStream,
    getJsonTaskBackup,
    addTaskBackup,
    deleteAllTasks,
    deleteTaskThread,
    countTasks,
    findSiblingLeafTasks,
    searchNextSibling,
    searchAllDirectChildren,
    searchAllChildren,
    loadYamlConversation,
  }

  const metaUpsertLogged = async (
    id: string | number,
    data: TaskNodeMeta,
    strategy?: 'shallow_merge' | 'replace' | 'deepmerge' | 'native_shallow',
  ) => {
    const payload = data as Record<string, unknown>
    const hasError = Object.prototype.hasOwnProperty.call(payload ?? {}, 'error')
    const keys = payload ? Object.keys(payload) : []
    console.log('[DEBUGDB] metaUpsert:start', {
      taskId: id,
      strategy: strategy ?? 'replace',
      keys,
      hasError,
      errorType: hasError ? typeof payload?.['error'] : undefined,
    })
    try {
      const out = await metaDb.upsert(id, data, strategy)
      const outKeys =
        out && typeof out === 'object' ? Object.keys(out as Record<string, unknown>) : []
      console.log('[DEBUGDB] metaUpsert:done', {
        taskId: id,
        strategy: strategy ?? 'replace',
        outKeys,
        hasError: !!(out && typeof out === 'object' && 'error' in (out as Record<string, unknown>)),
      })
      return out
    } catch (error) {
      console.error('[DEBUGDB] metaUpsert:failed', {
        taskId: id,
        strategy: strategy ?? 'replace',
        error,
      })
      throw error
    }
  }

  return {
    ...defaultMode,
    ...(taskVectors ?? {}),
    getTaskIdChain,
    getTaskChain,
    getTaskChainSelection,
    convertTaskIDs,
    buildSiblingChain,
    buildTaskTreeNode,
    getChildChains,
    addPartialTask2Tree,
    addTaskChain,
    addMdTaskChain,
    getMeta: metaDb.get,
    metaLiveRead: metaDb.readLive,
    metaUpsert: metaUpsertLogged,
  }
}
export type TyTaskManager = Awaited<ReturnType<typeof useTyTaskManager>>
