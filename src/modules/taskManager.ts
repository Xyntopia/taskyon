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
  }
  // Push the new function task to processTasksQueue
  // we are not saving yet, as it is going to be processed :)
  if (execute) {
    processTasksQueue.push(newTask.id);
    newTask.state = 'Queued';
    taskManager.setTask(newTask, false);
  } else {
    // in the case of a task which is not processed, we can save it :)
    taskManager.setTask(newTask, true);
  }
  chatState.selectedTaskId = newTask.id;
  return newTask.id;
}

export class TaskManager {
  // uses RxDB as a DB backend..
  // Usage example:
  // const taskManager = new TaskManager(initialTasks, taskyonDBInstance);
  private taskyonDB: TaskyonDatabase;
  private tasks: Record<string, LLMTask>;
  private subscribers: Array<(task: LLMTask) => void> = [];

  constructor(tasks: Record<string, LLMTask>, taskyonDB: TaskyonDatabase) {
    this.tasks = tasks;
    this.taskyonDB = taskyonDB;
  }

  getFileDB() {
    return this.taskyonDB.filemappings;
  }

  async getTask(taskId: string): Promise<LLMTask | undefined> {
    // Check if the task exists in the local record
    let task = this.tasks[taskId];
    if (!task) {
      // If not, load from the database
      const taskFromDb = await this.taskyonDB.llmtasks.findOne(taskId).exec();
      if (taskFromDb) {
        task = transformDocToLLMTask(taskFromDb);
        this.tasks[taskId] = task; // Update local record
      }
    }
    this.notifySubscribers(taskId);
    return task;
  }

  setTask(task: LLMTask, save: boolean): void {
    this.tasks[task.id] = task;
    if (save) {
      void this.saveTask(task.id); // Save to database if required
    }
    this.notifySubscribers(task.id);
  }

  async updateTask(
    updateData: Partial<LLMTask> & { id: string },
    save: boolean
  ): Promise<void> {
    const task = await this.getTask(updateData.id);
    if (task) {
      // Update the task with new data
      Object.assign(task, updateData);
      if (save) {
        void this.saveTask(task.id); // Save to database if required
      }
    }
    this.notifySubscribers(updateData.id);
  }

  async saveTask(taskId: string): Promise<void> {
    const task = this.tasks[taskId];
    if (task) {
      const newDBTask = transformLLMTaskToDocType(task);
      await this.taskyonDB.llmtasks.upsert(newDBTask);
    }
  }

  async deleteTask(taskId: string): Promise<void> {
    // Delete from local record
    delete this.tasks[taskId];

    // Delete from the database
    const taskDoc = await this.taskyonDB.llmtasks.findOne(taskId).exec();
    if (taskDoc) {
      await taskDoc.remove();
    }
  }

  // Method to notify all subscribers for a specific task
  private notifySubscribers(taskId: string): void {
    const task = this.tasks[taskId];
    if (task) {
      this.subscribers.forEach((callback) => callback(task));
    }
  }

  // Revised subscription method
  subscribeToTaskChanges(
    taskId: string,
    callback: (task: LLMTask) => void
  ): void {
    this.subscribers.push(callback);
  }

  // You may also need a method to unsubscribe if required
  unsubscribeFromTaskChanges(callback: (task: LLMTask) => void): void {
    this.subscribers = this.subscribers.filter((sub) => sub !== callback);
  }

  getRootTasks() {
    const orphanTasks = Object.values(this.tasks)
      .filter((t) => {
        return t.childrenIDs.length == 0;
      })
      .map((t) => t.id);
    return orphanTasks;
  }
}
