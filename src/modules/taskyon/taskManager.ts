import type { LLMTask, partialTaskDraft } from './types';
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
import { loadModel } from './mlModels';

/**
 * Finds the root task of a given task.
 *
 * @param {string} taskId - The ID of the task.
 * @returns {string} - The ID of the root task, or null if not found.
 */
export async function findRootTask(
  taskId: string,
  getTask: InstanceType<typeof TaskManager>['getTask']
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
  getTask: InstanceType<typeof TaskManager>['getTask']
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

export async function getFileMappingByUuid(
  uuid: string,
  taskManager: TaskManager
): Promise<FileMappingDocType | null> {
  // Find the document with the matching UUID
  const fileMappingDoc = await taskManager.getFileMappingByUuid(uuid);

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

export async function getFile(uuid: string, taskManager: TaskManager) {
  const fileMap = await getFileMappingByUuid(uuid, taskManager);
  if (fileMap?.opfs) {
    const file = openFile(fileMap.opfs);
    return file;
  }
}

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

export async function addTask2Tree(
  task: partialTaskDraft,
  parentID: string | undefined,
  chatState: ChatStateType,
  taskManager: TaskManager,
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

// Function to create the database
/*
  TaskyonManager is build with reactivity in mind. you can supply a reactive map
  to the constructor. it will be kept in sync with the taskdb and supplies reactive changes
  to the UI. We could have used the function of RxDB for this. But this approach would have been
  less flexible...

    const TaskList = reactive<Map<string, LLMTask>>(new Map());
    const taskyonDBInstance = await createTaskyonDatabase('taskyondb');
    taskManagerInstance = new TaskManager(TaskList, taskyonDBInstance);
*/

// TODO: refactor TaskManager into a module (function which returns a subset of functions)
//       when we do this it becomes much easier to pass around the individual functions....
//       and we can include most of the functions above in this as well...
// TODO:  we cna also break down  the individual parts of TaskManager this way into smaller parts:
//        - the vector store part
//        - the taskDB part
//        - he file search part etc...
export class TaskManager {
  // uses RxDB as a DB backend..
  // Usage example:
  // const taskManager = new TaskManager(initialTasks, taskyonDBInstance);
  private taskyonDB: TaskyonDatabase | undefined;
  private tasks: Map<string, LLMTask>;
  private defaultTools: Tool[];
  private vectorIndex: HierarchicalNSW | undefined;
  // we need these locks in order to sync our databases..
  private taskLocks: Map<string, Lock> = new Map();
  private subscribers: Array<
    (task?: LLMTask, taskNum?: number) => void | Promise<void>
  > = [];
  private taskCountSubscribers: Array<
    (task?: LLMTask, taskNum?: number) => void
  > = [];
  private vectorizerModel: string;
  private vectorIndexName: string;

  private vectorizeText: ReturnType<typeof useNlpWorker>['vectorizeText'];

  constructor(
    tasks: TaskManager['tasks'],
    defaultTools: TaskManager['defaultTools'],
    taskyonDB?: TaskyonDatabase,
    vectorizerModel?: string
  ) {
    this.tasks = tasks;
    this.taskyonDB = taskyonDB;
    void this.initializeTasksFromDB();
    this.vectorizerModel = vectorizerModel || '';
    this.vectorIndexName = 'taskyondbv';
    void this.initVectorStore();
    this.defaultTools = defaultTools;

    const { vectorizeText } = useNlpWorker();
    this.vectorizeText = vectorizeText;
    // make sure our search if prepared:
    // by calling this function, we initialize our search model and other things :)
    void vectorizeText(undefined, this.vectorizerModel);
  }

  private initVectorStore = async (loadIfExists = true) => {
    const maxElements = 10000;
    this.vectorIndex = await loadOrCreateHNSWIndex(
      this.vectorIndexName,
      maxElements,
      loadIfExists
    );
  };

  // Lock a task and returns a function closure which can be used to unlock it again...
  private lockTask = async (taskId: string) => {
    const newLock = new Lock();
    this.taskLocks.set(taskId, newLock);
    return newLock.lock();
  };

  private waitForTaskUnlock = async (taskId: string) => {
    const lock = this.taskLocks.get(taskId);
    if (lock) {
      console.log('wait for unlock!');
      await lock.waitForUnlock();
    }
  };

  count() {
    return this.tasks.size;
  }

  // TODO: get rid of this...
  async initializeTasksFromDB() {
    // TODO: wondering if we should maybe get rid of this?  its pretty inefficient to do this
    //       on every reload of our app :P
    if (this.taskyonDB) {
      const tasksFromDb = await this.taskyonDB.llmtasks.find().exec();
      tasksFromDb.forEach((taskDoc) => {
        try {
          const task = transformDocToLLMTask(taskDoc);
          this.tasks.set(task.id, task);
        } catch (error) {
          console.error('Error transforming task doc:', error);
          // skip this task and continue with the next one
        }
      });
      console.log('all tasks loaded from DB!');
      this.notifySubscribers(undefined, true);
    }
  }

  private async unblockedGetTask(taskId: string): Promise<LLMTask | undefined> {
    // Check if the task exists in the local record
    let task = this.tasks.get(taskId);
    if (!task && this.taskyonDB) {
      // If not, load from the database
      const taskFromDb = await this.taskyonDB.llmtasks.findOne(taskId).exec();
      if (taskFromDb) {
        task = transformDocToLLMTask(taskFromDb);
        this.tasks.set(taskId, task); // Update local record
      }
    }
    return task;
  }

  async getTask(taskId: string): Promise<LLMTask | undefined> {
    await this.waitForTaskUnlock(taskId);
    return await this.unblockedGetTask(taskId);
  }

  async setTask(task: LLMTask, save: boolean): Promise<void> {
    const unlock = await this.lockTask(task.id);
    await this.withTaskCountCheck(task.id, async () => {
      this.tasks.set(task.id, task);
      if (save) {
        await this.saveTask(task.id); // Save to database if required
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
  async updateTask(
    updateData: Partial<LLMTask> & { id: string },
    save: boolean
  ): Promise<void> {
    await this.withTaskCountCheck(updateData.id, async () => {
      const unlock = await this.lockTask(updateData.id);
      const task = await this.unblockedGetTask(updateData.id);
      if (task) {
        // Update the task with new data
        //Object.assign(task, updateData);
        Object.assign(task, deepMerge(task, updateData));
        if (save) {
          await this.saveTask(task.id); // Save to database if required
        }
      }
      unlock();
      this.notifySubscribers(updateData.id);
    });
    // TODO: return the root or leave of the new tree ;).
  }

  async syncVectorIndexWithTasks(
    resetVectorIndex = false,
    progressCallback: (done: number, total: number) => void
  ) {
    console.log('sync vector index');
    if (!this.vectorIndex || !this.taskyonDB) {
      console.warn('Vector index or database is not initialized.');
      return;
    }

    if (resetVectorIndex) {
      console.log('delete vector store');
      await this.initVectorStore(false);
      console.log('delete vector mappings');
      await this.taskyonDB.vectormappings.remove();
      await this.taskyonDB.addCollections({
        vectormappings: collections.vectormappings,
      });
    }

    let counter = 0;
    //this.taskyonDB.vectormappings.exportJSON()
    for (const task of this.tasks.values()) {
      progressCallback(counter, this.tasks.size);
      // Check if the task is already in the vector index
      /*const vectorMappingDoc = await this.taskyonDB.vectormappings
        .findOne(task.id)
        .exec();
      if (vectorMappingDoc) {
        continue; // Skip if already in the vector index
      }*/

      await this.addtoVectorDB(task);
      counter += 1;
    }

    await sleep(1000);
    //await this.vectorIndex.writeIndex(this.vectorIndexName);
    progressCallback(this.tasks.size, this.tasks.size);

    console.log('Sync complete.');
  }

  private async addtoVectorDB(task: LLMTask) {
    if (this.vectorIndex && this.taskyonDB) {
      const vec = await this.vectorizeText(
        JSON.stringify(task),
        this.vectorizerModel
      );
      console.log('got a vector result.');
      //const vec = await getVector(JSON.stringify(task), this.vectorizerModel);
      if (vec) {
        const newLabel = this.vectorIndex.addItems([vec], false)[0];
        void this.taskyonDB.vectormappings.upsert({
          uuid: task.id,
          vecid: String(newLabel),
        });
      }
      console.log('finished adding vector!');
    }
  }

  private async saveTask(taskId: string): Promise<void> {
    // TODO: throw an error, if we save an already existing task!
    //       because we want to make sure, that tasks in the db are immutable.
    //       so we can never update a task with an already existing id...
    const task = this.tasks.get(taskId);
    console.log('save task: ', task);
    if (task && this.taskyonDB) {
      const newDBTask = transformLLMTaskToDocType(task);
      await this.taskyonDB.llmtasks.upsert(newDBTask);
      // async update of the vector database in order to not cause any interruptions...
      void this.addtoVectorDB(task);
    }
  }

  async vectorSearchTasks(searchTerm: string, k = 5) {
    console.log('search for', searchTerm);
    const result = { tasks: [] as LLMTask[], distances: [] as number[] };
    if (this.vectorIndex) {
      const queryVec = await this.vectorizeText(
        searchTerm,
        this.vectorizerModel
      );
      if (queryVec && this.taskyonDB) {
        const res = this.vectorIndex.searchKnn(queryVec, k, undefined);
        const neighborIndices = res.neighbors.map((r) => String(r));

        // Fetch the vector mappings in bulk for all neighbor indices
        const vectorMappingDocs = await this.taskyonDB.vectormappings
          .findByIds(neighborIndices)
          .exec();

        // Use the neighbor indices to get the correct vector mapping documents
        // and then use the uuid from those documents to fetch the tasks
        res.neighbors.forEach((neighborIndex, searchResultIndex) => {
          const uuid = vectorMappingDocs.get(String(neighborIndex))?.uuid;
          if (uuid) {
            const foundTask = this.tasks.get(uuid);
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

  async addFile(fileMapping: Partial<FileMappingDocType>) {
    const uuidFileMapping: FileMappingDocType = {
      uuid: base64Uuid(),
      ...fileMapping,
    };

    if (this.taskyonDB) {
      const fileMappingDoc = await this.taskyonDB.filemappings.insert(
        uuidFileMapping
      );
      return fileMappingDoc?.uuid;
    }
  }

  async bulkUpsertFiles(filemappings: FileMappingDocType[]) {
    if (this.taskyonDB) {
      await this.taskyonDB.filemappings.bulkUpsert(filemappings);
    }
  }

  async getFileMappingByUuid(uuid: string) {
    if (this.taskyonDB) {
      const fileMappingDoc = await this.taskyonDB.filemappings
        .findOne(uuid)
        .exec();
      return fileMappingDoc;
    }
  }

  async deleteAllTasks() {
    // TODO: manually re-initiailized taskyondb after remove...
    if (this.taskyonDB) {
      console.log('delete the entire database!');
      await this.taskyonDB.remove();
    }
    this.tasks.clear();
    this.notifySubscribers(undefined, true);
  }

  async deleteTask(taskId: string): Promise<void> {
    const unlock = await this.lockTask(taskId);
    console.log('deleting task:', taskId);
    // Delete from local record
    this.tasks.delete(taskId);

    // Delete from the database
    if (this.taskyonDB) {
      const taskDoc = await this.taskyonDB.llmtasks.findOne(taskId).exec();
      if (taskDoc) {
        await taskDoc.remove();
      }
    }
    console.log('done deleting task:', taskId);
    this.notifySubscribers(taskId, true);
    unlock();
  }

  subscribeToTaskChanges(
    callback: (task?: LLMTask, taskNum?: number) => void | Promise<void>,
    subscribeToTaskCountOnly = false
  ): void {
    if (subscribeToTaskCountOnly) {
      this.taskCountSubscribers.push(callback);
    } else {
      this.subscribers.push(callback);
    }
  }

  // You may also need a method to unsubscribe if required
  unsubscribeFromTaskChanges(
    callback: (task?: LLMTask, taskNum?: number) => void | Promise<void>
  ): void {
    this.subscribers = this.subscribers.filter((sub) => sub !== callback);
    this.taskCountSubscribers = this.taskCountSubscribers.filter(
      (sub) => sub !== callback
    );
  }

  // TODO:  we need to rewrite this, so that we only use parents and not children!
  getLeafTasks() {
    console.log('get leaf tasks...');
    const orphanTasks = [];
    for (const task of this.tasks.values()) {
      if (task.childrenIDs && task.childrenIDs.length == 0) {
        orphanTasks.push(task);
      }
    }
    return orphanTasks
      .sort((a, b) => (a.created_at || 0) - (b.created_at || 0))
      .map((t) => t.id);
  }

  private notifySubscribers(taskId?: string, taskCountChanged = false): void {
    const taskNum = taskCountChanged ? this.tasks.size : undefined;

    // Notify subscribers interested in task changes
    if (taskId) {
      const task = this.tasks.get(taskId);
      if (task) {
        this.subscribers.forEach((callback) => void callback(task, taskNum));
      }
    } else {
      this.subscribers.forEach((callback) => void callback(undefined, taskNum));
    }

    // Notify subscribers interested in task count changes
    if (taskCountChanged) {
      this.taskCountSubscribers.forEach((callback) =>
        callback(undefined, taskNum)
      );
    }
  }

  private async withTaskCountCheck(
    taskId: string,
    operation: () => void | Promise<void>
  ) {
    const prevTaskCount = this.tasks.size;

    void (await Promise.resolve(operation()));

    const taskCountChanged = this.tasks.size !== prevTaskCount;
    this.notifySubscribers(taskId, taskCountChanged);
  }

  // we can search tasks here using a mongo-db query object
  // find out more here:  https://rxdb.info/rx-query.html
  async searchTasks(query: MangoQuery): Promise<LLMTask[]> {
    if (this.taskyonDB) {
      const tasks = await this.taskyonDB.llmtasks.find(query).exec();

      const llmtasks = tasks.map((toolDoc) => {
        const task = transformDocToLLMTask(toolDoc);
        // update our function cache :)
        this.tasks.set(task.id, task);
        return task;
      });
      return llmtasks;
    }
    return [];
  }

  async searchToolDefinitions(): Promise<Record<string, ToolBase | Tool>> {
    // TODO: make sure, its clear that we return non-partial tool types here...
    if (this.taskyonDB) {
      const tasks = await this.searchTasks({
        selector: {
          label: {
            $elemMatch: {
              $eq: 'function',
            },
          },
        },
      });

      const toolDefs = tasks.map((task) => {
        const toolDef = ToolBase.parse(JSON.parse(task.content || ''));
        return toolDef;
      });

      return toolDefs
        .concat(Object.values(this.defaultTools))
        .reduce((pv, cv) => {
          pv[cv.name] = cv;
          return pv;
        }, {} as Record<string, ToolBase>);
    }
    return {};
  }

  // TODO: evaluate js code from an actual function :). Put it into a secure iframe?
  addToolCode(toolCode: string) {
    console.log('add tool code:', toolCode);

    const myString =
      "function myFunction(a) { console.log('Hello, World!', a); }";

    // TODO: consider getting a security audit for these types of things...  But we can already execute html code etc..  sow I don't
    //       think there is anything wrong here anyways. We are also in the browser sandbox
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const myFunction = new Function(myString);
    myFunction('Hello, World!');
  }

  async getJsonTaskBackup() {
    // TODO: give this a callback so that we can save it in "chunks"
    if (this.taskyonDB) {
      console.log('exporting json backup db!');
      const dbobject = await this.taskyonDB.exportJSON([
        'llmtasks',
        'filemappings',
        //'vectormappings'
      ]);
      return dbobject;
    }
  }

  async addTaskBackup(jsonObjString: string) {
    // TODO: add some zod validation here!
    if (this.taskyonDB) {
      type ImportJSONFunction = typeof this.taskyonDB.importJSON;
      type FirstArgumentType = Parameters<ImportJSONFunction>[0];
      const jsonObj = JSON.parse(jsonObjString) as FirstArgumentType;
      console.log('importing json backup to db!');
      const dbobject = await this.taskyonDB.importJSON(jsonObj);
      return dbobject;
    }
    this.notifySubscribers(undefined, true);
  }
}

// deletes tasks up to the first branch "split", eliminating a branch
// which is defined by the leaf and preceding, exclusive tasks
export async function deleteTaskThread(
  leafId: string,
  taskManager: TaskManager
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
