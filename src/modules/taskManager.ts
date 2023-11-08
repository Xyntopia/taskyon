import { TaskResult } from './types';
import type { FunctionCall, ToolCollection } from './tools';
import { useVectorStore } from './localVectorStore';
import { ChatStateType } from './chat';
import { bigIntToString } from './chat';
import { dump } from 'js-yaml';
import { LLMTask, TaskState } from './types';

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

// Helper function to handle function execution
export async function handleFunctionExecution(
  func: FunctionCall,
  tools: ToolCollection
): Promise<{ result: TaskResult; state: TaskState; error?: string }> {
  try {
    let funcR: unknown = await tools[func.name].function(func.arguments);
    funcR = bigIntToString(funcR);
    const result: TaskResult = {
      type: 'FunctionResult',
      content: dump(funcR),
    };
    return { result, state: 'Completed' };
  } catch (error) {
    return {
      result: {
        type: 'FunctionResult',
        content: JSON.stringify(error),
      },
      state: 'Error',
    };
  }
}

/*function taskChat(
  task: string,
  context: string | null = null,
  previousTasks: string | null = null,
  objective: string | null = null,
  format = 'yaml',
  method = 'prompt'
) {
  // This function generates a chat prompt for a task. It is used to generate the prompt for the chat interface
  const msgs = [];
  msgs.push({
    role: 'system',
    content:
      'You are a helpful assistant that aims to complete the given task. Do not add any amount of explanatory text.',
  });

  if (method === 'chat') {
    if (objective) {
      msgs.push({
        role: 'user',
        content: `# Overall objective: \n${objective}\n\n`,
      });
    }

    if (previousTasks) {
      msgs.push({
        role: 'user',
        content: `# Take into account these previously completed tasks\n\n${previousTasks} \n\n`,
      });
    }

    if (context) {
      msgs.push({
        role: 'user',
        content: `# Take into account this context\n\n${context} \n\n`,
      });
    }

    // This 'if' will never be true because it's explicitly set to false. It's probably a placeholder for future logic.
    if (false) {
      // code that will never execute
    }

    if (task) {
      msgs.push({
        role: 'user',
        content: `# Complete the following task: \n${task} \n\nProvide only the precise information requested without context, make sure we can parse the response as ${format}. \n\n## RESULT:\n`,
      });
    }
  } else {
    let msg = '';

    if (objective) {
      msg += `# Considering the overall objective: \n${objective}\n\n`;
    }

    if (previousTasks) {
      msg += `# Take into account these previously completed tasks:\n\n${previousTasks} \n\n`;
    }

    if (context) {
      msg += `# Take into account this context:\n\n${context} \n\n`;
    }

    msg += `# Complete the following task: \n${task} \n\nProvide only the precise information requested without context, make sure we can parse the response as ${format}. RESULT:\n`;
    msgs.push({ role: 'user', content: msg });
  }

  return msgs;
}*/

/*
async function executeTask(task, previousTasks = null, context = null, objective = null, formatting = "yaml", modelId = "ggml-mpt-7b-instruct", maxTokens = 1000) {
  // Creates a message and executes a task with an LLM based on given information
  const msgs = taskChat(task, context ? `\n---\n${context.join("\n---\n")}` : null, previousTasks, objective, formatting);
  let res;
  try {
      // You'll need to define the 'chatCompletion' function, as it's not included in the Python code.
      res = await chatCompletion(msgs, maxTokens, modelId);
  } catch (error) {
      // handle error
      console.error(error);
  }

  let obj;
  if (formatting === "yaml") {
      try {
          // You'll need to use a YAML parsing library here, as JavaScript doesn't have native YAML support.
          obj = YAML.parse(res); // using 'yaml' or another library
      } catch (error) {
          throw new Error(`Could not convert ${res} to yaml: ${error}`);
      }
  } else if (["txt", "markdown"].includes(formatting)) {
      obj = res;
  } else {
      console.warn(`Formatting: ${formatting} is unknown!`);
      // do nothing ;)
  }

  return [obj, msgs, res];
}
*/

/*async function generateContext(
  searchTerm: string
): Promise<OpenAIMessage | undefined> {
  const k = 3;
  console.log(`Searching for ${searchTerm}`);
  const results = await vectorStore.query(searchTerm, k);
  if (results.length > 0) {
    const context = dump(results);
    return {
      role: 'user',
      content: `# Take into account this context which was found in 
    our database for the previous message\n\n${context} \n\n`,
    };
  } else {
    return undefined;
  }
}*/
