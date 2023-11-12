import axios from 'axios';
//import { useCachedModels } from './mlModels';
import { Tool, tools, ExtendedTool } from './tools';
import { getEncoding } from 'js-tiktoken';
import {
  LLMTask,
  OpenAIMessage,
  ChatCompletionResponse,
  OpenRouterGenerationInfo,
} from './types';
import { taskChain } from './taskManager';
import OpenAI from 'openai';
import { lruCache, sleep } from './utils';

const getOpenai = lruCache<OpenAI>(1)((apiKey: string) => {
  const api = new OpenAI({
    apiKey: apiKey,
    dangerouslyAllowBrowser: true,
  });
  return api;
});

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

export function defaultTaskState() {
  return {
    Tasks: {} as Record<string, LLMTask>,
    // this refers to the task chain that we have selected. We select one task and then
    // put the chain together by following the parentIds.
    selectedTaskId: undefined as string | undefined,
    openrouterAIModel: 'mistralai/mistral-7b-instruct', //model which is generally chosen for a task if not explicitly specified
    openAIModel: 'gpt-3.5-turbo',
    openAIAssistant: '',
    openAIApiKey: '',
    openRouterAIApiKey: '',
    useOpenAIAssistants: false,
    siteUrl: 'https://taskyon.xyntopia.com',
    summaryModel: 'Xenova/distilbart-cnn-6-6',
    baseURL: getBackendUrls('openrouter'),
  };
}
export type ChatStateType = ReturnType<typeof defaultTaskState>;

function openRouterUsed(chatState: ChatStateType) {
  return getBackendUrls('openrouter') == chatState.baseURL;
}

export function openAIUsed(chatState: ChatStateType) {
  return getBackendUrls('openai') == chatState.baseURL;
}

export async function getAssistants(chatState: ChatStateType) {
  const response = await getOpenai(chatState.openAIApiKey).beta.assistants.list(
    {
      order: 'desc',
      limit: 20,
    }
  );

  const assistantsArray = response.data;
  const assistantsDict = assistantsArray.reduce((dict, assistant) => {
    dict[assistant.id] = assistant;
    return dict;
  }, {} as Record<string, OpenAI.Beta.Assistant>);

  return assistantsDict;
}

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

const enc = getEncoding('gpt2');

export function countStringTokens(txt: string) {
  // Tokenize the content
  const content = enc.encode(txt);
  return content.length;
}

function estimateTokens(task: LLMTask) {
  const content = countStringTokens(task.content || '');
  // Return the token count
  const total = content;
  return total;
}

function countChatTokens(chatMessages: OpenAIMessage[]): number {
  let totalTokens = 0;
  for (const message of chatMessages) {
    if (message.content) {
      totalTokens += countStringTokens(message.content);
    }
  }
  return totalTokens;
}

export function countToolTokens(functionList: ExtendedTool[]): number {
  let totalTokens = 0;

  // Iterate through each tool in the functionList array
  for (const tool of functionList) {
    // Get the description and stringify the parameters of the tool
    const description = tool.description;
    const stringifiedParameters = JSON.stringify(tool.parameters, null, 2); // Pretty print the JSON string

    // Count the tokens in the description and stringified parameters using countStringTokens
    const descriptionTokens = countStringTokens(description);
    const parametersTokens = countStringTokens(stringifiedParameters);

    // Sum the tokens of the description and stringified parameters for this tool
    totalTokens += descriptionTokens + parametersTokens;
  }

  return totalTokens;
}

export function estimateChatTokens(
  newResponseTask: LLMTask,
  chatState: ChatStateType
) {
  const chat: OpenAIMessage[] = buildChatFromTask(newResponseTask, chatState);
  const functions: ExtendedTool[] = mapFunctionNames(
    newResponseTask.allowedTools || []
  );
  const promptTokens = estimateTokens(newResponseTask);
  const chatTokens = countChatTokens(chat);
  const functionTokens = Math.floor(countToolTokens(functions) * 0.7);
  return {
    promptTokens,
    chatTokens,
    functionTokens,
    total: chatTokens + functionTokens,
  };
}

function generateHeaders(chatState: ChatStateType) {
  let headers: Record<string, string> = {
    Authorization: `Bearer ${getApikey(chatState)}`,
    'Content-Type': 'application/json',
  };

  if (openRouterUsed(chatState)) {
    headers = {
      ...headers,
      'HTTP-Referer': `${chatState.siteUrl}`, // To identify your app. Can be set to localhost for testing
      'X-Title': `${chatState.siteUrl}`, // Optional. Shows on openrouter.ai
    };
  }

  return headers;
}

// calls openRouter OR OpenAI  chatmodels
async function callLLM(
  chatMessages: OpenAIMessage[],
  functions: Array<Tool>,
  chatState: ChatStateType,
  headers: Record<string, string>,
  model: string,
  chatURL: string
) {
  const payload: ChatCompletionRequest = {
    model,
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

  const response = await axios.post<ChatCompletionResponse>(chatURL, payload, {
    headers,
  });
  console.log('AI responded:', response);
  const chatCompletion = response.data;

  if (openRouterUsed(chatState)) {
    const GENERATION_ID = response.data.id;
    const generation = await axios.get<OpenRouterGenerationInfo>(
      `https://openrouter.ai/api/v1/generation?id=${GENERATION_ID}`,
      { headers }
    );

    const generationInfo = generation.data.data;

    if (
      generationInfo.native_tokens_completion &&
      generationInfo.native_tokens_prompt
    ) {
      chatCompletion.usage = {
        prompt_tokens: generationInfo.native_tokens_prompt,
        completion_tokens: generationInfo.native_tokens_completion,
        total_tokens:
          generationInfo.native_tokens_prompt +
          generationInfo.native_tokens_completion,
        origin: generationInfo.origin,
        inference_costs: generationInfo.usage,
      };
    }
  }

  return chatCompletion;
}

function buildChatFromTask(task: LLMTask, chatState: ChatStateType) {
  const openAIMessageThread = [] as OpenAIMessage[];
  const conversationThread = taskChain(task.id, chatState.Tasks);

  if (conversationThread) {
    openAIMessageThread.push(
      ...conversationThread
        .map((mId) => {
          const m = chatState.Tasks[mId];
          const message: OpenAIMessage = {
            role: m.role,
            content: m.content,
          };
          if (m.role == 'function') {
            message.name = m.authorId;
            message.content = m.result?.functionResult || null;
          }
          return message;
        })
        .filter((m) => m.content) // OpenAI doesn't accept messages with zero content, even though they generate it themselfs
    );
  }
  return openAIMessageThread;
}

export type partialTaskDraft = {
  role: LLMTask['role'];
  content?: LLMTask['content'];
  context?: LLMTask['context'];
  state?: LLMTask['state'];
  allowedTools?: LLMTask['allowedTools'];
  debugging?: LLMTask['debugging'];
};

export function bigIntToString(obj: unknown): unknown {
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

function mapFunctionNames(toolNames: string[]) {
  return toolNames?.map((t) => tools[t]);
}

// Function to process OpenAI conversation
export async function getOpenAIChatResponse(
  task: LLMTask,
  chatState: ChatStateType
) {
  const openAIConversationThread = buildChatFromTask(task, chatState);
  if (openAIConversationThread) {
    const functions = mapFunctionNames(task.allowedTools || []) || [];
    const response = await callLLM(
      openAIConversationThread,
      functions,
      chatState,
      generateHeaders(chatState),
      getSelectedModel(chatState),
      getAPIURLs(chatState.baseURL).chat
    );
    return response;
  }
}

export async function getOpenAIAssistantResponse(
  task: LLMTask,
  chatState: ChatStateType
) {
  if (task.content) {
    const openai = getOpenai(chatState.openAIApiKey);
    console.log('send task to assistant!', task);
    const parentTask: LLMTask | undefined =
      chatState.Tasks[task.parentID || ''];
    let threadId = parentTask?.debugging?.threadMessage?.thread_id;
    if (!threadId) {
      const thread = await openai.beta.threads.create();
      threadId = thread.id;
    }

    const assistantId = chatState.openAIAssistant;
    //TODO: we could potentially check for all the messages which are already in the thread

    // first, we check if the parent of the task already has a thread & message id. If it does, we
    // will simply use that, add the same id to our current task and add the task as a message
    // to the thread.
    const message = await openai.beta.threads.messages.create(threadId, {
      role: 'user',
      content: task.content,
    });

    // attach message to task
    task.debugging.threadMessage = message;

    //after we have done that, we tell openai to process the run with the new message
    let run = await openai.beta.threads.runs.create(threadId, {
      assistant_id: assistantId,
      //instructions:
      //  'Please address the user as Jane Doe. The user has a premium account.',
    });

    // check if message has completed already...
    // TODO: write an extra task for this..   we should check if message has completed.
    // And if so, retrieve the result..
    run = await openai.beta.threads.runs.retrieve(threadId, run.id);

    const newMessages: OpenAI.Beta.Threads.Messages.ThreadMessage[] = [];

    let status;
    do {
      // Wait for a specified time before checking the status again
      await sleep(5000); // sleeps for 5 seconds

      // Retrieve the current status of run
      run = await openai.beta.threads.runs.retrieve(threadId, run.id);
      status = run.status;

      // Log the current status
      console.log('Current status:', status);

      // Retrieve the steps of the run
      const runStep = await openai.beta.threads.runs.steps.list(
        threadId,
        run.id
      );
      for (const step of runStep.data) {
        if (step.type === 'message_creation' && step.status === 'completed') {
          // Retrieve the message using the message ID from step_details
          OpenAI.Beta.Threads.Messages.ThreadMessagesPage;
          const messageId = (
            step.step_details as OpenAI.Beta.Threads.Runs.Steps.MessageCreationStepDetails
          ).message_creation.message_id;
          const message = await openai.beta.threads.messages.retrieve(
            threadId,
            messageId
          );

          // Add the retrieved message to the newMessages list
          newMessages.push(message);

          // TODO: we can now process this message and push it to our own list...
        }
      }
    } while (status === 'queued' || status === 'in_progress');

    // Handle other statuses accordingly
    if (status === 'completed') {
      // Process the completed run
      console.log('Run completed:', run);
    } else if (
      status === 'requires_action' ||
      status === 'failed' ||
      status === 'cancelled' ||
      status === 'expired'
    ) {
      // Handle other terminal statuses
      console.log('Run ended with status:', status);
    }

    // retrieve finished conversation...
    //const messages = await openai.beta.threads.messages.list(threadId);

    // now we need to check which messages are "new"
    // for now we simply assume, the last one...
    //const lastMessage = messages.data[0]
    return newMessages;
  }
}

// deletes tasks up to the first branch "split", eliminating a branch
// which is defined by the leaf and preceding, exclusive tasks
export function deleteTaskThread(leafId: string, chatState: ChatStateType) {
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
