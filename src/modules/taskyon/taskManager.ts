import type { LLMTask, RequireSome } from './types';
import type { ChatStateType } from './chat';
import { v1 as uuidv1 } from 'uuid';
import {
  TaskyonDatabase,
  FileMappingDocType,
  transformLLMTaskToDocType,
  transformDocToLLMTask,
  collections,
} from './rxdb';
import { openFile } from './OPFS';
import { Lock, sleep, deepMerge, AsyncQueue } from './utils';
import { HierarchicalNSW } from 'hnswlib-wasm/dist/hnswlib-wasm';
import { loadOrCreateHNSWIndex } from './hnswIndex';
import { extractKeywords, useNlpWorker } from './webWorkerApi';
import { Tool, ToolBase } from './tools';
import { buildChatFromTask } from './taskUtils';
import { MangoQuery } from 'rxdb';

/**
 * Finds the root task of a given task.
 *
 * @param {string} taskId - The ID of the task.
 * @returns {string} - The ID of the root task, or null if not found.
 */
export async function findRootTask(
  taskId: string,
  getTask: TyTaskManager['getTask']
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
  getTask: TyTaskManager['getTask']
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

async function taskContentHash(task: LLMTask) {
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

// add a task to the db. Adding some default information such as timestamps etc...
// whats important here is that the LLMtask can only have one type of content
// so when calling the function, we need to pre-select which type of task
// we want to have.
export async function addTask2Tree(
  task: RequireSome<Partial<LLMTask>, 'role' | 'content'>,
  parentID: string | undefined,
  chatState: ChatStateType,
  taskManager: TyTaskManager,
  execute = true,
  duplicateTaskName = true
): Promise<LLMTask['id']> {
  if (!duplicateTaskName && task.name) {
    // check if task already exists and throw an error, if it does, because
    // we are not supposed to create it in that case ;)
    const tasks = await taskManager.searchTasks({
      selector: { name: task.name },
    });
    if (tasks.length > 0) {
      throw `The task ${task.name} already exists!`;
    }
  }

  const uuid = base64Uuid();

  const parent = parentID ? await taskManager.getTask(parentID) : undefined;

  const newTask: LLMTask = {
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
  if (!newTask.name && task.content) {
    const chat = buildChatFromTask(newTask.id, (tId: string) =>
      taskManager.getTask(tId)
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

  chatState.selectedTaskId = newTask.id;
  return newTask.id;
}

function useFileManager(fileMappingDb?: TaskyonDatabase['filemappings']) {
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
    uuid: string
  ): Promise<FileMappingDocType | null> {
    // Find the document with the matching UUID
    const fileMappingDoc = await fileMappingDb?.findOne(uuid).exec();

    // Check if the document exists
    if (!fileMappingDoc) {
      console.log(`No file mapping found for UUID: ${uuid}`);
      return null;
    }

    // Return the found document
    return {
      uuid: fileMappingDoc.uuid,
      opfs: fileMappingDoc.opfs,
      openAIFileId: fileMappingDoc.openAIFileId,
    };
  }

  async function getFile(uuid: string) {
    const fileMap = await getFileMappingByUuid(uuid);
    if (fileMap?.opfs) {
      const file = openFile(fileMap.opfs);
      return file;
    }
  }

  // TODO: this function needs to be changes to search for names, instead of UUIDs
  async function getFileByName(name: string) {
    const fileMap = await getFileMappingByUuid(name);
    if (fileMap?.opfs) {
      const file = openFile(fileMap.opfs);
      return file;
    }
  }

  return { addFile, bulkUpsertFiles, getFileMappingByUuid, getFile };
}

function tyMechanisms() {
  // we need these locks in order to sync our databases..
  const taskLocks: Map<string, Lock> = new Map();
  let subscribers: Array<
    (task?: LLMTask, taskNum?: number) => void | Promise<void>
  > = [];
  let taskCountSubscribers: Array<(task?: LLMTask, taskNum?: number) => void> =
    [];

  // Lock a task and returns a function closure which can be used to unlock it again...
  async function lockTask(taskId: string) {
    const newLock = new Lock();
    taskLocks.set(taskId, newLock);
    return newLock.lock();
  }

  async function waitForTaskUnlock(taskId: string) {
    const lock = taskLocks.get(taskId);
    if (lock) {
      console.log('wait for unlock!');
      await lock.waitForUnlock();
    }
  }

  function subscribeToTaskChanges(
    callback: (task?: LLMTask, taskNum?: number) => void | Promise<void>,
    subscribeToTaskCountOnly = false
  ): void {
    if (subscribeToTaskCountOnly) {
      taskCountSubscribers.push(callback);
    } else {
      subscribers.push(callback);
    }
  }

  // You may also need a method to unsubscribe if required
  function unsubscribeFromTaskChanges(
    callback: (task?: LLMTask, taskNum?: number) => void | Promise<void>
  ): void {
    subscribers = subscribers.filter((sub) => sub !== callback);
    taskCountSubscribers = taskCountSubscribers.filter(
      (sub) => sub !== callback
    );
  }

  function notifySubscribers(
    task: LLMTask | undefined,
    taskNum: number | undefined = undefined
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
export function useTyTaskManager<T extends TaskyonDatabase | undefined>(
  tasks: Map<string, LLMTask>,
  defaultTools: Tool[],
  taskyonDB?: T,
  vectorizerModel?: string
) {
  // uses RxDB as a DB backend..
  // Usage example:
  // const taskManager = new TaskManager(initialTasks, taskyonDBInstance);
  let vectorIndex: HierarchicalNSW | undefined;
  const vectorIndexName = 'taskyondbv';
  const { vectorizeText } = useNlpWorker();

  const {
    lockTask,
    waitForTaskUnlock,
    subscribeToTaskChanges,
    unsubscribeFromTaskChanges,
    notifySubscribers,
  } = tyMechanisms();

  if (vectorizerModel) {
    // make sure our search if prepared:
    // by calling this function, we initialize our search model and other things :)
    void vectorizeText(undefined, vectorizerModel);
  }

  async function initVectorStore(loadIfExists = true) {
    const maxElements = 10000;
    vectorIndex = await loadOrCreateHNSWIndex(
      vectorIndexName,
      maxElements,
      loadIfExists
    );
  }
  void initVectorStore();

  function count() {
    return tasks.size;
  }

  // TODO: get rid of this...
  async function initializeTasksFromDB() {
    // TODO: wondering if we should maybe get rid of this?  its pretty inefficient to do this
    //       on every reload of our app :P
    if (taskyonDB) {
      const tasksFromDb = await taskyonDB.llmtasks.find().exec();
      tasksFromDb.forEach((taskDoc) => {
        try {
          const task = transformDocToLLMTask(taskDoc);
          tasks.set(task.id, task);
        } catch (error) {
          console.error('Error transforming task doc:', error);
          // skip this task and continue with the next one
        }
      });
      console.log('all tasks loaded from DB!');

      notifySubscribers(undefined, count());
    }
  }
  void initializeTasksFromDB();

  async function unblockedGetTask(
    taskId: string
  ): Promise<LLMTask | undefined> {
    // Check if the task exists in the local record
    let task = tasks.get(taskId);
    if (!task && taskyonDB) {
      // If not, load from the database
      const taskFromDb = await taskyonDB.llmtasks.findOne(taskId).exec();
      if (taskFromDb) {
        task = transformDocToLLMTask(taskFromDb);
        tasks.set(taskId, task); // Update local record
      }
    }
    return task;
  }

  async function getTask(taskId: string): Promise<LLMTask | undefined> {
    await waitForTaskUnlock(taskId);
    return await unblockedGetTask(taskId);
  }

  async function setTask(task: LLMTask, save: boolean): Promise<void> {
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
  async function updateTask(
    updateData: Partial<LLMTask> & { id: string },
    save: boolean
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

  async function syncVectorIndexWithTasks(
    resetVectorIndex = false,
    progressCallback: (done: number, total: number) => void
  ) {
    console.log('sync vector index');
    if (!vectorIndex || !taskyonDB) {
      console.warn('Vector index or database is not initialized.');
      return;
    }

    if (resetVectorIndex) {
      console.log('delete vector store');
      await initVectorStore(false);
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
      // Check if the task is already in the vector index
      /*const vectorMappingDoc = await taskyonDB.vectormappings
        .findOne(task.id)
        .exec();
      if (vectorMappingDoc) {
        continue; // Skip if already in the vector index
      }*/

      await addtoVectorDB(task);
      counter += 1;
    }

    await sleep(1000);
    //await vectorIndex.writeIndex(vectorIndexName);
    progressCallback(tasks.size, tasks.size);

    console.log('Sync complete.');
  }

  async function addtoVectorDB(task: LLMTask) {
    if (vectorIndex && taskyonDB && vectorizerModel) {
      const vec = await vectorizeText(JSON.stringify(task), vectorizerModel);
      console.log('got a vector result.');
      //const vec = await getVector(JSON.stringify(task), vectorizerModel);
      if (vec) {
        const newLabel = vectorIndex.addItems([vec], false)[0];
        void taskyonDB.vectormappings.upsert({
          uuid: task.id,
          vecid: String(newLabel),
        });
      }
      console.log('finished adding vector!');
    }
  }

  async function saveTask(taskId: string): Promise<void> {
    // TODO: throw an error, if we save an already existing task!
    //       because we want to make sure, that tasks in the db are immutable.
    //       so we can never update a task with an already existing id...
    const task = tasks.get(taskId);
    console.log('save task: ', task);
    if (task && taskyonDB) {
      const newDBTask = transformLLMTaskToDocType(task);
      await taskyonDB.llmtasks.upsert(newDBTask);
      // async update of the vector database in order to not cause any interruptions...
      void addtoVectorDB(task);
    }
  }

  async function vectorSearchTasks(searchTerm: string, k = 5) {
    console.log('search for', searchTerm);
    const result = { tasks: [] as LLMTask[], distances: [] as number[] };
    if (vectorIndex && vectorizerModel) {
      const queryVec = await vectorizeText(searchTerm, vectorizerModel);
      if (queryVec && taskyonDB) {
        const res = vectorIndex.searchKnn(queryVec, k, undefined);
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
              result.tasks.push(foundTask);
              result.distances.push(res.distances[searchResultIndex]);
            }
          }
        });
      }
    }
    return result;
  }

  async function deleteAllTasks() {
    // TODO: manually re-initiailized taskyondb after remove...
    if (taskyonDB) {
      console.log('delete the entire database!');
      await taskyonDB.remove();
    }
    tasks.clear();
    notifySubscribers(undefined, count());
  }

  async function deleteTask(taskId: string): Promise<void> {
    const unlock = await lockTask(taskId);
    console.log('deleting task:', taskId);
    // Delete from local record
    tasks.delete(taskId);

    // Delete from the database
    if (taskyonDB) {
      const taskDoc = await taskyonDB.llmtasks.findOne(taskId).exec();
      if (taskDoc) {
        await taskDoc.remove();
      }
    }
    console.log('done deleting task:', taskId);
    notifySubscribers(tasks.get(taskId), count());
    unlock();
  }

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
    operation: () => void | Promise<void>
  ) {
    const prevTaskCount = tasks.size;

    void (await Promise.resolve(operation()));

    const taskCountChanged = tasks.size !== prevTaskCount;
    notifySubscribers(
      tasks.get(taskId),
      taskCountChanged ? count() : undefined
    );
  }

  // we can search tasks here using a mongo-db query object
  // find out more here:  https://rxdb.info/rx-query.html
  async function searchTasks(query: MangoQuery): Promise<LLMTask[]> {
    if (taskyonDB) {
      const taskList = await taskyonDB.llmtasks.find(query).exec();

      const llmtasks = taskList.map((toolDoc) => {
        const task = transformDocToLLMTask(toolDoc);
        // update our function cache :)
        tasks.set(task.id, task);
        return task;
      });
      return llmtasks;
    }
    return [];
  }

  async function searchToolDefinitions(): Promise<
    Record<string, ToolBase | Tool>
  > {
    // TODO: make sure, its clear that we return non-partial tool types here...
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
        task: LLMTask
      ): task is LLMTask & { content: { message: string } } {
        return 'message' in task.content;
      }
      const toolDefs = tasks.filter(hasMessage);
      //const toolDefs = tasks.filter((task) => 'message' in task);
      const parsedToolDefs = toolDefs.map((task) => {
        const toolDef = ToolBase.parse(JSON.parse(task.content.message));
        return toolDef;
      });

      return parsedToolDefs
        .concat(Object.values(parsedToolDefs))
        .reduce((pv, cv) => {
          pv[cv.name] = cv;
          return pv;
        }, {} as Record<string, ToolBase>);
    }
    return {};
  }

  // TODO: evaluate js code from an actual function :). Put it into a secure iframe?
  function addToolCode(toolCode: string) {
    console.log('add tool code:', toolCode);

    const myString =
      "function myFunction(a) { console.log('Hello, World!', a); }";

    // TODO: consider getting a security audit for these types of things...  But we can already execute html code etc..  sow I don't
    //       think there is anything wrong here anyways. We are also in the browser sandbox
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const myFunction = new Function(myString);
    myFunction('Hello, World!');
  }

  async function getJsonTaskBackup() {
    // TODO: give this a callback so that we can save it in "chunks"
    if (taskyonDB) {
      console.log('exporting json backup db!');
      const dbobject = await taskyonDB.exportJSON([
        'llmtasks',
        'filemappings',
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
    notifySubscribers(undefined, count());
  }

  const defaultMode = {
    getTask,
    updateTask,
    deleteTask,
    searchTasks,
    setTask,
    searchToolDefinitions,
    getLeafTasks,
    subscribeToTaskChanges,
    unsubscribeFromTaskChanges,
    getJsonTaskBackup,
    addTaskBackup,
    deleteAllTasks,
    count,
    syncVectorIndexWithTasks,
    vectorSearchTasks,
    addToolCode,
  };

  return {
    ...defaultMode,
    ...useFileManager(taskyonDB?.filemappings),
  };
}
export type TyTaskManager = ReturnType<typeof useTyTaskManager>;

// deletes tasks up to the first branch "split", eliminating a branch
// which is defined by the leaf and preceding, exclusive tasks
export async function deleteTaskThread(
  leafId: string,
  taskManager: TyTaskManager
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
          (id) => id != currentTask.id
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
