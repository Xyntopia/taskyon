import type { LLMTask } from './types';
import type { ChatStateType } from './chat';
import { v1 as uuidv1 } from 'uuid';
import type { partialTaskDraft } from './types';
import {
  TaskyonDatabase,
  FileMappingDocType,
  transformLLMTaskToDocType,
  transformDocToLLMTask,
  collections,
} from './rxdb';
import { openFile } from './OPFS';
import { Lock, sleep } from 'src/modules/taskyon/utils';
import { deepMerge } from './utils';
import { HierarchicalNSW } from 'hnswlib-wasm/dist/hnswlib-wasm';
import { AsyncQueue } from './utils';
import { loadOrCreateVectorStore } from './vectorSearch';
import { extractKeywords, vectorizeText } from './webWorkerApi';
import { Tool } from './tools';

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

// get a taskchain from a task ID: following parent and/or child links
export async function taskChain(
  taskId: string,
  getTask: InstanceType<typeof TaskManager>['getTask'],
  parents = true,
  children = false
) {
  const conversationList: string[] = [taskId];

  if (parents) {
    // Start with the selected task
    let currentTaskID = taskId;

    // Trace back the parentIDs to the original task in the chain
    while (currentTaskID) {
      // Get the current task
      const currentTask = await getTask(currentTaskID);
      if (!currentTask) break; // Break if we reach a task that doesn't exist

      // Move to the parent task
      if (currentTask.parentID) {
        currentTaskID = currentTask.parentID; // This can now be string | undefined
      } else break; // Break if we reach an "initial" task

      // Prepend the current task to the conversation list so the selected task ends up being the last in the list
      conversationList.unshift(currentTaskID);
    }
  }

  if (children) {
    // Start with the first child of the selected task
    let currentTaskID = taskId;

    // Follow the first child in the task list
    while (currentTaskID) {
      // Get the current task
      const currentTask = await getTask(currentTaskID);
      if (!currentTask) break; // Break if we reach a task that doesn't exist

      // Move to the first child task, if it exists
      if (currentTask.childrenIDs.length) {
        currentTaskID = currentTask.childrenIDs[0];
      } else break;

      // Append the current task to the conversation list
      conversationList.push(currentTaskID);
    }
  }

  return conversationList;
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

export function findAllFilesInTasks(taskList: LLMTask[]): string[] {
  const fileSet = new Set<string>();
  taskList.forEach((task) => {
    (task.configuration?.uploadedFiles || []).forEach((file) =>
      fileSet.add(file)
    );
  });
  return Array.from(fileSet);
}

export const processTasksQueue = new AsyncQueue<string>();

export async function addTask2Tree(
  task: partialTaskDraft,
  parentID: string | undefined,
  chatState: ChatStateType,
  taskManager: TaskManager,
  execute = true
): Promise<LLMTask['id']> {
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

  console.log('create new Task:', newTask.id);

  if (task.content) {
    void extractKeywords(task.content, 5).then((kws) => {
      console.log('update task with kw: ', kws);
      void taskManager.updateTask({ id: uuid, name: kws[0] }, true);
    });
  }

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
    await taskManager.setTask(newTask, true);
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
export class TaskManager {
  // uses RxDB as a DB backend..
  // Usage example:
  // const taskManager = new TaskManager(initialTasks, taskyonDBInstance);
  private taskyonDB: TaskyonDatabase | undefined;
  private tasks: Map<string, LLMTask>;
  private defaultTools: Record<string, Tool>;
  private vectorIndex: HierarchicalNSW | undefined;
  // we need these locks in order to sync our databases..
  private taskLocks: Map<string, Lock> = new Map();
  private subscribers: Array<(task?: LLMTask, taskNum?: number) => void> = [];
  private taskCountSubscribers: Array<
    (task?: LLMTask, taskNum?: number) => void
  > = [];
  private vectorizerModel: string;
  private vectorIndexName: string;

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
  }

  async initVectorStore(loadIfExists = true) {
    const maxElements = 10000;
    this.vectorIndex = await loadOrCreateVectorStore(
      this.vectorIndexName,
      maxElements,
      loadIfExists
    );
  }

  // Lock a task and returns a function closure which can be used to unlock it again...
  async lockTask(taskId: string): Promise<() => void> {
    const newLock = new Lock();
    this.taskLocks.set(taskId, newLock);
    return newLock.lock();
  }

  async waitForTaskUnlock(taskId: string): Promise<void> {
    const lock = this.taskLocks.get(taskId);
    if (lock) {
      console.log('wait for unlock!');
      await lock.waitForUnlock();
    }
  }

  count() {
    return this.tasks.size;
  }

  async initializeTasksFromDB() {
    if (this.taskyonDB) {
      const tasksFromDb = await this.taskyonDB.llmtasks.find().exec();
      tasksFromDb.forEach((taskDoc) => {
        const task = transformDocToLLMTask(taskDoc);
        this.tasks.set(task.id, task);
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
      const vec = await vectorizeText(
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
      const queryVec = await vectorizeText(searchTerm, this.vectorizerModel);
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
    callback: (task?: LLMTask, taskNum?: number) => void,
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
    callback: (task?: LLMTask, taskNum?: number) => void
  ): void {
    this.subscribers = this.subscribers.filter((sub) => sub !== callback);
    this.taskCountSubscribers = this.taskCountSubscribers.filter(
      (sub) => sub !== callback
    );
  }

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
        this.subscribers.forEach((callback) => callback(task, taskNum));
      }
    } else {
      this.subscribers.forEach((callback) => callback(undefined, taskNum));
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

  getTools() {
    // TODO: make sure, its clear that we return non-partial tool types here...
    return this.defaultTools;
  }

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
