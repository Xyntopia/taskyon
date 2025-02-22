import type { TaskNodeMeta } from './types'
import { type TaskNode, ToolBase, TaskListType, type partialTaskDraft } from './types'
import {
  type TaskyonDatabase,
  type FileMappingDocType,
  transformTaskNodeToDocType,
  transformDocToTaskNode,
  collections,
  createTaskNodeMangoQuery,
} from './rxdb'
import { openFile } from '../OPFS'
import { deepCopy, lockMap } from '../utils'
import { useVectorStore } from './hnswIndex'
import { usePyodideWebworker, useNlpWorker } from './webWorkerApi'
import { type InternalTool } from './tools'
import { taskUtils } from './taskUtils'
import { type MangoQuery } from 'rxdb'
import { dump, load } from 'js-yaml'
import { processMarkdown } from 'src/modules/taskyon/taskUtils'
import type { EnhancedCrudWrapper } from '../crudWrapper'
import {
  createCombinedCrudWrapper,
  createMapCrudWrapper,
  withLiveStreams,
  withLocking,
  type CrudWrapper,
} from '../crudWrapper'
import { sha256UrlSafeHash } from '../hashing'
import { urlSafeBase64Uuid } from '../crypto'

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

async function taskContentHash(task: Omit<TaskNode, 'id'>) {
  console.log('generating new hash ID for task')
  // generate this hash ID to check of there are any duplicate tasks or anything like that...
  const hashId = await sha256UrlSafeHash(task)
  return hashId
}

/**
 * Creates a new content addressable task here.
 *
 * This function creates a taskyon TaskNode where the ID is  SHA-256 hash of the
 * content of the task.
 *
 */
export async function createTaskNode(task: partialTaskDraft, priorID?: string) {
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
    priorID: priorID ?? task.priorID,
    created_at: Date.now(),
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { name, ...taskContentWithoutName } = taskContent
  const newId = await taskContentHash(taskContentWithoutName)
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

  async function getFile(uuid: string): Promise<File | undefined> {
    const fileMap = await getFileMappingByUuid(uuid)
    if (fileMap?.opfs) {
      const file = openFile(fileMap.opfs)
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
        const file = await openFile(fileName)
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
    getFile,
    getFileByName,
  }
}

export type TaskEvent = 'new' | 'update' | 'delete' | 'deleteAll'

type TaskCallBack = (task: TaskNode, msg: TaskEvent) => Promise<void>

function tyMechanisms() {
  let subscribers: TaskCallBack[] = []

  // because our tass are supposed to be "immutable" (not yet as of 2024.11.04), we only really need
  // to subscribe to the task itself. Every time we "change" something in the
  // tasks, we can assume that the task number changed as well...
  function subscribeToTaskChanges(callback: TaskCallBack): void {
    subscribers.push(callback)
  }

  // You may also need a method to unsubscribe if required
  function unsubscribeFromTaskChanges(callback: TaskCallBack): void {
    subscribers = subscribers.filter((sub) => sub !== callback)
  }

  function notifySubscribers(task: TaskNode | undefined, msg: TaskEvent): void {
    if (task) {
      subscribers.forEach((callback) => void callback(task, msg))
    }
  }

  // this class holds utilitiy funcions to manage taskyons infrastructure
  return {
    subscribeToTaskChanges,
    unsubscribeFromTaskChanges,
    notifySubscribers,
  }
}

// TODO: replace this with pglite vector search :)
function useTaskVectors(
  getAllTaskIds: () => Promise<string[]>,
  getTask: (taskId: string) => Promise<TaskNode | null>,
  vectorizerModel?: string,
  taskyonDB?: TaskyonDatabase,
) {
  const { lockItem } = lockMap('vector')
  const { vectorizeText } = useNlpWorker()
  const { getVectorIndex, resetVectorStore } = useVectorStore('taskyondbv')

  async function syncVectorIndexWithTasks(progressCallback: (done: number, total: number) => void) {
    console.log('sync vector index')
    const vectorIndex = await getVectorIndex()
    if (!vectorIndex || !taskyonDB) {
      console.warn('Vector index or database is not initialized.')
      return
    }

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

  async function resetTaskVectors() {
    console.log('delete vector store')
    await resetVectorStore()
    console.log('delete vector mappings')
    await taskyonDB?.vectormappings.remove()
    await taskyonDB?.addCollections({
      vectormappings: collections.vectormappings,
    })
  }

  const vecMappingFromTask = (taskId: string) =>
    taskyonDB?.vectormappings
      .findOne({
        selector: { uuid: taskId },
      })
      .exec()

  async function deleteTaskFromVectorStore(taskId: string) {
    const vecmapping = await vecMappingFromTask(taskId)
    await vecmapping?.remove()
    const vecid = Number(vecmapping?.vecid)
    if (vecid) {
      void (await getVectorIndex())?.markDelete(vecid)
    }
  }

  const vecAlreadyExists = async (taskId: string) => {
    const res = await vecMappingFromTask(taskId)
    if (res?.vecid) {
      const vecid = Number(res.vecid)
      if (!isNaN(vecid)) {
        try {
          // this works. If we mark a label as deleted in our vector index
          // this will throw an error, meaning the vector doesn't exist...
          const vec = (await getVectorIndex())?.getPoint(vecid)
          return vec
        } catch {
          return undefined
        }
      }
    }
    return undefined
  }

  // TODO: make sure, we also stringify tool calls etc...
  const task2Str = (t: TaskNode) => JSON.stringify(t.content)

  async function addtoVectorDB(
    task: TaskNode,
    //override = false,
    //storeInDB: false,
  ) {
    const unlock = await lockItem(task.id)
    const existingVector = await vecAlreadyExists(task.id)
    if (existingVector) {
      console.log('vector already exists!', task.id)
    } else if (vectorizerModel) {
      console.log('create vector...', task.id)
      const numvec = await vectorizeText(task2Str(task), vectorizerModel)
      if (numvec) {
        console.log('got a vector result.')
        const vectorIndex = await getVectorIndex()
        const vec = new Float32Array(numvec)
        const label = vectorIndex?.addItems([vec], true)[0]
        // it is important that we await all functions here becase
        // we are in a task lock-situation and can not afford for them to be unlocked at some point :)
        await taskyonDB?.vectormappings.upsert({
          uuid: task.id,
          vecid: String(label),
          //vector: storeInDB ? encodeVector(vec) : undefined, # not saving vectors for now...
        })
      }
    }
    unlock()
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
  ): Promise<{ taskId: string; distance: number }[]> {
    if (taskyonDB) {
      if (query) {
        const taskList = await taskyonDB.tasknodes.find(query).exec()
        const taskIDs = taskList.map((taskDoc) => taskDoc.id)
        const prefilterVectorsIds = await taskyonDB.vectormappings
          .find({
            selector: {
              uuid: { $in: taskIDs },
            },
          })
          .exec()
        const vecIDs = prefilterVectorsIds.map((vm) => vm.vecid)
        const result = vectorSearchTasks(searchTerm, k, (label: number) =>
          vecIDs.includes(label.toString()),
        )
        return result
      } else {
        const result = vectorSearchTasks(searchTerm, k)
        return result
      }
    }
    return []
  }

  async function vectorSearchTasks(
    searchTerm: string,
    k = 5,
    filterfunction?: (label: number) => boolean,
  ) {
    console.log('search for', searchTerm)
    const result: { taskId: string; distance: number }[] = []
    const vectorIndex = await getVectorIndex()
    if (vectorIndex && vectorizerModel) {
      const queryVec = await vectorizeText(searchTerm, vectorizerModel)
      if (queryVec && taskyonDB) {
        const res = vectorIndex.searchKnn(queryVec, k, filterfunction)
        const neighborIndices = res.neighbors.map((r) => String(r))

        // Fetch the vector mappings in bulk for all neighbor indices
        const vectorMappingDocs = await taskyonDB.vectormappings.findByIds(neighborIndices).exec()

        // Use the neighbor indices to get the correct vector mapping documents
        // and then use the uuid from those documents to fetch the tasks
        res.neighbors.forEach((neighborIndex, searchResultIndex) => {
          const uuid = vectorMappingDocs.get(String(neighborIndex))?.uuid
          if (uuid) {
            result.push({
              taskId: uuid,
              distance: res.distances[searchResultIndex] || 0.0,
            })
          }
        })
      }
    }
    return result
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
    deleteTaskFromVectorStore,
    addtoVectorDB,
    filteredVectorSearch,
    resetTaskVectors,
    searchSimilarTasks,
  }
}

// TODO: maybe generalize this into a "RxDB Crud?"
const createRxDBCrudWrapper = (db: TaskyonDatabase): CrudWrapper<TaskNode> => {
  // TODO: move this CRUD wrapper into our RXDB file and also add the database creation itself to it :)

  const get = async (id: string | number) => {
    const taskFromDb = await db.tasknodes.findOne(id.toString()).exec()
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
    upsert: async (id, data) => {
      const oldData = await get(id)
      if (oldData) {
        await set(id, { ...oldData, ...data })
      }
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
export function useTyTaskManager(
  tasksCache: Map<string, TaskNode>,
  defaultTools: InternalTool[],
  taskyonDB: TaskyonDatabase,
  debugDb: EnhancedCrudWrapper<TaskNodeMeta>,
  vectorizerModel?: string,
) {
  // uses RxDB as a DB backend..
  // Usage example:
  // const taskManager = new TaskManager(initialTasks, taskyonDBInstance);

  // TODO: replace this next expression with something less memory intensive which
  //       simply selects all tasks
  const getAllTaskIds = async () =>
    taskyonDB ? (await taskyonDB.tasknodes.find().exec()).map((x) => x.id) : []

  const { subscribeToTaskChanges, unsubscribeFromTaskChanges, notifySubscribers } = tyMechanisms()

  // because our tasks only have parent IDs defined, we keep a cache of
  // child IDs in order to be able to do faster tree traversals...
  const nextSiblingMap = new Map<string, Set<string>>()
  const parentToChildMap = new Map<string, Set<string>>()

  const tyCrud = withLiveStreams(
    createCombinedCrudWrapper([createMapCrudWrapper(tasksCache), createRxDBCrudWrapper(taskyonDB)]),
  )

  const {
    syncVectorIndexWithTasks,
    deleteTaskFromVectorStore,
    addtoVectorDB,
    filteredVectorSearch,
    resetTaskVectors,
    searchSimilarTasks,
  } = useTaskVectors(getAllTaskIds, tyCrud.get, vectorizerModel, taskyonDB)

  // add more enhanced, ty-specific functionality to our CRUD
  const tyCrudVec = withLocking({
    ...tyCrud,
    set: async (id: string | number, task: TaskNode) => {
      await tyCrud.get(task.id)
      await addtoVectorDB(task)
      // Update parent-child cache
      if (task.priorID) {
        const children = await searchNextSibling(task.priorID)
        children.add(task.id)
        nextSiblingMap.set(task.priorID, children)
      }
      if (task.parentID) {
        const parents = await searchNextSibling(task.parentID)
        parents.add(task.id)
        parentToChildMap.set(task.parentID, parents)
      }
      notifySubscribers(task, 'new')
    },
    delete: async (id: string | number) => {
      // Delete from local record/memorydb
      const task = await tyCrud.get(id)
      if (task && task.priorID) {
        // deleting the task from our children map...
        // because our tasks are immutable, we can do this in a decentralized way :)
        void searchNextSibling(task.priorID).then((siblings) => {
          if (siblings) siblings.delete(id.toString())
        })
      }
      void tyCrud.delete(id)
      void deleteTaskFromVectorStore(id.toString())
      if (task) notifySubscribers(task, 'delete')
    },
    upsert: async (id: string | number, data: TaskNode) => {
      await tyCrud.upsert(id, data)
      notifySubscribers(data, 'update')
    },
  })

  async function countVecs() {
    if (taskyonDB) {
      return await taskyonDB.vectormappings.count().exec()
    } else return undefined
  }

  async function countTasks() {
    if (taskyonDB) {
      return await taskyonDB.tasknodes.count().exec()
    } else return undefined
  }

  // find all sibling tasks in our parent-linked task tree
  async function searchNextSibling(priorID: string): Promise<Set<string>> {
    let siblings = nextSiblingMap.get(priorID)

    // if we didn#t find it in our cache, search for it manually...
    if (!siblings && taskyonDB) {
      // Fallback to database query if not in the cache
      const dbSiblings = (
        await taskyonDB.tasknodes
          .find({
            selector: {
              priorID,
            },
          })
          .exec()
      ).map((t) => t.id)
      siblings = new Set(dbSiblings)

      // Cache the result for future lookups
      nextSiblingMap.set(priorID, siblings)
      return siblings
    }
    return siblings ?? new Set()
  }

  // TODO: right now, we can only find the "first" child...
  //       this needs to become better ;). Especially, if we cache this. The first child we have in the cache
  //       will always stay there...
  // "direct" children are the ones where both: parentID is set, but no priorID
  async function searchAllDirectChildren(parentID: string): Promise<Set<string>> {
    // we can actually cache this result, because it will never change...
    let immediateChildren = parentToChildMap.get(parentID)

    if (!immediateChildren) {
      // if we didn#t find it in our cache, search for it manually...
      // Fallback to database query if not in the cache
      const dbChildren = (
        await taskyonDB.tasknodes
          .find({
            selector: {
              parentID,
              $or: [{ priorID: { $exists: false } }, { priorID: null }],
            },
          })
          .exec()
      ).map((t) => t.id)
      immediateChildren = new Set(dbChildren)

      // Cache the result for future lookups. It is sufficient to do this once
      // because tasks only get generated once and it doesn't "make sense"
      // to attach a new child task to an already processed task, because by definition
      // child tasks can only be generated by its parent task.
      parentToChildMap.set(parentID, immediateChildren)
      return immediateChildren
    }
    return immediateChildren ?? new Set()
  }

  async function deleteAllTasks() {
    // TODO: also delete vectordb!
    // TODO: manually re-initiailized taskyondb after remove...
    await resetTaskVectors()

    if (taskyonDB) {
      console.log('delete the entire database!')
      await taskyonDB.remove()
    }
    await tyCrudVec.clear()
    nextSiblingMap.clear()
    await debugDb.clear()
    notifySubscribers(undefined, 'deleteAll')
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
      // update our function cache :)
      tasksCache.set(task.id, task)
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
    removeFunction: T = false as T,
  ): Promise<T extends true ? Record<string, ToolBase> : Record<string, ToolBase | InternalTool>> {
    if (taskyonDB) {
      const tasks = await searchTasks(createTaskNodeMangoQuery('function'))

      // TODO: we can do better here ;)
      function hasMessage(task: TaskNode): task is TaskNode & { content: { type: 'message' } } {
        return task.content.type === 'tooldefinition'
      }

      const toolDefs = tasks.filter(hasMessage)
      const parsedToolDefs = toolDefs.flatMap((task) => {
        try {
          const toolDef = ToolBase.parse(JSON.parse(task.content.data))
          return [toolDef]
        } catch {
          return []
        }
      })

      // Merge parsed tool definitions with default tools
      return parsedToolDefs.concat(Object.values(defaultTools)).reduce(
        (pv, cv) => {
          if (removeFunction && 'function' in cv) {
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

    return {} as T extends true ? Record<string, ToolBase> : Record<string, ToolBase | InternalTool>
  }

  /**
   * Finds the leaf tasks of a given task tree node using a depth-first search (DFS) iterative approach.
   * // TODO: find all leaf tasks...
   *
   * @param {string} taskId - The ID of the task.
   * @param {Function} getTask - Function to retrieve a task by its ID.
   * @returns {Promise<string[]>} - An array of IDs of the leaf tasks.
   *
   */
  async function findOneSiblingLeafTask(taskId: string): Promise<string[]> {
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
    if (taskyonDB) {
      console.log('exporting json backup db!')
      const dbobject = await taskyonDB.exportJSON([
        'filemappings',
        'tasknodes',
        //'vectormappings'
      ])
      return dbobject
    }
  }

  // import tasks from json! :)
  // TODO: remove this function and replace this with a list of tasnode json functions!!
  //       we want to get rid of our rxdb dependency here... we could even backup tass as markdown!  that might be even better :)
  async function addTaskBackup(jsonObjString: string) {
    // TODO: add some zod validation here!
    if (taskyonDB) {
      type ImportJSONFunction = typeof taskyonDB.importJSON
      type FirstArgumentType = Parameters<ImportJSONFunction>[0]
      const jsonObj = JSON.parse(jsonObjString) as FirstArgumentType
      console.log('importing json backup to db!')
      const dbobject = await taskyonDB.importJSON(jsonObj)
      return dbobject
    }
    // when loading json, notify for each individual new task...
    notifySubscribers(undefined, 'new')
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

  const { getTaskIdChain, getTaskChain } = taskUtils(tyCrud.get)

  // converts an antire taskchain (thread) into yaml for download
  async function chatToYaml(conversationId: string) {
    const taskList = await getTaskChain(conversationId)

    if (taskList.length) {
      const fileContent = dump(taskList)
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
      const yamlMeta = `<!--taskyon\n${dump(partialTask, { skipInvalid: true })}\n-->`
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

    const newTask = await createTaskNode(task, priorID)

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
        { ...task, parentID },
        lastTaskId, //previous
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
    updateToolDefinitions,
    subscribeToTaskChanges,
    unsubscribeFromTaskChanges,
    getJsonTaskBackup,
    addTaskBackup,
    deleteAllTasks,
    deleteTaskThread,
    countTasks,
    syncVectorIndexWithTasks,
    resetTaskVectors,
    countVecs,
    filteredVectorSearch,
    findOneSiblingLeafTask,
    searchNextSibling,
    searchAllDirectChildren,
    searchSimilarTasks,
    loadYamlConversation,
  }

  return {
    ...defaultMode,
    ...fm,
    getTaskIdChain,
    getTaskChain,
    chatToYaml,
    chatToMarkdown,
    addPartialTask2Tree,
    addTaskChain,
    addMdTaskChain,
    debugDb,
  }
}
export type TyTaskManager = ReturnType<typeof useTyTaskManager>
