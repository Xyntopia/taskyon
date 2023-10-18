import { useVectorStore, SearchResult } from 'src/modules/localVectorStore';
import axios from 'axios';
import { dump } from 'js-yaml';
import { v1 as uuidv1 } from 'uuid';
import { useCachedModels } from './mlModels';
import { Tool } from './tools';
import { tools } from './tools';
import AsyncQueue from './taskManager';

export let chatState = {
  Tasks: {} as Record<string, LLMTask>,
  // this refers to the task chain that we have selected. We select one task and then
  // put the chain together by following the parentIds.
  selectedTaskId: undefined as string | undefined,
  selectedConversationID: '',
  openAIKey: '',
  summaryModel: 'Xenova/distilbart-cnn-6-6',
};

/**
 * Updates the chat state with a new value.
 *
 * @param {typeof chatState} newValue - The new value for the chat state.
 */
export function updateChatState(newValue: typeof chatState) {
  chatState = newValue;
}

const models = useCachedModels();

export type FunctionCall = {
  // The name of the function to call.
  name: string;
  // Arguments to call the function with in JSON format.
  arguments: string;
};

export type OpenAIMessage = {
  // The content of the message, can be null for some messages.
  content: string | null;
  // Function call details if applicable.
  function_call?: FunctionCall;
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

export type LLMTask = {
  role: 'system' | 'user' | 'assistant' | 'function';
  content: string | null;
  status: 'Open' | 'In Progress' | 'Completed';
  context?: {
    message?: OpenAIMessage;
    function?: FunctionCall;
  };
  // is undefined in the case it is an "initial" task
  parentID?: string | undefined;
  debugging?: Record<string, any>;
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

/**
 * Calls the OpenAI API with a given set of chat messages.
 *
 * @param {OpenAIMessage[]} chatMessages - The chat messages to send to the API.
 * @returns {Promise<string>} - A promise that resolves to the bot's response content.
 */
async function callOpenAI(
  chatMessages: OpenAIMessage[],
  functions: Array<Tool>
) {
  const payload: ChatCompletionRequest = {
    model: 'gpt-3.5-turbo',
    messages: chatMessages,
    user: 'vexvault',
  };

  if (functions.length > 0) {
    payload.function_call = 'auto';
    payload.functions = functions;
  }

  const response = await axios.post<ChatCompletionResponse>(
    'https://api.openai.com/v1/chat/completions',
    payload,
    {
      headers: {
        Authorization: `Bearer ${chatState.openAIKey}`,
        'Content-Type': 'application/json',
      },
    }
  );

  return response.data;
}

export function taskChain(lastTaskId: string) {
  // Start with the selected task
  let currentTaskID = lastTaskId;
  const conversationList: string[] = [];

  // Trace back the parentIDs to the original task in the chain
  while (currentTaskID) {
    // Get the current task
    const currentTask = chatState.Tasks[currentTaskID];
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

function taskChat(
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
}

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

async function generateContext(
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
}

export function sendMessage(message: string) {
  // adds a "sendMessage task to the Task stack"
  if (message.trim() === '') return;

  const currentTask: LLMTask = {
    role: 'user',
    status: 'Open',
    content: message,
    id: uuidv1(),
    allowedTools: Object.keys(tools),
  };

  if (chatState.selectedTaskId) {
    currentTask.parentID = chatState.selectedTaskId;
  }

  // Push it to the "overall Tasks List"
  chatState.Tasks[currentTask.id] = currentTask;

  // make it the acive task!
  chatState.selectedTaskId = currentTask.id;

  // Push the new task to processTasksQueue
  processTasksQueue.push(currentTask);
}

function buildChatFromTask(task: LLMTask) {
  const openAIConversation = [] as OpenAIMessage[];
  const conversation = taskChain(task.id);

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
  parentTaskId: string
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
      debugging: {
        aiResponse: response,
      },
      id: response.id,
    };

    // and push newly created tasks to our task list. they were already processed, so we don't need to
    // add them to our task queue.
    if (choice.message.content) {
      chatState.Tasks[response.id] = newResponseTask;
      chatState.selectedTaskId = newResponseTask.id;
    } else if (
      choice.finish_reason === 'function_call' &&
      choice.message.function_call
    ) {
      const func = choice.message.function_call;
      newResponseTask.result = {
        type: 'FunctionCall',
        functionCallDetails: func,
      };
      chatState.Tasks[response.id] = newResponseTask;

      // Create a new task for the function call
      const funcTask: LLMTask = {
        role: 'function',
        parentID: newResponseTask.id,
        content: null,
        status: 'Open',
        id: uuidv1(),
        context: {
          function: func,
        },
        authorId: func.name,
      };

      // Push the new function task to processTasksQueue
      chatState.Tasks[funcTask.id] = funcTask;
      processTasksQueue.push(funcTask);
      chatState.selectedTaskId = funcTask.id;
    }
  }
}

async function taskWorker() {
  console.log('entering task worker loop...');
  while (true) {
    console.log('waiting for next task!');
    const task = await processTasksQueue.pop();
    console.log('processing task:', task);
    if (task.role == 'user') {
      const openAIConversation = buildChatFromTask(task);
      if (openAIConversation) {
        const functions = task.allowedTools?.map((t) => tools[t]) || [];
        const response = await callOpenAI(openAIConversation, functions);
        createNewTasksFromChatResponse(response, task.id);
      }
    } else if (task.role == 'function') {
      if (task.context?.function) {
        const func = task.context?.function;
        // convert functions arguments from json
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const funcArguments = JSON.parse(func.arguments);
        // now do the function call :)
        console.log('call ' + func.name);
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const funcR = dump(await tools[func.name].function(funcArguments));

        task.result = {
          type: 'FunctionResult',
          content: funcR,
        };
        task.status = 'Completed';
        // Push the task ID to the current conversation
        // make the task ID active..
        chatState.selectedTaskId = task.id;

        // now we're making sure to send the chat with the function result
        // to openAI again...
        const openAIConversation = buildChatFromTask(task);
        if (openAIConversation) {
          const functions = task.allowedTools?.map((t) => tools[t]) || [];
          const response = await callOpenAI(openAIConversation, functions);
          createNewTasksFromChatResponse(response, task.id);
        }
      }
    } else {
      console.log("We don't know what to do with this task:", task);
    }
    task.status = 'Completed';
  }
}

export async function run() {
  console.log('start task taskWorker');
  await taskWorker();
}
