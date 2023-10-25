import { useVectorStore } from 'src/modules/localVectorStore';
import axios from 'axios';
import { dump } from 'js-yaml';
import { v1 as uuidv1 } from 'uuid';
//import { useCachedModels } from './mlModels';
import { Tool } from './tools';
import { tools } from './tools';
import AsyncQueue from './taskManager';

function getAPIURLs(baseURL: string) {
  return {
    chat: baseURL + '/chat/completions',
    models: baseURL + '/models',
  };
}

export function getBackendUrls(backend: 'openai' | 'openrouter') {
  let baseURL;
  if (backend == 'openai') {
    baseURL = 'https://api.openai.com/v1/';
  } else {
    baseURL = 'https://openrouter.ai/api/v1';
  }
  return baseURL;
}

export function getApikey(chatState: ChatStateType) {
  return getBackendUrls('openai') == chatState.baseURL
    ? chatState.openAIApiKey
    : chatState.openRouterAIApiKey;
}

export function getSelectedModel(chatState: ChatStateType) {
  return getBackendUrls('openai') == chatState.baseURL
    ? chatState.openAIModel
    : chatState.openrouterAIModel;
}

export function defaultChatState() {
  return {
    Tasks: {} as Record<string, LLMTask>,
    // this refers to the task chain that we have selected. We select one task and then
    // put the chain together by following the parentIds.
    selectedTaskId: undefined as string | undefined,
    openrouterAIModel: 'mistralai/mistral-7b-instruct', //model which is generally chosen for a task if not explicitly specified
    openAIModel: 'gpt-3.5-turbo',
    openAIApiKey: '',
    openRouterAIApiKey: '',
    siteUrl: 'https://taskyon.xyntopia.com',
    summaryModel: 'Xenova/distilbart-cnn-6-6',
    baseURL: getBackendUrls('openrouter'),
  };
}

type ChatStateType = ReturnType<typeof defaultChatState>;
type FunctionArguments = Record<string, unknown> | string | number;

export type FunctionCall = {
  // The name of the function to call.
  name: string;
  arguments: FunctionArguments;
};

export type OpenAIMessage = {
  // The content of the message, can be null for some messages.
  content: string | null;
  // Function call details if applicable.
  function_call?: {
    // The name of the function to call.
    name: string;
    // Arguments to call the function with in JSON format.
    arguments: string;
  };
  // The name of the message author (optional) it has to be the name of the function, if
  // the role is "function".
  name?: string;
  // The role of the message author (system, user, assistant, or function).
  role: 'system' | 'user' | 'assistant' | 'function';
};

export type ChatCompletionResponse = {
  id: string;
  object: string; // "chat.completion"
  created: number; // Unix timestamp in seconds
  model: string;
  choices: {
    index: number;
    message: OpenAIMessage;
    finish_reason: string;
  }[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
};

type ChatCompletionRequest = {
  // An array of messages in the conversation.
  messages: Array<OpenAIMessage>;
  // The ID of the model to use.
  model: string;
  // Controls how the model calls functions.
  function_call?:
    | 'none'
    | 'auto'
    | {
        // The name of the function to call.
        name: string;
      };
  // Penalty for repeating tokens.
  frequency_penalty?: number | null;
  // Details on how the model calls functions.
  functions?: Array<Tool>;
  // Modify the likelihood of specified tokens.
  logit_bias?: Record<string, number> | null;
  // Maximum number of tokens to generate.
  max_tokens?: number | null;
  // Number of chat completion choices to generate.
  n?: number | null;
  // Penalty for new tokens in the text.
  presence_penalty?: number | null;
  // Sequences to stop generating tokens.
  stop?: string | Array<string> | null;
  // Enable partial message deltas streaming.
  stream?: boolean | null;
  // Sampling temperature for output.
  temperature?: number | null;
  // Probability mass for nucleus sampling.
  top_p?: number | null;
  // Unique identifier for your end-user (optional).
  user?: string;
};

type TaskStatus = 'Open' | 'In Progress' | 'Completed' | 'Error';

export type LLMTask = {
  role: 'system' | 'user' | 'assistant' | 'function';
  content: string | null;
  status: TaskStatus;
  context?: {
    message?: OpenAIMessage;
    function?: FunctionCall;
    model?: string;
  };
  // is undefined in the case it is an "initial" task
  parentID?: string | undefined;
  childrenIDs: string[];
  debugging?: Record<string, unknown>;
  result?: TaskResult;
  id: string;
  allowedTools?: string[];
  authorId?: string;
};

const processTasksQueue = new AsyncQueue<LLMTask>();

interface TaskResult {
  type: 'ChatAnswer' | 'FunctionCall' | 'NewTask' | 'FunctionResult'; // Type of result
  content?: string; // Description or value of the result
  functionCallDetails?: FunctionCall; // Details if the result is a function call
  newTaskDetails?: LLMTask[]; // Details if the result is a new task
}

export const vectorStore = useVectorStore();

// calls openRouter OR OpenAI  chatmodels
async function callLLM(
  chatMessages: OpenAIMessage[],
  functions: Array<Tool>,
  openRouter = true,
  chatState: ChatStateType
) {
  const payload: ChatCompletionRequest = {
    model: getSelectedModel(chatState),
    messages: chatMessages,
    user: 'taskyon',
    temperature: 0.0,
    stream: false,
    n: 1,
  };

  if (functions.length > 0) {
    payload.function_call = 'auto';
    payload.functions = functions;
  }

  let headers: Record<string, string> = {
    Authorization: `Bearer ${getApikey(chatState)}`,
    'Content-Type': 'application/json',
  };

  if (openRouter) {
    headers = {
      ...headers,
      'HTTP-Referer': `${chatState.siteUrl}`, // To identify your app. Can be set to localhost for testing
      'X-Title': `${chatState.siteUrl}`, // Optional. Shows on openrouter.ai
    };
  }

  const response = await axios.post<ChatCompletionResponse>(
    getAPIURLs(chatState.baseURL).chat,
    payload,
    { headers }
  );

  return response.data;
}

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

export function sendMessage(message: string, chatState: ChatStateType) {
  // adds a "sendMessage task to the Task stack"
  console.log('send message');
  if (message.trim() === '') return;

  const currentTask: LLMTask = {
    role: 'user',
    status: 'Open',
    content: message,
    id: uuidv1(),
    childrenIDs: [],
    allowedTools: Object.keys(tools),
  };

  if (chatState.selectedTaskId) {
    currentTask.parentID = chatState.selectedTaskId;
    chatState.Tasks[chatState.selectedTaskId].childrenIDs.push(currentTask.id);
  }

  // Push it to the "overall Tasks List"
  chatState.Tasks[currentTask.id] = currentTask;

  // make it the acive task!
  chatState.selectedTaskId = currentTask.id;

  // Push the new task to processTasksQueue
  // we are using the reference from chatState here isntead of currentTask,
  // because we want to preserve reactivity from librares such as react
  // or vue. And this way we can use the reactive object!
  processTasksQueue.push(chatState.Tasks[currentTask.id]);
}

function buildChatFromTask(task: LLMTask, chatState: ChatStateType) {
  const openAIConversation = [] as OpenAIMessage[];
  const conversation = taskChain(task.id, chatState.Tasks);

  if (conversation) {
    openAIConversation.push(
      ...conversation
        .map((mId) => {
          const m = chatState.Tasks[mId];
          const message: OpenAIMessage = {
            role: m.role,
            content: m.content,
          };
          if (m.role == 'function') {
            message.name = m.authorId;
            message.content = m.result?.content || null;
          }
          return message;
        })
        .filter((m) => m.content) // OpenAI doesn't accept messages with zero content, even though they generate it themselfs
    );
  }
  return openAIConversation;
}

function createNewTasksFromChatResponse(
  response: ChatCompletionResponse,
  parentTaskId: string,
  chatState: ChatStateType
) {
  // Process the response and create new tasks if necessary
  if (response.choices.length > 0) {
    const choice = response.choices[0];
    // put AI response in our chain as a new, completed task...
    // TODO: theoretically the user "viewing" the task would be its completion..
    //       so we could create it before sending it and then wait for AI to respond...
    const newResponseTask: LLMTask = {
      status: 'Completed',
      parentID: parentTaskId,
      role: choice.message.role,
      content: choice.message.content,
      childrenIDs: [],
      debugging: {
        aiResponse: response,
      },
      id: response.id,
    };
    chatState.Tasks[response.id] = newResponseTask;
    chatState.Tasks[parentTaskId].childrenIDs.push(newResponseTask.id);

    // and push newly created tasks to our task list. they were already processed, so we don't need to
    // add them to our task queue.
    if (choice.message.content) {
      chatState.selectedTaskId = newResponseTask.id;
    } else if (
      choice.finish_reason === 'function_call' &&
      choice.message.function_call
    ) {
      const func = choice.message.function_call;

      // Try to parse the function arguments from JSON, log and re-throw the error if parsing fails
      let funcArguments: Record<string, unknown> | string;
      try {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        funcArguments = JSON.parse(func.arguments);
      } catch (parseError) {
        // in this case, we assume, that we can call the function with the return string!
        funcArguments = func.arguments;
      }

      newResponseTask.result = {
        type: 'FunctionCall',
        functionCallDetails: func,
      };
      // Create a new task for the function call
      const funcTask: LLMTask = {
        role: 'function',
        parentID: newResponseTask.id,
        content: null,
        status: 'Open',
        childrenIDs: [],
        id: uuidv1(),
        context: {
          function: {
            name: func.name,
            arguments: funcArguments,
          },
        },
        authorId: func.name,
      };
      chatState.Tasks[funcTask.id] = funcTask;
      newResponseTask.childrenIDs.push(funcTask.id);
      // Push the new function task to processTasksQueue
      processTasksQueue.push(chatState.Tasks[funcTask.id]);
      chatState.selectedTaskId = funcTask.id;
    }
  }
}

function bigIntToString(obj: unknown): unknown {
  if (obj === null) {
    return obj;
  }

  if (typeof obj === 'bigint') {
    return obj.toString();
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => bigIntToString(item));
  }

  if (typeof obj === 'object') {
    const result: { [key: string]: unknown } = {};
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        result[key] = bigIntToString((obj as Record<string, unknown>)[key]);
      }
    }
    return result;
  }

  return obj;
}

// Function to process OpenAI conversation
async function processOpenAIConversation(
  task: LLMTask,
  chatState: ChatStateType
) {
  const openAIConversation = buildChatFromTask(task, chatState);
  if (openAIConversation) {
    const functions = task.allowedTools?.map((t) => tools[t]) || [];
    const response = await callLLM(
      openAIConversation,
      functions,
      true,
      chatState
    );
    createNewTasksFromChatResponse(response, task.id, chatState);
  }
}

// Function to process user tasks
async function processUserTask(task: LLMTask, chatState: ChatStateType) {
  await processOpenAIConversation(task, chatState);
  task.status = 'Completed';
}

// Function to process function tasks
async function processFunctionTask(task: LLMTask, chatState: ChatStateType) {
  if (task.context?.function) {
    const func = task.context.function;
    console.log(`Calling function ${func.name}`);
    const { result, status } = await handleFunctionExecution(task, func);
    task.result = result;
    task.status = status;
    task.allowedTools = Object.keys(tools);
    await processOpenAIConversation(task, chatState);
  }
}

export function deleteConversation(leafId: string, chatState: ChatStateType) {
  if (chatState.selectedTaskId == leafId) {
    chatState.selectedTaskId = undefined;
  }

  let currentTaskId = leafId;
  while (currentTaskId) {
    const currentTask = chatState.Tasks[currentTaskId];
    if (!currentTask) break; // Break if a task doesn't exist

    // Check if the parent task has more than one child
    if (currentTask.parentID) {
      const parentTask = chatState.Tasks[currentTask.parentID];
      if (parentTask && parentTask.childrenIDs.length > 1) {
        break; // Stop deletion if the parent task has more than one child
      }
    }

    // Delete the current task
    delete chatState.Tasks[currentTaskId];

    if (currentTask.parentID) {
      // Move to the parent task
      currentTaskId = currentTask.parentID;
    } else {
      break;
    }
  }
}

// Helper function to handle function execution
async function handleFunctionExecution(
  task: LLMTask,
  func: FunctionCall
): Promise<{ result: TaskResult; status: TaskStatus }> {
  const allowedTools = Object.keys(tools);
  if (tools[func.name]) {
    let funcR: unknown = await tools[func.name].function(func.arguments);
    funcR = bigIntToString(funcR);
    const result: TaskResult = { type: 'FunctionResult', content: dump(funcR) };
    return { result, status: 'Completed' };
  } else {
    const toolnames = JSON.stringify(allowedTools);
    const result: TaskResult = {
      type: 'FunctionResult',
      content: `The function ${func.name} is not available in tools. Please select a valid function from this list: ${toolnames}`,
    };
    return { result, status: 'Error' };
  }
}

async function taskWorker(chatState: ChatStateType) {
  console.log('entering task worker loop...');
  while (true) {
    console.log('waiting for next task!');
    const task = await processTasksQueue.pop();
    console.log('processing task:', task);
    try {
      if (task.role == 'user') {
        await processUserTask(task, chatState);
      } else if (task.role == 'function') {
        await processFunctionTask(task, chatState);
      } else {
        console.log("We don't know what to do with this task:", task);
        task.status = 'Error';
      }
    } catch (error) {
      task.status = 'Error';
      task.debugging = { error };
      console.error('Error processing task:', error);
    }
  }
}

export async function run(chatState: ChatStateType) {
  console.log('start task taskWorker');
  await taskWorker(chatState);
}

interface Permission {
  id: string;
  object: string;
  created: number;
  allow_create_engine: boolean;
  allow_sampling: boolean;
  allow_logprobs: boolean;
  allow_search_indices: boolean;
  allow_view: boolean;
  allow_fine_tuning: boolean;
  organization: string;
  group: null | string;
  is_blocking: boolean;
}

export interface Model {
  id: string;
  object?: string;
  created?: number;
  owned_by?: string;
  permission?: Permission[];
  root?: string;
  parent?: null | string;
  pricing?: {
    prompt: string;
    completion: string;
    discount: number;
  };
  context_length?: number;
  top_provider?: {
    max_completion_tokens: number;
  };
  per_request_limits?: {
    prompt_tokens: string;
    completion_tokens: string;
  };
}

// Update the availableModels function to return a list of models
export async function availableModels(
  baseURL: string,
  apiKey: string
): Promise<Model[]> {
  try {
    // Setting up the Axios requsest
    const response = await axios.get<{ data: Model[] }>(
      getAPIURLs(baseURL).models,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Cache-Control': 'max-stale=3600',
        },
      }
    );

    // Return the list of models directly
    return response.data.data;
  } catch (error) {
    console.error('Error fetching models:', error);
    throw error; // re-throwing the error to be handled by the calling code
  }
}
