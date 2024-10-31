import { TaskNode, RequireSome, ToolBase } from './types';
import { v1 as uuidv1 } from 'uuid';
import {
  TaskyonDatabase,
  FileMappingDocType,
  transformTaskNodeToDocType,
  transformDocToTaskNode,
  collections,
} from './rxdb';
import { openFile } from '../OPFS';
import { Lock, deepMerge, AsyncQueue, sleep } from '../utils';
import { useVectorStore } from './hnswIndex';
import { usePyodideWebworker, useNlpWorker } from './webWorkerApi';
import { Tool } from './tools';
import { taskUtils } from './taskUtils';
import { MangoQuery } from 'rxdb';

/**
 * Finds the root task of a given task.
 *
 * @param {string} taskId - The ID of the task.
 * @returns {string} - The ID of the root task, or null if not found.
 */
export async function findRootTask(
  taskId: string,
  getTask: TyTaskManager['getTask'],
) {
  let currentTaskID = taskId;

  while (currentTaskID) {
    const currentTask = await getTask(currentTaskID);
    if (!currentTask) return null; // Return null if a task doesn't exist

    if (currentTask.parentID) {
      currentTaskID = currentTask.parentID; // Trace back to the parent task
    } else {
      return currentTaskID; // Return the current task ID if it has no parent
    }
  }

  return currentTaskID; // Return null if the loop exits without finding a root task
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
export async function findLeafTasks(
  taskId: string,
  getTask: TyTaskManager['getTask'],
): Promise<string[]> {
  const stack: string[] = [taskId];
  const leafTasks: string[] = [];

  while (stack.length > 0) {
    const currentTaskId = stack.pop() || ''; // Pop the last task from the stack
    const currentTask = await getTask(currentTaskId);

    if (!currentTask) continue; // Skip if the task doesn't exist

    // Check if the current task is a leaf task
    if (!currentTask.childrenIDs || currentTask.childrenIDs.length === 0) {
      leafTasks.push(currentTaskId);
    } else {
      // Push all children of the current task onto the stack
      // To maintain the order of processing, you might want to reverse the children array
      stack.push(...currentTask.childrenIDs.reverse());
    }
  }

  return leafTasks;
}

function base64Uuid() {
  // Generate a UUID
  const hexUuid = uuidv1();

  // Convert the UUID from hex to a Buffer
  const bufferUuid = Buffer.from(hexUuid.replace(/-/g, ''), 'hex');

  // Convert the Buffer to a base64 string
  let base64Uuid = bufferUuid.toString('base64');

  base64Uuid = base64Uuid.replace(/==$/, '');

  return base64Uuid;
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

export const processTasksQueue = new AsyncQueue<string>();

// use this to create hashes for every task
async function hashObject(obj: unknown) {
  const jsonString = JSON.stringify(obj);
  const encoder = new TextEncoder();
  const dataBytes = encoder.encode(jsonString);

  const hash = await crypto.subtle.digest('SHA-256', dataBytes);
  const hashArray = Array.from(new Uint8Array(hash)); // convert buffer to byte array
  const hashHex = hashArray
    .map((b) => b.toString(16).padStart(2, '0'))
    .join(''); // convert bytes to hex string
  return hashHex;
}

async function taskContentHash(task: TaskNode) {
  console.log('generating new hash ID for task');
  // generate this hash ID to check of there are any duplicate tasks or anything like that...
  const hashId = await hashObject([
    task.content,
    task.role,
    task.allowedTools,
    task.label,
  ]);
  return hashId;
}

const { extractKeywords } = usePyodideWebworker('task manager keywords');

// add a task to the db. Adding some default information such as timestamps etc...
// whats important here is that the TaskNode can only have one type of content
// so when calling the function, we need to pre-select which type of task
// we want to have.
// TODO: move this into tyManager and rename ot to "addPartialTask2Tree"
export async function addTask2Tree(
  task: RequireSome<Partial<TaskNode>, 'role' | 'content'>,
  parentID: string | undefined,
  taskManager: TyTaskManager,
  execute = true,
  duplicateTaskName = true,
): Promise<TaskNode['id']> {
  if (!duplicateTaskName && task.name) {
    // check if task already exists and throw an error, if it does, because
    // we are not supposed to create it in that case ;)
    // this is specifically used in the case of repeated task
    // declarations which come for example from a webapge which integrates the tasks
    // TODO: instead of givien the webpage the option to "disallow" duplicate
    //       tasks, make sure, the tasks don't get saved in the db
    //       as the get declared every single time anyways, we don't need to store them!
    const tasks = await taskManager.searchTasks({
      selector: { name: task.name },
    });
    if (tasks.length > 0) {
      throw `The task ${task.name} already exists!`;
    }
  }

  const uuid = base64Uuid();

  const parent = parentID ? await taskManager.getTask(parentID) : undefined;

  const newTask: TaskNode = {
    ...task,
    role: task.role,
    parentID,
    content: task.content,
    state: task.state || 'Open',
    childrenIDs: [],
    debugging: task.debugging || {},
    id: uuid,
    created_at: Date.now(),
    configuration: task.configuration,
    allowedTools: task.allowedTools || parent?.allowedTools,
  };

  // TODO: register this in a list in taskyon so that figure out how
  // to make use of this...
  void taskContentHash(newTask);

  console.log('create new Task:', newTask.id);

  // TODO: get rid of this section..   we don't want task children, because
  //       they prevent us from creating immutable task trees
  if (parent) {
    parent.childrenIDs.push(newTask.id);
    await taskManager.updateTask(parent, true);
  }

  // Push the new function task to processTasksQueue
  // we are not saving yet, as it is going to be processed :)
  // TODO:  this needs an overhaul..  we want to save tasks only once
  //        and have them immutable...
  if (execute) {
    processTasksQueue.push(newTask.id);
    newTask.state = 'Queued';
    await taskManager.setTask(newTask, false);
  } else {
    // in the case of a task which is not processed, we can save it :)
    newTask.state = 'Completed';
    await taskManager.setTask(newTask, true);
  }

  // extract keywordsfrom entire chat and use it to name the task...
  // but only if a taskname doesn't exist yet.
  if (!newTask.name && task.content && !task.label?.includes('discard')) {
    const toolDefs = await taskManager.updateToolDefinitions(true);
    const chat = taskManager.buildChatThread(
      newTask.id,
      false,
      toolDefs,
      false,
    );
    const chatString = (await chat).reduce((p, n) => {
      if (typeof n.content === 'string') {
        return p + '\n\n' + n.content;
      }
      return p;
    }, '');
    void extractKeywords(chatString, 5).then((kws) => {
      console.log('update task with kw: ', kws);
      void taskManager.updateTask({ id: newTask.id, name: kws[0] }, true);
    });
  } else if (newTask.name) {
    console.log('task already has a name:', newTask.name);
  }

  return newTask.id;
}

function useFileManager(fileMappingDb?: TaskyonDatabase['filemappings']) {
  // TODO: make sure, we add the correct file type here!
  async function addFile(fileMapping: Partial<FileMappingDocType>) {
    const uuidFileMapping: FileMappingDocType = {
      uuid: base64Uuid(),
      ...fileMapping,
    };

    const fileMappingDoc = await fileMappingDb?.insert(uuidFileMapping);
    return fileMappingDoc?.uuid;
  }

  async function bulkUpsertFiles(filemappings: FileMappingDocType[]) {
    await fileMappingDb?.bulkUpsert(filemappings);
  }

  async function getFileMappingByUuid(
    uuid: string,
  ): Promise<FileMappingDocType | null> {
    // Find the document with the matching UUID
    const fileMappingDoc = await fileMappingDb?.findOne(uuid).exec();

    // Check if the document exists
    if (!fileMappingDoc) {
      console.log(`No file mapping found for UUID: ${uuid}`);
      return null;
    }

    // Return the found document
    return fileMappingDoc;
  }

  // we can search tasks here using a mongo-db query object
  // find out more here:  https://rxdb.info/rx-query.html
  async function searchFiles(query: MangoQuery): Promise<FileMappingDocType[]> {
    if (fileMappingDb) {
      const fileMappingList = await fileMappingDb.find(query).exec();
      return fileMappingList;
    }
    return [];
  }

  async function getFile(uuid: string): Promise<File | undefined> {
    const fileMap = await getFileMappingByUuid(uuid);
    if (fileMap?.opfs) {
      const file = openFile(fileMap.opfs);
      return file;
    }
  }

  // TODO: this function needs to be changes to search for names, instead of UUIDs
  async function getFileByName(name: string): Promise<File> {
    const fileMaps = await searchFiles({
      selector: {
        name: name,
      },
    });
    if (fileMaps.length) {
      // TODO: what do we do if we have multiple files with the same name?
      // TODO: try to load files form other sources as well :)
      const fileName = fileMaps[0]?.opfs;
      if (fileName) {
        const file = await openFile(fileName);
        if (file) {
          if (file.type.length == 0) {
            // we do this, because for some files, opfs doesn't recognize the file type
            // for some reason...
            const newfile = new File([file], file.name, {
              type: fileMaps[0]?.fileType,
            });
            return newfile;
          }
          return file;
        }
      }
      throw new Error(
        `We could not find the file locally:  ${name}. Was it uploaded somewhere else?`,
      );
    }
    throw new Error(`File not found: ${name}`);
  }

  return {
    addFile,
    searchFiles,
    bulkUpsertFiles,
    getFileMappingByUuid,
    getFile,
    getFileByName,
  };
}

function tyMechanisms() {
  // we need these locks in order to sync our databases..
  const taskLocks = new Map<string, Lock>();
  let subscribers: Array<
    (task?: TaskNode, taskNum?: number) => void | Promise<void>
  > = [];
  let taskCountSubscribers: Array<(task?: TaskNode, taskNum?: number) => void> =
    [];

  // Lock a task and returns a function closure which can be used to unlock it again...
  async function lockTask(taskId: string) {
    let lock = taskLocks.get(taskId);
    if (!lock) {
      lock = new Lock();
      taskLocks.set(taskId, lock);
    }
    console.log('getting lock for task:', taskId);
    const unlock = await lock.lock();
    console.log('acquired lock for', taskId);
    return () => {
      console.log('unlock!', taskId);
      unlock();
    };
  }

  // this function simply waits for a task to be unlocked, but doesn't
  // acquire a lock itself...
  async function waitForTaskUnlock(taskId: string) {
    const lock = taskLocks.get(taskId);
    if (lock) {
      // TODO: why is this called so often??
      //console.log('wait for unlock!');
      await lock.waitForUnlock();
    }
  }

  function subscribeToTaskChanges(
    callback: (task?: TaskNode, taskNum?: number) => void | Promise<void>,
    subscribeToTaskCountOnly = false,
  ): void {
    if (subscribeToTaskCountOnly) {
      taskCountSubscribers.push(callback);
    } else {
      subscribers.push(callback);
    }
  }

  // You may also need a method to unsubscribe if required
  function unsubscribeFromTaskChanges(
    callback: (task?: TaskNode, taskNum?: number) => void | Promise<void>,
  ): void {
    subscribers = subscribers.filter((sub) => sub !== callback);
    taskCountSubscribers = taskCountSubscribers.filter(
      (sub) => sub !== callback,
    );
  }

  function notifySubscribers(
    task: TaskNode | undefined,
    taskNum: number | undefined = undefined,
  ): void {
    /*if (!task && !taskNum) {
      subscribers.forEach((callback) => void callback(undefined, undefined));
    }*/

    if (task) {
      subscribers.forEach((callback) => void callback(task, taskNum));
    }

    // Notify subscribers interested in task count changes
    if (taskNum) {
      taskCountSubscribers.forEach((callback) => callback(undefined, taskNum));
    }
  }

  // this class holds utilitiy funcions to manage taskyons infrastructure
  return {
    lockTask,
    waitForTaskUnlock,
    subscribeToTaskChanges,
    unsubscribeFromTaskChanges,
    notifySubscribers,
  };
}

function useTaskVectors(
  tasks: Map<string, TaskNode>,
  lockTask: (taskId: string) => Promise<() => void>,
  vectorizerModel?: string,
  taskyonDB?: TaskyonDatabase,
) {
  const { vectorizeText } = useNlpWorker();
  const { getVectorIndex, resetVectorStore } = useVectorStore('taskyondbv');

  async function syncVectorIndexWithTasks(
    resetVectorIndex = false,
    progressCallback: (done: number, total: number) => void,
  ) {
    console.log('sync vector index');
    const vectorIndex = await getVectorIndex();
    if (!vectorIndex || !taskyonDB) {
      console.warn('Vector index or database is not initialized.');
      return;
    }

    if (resetVectorIndex) {
      console.log('delete vector store');
      await resetVectorStore();
      console.log('delete vector mappings');
      await taskyonDB.vectormappings.remove();
      await taskyonDB.addCollections({
        vectormappings: collections.vectormappings,
      });
    }

    let counter = 0;
    //taskyonDB.vectormappings.exportJSON()
    for (const task of tasks.values()) {
      progressCallback(counter, tasks.size);
      // addtovectorDB checks if a task already exists...
      await addtoVectorDB(task);
      counter += 1;
    }

    //await sleep(10);
    //await vectorIndex.writeIndex(vectorIndexName);
    progressCallback(tasks.size, tasks.size);

    console.log('Sync complete.');
  }

  const vecMappingFromTask = (taskId: string) =>
    taskyonDB?.vectormappings
      .findOne({
        selector: { uuid: taskId },
      })
      .exec();

  async function deleteTaskFromVectorStore(taskId: string) {
    const vecmapping = await vecMappingFromTask(taskId);
    await vecmapping?.remove();
    const vecid = Number(vecmapping?.vecid);
    if (vecid) {
      void (await getVectorIndex())?.markDelete(vecid);
    }
  }

  const vecAlreadyExists = async (taskId: string) => {
    const vecid = Number((await vecMappingFromTask(taskId))?.vecid);
    if (vecid) {
      try {
        // this works. If we mark a label as deleted in our vector index
        // this will throw an error, meaning the vector doesn't exist...
        const vec = (await getVectorIndex())?.getPoint(vecid);
        return vec;
      } catch (error) {
        return undefined;
      }
    }
    return undefined;
  };

  async function addtoVectorDB(
    task: TaskNode,
    //override = false,
    //storeInDB: false,
  ) {
    const unlock = await lockTask(task.id);
    const existingVector = await vecAlreadyExists(task.id);
    if (existingVector) {
      console.log('vector already exists!', task.id);
    } else if (vectorizerModel) {
      console.log('create vector...', task.id);
      const numvec = await vectorizeText(
        JSON.stringify(task.content),
        vectorizerModel,
      );
      if (numvec) {
        console.log('got a vector result.');
        const vectorIndex = await getVectorIndex();
        const vec = new Float32Array(numvec);
        const label = vectorIndex?.addItems([vec], true)[0];
        // it is important that we await all functions here becase
        // we are in a task lock-situation and can not afford for them to be unlocked at some point :)
        await taskyonDB?.vectormappings.upsert({
          uuid: task.id,
          vecid: String(label),
          //vector: storeInDB ? encodeVector(vec) : undefined, # not saving vectors for now...
        });
      }
    }
    unlock();
  }

  async function filteredVectorSearch(
    searchTerm: string,
    query: MangoQuery,
    k = 10,
  ): Promise<{ task: TaskNode; distance: number }[]> {
    if (taskyonDB) {
      const taskList = await taskyonDB.tasknodes.find(query).exec();
      const taskIDs = taskList.map((taskDoc) => taskDoc.id);
      const prefilterVectorsIds = await taskyonDB.vectormappings
        .find({
          selector: {
            uuid: { $in: taskIDs },
          },
        })
        .exec();
      const vecIDs = prefilterVectorsIds.map((vm) => vm.vecid);
      const filterfunction = (label: number) =>
        vecIDs.includes(label.toString());

      const result = vectorSearchTasks(searchTerm, k, filterfunction);
      return result;
    }
    return [];
  }

  async function vectorSearchTasks(
    searchTerm: string,
    k = 5,
    filterfunction?: (label: number) => boolean,
  ) {
    console.log('search for', searchTerm);
    const result: { task: TaskNode; distance: number }[] = [];
    const vectorIndex = await getVectorIndex();
    if (vectorIndex && vectorizerModel) {
      const queryVec = await vectorizeText(searchTerm, vectorizerModel);
      if (queryVec && taskyonDB) {
        const res = vectorIndex.searchKnn(queryVec, k, filterfunction);
        const neighborIndices = res.neighbors.map((r) => String(r));

        // Fetch the vector mappings in bulk for all neighbor indices
        const vectorMappingDocs = await taskyonDB.vectormappings
          .findByIds(neighborIndices)
          .exec();

        // Use the neighbor indices to get the correct vector mapping documents
        // and then use the uuid from those documents to fetch the tasks
        res.neighbors.forEach((neighborIndex, searchResultIndex) => {
          const uuid = vectorMappingDocs.get(String(neighborIndex))?.uuid;
          if (uuid) {
            const foundTask = tasks.get(uuid);
            if (foundTask) {
              result.push({
                task: foundTask,
                distance: res.distances[searchResultIndex] || 0.0,
              });
            }
          }
        });
      }
    }
    return result;
  }

  return {
    syncVectorIndexWithTasks,
    deleteTaskFromVectorStore,
    addtoVectorDB,
    filteredVectorSearch,
    vectorSearchTasks,
    resetVectorStore,
  };
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
  tasks: Map<string, TaskNode>,
  defaultTools: Tool[],
  taskyonDB?: TaskyonDatabase,
  vectorizerModel?: string,
) {
  // uses RxDB as a DB backend..
  // Usage example:
  // const taskManager = new TaskManager(initialTasks, taskyonDBInstance);

  const {
    lockTask,
    waitForTaskUnlock,
    subscribeToTaskChanges,
    unsubscribeFromTaskChanges,
    notifySubscribers,
  } = tyMechanisms();

  const {
    syncVectorIndexWithTasks,
    deleteTaskFromVectorStore,
    addtoVectorDB,
    filteredVectorSearch,
    vectorSearchTasks,
    resetVectorStore,
  } = useTaskVectors(tasks, lockTask, vectorizerModel, taskyonDB);

  async function countVecs() {
    if (taskyonDB) {
      return await taskyonDB.vectormappings.count().exec();
    } else return undefined;
  }

  async function countTasks() {
    if (taskyonDB) {
      return await taskyonDB.tasknodes.count().exec();
    } else return undefined;
  }

  // TODO: get rid of this...  its too slow and we want to oad tasks directly from the db...
  //       or do this really slowly...
  // this function slowly loads the entire db into memory cache in the background trying to speed up
  // future access to tasks...
  // it would probably be a better idea to to this with a caching function, considering
  // that our tasks are supposd to be immutable anyways...
  // probably also a good idea to return an immutable with immutable.js :)
  async function initializeTasksFromDB() {
    // TODO: wondering if we should maybe get rid of this?  its pretty inefficient to do this
    //       on every reload of our app :P
    console.log('Initialize our in-memory task store.');
    if (taskyonDB) {
      const tasksFromDb = await taskyonDB.tasknodes.find().exec();
      tasksFromDb.forEach(async (taskDoc) => {
        try {
          // make sure we load the task into cache by calling it...
          getTask(taskDoc.id);
        } catch (error) {
          console.error('Error transforming task doc:', error);
          // skip this task and continue with the next one
        }
        await sleep(100);
      });
      console.log('all tasks loaded from DB!');

      notifySubscribers(undefined, await countTasks());
    }
  }
  void initializeTasksFromDB();

  async function unblockedGetTask(
    taskId: string,
  ): Promise<TaskNode | undefined> {
    // Check if the task exists in the local record
    let task = tasks.get(taskId);
    if (!task && taskyonDB) {
      // If not, load from the database
      const taskFromDb = await taskyonDB.tasknodes.findOne(taskId).exec();
      if (taskFromDb) {
        task = transformDocToTaskNode(taskFromDb);
        tasks.set(taskId, task); // Update local record
      }
    }
    return task;
  }

  async function getTask(taskId: string): Promise<TaskNode | undefined> {
    await waitForTaskUnlock(taskId);
    return await unblockedGetTask(taskId);
  }

  async function setTask(task: TaskNode, save: boolean): Promise<void> {
    const unlock = await lockTask(task.id);
    await withTaskCountCheck(task.id, async () => {
      tasks.set(task.id, task);
      if (save) {
        await saveTask(task.id); // Save to database if required
      }
    });
    unlock();
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
  async function updateTask(
    updateData: Partial<TaskNode> & { id: string },
    save: boolean,
  ): Promise<void> {
    await withTaskCountCheck(updateData.id, async () => {
      const unlock = await lockTask(updateData.id);
      const task = await unblockedGetTask(updateData.id);
      if (task) {
        // Update the task with new data
        //Object.assign(task, updateData);
        Object.assign(task, deepMerge(task, updateData));
        if (save) {
          await saveTask(task.id); // Save to database if required
        }
      }
      unlock();
      notifySubscribers(tasks.get(updateData.id));
    });
    // TODO: return the root or leave of the new tree ;).
  }

  async function saveTask(taskId: string): Promise<void> {
    // TODO: throw an error, if we save an already existing task!
    //       because we want to make sure, that tasks in the db are immutable.
    //       so we can never update a task with an already existing id...
    const task = tasks.get(taskId);
    console.log('save task: ', taskId);
    if (task && taskyonDB) {
      const newDBTask = transformTaskNodeToDocType(task);
      await taskyonDB.tasknodes.upsert(newDBTask);
      void addtoVectorDB(task);
    }
  }

  async function deleteAllTasks() {
    // also delete vectordb!
    // TODO: manually re-initiailized taskyondb after remove...
    if (taskyonDB) {
      console.log('delete the entire database!');
      await taskyonDB.remove();
    }
    tasks.clear();
    await resetVectorStore();
    notifySubscribers(undefined, 0);
  }

  async function deleteTask(taskId: string): Promise<void> {
    // also delete from vectordb!
    const unlock = await lockTask(taskId);
    console.log('deleting task:', taskId);

    // Delete from local record/memorydb
    tasks.delete(taskId);
    await deleteTaskFromDB(taskId);
    await deleteTaskFromVectorStore(taskId);
    console.log('done deleting task:', taskId);

    notifySubscribers(tasks.get(taskId), await countTasks());
    unlock();
  }

  const deleteTaskFromDB = async (taskId: string) => {
    if (taskyonDB) {
      const taskDoc = await taskyonDB.tasknodes.findOne(taskId).exec();
      if (taskDoc) {
        await taskDoc.remove();
      }
    }
  };

  // TODO:  we need to rewrite this, so that we only use parents and not children!
  function getLeafTasks() {
    console.log('get leaf tasks...');
    const orphanTasks = [];
    for (const task of tasks.values()) {
      if (task.childrenIDs && task.childrenIDs.length == 0) {
        orphanTasks.push(task);
      }
    }
    return orphanTasks
      .sort((a, b) => (a.created_at || 0) - (b.created_at || 0))
      .map((t) => t.id);
  }

  async function withTaskCountCheck(
    taskId: string,
    operation: () => void | Promise<void>,
  ) {
    const prevTaskCount = tasks.size;

    void (await Promise.resolve(operation()));

    const taskCountChanged = tasks.size !== prevTaskCount;
    notifySubscribers(
      tasks.get(taskId),
      taskCountChanged ? await countTasks() : undefined,
    );
  }

  // we can search tasks here using a mongo-db query object
  // find out more here:  https://rxdb.info/rx-query.html
  async function searchTasks(query: MangoQuery): Promise<TaskNode[]> {
    if (taskyonDB) {
      const taskList = await taskyonDB.tasknodes.find(query).exec();

      const llmtasks = taskList.map((taskDoc) => {
        const task = transformDocToTaskNode(taskDoc);
        // update our function cache :)
        tasks.set(task.id, task);
        return task;
      });
      return llmtasks;
    }
    return [];
  }

  async function updateToolDefinitions<T extends boolean>(
    removeFunction: T = false as T,
  ): Promise<
    T extends true ? Record<string, ToolBase> : Record<string, ToolBase | Tool>
  > {
    if (taskyonDB) {
      const tasks = await searchTasks({
        selector: {
          label: {
            $elemMatch: {
              $eq: 'function',
            },
          },
        },
      });

      function hasMessage(
        task: TaskNode,
      ): task is TaskNode & { content: { message: string } } {
        return 'message' in task.content;
      }

      const toolDefs = tasks.filter(hasMessage);
      const parsedToolDefs = toolDefs.flatMap((task) => {
        try {
          const toolDef = ToolBase.parse(JSON.parse(task.content.message));
          return [toolDef];
        } catch (e) {
          return [];
        }
      });

      // Merge parsed tool definitions with default tools
      return parsedToolDefs.concat(Object.values(defaultTools)).reduce(
        (pv, cv) => {
          if (removeFunction && 'function' in cv) {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { function: unused, ...toolBaseOnly } = cv as Tool;
            pv[toolBaseOnly.name] = toolBaseOnly;
          } else {
            pv[cv.name] = cv;
          }
          return pv;
        },
        {} as T extends true
          ? Record<string, ToolBase>
          : Record<string, ToolBase | Tool>,
      );
    }

    return {} as T extends true
      ? Record<string, ToolBase>
      : Record<string, ToolBase | Tool>;
  }

  async function getJsonTaskBackup() {
    // TODO: give this a callback so that we can save it in "chunks"
    if (taskyonDB) {
      console.log('exporting json backup db!');
      const dbobject = await taskyonDB.exportJSON([
        'filemappings',
        'tasknodes',
        //'vectormappings'
      ]);
      return dbobject;
    }
  }

  async function addTaskBackup(jsonObjString: string) {
    // TODO: add some zod validation here!
    if (taskyonDB) {
      type ImportJSONFunction = typeof taskyonDB.importJSON;
      type FirstArgumentType = Parameters<ImportJSONFunction>[0];
      const jsonObj = JSON.parse(jsonObjString) as FirstArgumentType;
      console.log('importing json backup to db!');
      const dbobject = await taskyonDB.importJSON(jsonObj);
      return dbobject;
    }
    notifySubscribers(undefined, await countTasks());
  }

  const defaultMode = {
    getTask,
    updateTask,
    deleteTask,
    searchTasks,
    setTask,
    updateToolDefinitions,
    getLeafTasks,
    subscribeToTaskChanges,
    unsubscribeFromTaskChanges,
    getJsonTaskBackup,
    addTaskBackup,
    deleteAllTasks,
    countTasks,
    syncVectorIndexWithTasks,
    vectorSearchTasks,
    countVecs,
    filteredVectorSearch,
  };

  const fm = useFileManager(taskyonDB?.filemappings);

  return {
    ...defaultMode,
    ...fm,
    ...taskUtils(getTask, fm.getFileMappingByUuid, fm.getFile),
  };
}
export type TyTaskManager = ReturnType<typeof useTyTaskManager>;

// deletes tasks up to the first branch "split", eliminating a branch
// which is defined by the leaf and preceding, exclusive tasks
export async function deleteTaskThread(
  leafId: string,
  taskManager: TyTaskManager,
) {
  let currentTaskId = leafId;
  while (currentTaskId) {
    const currentTask = await taskManager.getTask(currentTaskId);
    if (!currentTask) break; // Break if a task doesn't exist

    // Check if the parent task has more than one child
    if (currentTask.parentID) {
      const parentTask = await taskManager.getTask(currentTask.parentID);
      if (parentTask && parentTask.childrenIDs.length > 1) {
        // in this case we need to update the parent with the fewer children
        const childrenIDs = parentTask.childrenIDs.filter(
          (id) => id != currentTask.id,
        );
        await taskManager.updateTask({ id: parentTask.id, childrenIDs }, true);
        break; // Stop deletion if the parent task has more than one child. We only want to delete this branch...
      }
    }

    // Delete the current task
    await taskManager.deleteTask(currentTaskId);

    if (currentTask.parentID) {
      // Move to the parent task
      currentTaskId = currentTask.parentID;
    } else {
      break;
    }
  }
}
