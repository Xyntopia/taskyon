import axios from 'axios';
//import { useCachedModels } from './mlModels';
import { ToolBase } from './types';
import { LLMTask, OpenAIMessage, OpenRouterGenerationInfo } from './types';
import type { TyTaskManager } from './taskManager';
import OpenAI from 'openai';
import { openFile } from './OPFS';
import { z } from 'zod';
import {
  lruCache,
  sleep,
  asyncTimeLruCache,
  asyncLruCache,
  deepCopy,
} from './utils';
import type { FileMappingDocType } from './rxdb';
import { findAllFilesInTasks } from './taskUtils';
import defaultSettings from 'src/assets/taskyon_settings.json';

const getOpenai = lruCache<OpenAI>(5)(
  (apiKey: string, baseURL?: string, headers?: Record<string, string>) => {
    if (baseURL) {
      const openai = new OpenAI({
        baseURL: baseURL,
        apiKey: apiKey,
        defaultHeaders: headers,
        dangerouslyAllowBrowser: true,
      });
      return openai;
    } else {
      const api = new OpenAI({
        apiKey: apiKey,
        dangerouslyAllowBrowser: true,
      });
      return api;
    }
  }
);

const apiConfig = z.object({
  name: z.string(),
  baseURL: z.string(),
  defaultModel: z.string(),
  streamSupport: z.boolean(),
  defaultHeaders: z.record(z.string(), z.string()).optional(),
  routes: z.object({
    chatCompletion: z.string(),
    models: z.string(),
  }),
});
export type apiConfig = z.infer<typeof apiConfig>;

const llmSettings = z.object({
  // this refers to the task chain that we have currently selected. We select one task and then
  // put the chain together by following the parentIds.
  selectedTaskId: z.string().optional(),
  openAIAssistantId: z.string().default(''),
  useOpenAIAssistants: z.boolean().default(false),
  enableOpenAiTools: z.boolean().default(false),
  selectedApi: z.string().default('taskyon'),
  llmApis: z.record(apiConfig).default({}),
  siteUrl: z.string().default('https://taskyon.space'),
  summaryModel: z.string().default('Xenova/distilbart-cnn-6-6'),
  vectorizationModel: z.string().default('Xenova/all-MiniLM-L6-v2'),
  maxAutonomousTasks: z.number().default(3),
  taskChatTemplates: z.object({
    constraints: z.string().default(''),
    instruction: z.string().default(''),
    objective: z.string().default(''),
    tools: z.string().default(''),
    previousTasks: z.string().default(''),
    context: z.string().default(''),
    toolResult: z.string().default(''),
    task: z.string().default(''),
  }),
});
export type llmSettings = z.infer<typeof llmSettings>;

const appConfiguration = z.object({
  supabase_url: z.string().default(''),
  supabase_anon_key: z.string().default(''),
  appConfigurationUrl: z
    .string()
    .default('/taskyon_settings.json')
    .describe('URL from which to load the initial app configuration'),
  gdriveConfigurationFile: z
    .string()
    .default('taskyon_settings.json')
    .describe('gDrive fileid of the configuration'),
  expertMode: z.boolean().default(false),
  showCosts: z.boolean().default(false),
  gdriveDir: z.string().default('taskyon'), // not sure, if we need this here?
  useEnterToSend: z
    .boolean()
    .default(true)
    .describe(
      'Determines, if enter will automatically send a message or rather shift-enter'
    ),
  guiMode: z
    .enum(['auto', 'iframe', 'default'])
    .default('auto')
    .describe('Sets whether we want to have a minimalist chat or the full app'),
});
export type appConfiguration = z.infer<typeof appConfiguration>;

export const storedSettings = z.object({
  version: z
    .literal(4)
    .describe(
      'whenever the settings change, this number will get changed as well...'
    ),
  appConfiguration,
  llmSettings,
});
export type storedSettings = z.infer<typeof storedSettings>;

// this state stores all information which
// should be stored e.g. in browser LocalStorage
export function defaultLLMSettings() {
  return storedSettings.parse(defaultSettings).llmSettings;
}

export function getApiConfig(llmSettings: LLMSettingsType) {
  return llmSettings.llmApis[llmSettings.selectedApi];
}

export function getApiConfigCopy(
  llmSettings: LLMSettingsType,
  apiName?: string
) {
  const searchName = apiName || llmSettings.selectedApi;
  const api = llmSettings.llmApis[searchName];
  return deepCopy(api);
}

export type LLMSettingsType = ReturnType<typeof defaultLLMSettings>;

export const getAssistants = asyncTimeLruCache<
  Record<string, OpenAI.Beta.Assistant>
>(
  1,
  60000 * 10 * 60 //1h
)(async (openAIApiKey: string) => {
  console.log('get list of openai assistants');
  const response = await getOpenai(openAIApiKey).beta.assistants.list({
    order: 'desc',
    limit: 20,
  });

  const assistantsArray = response.data;
  const assistantsDict = assistantsArray.reduce((dict, assistant) => {
    dict[assistant.id] = assistant;
    return dict;
  }, {} as Record<string, OpenAI.Beta.Assistant>);

  return assistantsDict;
});

export type OpenAIChatMessage = {
  // The role of the message author (system, user, assistant, or function).
  role: 'system' | 'user' | 'assistant' | 'function';
  // The content of the message, can be null for some messages.
  content: string | null;
  // The name of the message author (optional) it has to be the name of the function, if
  // the role is "function".
  name: string;
};

//import { getEncoding } from 'js-tiktoken';
const { getEncoding } = await import(
  /* webpackChunkName: "tiktoken" */
  /* webpackMode: "lazy" */
  /* webpackExports: ["getEncoding"] */
  /* webpackFetchPriority: "high" */
  'js-tiktoken'
);
const enc = getEncoding('gpt2');

export function countStringTokens(txt: string) {
  // Tokenize the content
  const content = enc.encode(txt);
  return content.length;
}

function countChatTokens(
  chatMessages: (
    | OpenAIMessage
    | OpenAI.ChatCompletionMessage
    | OpenAI.ChatCompletionMessageParam
  )[]
): number {
  let totalTokens = 0;
  for (const message of chatMessages) {
    if (message.content && typeof message.content == 'string') {
      totalTokens += countStringTokens(message.content);
    }
  }
  return totalTokens;
}

export function countToolTokens(functionList: ToolBase[]): number {
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
  task: LLMTask,
  chat: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  tools: Record<string, ToolBase>
): LLMTask['debugging']['estimatedTokens'] {
  const functions: ToolBase[] = mapFunctionNames(
    task.allowedTools || [],
    tools
  );
  // TODO: convert task.content into a legitimate string first, using the
  //       "original" functions toshow what actually gets sent to the LLM!
  const contentStr = JSON.stringify(Object.values(task.content)[0]);
  const singlePromptTokens = countStringTokens(contentStr);
  const promptTokens = countChatTokens(chat);
  const functionTokens = Math.floor(countToolTokens(functions) * 0.7);
  const resultTokens = countStringTokens(
    task.result?.chatResponse?.choices[0]?.message.content || ''
  );
  return {
    singlePromptTokens,
    promptTokens,
    functionTokens,
    resultTokens,
  };
}

export function generateHeaders(
  apiSecret: string,
  siteUrl: string,
  selectedApi: string
) {
  let headers: Record<string, string> = {
    Authorization: `Bearer ${apiSecret}`,
    'Content-Type': 'application/json',
  };

  if (selectedApi == 'openrouter.ai') {
    headers = {
      ...headers,
      'HTTP-Referer': `${siteUrl}`, // To identify your app. Can be set to localhost for testing
      'X-Title': `${siteUrl}`, // Optional. Shows on openrouter.ai
    };
  }

  return headers;
}

function accumulateChatCompletion(
  chunks: OpenAI.ChatCompletionChunk[]
): OpenAI.ChatCompletion {
  if (chunks.length === 0) {
    throw new Error('No chunks provided');
  }

  // Assuming the id, created, and model fields are consistent across chunks,
  // we use the first chunk to initialize these values.
  const firstChunk = chunks[0];

  // Initialize the response
  const response: OpenAI.ChatCompletion = {
    id: firstChunk.id,
    object: 'chat.completion',
    created: firstChunk.created,
    model: firstChunk.model,
    choices: [
      {
        index: 0,
        message: {
          content: null,
          role: 'assistant', // or other roles as per your logic
        },
        finish_reason: 'stop',
        logprobs: null,
      },
    ],
  };

  // we need to accumulate tools separatly as we need an object to do this..
  const toolCalls: Record<string, OpenAI.ChatCompletionMessageToolCall> = {};

  // Accumulate the content from the first choice of each chunk
  // TODO: in the future we can easily accumulate from each choice with a  loop
  const choice = chunks.reduce(
    (previous, chunk) => {
      const choiceIdx = 0;
      if (chunk.choices[choiceIdx]?.delta?.content) {
        if (previous.message.content) {
          previous.message.content += chunk.choices[choiceIdx].delta.content;
        } else {
          previous.message.content = chunk.choices[choiceIdx].delta.content;
        }
      }
      previous.message.role =
        (chunk.choices[choiceIdx]?.delta
          ?.role as OpenAI.ChatCompletionMessage['role']) ||
        previous.message.role;
      previous.finish_reason =
        chunk.choices[choiceIdx]?.finish_reason || previous.finish_reason;
      for (const tc of chunk.choices[choiceIdx].delta?.tool_calls || []) {
        // initialize toolCalls if it doesn't exist
        const tcnew = toolCalls[tc.index] || {
          id: '',
          type: 'function',
          function: {
            name: '',
            arguments: '',
          },
        };
        tcnew.id += tc.id || '';
        tcnew.function.name += tc.function?.name || '';
        tcnew.function.arguments += tc.function?.arguments || '';
        toolCalls[tc.index] = tcnew;
      }
      return previous;
    },
    {
      index: 0,
      message: {
        content: null,
        role: 'assistant', // or other roles as per your logic
      },
      finish_reason: 'stop',
    } as OpenAI.ChatCompletion['choices'][0]
  );

  choice.message.tool_calls = Object.values(toolCalls).map((t) => t);
  response.choices = [choice];

  return response;
}

type MessageError = { error: { code: number; message: string } };

// calls openRouter OR OpenAI  chatmodels
export async function callLLM(
  chatMessages: OpenAI.ChatCompletionMessageParam[],
  functions: OpenAI.ChatCompletionTool[],
  api: apiConfig,
  siteUrl: string,
  apiKey: string,
  stream: false | true | null | undefined = false,
  contentCallBack: (
    chunk?: OpenAI.Chat.Completions.ChatCompletionChunk
  ) => void,
  cancelStream: () => boolean // a function which we can call and which indicates that we should cancel the stream
): Promise<OpenAI.ChatCompletion | undefined | MessageError> {
  const headers: Record<string, string> = generateHeaders(
    apiKey,
    siteUrl,
    api.name
  );
  let chatCompletion: OpenAI.ChatCompletion | undefined | MessageError =
    undefined;
  const openai = getOpenai(apiKey, api.baseURL, headers);

  const payload: OpenAI.ChatCompletionCreateParams = {
    model: api.defaultModel,
    messages: chatMessages,
    user: 'taskyon',
    temperature: 0.0,
    stream: stream && api.streamSupport,
    n: 1,
  };

  if (functions.length > 0) {
    payload.tool_choice = 'auto';
    payload.tools = functions;
  }

  if (payload.stream) {
    try {
      const completion = await openai.chat.completions.create(payload);

      const chunks = [];
      for await (const chunk of completion) {
        chunks.push(chunk);
        if (chunk) {
          contentCallBack(chunk);
        }
        // TODO: also cancel the completion request itself by giving it an abort signal which can be released
        //       by a callback from our executionContext...
        if (cancelStream()) {
          break; // --> and take everything that we have already accumulated so far
        }
      }
      chatCompletion = accumulateChatCompletion(chunks);
    } catch (error) {
      const err = new Error('Error during streaming');
      err.cause = error;
      throw err;
    }
  } else {
    const completion = await openai.chat.completions.create(payload);
    chatCompletion = completion;
  }

  console.log('AI responded:', chatCompletion);
  return chatCompletion;
}

export function mapFunctionNames(
  toolNames: string[],
  tools: Record<string, ToolBase>
) {
  return toolNames?.map((t) => tools[t]);
}

export async function getOpenRouterGenerationInfo(
  generationId: string,
  headers: Record<string, string>
) {
  let retryCount = 0;
  let delay = 5000; // first delay

  while (retryCount < 3) {
    const response = await fetch(
      `https://openrouter.ai/api/v1/generation?id=${generationId}`,
      {
        headers,
      }
    );

    if (response.ok) {
      const generationInfo = (await response.json()) as {
        data: OpenRouterGenerationInfo;
      };
      console.log('received generation info for task');
      return generationInfo.data;
    } else if (response.status === 404) {
      console.log(`Received 404, retrying in ${delay}ms`);
      await sleep(delay);
      retryCount++;
      delay *= 2; // increase delay for next retry
    } else {
      throw new Error(
        `Failed to get cost information for Openrouter.ai: ${generationId} - ${response.status}`
      );
    }
  }
  throw new Error(
    `Failed to get generation info after 3 retries for ${generationId}`
  );
}

export function enrichWithDelayedUsageInfos(
  task: LLMTask,
  taskManager: TyTaskManager,
  generationInfo: OpenRouterGenerationInfo
) {
  if (generationInfo) {
    if (
      generationInfo.native_tokens_completion &&
      generationInfo.native_tokens_prompt
    ) {
      // we get the useage data very often in an asynchronous form.
      // thats why we need to
      // openai sends back the exact number of prompt tokens :)
      const debugging = {
        promptTokens: generationInfo.native_tokens_prompt,
        resultTokens: generationInfo.native_tokens_completion,
        taskCosts: generationInfo.usage,
        taskTokens:
          generationInfo.native_tokens_prompt +
          generationInfo.native_tokens_completion,
      };
      void taskManager.updateTask({ id: task.id, debugging }, true);
      for (const childID of task.childrenIDs) {
        void taskManager.getTask(childID).then((child) => {
          if (child && !child?.debugging.promptTokens) {
            void taskManager.updateTask(
              {
                id: child.id,
                debugging: { promptTokens: task.debugging.resultTokens },
              },
              true
            );
          }
        });
      }
    }
  }
}

async function uploadFileToOpenAI(
  file: File,
  openaiKey: string
): Promise<string | undefined> {
  try {
    const response = await getOpenai(openaiKey).files.create({
      file: file,
      purpose: 'assistants',
    });
    return response.id;
  } catch (error) {
    const err = new Error('Error uploading file to OpenAI:');
    err.cause = error;
    throw err;
    // Handle the error as per your application's error handling policy
  }
}

// TODO: merge this with our taskyon "internal" agents...
function convertTasksToOpenAIThread(
  taskList: LLMTask[],
  fileMappings: Record<string, string>
): OpenAI.Beta.ThreadCreateParams.Message[] {
  const messageList = taskList.map((task) => {
    let content = '';
    if ('message' in task.content) {
      content = task.content.message;
    }
    return {
      role: 'user' as const,
      content,
      // TODO: attach file ids to chatmessage
      /*file_ids: (task.content?.uploadedFiles || [])
          .map((file) => fileMappings[file])
          .filter((id) => id !== undefined),*/
    };
  });

  return messageList;
}

export async function getOpenAIAssistantResponse(
  task: LLMTask,
  openAIApiKey: string,
  openAIAssistantId: string,
  taskManager: TyTaskManager
) {
  if (task.content) {
    const openai = getOpenai(openAIApiKey);
    console.log('send task to assistant!', task);

    // get all messages from a chat
    const taskList: LLMTask[] = [];
    const taskIdChain = await taskManager.taskChain(task.id);
    for (const t of taskIdChain) {
      const T = await taskManager.getTask(t);
      if (T) taskList.push();
    }

    // Find all fileIDs in the task list
    const fileIDs = findAllFilesInTasks(taskList);

    // Get all corresponding filemapping entries from our database
    const currentTaskListfileMappings = (
      await Promise.all(
        fileIDs.map(async (fuuid) => taskManager.getFileMappingByUuid(fuuid))
      )
    ).filter((fm) => fm !== null) as FileMappingDocType[];

    // upload files to openai with that information one-by-one
    const openAIFileMappings: Record<string, string> = {};
    for (const fm of currentTaskListfileMappings) {
      if (fm?.opfs) {
        const file = await openFile(fm.opfs);
        if (file) {
          // TODO: only upload file, if it doesn't have a openAI ID yet.
          const fileIDopenAI = await uploadFileToOpenAI(file, openAIApiKey);
          if (fileIDopenAI) {
            fm.openAIFileId = fileIDopenAI;
            openAIFileMappings[fm.uuid] = fileIDopenAI;
          }
        }
      }
    }

    // Update file mapping database
    await taskManager.bulkUpsertFiles(currentTaskListfileMappings);

    // Finally, Convert task list to OpenAI thread messages
    const openAIConversationThread = convertTasksToOpenAIThread(
      taskList,
      openAIFileMappings
    );

    // then upload the taskThread and execute it.
    const thread = await openai.beta.threads.create({
      messages: openAIConversationThread,
    });
    const threadId = thread.id;

    //after we have done that, we tell openai to process the run with the new message
    let run = await openai.beta.threads.runs.create(threadId, {
      assistant_id: openAIAssistantId,
      //instructions:
      //  e.g. "'Please address the user as Jane Doe. The user has a premium account.'"",
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

    // Sort the newMessages array by the created_at timestamp
    newMessages.sort((a, b) => {
      return a.created_at - b.created_at;
    });

    // now we need to check which messages are "new"
    // for now we simply assume, the last one...
    //const lastMessage = messages.data[0]
    return newMessages;
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
  name?: string;
  object?: string;
  created?: number;
  owned_by?: string;
  permission?: Permission[];
  root?: string;
  parent?: null | string;
  pricing?: {
    prompt: string;
    completion: string;
    discount?: number;
  };
  context_length?: number;
  top_provider?: {
    max_completion_tokens: number | null;
  };
  architecture?: {
    tokenizer?: string;
    instruct_type?: string | null;
  };
  per_request_limits?: {
    prompt_tokens: string;
    completion_tokens: string;
  } | null;
}

export const availableModels = asyncLruCache<Model[]>(3)(
  async (modelsUrl: string, apiKey: string): Promise<Model[]> => {
    try {
      // Setting up the Axios requsest
      const response = await axios.get<{ data: Model[] }>(modelsUrl, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Cache-Control': 'max-stale=3600',
        },
      });

      // Return the list of models directly
      return response.data.data;
    } catch (error) {
      console.error('Error fetching models:', error);
      throw error; // re-throwing the error to be handled by the calling code
    }
  }
);
