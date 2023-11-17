import type { LLMTask } from './types';
import { useVectorStore } from './localVectorStore';
import type { ChatStateType } from './chat';
import { v1 as uuidv1 } from 'uuid';
import type { partialTaskDraft } from './types';

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
}

export default AsyncQueue;

export const processTasksQueue = new AsyncQueue<LLMTask>();
export const vectorStore = useVectorStore();
/**
 * Finds the root task of a given task.
 *
 * @param {string} taskId - The ID of the task.
 * @returns {string} - The ID of the root task, or null if not found.
 */

export function findRootTask(
  taskId: string,
  chatState: ChatStateType
): string | null {
  let currentTaskID = taskId;

  while (currentTaskID) {
    const currentTask = chatState.Tasks[currentTaskID];
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
 * Finds the leaf tasks of a given task.
 *
 * @param {string} taskId - The ID of the task.
 * @returns {string[]} - An array of IDs of the leaf tasks.
 */

export function findLeafTasks(
  taskId: string,
  chatState: ChatStateType
): string[] {
  const leafTasks: string[] = [];

  function traverse(taskId: string) {
    const task = chatState.Tasks[taskId];
    if (!task) return; // Exit if a task doesn't exist

    let hasChildren = false;
    for (const [id, task] of Object.entries(chatState.Tasks)) {
      if (task.parentID === taskId) {
        hasChildren = true;
        traverse(id); // Recursively traverse the children
      }
    }

    if (!hasChildren) {
      leafTasks.push(taskId); // Add the task ID to the array if it has no children
    }
  }

  traverse(taskId); // Start the traversal from the given task ID
  return leafTasks;
}

export function taskChain(lastTaskId: string, tasks: Record<string, LLMTask>) {
  // Start with the selected task
  let currentTaskID = lastTaskId;
  const conversationList: string[] = [];

  // Trace back the parentIDs to the original task in the chain
  while (currentTaskID) {
    // Get the current task
    const currentTask = tasks[currentTaskID];
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

export function addTask2Tree(
  task: partialTaskDraft,
  parent: LLMTask | undefined,
  chatState: ChatStateType,
  execute = true
) {
  const uuid = base64Uuid();

  const newTask: LLMTask = {
    role: task.role,
    parentID: parent?.id,
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

  // connect task to task tree
  chatState.Tasks[newTask.id] = newTask;
  if (parent) {
    parent.childrenIDs.push(newTask.id);
  }
  // Push the new function task to processTasksQueue
  if (execute) {
    processTasksQueue.push(chatState.Tasks[newTask.id]);
    chatState.Tasks[newTask.id].state = 'Queued';
  }
  chatState.selectedTaskId = newTask.id;
  return newTask.id;
}
