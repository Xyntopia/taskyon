import type { TaskNodeMeta } from './types'
import { TaskNode, ToolBase, TaskListType, type partialTaskDraft } from './types'
import {
  type TaskyonDatabase,
  type FileMappingDocType,
  transformTaskNodeToDocType,
  transformDocToTaskNode,
  createTaskyonDatabase,
} from './rxdb'
import { openUserUploadedFile } from '../OPFS'
import { deepCopy, deepMerge } from '../utils'
import { usePyodideWebworker } from './webWorkerApi'
import { type InternalTool } from './tools'
import { type MangoQuery } from 'rxdb'
import { load } from 'js-yaml'
import { processMarkdown } from 'src/modules/taskyon/taskUtils'
import type { EncryptedDataRow } from '../crudWrapper'
import {
  createCombinedCrudWrapper,
  createEnhancedCrudWrapper,
  createMapCrudWrapper,
  createVectorStore,
  withLiveStreams,
  withLocking,
  withSecretStore,
  type CrudWrapper,
} from '../crudWrapper'
import { sha256UrlSafeHash } from '../crypto_webcrypto'
import { safeYamlDump } from '../yamlUtils'
import { urlSafeBase64Uuid } from '../crypto'
import { getDatabase } from '../pglite.api'

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

const TaskWithoutId = TaskNode.omit({ id: true }).strip()

async function taskContentHash(task: Partial<TaskNode>) {
  console.log('generating new hash ID for task')
  // we need to verify that our task is of type TaskNode without ID and we do this using Zod :)
  // we also want to make sure, that we only strip away anything which isn't official
  // part of our tasknode..
  const taskWithoutId = TaskWithoutId.parse(task)
  // generate this hash ID to check of there are any duplicate tasks or anything like that...
  const hashId = await sha256UrlSafeHash(taskWithoutId)
  return hashId
}

/**
 * Creates a new content addressable task here.
 *
 * This function creates a taskyon TaskNode where the ID is  SHA-256 hash of the
 * content of the task.
 *
 */
export async function createTaskNode(task: partialTaskDraft, priorID?: string, parentID?: string) {
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    throw new Error(
      'crypto.subtle is not available in this environment, can not generate task IDs!!',
    )
  }

  // TODO: add a signature as well! maybe by simply signing the task and adding it to the ID?
  //       or should we add a special signature property? Or can we do this only by encoding a task into
  //       a bytestream, similar to JWTs?
  // TODO: right now we are not using the "name" for the content hash because we update it through
  //       our keyword generation algorithm...
  const taskContent = {
    ...task,
    priorID,
    parentID,
    created_at: Date.now(),
  }

  const newId = await taskContentHash(taskContent)
  const newTask: TaskNode = {
    ...taskContent,
    id: newId,
  }
  return newTask
}

const { extractKeywords } = usePyodideWebworker('task manager keywords')

function useFileManager(fileMappingDb?: TaskyonDatabase['filemappings']) {
  // TODO: make sure, we add the correct file type here!
  async function addFile(fileMapping: Partial<FileMappingDocType>) {
    const uuidFileMapping: FileMappingDocType = {
      // TODO: replace this with a content Hash as well!
      uuid: urlSafeBase64Uuid(),
      ...fileMapping,
    }

    const fileMappingDoc = await fileMappingDb?.insert(uuidFileMapping)
    return fileMappingDoc?.uuid
  }

  async function bulkUpsertFiles(filemappings: FileMappingDocType[]) {
    await fileMappingDb?.bulkUpsert(filemappings)
  }

  async function getFileMappingByUuid(uuid: string): Promise<FileMappingDocType | null> {
    // Find the document with the matching UUID
    const fileMappingDoc = await fileMappingDb?.findOne(uuid).exec()

    // Check if the document exists
    if (!fileMappingDoc) {
      console.log(`No file mapping found for UUID: ${uuid}`)
      return null
    }

    // Return the found document
    return fileMappingDoc
  }

  // we can search tasks here using a mongo-db query object
  // find out more here:  https://rxdb.info/rx-query.html
  async function searchFiles(query: MangoQuery): Promise<FileMappingDocType[]> {
    if (fileMappingDb) {
      const fileMappingList = await fileMappingDb.find(query).exec()
      return fileMappingList
    }
    return []
  }

  async function getOpfsUploadedFile(uuid: string): Promise<File | undefined> {
    const fileMap = await getFileMappingByUuid(uuid)
    if (fileMap?.opfs) {
      const file = openUserUploadedFile(fileMap.opfs)
      return file
    }
  }

  // TODO: this function needs to be changes to search for names, instead of UUIDs
  async function getFileByName(name: string): Promise<File> {
    const fileMaps = await searchFiles({
      selector: {
        name: name,
      },
    })
    if (fileMaps.length) {
      // TODO: what do we do if we have multiple files with the same name?
      // TODO: try to load files form other sources as well :)
      const fileName = fileMaps[0]?.opfs
      if (fileName) {
        const file = await openUserUploadedFile(fileName)
        if (file) {
          if (file.type.length == 0) {
            // we do this, because for some files, opfs doesn't recognize the file type
            // for some reason...
            const newfile = new File(
              [file],
              file.name,
              fileMaps[0]?.fileType
                ? {
                    type: fileMaps[0]?.fileType,
                  }
                : {},
            )
            return newfile
          }
          return file
        }
      }
      throw new Error(
        `We could not find the file locally:  ${name}. Was it uploaded somewhere else?`,
      )
    }
    throw new Error(`File not found: ${name}`)
  }

  return {
    addFile,
    searchFiles,
    bulkUpsertFiles,
    getFileMappingByUuid,
    getOpfsUploadedFile,
    getFileByName,
  }
}

// TODO: replace this with pglite vector search :)
async function useTaskVectors(
  getAllTaskIds: () => Promise<string[]>,
  getTask: (taskId: string) => Promise<TaskNode | null>,
  vectorizerModel?: string,
  taskyonDB?: TaskyonDatabase,
) {
  const vecDb = await createVectorStore(await getDatabase('taskyon'), 'tyTaskVectors')

  async function syncVectorIndexWithTasks(progressCallback: (done: number, total: number) => void) {
    let counter = 0
    //taskyonDB.vectormappings.exportJSON()
    const taskIDs = await getAllTaskIds()
    for (const taskId of taskIDs) {
      const task = await getTask(taskId)
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
  // TODO: tryto get rid of unnecessary characters in the string...
  //       e.g. remove parenthesis from json etc..
  const task2Str = (t: TaskNode) => JSON.stringify(t.content)

  async function addtoVectorDB(task: TaskNode) {
    const existingVector = await vecDb.get(task.id)
    if (existingVector) {
      console.log('vector already exists!', task.id)
    } else if (
      task.content.type === 'functioncall' &&
      task.content.data.name === 'chatCompletion'
    ) {
      console.log('skip indexing of chatCompletion')
    } else if (vectorizerModel) {
      console.log('create vector...', task.id)
      const txt = task2Str(task)
      await vecDb.upsert(task.id, txt, undefined, false)
    }
  }

  /**
   * So here we use q ManogQuery "query", which we can use to pre-filter our vector search.
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
    query?: MangoQuery, // used to pre-filter our vector search
    k = 10,
    label?: string,
  ): Promise<{ taskId: string; distance: number }[]> {
    if (taskyonDB) {
      let result: Awaited<ReturnType<(typeof vecDb)['search']>>
      if (query) {
        const taskList = await taskyonDB.tasknodes.find(query).exec()
        const taskIDs = taskList.map((taskDoc) => taskDoc.id)
        result = await vecDb.search(searchTerm, k, label, taskIDs)
      } else {
        result = await vecDb.search(searchTerm, k)
      }
      return result.map((r) => ({ taskId: r.id, distance: r.distance }))
    }
    return []
  }

  async function searchSimilarTasks(
    task: TaskNode,
    query?: MangoQuery, // used to pre-filter our vector search
    k = 10,
  ) {
    const searchStr = task2Str(task)
    return filteredVectorSearch(searchStr, query, k)
  }

  return {
    syncVectorIndexWithTasks,
    deleteTaskFromVectorStore: vecDb.delete,
    addtoVectorDB,
    filteredVectorSearch,
    resetTaskVectors: vecDb.clear,
    count: vecDb.count,
    searchSimilarTasks,
  }
}

// TODO: maybe generalize this into a "RxDB Crud?"
const createRxDBCrudWrapper = (db: TaskyonDatabase): CrudWrapper<TaskNode> => {
  // TODO: move this CRUD wrapper into our RXDB file and also add the database creation itself to it :)

  const get = async (id: string | number) => {
    // we haven't found the bug yet..   but sometimes, this function seems to be called with an "undefined" id...
    // thats why w have the ?? '' here...
    const taskFromDb = await db.tasknodes.findOne(id?.toString() ?? '').exec()
    if (taskFromDb) {
      const task = transformDocToTaskNode(taskFromDb)
      return task
    }
    return null
  }

  // TODO: we need to add siblings /children functionality to our CRUD wrapper..
  /*        // Update parent-child cache
    set:
      if (data.priorID) {
        const siblings = await searchNextSibling(data.priorID)
        siblings.add(data.id)
        nextSiblingMap.set(data.priorID, siblings)
      }
  delete:
                // Delete from local record/memorydb
      const task = get(taskId)
      if (task && task.priorID) {
        // deleting the task from our children map...
        const children = await searchNextSibling(task.priorID)
        if (children) children.delete(taskId)
      }

*/

  const set = async (id: string | number, data: TaskNode) => {
    // TODO: throw an error, if we save an already existing task!
    //       because we want to make sure, that tasks in the db are immutable.
    //       so we can never update a task with an already existing id...
    if (id !== data.id) throw new Error('storage ID has to be the same as task ID!!')
    console.log('save task: ', data)
    const newDBTask = transformTaskNodeToDocType(data)
    await db.tasknodes.upsert(newDBTask)
  }

  return {
    get,
    set,
    // TODO: in order to make our database and all task objects pure,
    // we have to re-model trees when using this function.
    // so whenever we update a task, we recreate the tree path
    // updating all childen/parent properties in the path.
    // we do *not* need to edit any branches, as long as
    // they only have chilren properties and no parent properties...
    // if we only have parent properties, we can update
    // maybe also give an option to delete previous trees...
    // we should only really try to update tasks for very specific use
    // cases, such as the debug data..   otherwise things will simply get a lot
    // more difficult
    // TODO: when changing the updateTask to injecting a task with a different
    //       ID, what we can do is to have our update task point to its "parent" hash
    //       AND also advertise the update for the parent task! It is also important
    //       that we return the new id...
    upsert: async (id, data, strategy) => {
      const oldData = await get(id)
      let newData: TaskNode
      if ((oldData && strategy === 'shallow_merge') || strategy === 'native_shallow') {
        newData = { ...oldData, ...data }
        await set(id, newData)
      } else if (oldData && strategy === 'deepmerge') {
        newData = deepMerge(oldData, data, 'overwrite')
        await set(id, newData)
      }
      await set(id, data)
      newData = data
      return newData
    },
    delete: async (id) => {
      // also delete from vectordb!
      console.log('deleting task:', id)

      if (db) {
        const taskDoc = await db.tasknodes.findOne(id.toString()).exec()
        if (taskDoc) {
          await taskDoc.remove()
        }
      }
      console.log('done deleting task:', id)
    },
    list: async () => {
      const result = await db.tasknodes.find().exec()
      const tasks = result.map((rxdbtask) => ({
        id: rxdbtask.id,
        data: transformDocToTaskNode(rxdbtask),
      }))
      return tasks
    },
    clear: async () => {
      console.log('delete the entire database!')
      await db.remove()
    },
  }
}

export interface TaskTreeNode {
  task: TaskNode
  children: TaskTreeNode[][]
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
  defaultTools: InternalTool[],
  publicRecoveryKey: () => Promise<CryptoKey>,
  vectorizerModel?: string,
) {
  console.log('Initialize task manager.')

  console.log('initializing taskyondb')
  const taskyonDB: TaskyonDatabase = await createTaskyonDatabase()
  console.log('initializing task manager')

  // uses RxDB as a DB backend..
  // Usage example:
  // const taskManager = new TaskManager(initialTasks, taskyonDBInstance);

  // TODO: replace this next expression with something less memory intensive which
  //       simply selects all tasks
  const getAllTaskIds = async () =>
    taskyonDB ? (await taskyonDB.tasknodes.find().exec()).map((x) => x.id) : []

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

  const tyCrud = withLiveStreams(
    createCombinedCrudWrapper([
      createMapCrudWrapper(new Map<string, TaskNode>()),
      createRxDBCrudWrapper(taskyonDB),
    ]),
  )

  const {
    syncVectorIndexWithTasks,
    deleteTaskFromVectorStore,
    addtoVectorDB,
    filteredVectorSearch,
    resetTaskVectors,
    searchSimilarTasks,
    count: countVecs,
  } = await useTaskVectors(getAllTaskIds, tyCrud.get, vectorizerModel, taskyonDB)

  // add more enhanced, ty-specific functionality to our CRUD
  const tyCrudVec = withLocking({
    ...tyCrud,
    get: async (id: string | number) => {
      const task = await tyCrud.get(id)
      if (task) updateChildAndSiblingMap(task)
      return task
    },
    set: async (id: string | number, task: TaskNode) => {
      await tyCrud.get(task.id)
      await addtoVectorDB(task)
      // Update parent-child cache
      updateChildAndSiblingMap(task)
    },
    delete: async (id: string | number) => {
      // Delete from local record/memorydb
      const task = await tyCrud.get(id)
      if (task) void deleteFromChildAndSiblings(task)
      void tyCrud.delete(id)
      void deleteTaskFromVectorStore(id.toString())
    },
    upsert: async (id: string | number, data: TaskNode) => {
      // TODO: make sure, we never call this on tasks!
      const newData = await tyCrud.upsert(id, data)
      return newData
    },
  })

  const debugDb = await createEnhancedCrudWrapper<TaskNodeMeta>(
    await getDatabase('taskyon'),
    {
      tableName: 'debugDb',
    },
    new Map<string, TaskNodeMeta>(),
  )

  const secretStore = withSecretStore(
    await createEnhancedCrudWrapper(
      await getDatabase('taskyon'),
      {
        tableName: 'vault',
      },
      new Map<string, EncryptedDataRow>(),
    ),
    publicRecoveryKey,
  )

  async function countTasks() {
    return await taskyonDB.tasknodes.count().exec()
  }

  function createCachedSearch(
    cache: Map<string, Set<string>>,
    buildSelector: (key: string) => object,
  ) {
    return async (key: string): Promise<Set<string>> => {
      let cached = cache.get(key)
      if (!cached) {
        const dbResults = await taskyonDB.tasknodes
          .find({
            selector: buildSelector(key),
          })
          .exec()
        cached = new Set(dbResults.map((t) => t.id))
        cache.set(key, cached)
        return cached
      } else {
        return cached
      }
    }
  }

  const searchNextSibling = createCachedSearch(nextSiblingMap, (priorID: string) => ({
    priorID,
  }))

  const searchAllDirectChildren = createCachedSearch(immediateChildrenMap, (parentID: string) => ({
    parentID,
    $or: [{ priorID: { $exists: false } }, { priorID: null }],
  }))

  // Fetch **all** children (ignoring priorID) based on parentID.
  const searchAllChildren = createCachedSearch(parentToChildMap, (parentID: string) => ({
    parentID,
  }))

  async function convertTaskIDs(taskIds: string[]) {
    const taskList = await Promise.all(taskIds.map((tid) => tyCrudVec.get(tid)))

    // Check if any tasks are "null" or "undefined" and throw an error
    taskList.forEach((task, index) => {
      if (task === null || task === undefined) {
        throw new Error(`Task at index ${index} is ${task === null ? 'null' : 'undefined'}`)
      }
    })
    return taskList as TaskNode[]
  }

  const getTaskChain = async (taskId: string): Promise<TaskNode[]> =>
    await convertTaskIDs(await getTaskIdChain(taskId))

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

  // Recursively builds a tree node for the given task id.
  async function buildTaskTreeNode(taskId: string, maxDepth: number): Promise<TaskTreeNode> {
    const task = await tyCrud.get(taskId)
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
          const siblingTasks = await Promise.all(siblingArray.map((id) => tyCrud.get(id)))
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

  async function getFlattenedChain(
    taskId: string,
    maxFollow: number,
    untilTaskID: string | undefined,
    onlyFirstChild: boolean,
    isLastTask: boolean,
  ): Promise<string[]> {
    if (maxFollow <= 0) return []
    // get all leaf children from prior task but onyl if we are not the last task..:
    const taskAndChildren: string[] = [taskId]
    if (!isLastTask) {
      const leafs = await getTaskResults(taskId)
      if (leafs[0] && onlyFirstChild) {
        const childChain = await getFlattenedChain(leafs[0], maxFollow - 1, taskId, true, false)
        taskAndChildren.push(...childChain)
      } else if (!onlyFirstChild) {
        // TODO: enable some method how we can merge multiple parellel subtask chains. E.g. only take the last message
        // results or someting like that. Or assume, that we hade a "merger"
        // task which summarizes the results of some sort...
        throw new Error('we can not use multi task results yet!')
      }
    }

    // newMaxFollow will always be at max `maxFollow-1` because taskAnscDhilren includes the current TaskId.
    const newMaxFollow = maxFollow - taskAndChildren.length

    // we don't get children from this task, only from prior ones...
    const task = await tyCrudVec.get(taskId)

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

  const getTaskIdChain = (
    taskId: string,
    maxFollow = 1e9, // by default we can follow 1mio. tasks...
    untilTaskID: string | undefined = undefined,
    onlyFirstChild = true,
  ) =>
    getFlattenedChain(
      taskId,
      maxFollow, // by default we can follow 1mio. tasks...
      untilTaskID,
      onlyFirstChild,
      true,
    )

  async function deleteAllTasks() {
    // TODO: also delete vectordb! (will be done automatically, once we transition to pglite)
    // TODO: manually re-initiailized taskyondb after remove...
    await resetTaskVectors()
    await tyCrudVec.clear()
    await debugDb.clear()
  }

  // deletes tasks from the supplied leaf up to the first branch
  // "split", eliminating a branch
  // which is defined by the leaf and preceding, exclusive tasks to this branch
  async function deleteTaskThread(leafId: string) {
    let currentTaskId = leafId

    while (currentTaskId) {
      const currentTask = await tyCrud.get(currentTaskId)
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
      void tyCrud.delete(currentTaskId)

      if (currentTask.priorID) {
        // Move to the parent task
        currentTaskId = currentTask.priorID
      } else {
        break
      }
    }
  }

  // we can search tasks here using a mongo-db query object
  // find out more here:  https://rxdb.info/rx-query.html
  async function searchTasks(query: MangoQuery): Promise<TaskNode[]> {
    const taskList = await taskyonDB.tasknodes.find(query).exec()

    const llmtasks = taskList.map((taskDoc) => {
      const task = transformDocToTaskNode(taskDoc)
      return task
    })
    return llmtasks
  }

  // TODO: set an "update" flag here somewhere which we can use to
  //       cache this function. whenever a new tool gets added in "saveTask"
  //       we should set this
  /**
   * removeFunction will remove all "internal" functions from the returned tool list...
   */
  async function updateToolDefinitions<T extends boolean>(
    removeFunctionProperty: T = false as T,
  ): Promise<T extends true ? Record<string, ToolBase> : Record<string, ToolBase | InternalTool>> {
    const tasks = await searchTasks({
      selector: {
        type: 'tooldefinition',
      },
    })

    const parsedToolDefs = tasks.flatMap((task) => {
      try {
        if (task.content.type === 'tooldefinition') {
          const toolDef = ToolBase.parse(task.content.data)
          return toolDef
        }
        return []
      } catch {
        return []
      }
    })

    // Merge parsed tool definitions with default tools
    return parsedToolDefs.concat(Object.values(defaultTools)).reduce(
      (pv, cv) => {
        if (removeFunctionProperty && 'function' in cv) {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { function: unused, ...toolBaseOnly } = cv as InternalTool
          pv[toolBaseOnly.name] = toolBaseOnly
        } else {
          pv[cv.name] = cv
        }
        return pv
      },
      {} as T extends true ? Record<string, ToolBase> : Record<string, ToolBase | InternalTool>,
    )
  }

  /**
   * Finds the leaf tasks of a given task tree node using a depth-first search (DFS) iterative approach.
   *
   * @param {string} taskId - The ID of the task.
   * @param {Function} getTask - Function to retrieve a task by its ID.
   * @returns {Promise<string[]>} - An array of IDs of the leaf tasks.
   *
   */
  async function findSiblingLeafTasks(taskId: string): Promise<string[]> {
    const stack: string[] = [taskId]
    const leafTasks: string[] = []

    while (stack.length > 0) {
      const currentTaskId = stack.pop() || ''
      const currentTask = await tyCrudVec.get(currentTaskId)
      if (!currentTask) continue

      const children = await searchNextSibling(currentTaskId)

      // If no children are found, it's a leaf
      if (children.size === 0) {
        leafTasks.push(currentTaskId)
      } else {
        // Push all children onto the stack for further traversal
        stack.push(...Array.from(children))
      }
    }

    return leafTasks
  }

  async function getJsonTaskBackup() {
    // TODO: give this a callback so that we can save it in "chunks"
    console.log('exporting json backup db!')
    const dbobject = await taskyonDB.exportJSON([
      'filemappings',
      'tasknodes',
      //'vectormappings'
    ])
    return dbobject
  }

  // import tasks from json! :)
  // TODO: remove this function and replace this with a list of tasnode json functions!!
  //       we want to get rid of our rxdb dependency here... we could even backup tass as markdown!  that might be even better :)
  async function addTaskBackup(jsonObjString: string) {
    // TODO: add some zod validation here!
    type ImportJSONFunction = typeof taskyonDB.importJSON
    type FirstArgumentType = Parameters<ImportJSONFunction>[0]
    const jsonObj = JSON.parse(jsonObjString) as FirstArgumentType
    console.log('importing json backup to db!')
    const dbobject = await taskyonDB.importJSON(jsonObj)
    return dbobject
  }

  async function loadYamlConversation(input: File | string): Promise<string | undefined> {
    console.log('adding tasknodes & conversations from yaml input!')

    let last_task_id: string | undefined = undefined

    let taskListRaw: unknown
    if (typeof input === 'string') {
      taskListRaw = load(input)
    } else {
      const fileStr = await input.text()
      taskListRaw = load(fileStr)
    }

    const result = await TaskListType.safeParseAsync(taskListRaw)

    if (result.success) {
      const taskList = result.data
      taskList.forEach((t) => {
        void tyCrud.set(t.id, t)
        last_task_id = t.id
      })
    }

    return last_task_id
  }

  const fm = useFileManager(taskyonDB?.filemappings)

  // converts an antire taskchain (thread) into yaml for download
  async function chatToYaml(conversationId: string) {
    const taskList = await getTaskChain(conversationId)

    if (taskList.length) {
      const fileContent = safeYamlDump(taskList)
      return fileContent
    }
  }

  // converts an antire taskchain (thread) into yaml for download
  async function chatToMarkdown(conversationId: string, fullMeta = false) {
    console.log('convert Chat to markdown!')
    const taskList = await getTaskChain(conversationId)

    //convert into a list of markdown strings
    const messageStrings = taskList.map((t) => {
      const message = t?.content.type === 'message' ? '\n\n' + t.content.data : ''

      // we are doing this in order to protect the "original" tasks, e.g. if they
      // are reactive... :)
      const partialTask = deepCopy(t) as Record<string, unknown>
      if (!fullMeta && partialTask) {
        // delete everything which we don't require in order
        // to create new tasks...
        delete partialTask.result
        delete partialTask.id
        delete partialTask.created_at
        delete partialTask.priorID
        if (message) delete partialTask.content
      }
      const yamlMeta = `<!--taskyon\n${safeYamlDump(partialTask)}\n-->`
      return yamlMeta + message
    })

    return messageStrings.join('\n\n---\n\n')
  }

  async function updateTaskNameWKeywords(newTask: TaskNode) {
    const chat = getTaskChain(newTask.id)
    const chatString = (await chat).reduce((p, n) => {
      if (n?.content.type === 'message') {
        return p + '\n\n' + n.content.data
      }
      return p
    }, '')
    void extractKeywords(chatString, 5).then((kws) => {
      console.log('update task with kw: ', kws)
      newTask.name = kws[0]
      void tyCrud.upsert(newTask.id, newTask)
    })
  }

  // add a task to the db. Adding some default information such as timestamps etc...
  // whats important here is that the TaskNode can only have one type of content
  // so when calling the function, we need to pre-select which type of task
  // we want to have.
  const addPartialTask2Tree = async (
    task: partialTaskDraft,
    priorID: string | undefined,
    parentID: string | undefined,
    duplicateTaskName = true,
  ): Promise<TaskNode> => {
    if (!duplicateTaskName && task.name) {
      // check if a task with this name already exists and throw an error, if it does, because
      // we are not supposed to create it in that case ;)
      // this is specifically used in the case of repeated task
      // declarations which come for example from a webapge which integrates the tasks
      // TODO: instead of giving the webpage the option to "disallow" duplicate
      //       tasks, make sure, the tasks don't get saved in the db
      //       as they get declared every single time anyways when the webpage loads...,
      //       we don't *need* to store them! we can use the "persist" argument for this.
      const tasks = await searchTasks({
        selector: { name: task.name },
      })
      if (tasks.length > 0) {
        throw new Error(`The task ${task.name} already exists!`)
      }
    }

    const newTask = await createTaskNode(task, priorID, parentID)

    // task was already added at a previous point...
    // TODO: can we get rid of "setTask"? because we can generate task IDs now independently
    //       from whichever database we're using...
    if (await tyCrud.get(newTask.id)) return newTask

    console.log('create new Task:', newTask.id)
    await tyCrud.set(newTask.id, newTask)

    // extract keywordsfrom entire chat and use it to name the task...
    // but only if a taskname doesn't exist yet.
    // TODO: how can we do this much faster, so that we don't have to update our task and
    //       keep it immutable?  We should probably await keywords, but also keep a
    //       separate index with keywords for tasks...
    // TODO: we can get rid of the "discard" lavels, things that should be "discarded" can be part of
    //       a lower-level function or stay inside a tool etc...
    if (!newTask.name && task.content && !task.label?.includes('discard')) {
      await updateTaskNameWKeywords(newTask)
    } else if (newTask.name) {
      console.log('task already has a name:', newTask.name)
    }

    return newTask
  }

  async function addTaskChain(
    taskList: partialTaskDraft[],
    priorID: string | undefined = undefined,
    parentID: string | undefined = undefined,
    duplicateTaskName = true,
  ) {
    let lastTaskId = priorID
    const addedTaskList: TaskNode[] = []
    for (const task of taskList) {
      const addedTask = await addPartialTask2Tree(
        { ...task },
        lastTaskId, //previous
        parentID,
        duplicateTaskName,
      )
      lastTaskId = addedTask.id
      addedTaskList.push(addedTask)
    }
    return addedTaskList
  }

  async function addMdTaskChain(markdown?: string) {
    console.log('adding new Markdown tasks!!')
    if (markdown) {
      const taskList = processMarkdown(markdown)
      const newTaskList = await addTaskChain(taskList)
      return newTaskList.at(-1)?.id
    }
    return undefined
    // TODO: optionally execute the last task...
  }

  const defaultMode = {
    getTask: tyCrudVec.get,
    deleteTask: tyCrudVec.delete,
    searchTasks,
    setTask: tyCrudVec.set,
    taskStream: tyCrudVec.liveStream,
    updateToolDefinitions,
    getJsonTaskBackup,
    addTaskBackup,
    deleteAllTasks,
    deleteTaskThread,
    countTasks,
    syncVectorIndexWithTasks,
    resetTaskVectors,
    countVecs,
    filteredVectorSearch,
    findSiblingLeafTasks,
    searchNextSibling,
    searchAllDirectChildren,
    searchAllChildren,
    searchSimilarTasks,
    loadYamlConversation,
  }

  return {
    ...defaultMode,
    ...fm,
    getTaskIdChain,
    secretStore,
    getTaskChain,
    convertTaskIDs,
    buildSiblingChain,
    buildTaskTreeNode,
    chatToYaml,
    chatToMarkdown,
    addPartialTask2Tree,
    addTaskChain,
    addMdTaskChain,
    debugDb,
  }
}
export type TyTaskManager = Awaited<ReturnType<typeof useTyTaskManager>>
