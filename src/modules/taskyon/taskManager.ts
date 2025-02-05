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
import { deepCopy, deepMerge, lockMap } from '../utils'
import { useVectorStore } from './hnswIndex'
import { usePyodideWebworker, useNlpWorker } from './webWorkerApi'
import { type InternalTool } from './tools'
import { taskUtils } from './taskUtils'
import { type MangoQuery } from 'rxdb'
import { dump, load } from 'js-yaml'
import { processMarkdown } from 'src/modules/taskyon/taskUtils'
import type { CrudWrapper } from '../crudWrapper'
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

/*function uuidToBigInt(uuid: string) {
  // Remove dashes and decode hex to a Buffer
  const buffer = Buffer.from(uuid.replace(/-/g, ''), 'hex');

  let bigint = BigInt(0);

  // Iterate over each byte in the buffer and shift it into the BigInt
  for (const byte of buffer) {
    bigint = (bigint << BigInt(8)) + BigInt(byte);
  }

  return bigint;
}*/

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

function useTaskVectors(
  getAllTaskIds: () => Promise<string[]>,
  getTask: (taskId: string) => Promise<TaskNode | undefined>,
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
  debugDb: CrudWrapper<TaskNodeMeta>,
  vectorizerModel?: string,
) {
  // uses RxDB as a DB backend..
  // Usage example:
  // const taskManager = new TaskManager(initialTasks, taskyonDBInstance);

  const { lockItem: lockTask, waitForItemUnlock: waitForTaskUnlock } = lockMap('task')

  // TODO: replace this next expression with something less memory intensive which
  //       simply selects all tasks
  const getAllTaskIds = async () =>
    taskyonDB ? (await taskyonDB.tasknodes.find().exec()).map((x) => x.id) : []

  const { subscribeToTaskChanges, unsubscribeFromTaskChanges, notifySubscribers } = tyMechanisms()

  const {
    syncVectorIndexWithTasks,
    deleteTaskFromVectorStore,
    addtoVectorDB,
    filteredVectorSearch,
    resetTaskVectors,
    searchSimilarTasks,
  } = useTaskVectors(getAllTaskIds, getTask, vectorizerModel, taskyonDB)

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

  // because our tasks only have parent IDs defined, we keep a cache of
  // child IDs in order to be able to do faster tree traversals...
  const parentToChildrenMap = new Map<string, Set<string>>()

  async function unblockedGetTask(taskId: string): Promise<TaskNode | undefined> {
    // Check if the task exists in the local record
    let task = tasksCache.get(taskId)
    if (!task && taskyonDB) {
      // we are locking the task here in order to make other operations wait
      // for it to be cached...
      // TODO: somehow this doesn't work, I guess because of the async nature of lockTask?
      const unlock = await lockTask(taskId)
      // If not, load from the database
      const taskFromDb = await taskyonDB.tasknodes.findOne(taskId).exec()
      if (taskFromDb) {
        task = transformDocToTaskNode(taskFromDb)
        tasksCache.set(taskId, task) // Update local record
      }
      unlock()
    }
    return task
  }

  async function getTask(taskId: string | undefined): Promise<TaskNode | undefined> {
    if (!taskId) return undefined
    await waitForTaskUnlock(taskId)
    return await unblockedGetTask(taskId)
  }

  async function setTask(task: TaskNode, save: boolean): Promise<void> {
    const unlock = await lockTask(task.id)
    tasksCache.set(task.id, task)
    if (save) {
      await saveTaskToDb(task) // Save to database if required
    }
    // Update parent-child cache
    if (task.priorID) {
      const children = await searchOneChild(task.priorID)
      children.add(task.id)
      parentToChildrenMap.set(task.priorID, children)
    }
    notifySubscribers(task, 'new')
    unlock()
  }

  // find all children tasks in our parent-linked task tree
  // TODO: right now, we can only find the "first" child...
  //       this needs to become better ;). Especially, if we cache this. The first child we have in the cache
  //       will always stay there...
  async function searchOneChild(priorID: string): Promise<Set<string>> {
    // Check if children are already cached in the map
    // if we get an empty set (meaning we have a leaf task)
    // we assume, thats actually OK.  because the db query returned this. it
    // will be updated on time in the parentToChildrenMap if we add a new task.
    // the only problem here is, that this is asynchronous..  so in the future we might run into problems
    // where we need to lock the parentToChildMap if multiple processes want to access it.
    // but eventually the parentToChildrenMap will be updated with the additional children..
    let children = parentToChildrenMap.get(priorID)

    if (!children && taskyonDB) {
      // Fallback to database query if not in the cache
      const dbChildren = (
        await taskyonDB.tasknodes
          .find({
            selector: {
              priorID,
            },
          })
          .exec()
      ).map((t) => t.id)
      children = new Set(dbChildren)

      // Cache the result for future lookups
      parentToChildrenMap.set(priorID, children)
      return children
    }
    return children ?? new Set()
  }

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
  //       AND also dvertise the update for the parent task! It is also important
  //       that we return the new id...
  async function updateTask(
    updateData: Partial<TaskNode> & { id: string },
    save: boolean,
  ): Promise<void> {
    const unlock = await lockTask(updateData.id)
    const task = await unblockedGetTask(updateData.id)
    if (task) {
      // Update the task with new data
      // Object.assign(task, updateData);
      // TODO: her we are doing the deepmerge, so that the task stays reactive, but we don't need that
      // anymore in the future, as we are only goingto update tasks through a publish/subscribe mechanism
      // and get rid of inherently reactive tasks...
      Object.assign(task, deepMerge(task, updateData))
      // because we're updating a task we should not have to update the
      // parentToChildrenMap once, we have immutable tasks though, we are adding
      // a task with a new ID and should probably replace the childrens ID
      if (save) {
        await saveTaskToDb(task) // Save to database if required
      }
    }
    unlock()
    if (task) notifySubscribers(task, 'update')
    // TODO: return the root or leave of the new tree ;).
  }

  async function saveTaskToDb(task: TaskNode): Promise<void> {
    // TODO: throw an error, if we save an already existing task!
    //       because we want to make sure, that tasks in the db are immutable.
    //       so we can never update a task with an already existing id...
    console.log('save task: ', task)
    if (task && taskyonDB) {
      const newDBTask = transformTaskNodeToDocType(task)
      await taskyonDB.tasknodes.upsert(newDBTask)
      void addtoVectorDB(task)
    }
  }

  async function deleteAllTasks() {
    // also delete vectordb!
    // TODO: manually re-initiailized taskyondb after remove...
    await resetTaskVectors()
    if (taskyonDB) {
      console.log('delete the entire database!')
      await taskyonDB.remove()
    }
    tasksCache.clear()
    parentToChildrenMap.clear()
    notifySubscribers(undefined, 'deleteAll')
  }

  async function deleteTask(taskId: string): Promise<void> {
    // also delete from vectordb!
    const unlock = await lockTask(taskId)
    console.log('deleting task:', taskId)

    // Delete from local record/memorydb
    const task = tasksCache.get(taskId)
    if (task && task.priorID) {
      // deleting the task from our children map...
      const children = await searchOneChild(task.priorID)
      if (children) children.delete(taskId)
    }
    tasksCache.delete(taskId)
    await deleteTaskFromDB(taskId)
    await deleteTaskFromVectorStore(taskId)
    console.log('done deleting task:', taskId)
    if (task) notifySubscribers(task, 'delete')
    unlock()
  }

  const deleteTaskFromDB = async (taskId: string) => {
    if (taskyonDB) {
      const taskDoc = await taskyonDB.tasknodes.findOne(taskId).exec()
      if (taskDoc) {
        await taskDoc.remove()
      }
    }
  }

  // deletes tasks from the supplied leaf up to the first branch
  // "split", eliminating a branch
  // which is defined by the leaf and preceding, exclusive tasks to this branch
  async function deleteTaskThread(leafId: string) {
    let currentTaskId = leafId

    while (currentTaskId) {
      const currentTask = await getTask(currentTaskId)
      if (!currentTask) break // Break if a task doesn't exist

      // Check if the parent task has more than one child
      if (currentTask.priorID) {
        const childrenIDs = await searchOneChild(currentTask.priorID)
        if (childrenIDs.size > 1) {
          // in this case we need to update the parent with the fewer children
          break // Stop deletion if the parent task has more than one child. We only want to delete this branch...
        }
      }

      // Delete the current task
      void deleteTask(currentTaskId)

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
    if (taskyonDB) {
      const taskList = await taskyonDB.tasknodes.find(query).exec()

      const llmtasks = taskList.map((taskDoc) => {
        const task = transformDocToTaskNode(taskDoc)
        // update our function cache :)
        tasksCache.set(task.id, task)
        return task
      })
      return llmtasks
    }
    return []
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

      function hasMessage(task: TaskNode): task is TaskNode & { content: { message: string } } {
        return 'message' in task.content
      }

      const toolDefs = tasks.filter(hasMessage)
      const parsedToolDefs = toolDefs.flatMap((task) => {
        try {
          const toolDef = ToolBase.parse(JSON.parse(task.content.message))
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
   *
   * @param {string} taskId - The ID of the task.
   * @param {Function} getTask - Function to retrieve a task by its ID.
   * @returns {Promise<string[]>} - An array of IDs of the leaf tasks.
   *
   * TODO: we need to change this to become independent from "childrenIDs"
   *       an easy algoithm would be:  build a map of all tasks and check whether they have a parent or not.
   */
  async function findOneLeafTask(
    taskId: string,
    getTask: TyTaskManager['getTask'],
  ): Promise<string[]> {
    const stack: string[] = [taskId]
    const leafTasks: string[] = []

    while (stack.length > 0) {
      const currentTaskId = stack.pop() || ''
      const currentTask = await getTask(currentTaskId)
      if (!currentTask) continue

      const children = await searchOneChild(currentTaskId)

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
        void setTask(t, true)
        last_task_id = t.id
      })
    }

    return last_task_id
  }

  const fm = useFileManager(taskyonDB?.filemappings)

  const { getTaskIdChain, getTaskChain } = taskUtils(getTask)

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
      const message = t?.content && ('message' in t.content ? '\n\n' + t.content.message : '')

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
      if (n && 'message' in n.content) {
        return p + '\n\n' + n.content.message
      }
      return p
    }, '')
    void extractKeywords(chatString, 5).then((kws) => {
      console.log('update task with kw: ', kws)
      void updateTask({ id: newTask.id, name: kws[0] }, true)
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
    persist = true,
  ): Promise<TaskNode['id']> => {
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
    if (await getTask(newTask.id)) return newTask.id

    console.log('create new Task:', newTask.id)
    await setTask(newTask, persist)

    // extract keywordsfrom entire chat and use it to name the task...
    // but only if a taskname doesn't exist yet.
    // TODO: how can we do this much faster, so that we don't have to update our task and
    //       keep it immutable?  We should probably await keywords, but also keep a
    //       separate index with keywords for tasks...
    if (!newTask.name && task.content && !task.label?.includes('discard')) {
      await updateTaskNameWKeywords(newTask)
    } else if (newTask.name) {
      console.log('task already has a name:', newTask.name)
    }

    return newTask.id
  }

  async function addTaskChain(
    taskList: partialTaskDraft[],
    priorID: string | undefined = undefined,
    duplicateTaskName = true,
    persist = true,
  ) {
    let lastTaskId = priorID
    for (const task of taskList) {
      lastTaskId = await addPartialTask2Tree(
        task,
        lastTaskId, //parent
        duplicateTaskName,
        persist,
      )
    }
    return lastTaskId
  }

  async function addMdTaskChain(markdown?: string) {
    console.log('adding new Markdown tasks!!')
    if (markdown) {
      const taskList = processMarkdown(markdown)
      const lastTaskId = await addTaskChain(taskList)
      return lastTaskId
    }
    return undefined
    // TODO: optionally execute the last task...
  }

  const defaultMode = {
    getTask,
    deleteTask,
    searchTasks,
    setTask,
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
    findOneLeafTask,
    searchOneChild,
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
