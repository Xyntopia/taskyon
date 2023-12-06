import type { LLMTask } from './types';
import { useVectorStore } from './localVectorStore';
import type { ChatStateType } from './chat';
import { v1 as uuidv1 } from 'uuid';
import type { partialTaskDraft } from './types';
import {
  TaskyonDatabase,
  FileMappingDocType,
  transformLLMTaskToDocType,
  transformDocToLLMTask,
} from './rxdb';
import { openFile } from './OPFS';
import { Lock } from 'src/modules/utils';

class AsyncQueue<T> {
  private queue: T[] = [];
  private resolveWaitingPop?: (value: T) => void;

  push(item: T) {
    this.queue.push(item);
    if (this.resolveWaitingPop) {
      // Since TypeScript now expects queue.shift() to always return a T,
      // we need to assure it's not called on an empty array.
      // The logic ensures it's never empty at this point, but TypeScript doesn't know that.
      const shiftedItem = this.queue.shift();
      if (shiftedItem !== undefined) {
        this.resolveWaitingPop(shiftedItem);
      }
      this.resolveWaitingPop = undefined;
    }
  }

  count() {
    return this.queue.length;
  }

  async pop(): Promise<T> {
    const shiftedItem = this.queue.shift();
    if (shiftedItem !== undefined) {
      return shiftedItem;
    } else {
      return new Promise<T>((resolve) => {
        this.resolveWaitingPop = resolve;
      });
    }
  }

  clear() {
    const oldQueue = this.queue;
    this.queue = [];
    return oldQueue;
  }
}

export default AsyncQueue;

export const processTasksQueue = new AsyncQueue<string>();
export const vectorStore = useVectorStore();
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

export async function taskChain(
  lastTaskId: string,
  getTask: InstanceType<typeof TaskManager>['getTask']
) {
  // Start with the selected task
  let currentTaskID = lastTaskId;
  const conversationList: string[] = [];

  // Trace back the parentIDs to the original task in the chain
  while (currentTaskID) {
    // Get the current task
    const currentTask = await getTask(currentTaskID);
    if (!currentTask) break; // Break if we reach a task that doesn't exist

    // Prepend the current task to the conversation list so the selected task ends up being the last in the list
    conversationList.unshift(currentTaskID);

    // Move to the parent task
    if (currentTask.parentID) {
      currentTaskID = currentTask.parentID; // This can now be string | undefined
    } else break; // Break if we reach an "initial" task
  }

  return conversationList;
}

function base64Uuid() {
  // Generate a UUID
  const hexUuid = uuidv1();

  // Convert the UUID from hex to a Buffer
  const bufferUuid = Buffer.from(hexUuid.replace(/-/g, ''), 'hex');

  // Convert the Buffer to a base64 string
  const base64Uuid = bufferUuid.toString('base64');

  return base64Uuid;
}

export async function addFile(
  taskManager: TaskManager,
  opfsName?: string,
  openAIFileId?: string
) {
  const fileMapping: FileMappingDocType = {
    uuid: base64Uuid(),
  };

  // Add 'opfs' only if 'opfsName' is provided
  if (opfsName) {
    fileMapping.opfs = opfsName;
  }

  // Add 'openAIFileId' only if 'openAIFileId' is provided
  if (openAIFileId) {
    fileMapping.openAIFileId = openAIFileId;
  }

  const fileMappingDoc = await taskManager.getFileDB().insert(fileMapping);
  return fileMappingDoc.uuid;
}

export async function getFileMappingByUuid(
  uuid: string,
  taskManager: TaskManager
): Promise<FileMappingDocType | null> {
  // Find the document with the matching UUID
  const fileMappingDoc = await taskManager.getFileDB().findOne(uuid).exec();

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
    (task.context?.uploadedFiles || []).forEach((file) => fileSet.add(file));
  });
  return Array.from(fileSet);
}

export async function addTask2Tree(
  task: partialTaskDraft,
  parentID: string | undefined,
  chatState: ChatStateType,
  taskManager: TaskManager,
  execute = true
) {
  const uuid = base64Uuid();

  const parent = parentID ? await taskManager.getTask(parentID) : undefined;

  const newTask: LLMTask = {
    role: task.role,
    parentID,
    content: task.content || null,
    state: task.state || 'Open',
    childrenIDs: [],
    debugging: task.debugging || {},
    id: uuid,
    created_at: Date.now(),
    context: task.context,
    allowedTools: task.allowedTools || parent?.allowedTools,
  };

  console.log('create new Task:', newTask.id);

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

function isObject(item: unknown): item is Record<string, unknown> {
  return item !== null && typeof item === 'object' && !Array.isArray(item);
}

function deepMerge(
  obj1: Record<string, unknown>,
  obj2: Record<string, unknown>
): Record<string, unknown> {
  const output = Object.assign({}, obj1); // Start with a shallow copy of obj1
  if (isObject(obj1) && isObject(obj2)) {
    Object.keys(obj2).forEach((key) => {
      const obj2Key = obj2[key];
      if (isObject(obj2Key)) {
        const obj1Key = obj1[key];
        if (isObject(obj1Key)) {
          // Recursively call deepMerge only if both obj1[key] and obj2[key] are objects
          output[key] = deepMerge(obj1Key, obj2Key);
        } else {
          // If obj1[key] is not an object, simply assign obj2[key]
          Object.assign(output, { [key]: obj2Key });
        }
      } else {
        // For non-object properties, overwrite with the value from obj2
        Object.assign(output, { [key]: obj2Key });
      }
    });
  }
  return output;
}

export class TaskManager {
  // uses RxDB as a DB backend..
  // Usage example:
  // const taskManager = new TaskManager(initialTasks, taskyonDBInstance);
  private taskyonDB: TaskyonDatabase;
  private tasks: Map<string, LLMTask>;
  // we need these locks in order to sync our databases..
  private taskLocks: Map<string, Lock> = new Map();
  private subscribers: Array<(task?: LLMTask, taskNum?: number) => void> = [];
  private taskCountSubscribers: Array<
    (task?: LLMTask, taskNum?: number) => void
  > = [];

  constructor(tasks: TaskManager['tasks'], taskyonDB: TaskyonDatabase) {
    this.tasks = tasks;
    this.taskyonDB = taskyonDB;
    void this.initializeTasksFromDB();
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
      await lock.waitForUnlock();
    }
  }

  async initializeTasksFromDB() {
    const tasksFromDb = await this.taskyonDB.llmtasks.find().exec();
    tasksFromDb.forEach((taskDoc) => {
      const task = transformDocToLLMTask(taskDoc);
      this.tasks.set(task.id, task);
    });
    console.log('all tasks loaded from DB!');
    this.notifySubscribers(undefined, true);
  }

  getFileDB() {
    return this.taskyonDB.filemappings;
  }

  async getTask(taskId: string): Promise<LLMTask | undefined> {
    await this.waitForTaskUnlock(taskId);
    // Check if the task exists in the local record
    let task = this.tasks.get(taskId);
    if (!task) {
      // If not, load from the database
      const taskFromDb = await this.taskyonDB.llmtasks.findOne(taskId).exec();
      if (taskFromDb) {
        task = transformDocToLLMTask(taskFromDb);
        this.tasks.set(taskId, task); // Update local record
      }
    }
    return task;
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

  async updateTask(
    updateData: Partial<LLMTask> & { id: string },
    save: boolean
  ): Promise<void> {
    await this.withTaskCountCheck(updateData.id, async () => {
      const unlock = await this.lockTask(updateData.id);
      const task = await this.getTask(updateData.id);
      if (task) {
        // Update the task with new data
        //Object.assign(task, updateData);
        Object.assign(task, deepMerge(task, updateData));
        if (save) {
          void this.saveTask(task.id); // Save to database if required
        }
      }
      unlock();
      this.notifySubscribers(updateData.id);
    });
  }

  private async saveTask(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    console.log('save task: ', task);
    if (task) {
      const newDBTask = transformLLMTaskToDocType(task);
      await this.taskyonDB.llmtasks.upsert(newDBTask);
    }
  }

  async deleteTask(taskId: string): Promise<void> {
    const unlock = await this.lockTask(taskId);
    console.log('deleting task:', taskId);
    // Delete from local record
    this.tasks.delete(taskId);

    // Delete from the database
    const taskDoc = await this.taskyonDB.llmtasks.findOne(taskId).exec();
    if (taskDoc) {
      await taskDoc.remove();
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
        orphanTasks.push(task.id);
      }
    }
    return orphanTasks;
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
