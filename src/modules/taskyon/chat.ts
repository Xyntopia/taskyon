//import { useCachedModels } from './mlModels';
import type {
  ToolBase,
  TaskNode,
  OpenAIMessage,
  OpenRouterGenerationInfo,
  Model,
} from './types';
import type { TyTaskManager } from './taskManager';
import type OpenAI from 'openai';
import { sleep, asnycasyncTimeLruCache } from '../utils';
import { TaskProcessingError, apiConfig } from './types';

//import { getEncoding } from 'js-tiktoken';
async function loadTikTokenEncoder() {
  const { getEncoding } = await import(
    /* webpackChunkName: "tiktoken" */
    /* webpackMode: "lazy" */
    /* webpackExports: ["getEncoding"] */
    /* webpackFetchPriority: "low" */
    'js-tiktoken'
  );
  const enc = getEncoding('gpt2');
  return enc;
}

export async function countStringTokens(txt: string) {
  const enc = await loadTikTokenEncoder();
  // Tokenize the content
  const content = enc.encode(txt);
  return content.length;
}

async function countChatTokens(
  chatMessages: (
    | OpenAIMessage
    | OpenAI.ChatCompletionMessage
    | OpenAI.ChatCompletionMessageParam
  )[],
) {
  let totalTokens = 0;
  for (const message of chatMessages) {
    if (message.content && typeof message.content == 'string') {
      totalTokens += await countStringTokens(message.content);
    }
  }
  return totalTokens;
}

export async function countToolTokens(functionList: ToolBase[]) {
  let totalTokens = 0;

  // Iterate through each tool in the functionList array
  for (const tool of functionList) {
    // Get the description and stringify the parameters of the tool
    const description = tool.description;
    const stringifiedParameters = JSON.stringify(tool.parameters, null, 2); // Pretty print the JSON string

    // Count the tokens in the description and stringified parameters using countStringTokens
    const descriptionTokens = await countStringTokens(description);
    const parametersTokens = await countStringTokens(stringifiedParameters);

    // Sum the tokens of the description and stringified parameters for this tool
    totalTokens += descriptionTokens + parametersTokens;
  }

  return totalTokens;
}

export async function estimateChatTokens(
  task: TaskNode,
  chat: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  tools: Record<string, ToolBase>,
): Promise<TaskNode['debugging']['estimatedTokens']> {
  const functions: ToolBase[] = mapFunctionNames(
    task.allowedTools || [],
    tools,
  );
  // TODO: convert task.content into a legitimate string first, using the
  //       "original" functions toshow what actually gets sent to the LLM!
  const contentStr = JSON.stringify(Object.values(task.content)[0]);
  const singlePromptTokens = await countStringTokens(contentStr);
  const promptTokens = await countChatTokens(chat);
  const functionTokens = Math.floor((await countToolTokens(functions)) * 0.7);
  const resultTokens = await countStringTokens(
    task.result?.chatResponse?.choices[0]?.message.content || '',
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
  selectedApi: string,
) {
  let headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (apiSecret && !(selectedApi === 'taskyon' && apiSecret === 'anonymous')) {
    headers.Authorization = `Bearer ${apiSecret}`;
  }

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
  chunks: OpenAI.ChatCompletionChunk[],
): OpenAI.ChatCompletion {
  if (!chunks[0]) {
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
          refusal: null,
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
      for (const tc of chunk.choices[choiceIdx]?.delta?.tool_calls || []) {
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
    } as OpenAI.ChatCompletion['choices'][0],
  );

  choice.message.tool_calls = Object.values(toolCalls).map((t) => t);
  response.choices = [choice];

  return response;
}

// calls openRouter OR OpenAI  chatmodels
export async function callLLM(
  chatMessages: OpenAI.ChatCompletionMessageParam[],
  functions: OpenAI.ChatCompletionTool[],
  api: apiConfig,
  siteUrl: string,
  apiKey: string,
  stream: false | true | null | undefined = false,
  contentCallBack: (
    chunk?: OpenAI.Chat.Completions.ChatCompletionChunk,
  ) => void,
  cancelStream: () => boolean, // a function which we can call and which indicates that we should cancel the stream
): Promise<OpenAI.ChatCompletion | undefined> {
  const headers: Record<string, string> = generateHeaders(
    apiKey,
    siteUrl,
    api.name,
  );
  let chatCompletion: OpenAI.ChatCompletion | undefined = undefined;

  if (!api.selectedModel) {
    throw new TaskProcessingError(
      'You need to select an AI model in order to use the AI!',
    );
  }

  const payload = {
    model: api.selectedModel,
    messages: chatMessages,
    user: 'taskyon',
    temperature: 0.0,
    stream: stream && api.streamSupport,
    n: 1,
    ...(functions.length > 0 && { tools: functions, tool_choice: 'auto' }),
  };

  // Use AbortController to handle stream cancellation
  const controller = new AbortController();

  try {
    const response = await fetch(`${api.baseURL}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (stream && response.body) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const chunks: OpenAI.Chat.Completions.ChatCompletionChunk[] = [];
      let bufferedData = ''; // Buffer to hold partial JSON chunks

      while (true) {
        console.log('waiting for chunk');
        const { done, value } = await reader.read();
        if (done) break;

        // Decode the binary chunk into a string
        const chunk = decoder.decode(value, { stream: true });
        bufferedData += chunk;

        // Process the buffered data and split at newlines (for each "data: ..." chunk)
        const lines = bufferedData.split('\n');

        for (let i = 0; i < lines.length - 1; i++) {
          const line = lines[i]!.trim();

          // Only process lines starting with "data: "
          if (line.startsWith('data: ')) {
            const jsonString = line.replace(/^data: /, '').trim();

            if (jsonString && jsonString !== '[DONE]') {
              try {
                // Parse the current line into a JSON object
                const jsonChunk: OpenAI.Chat.Completions.ChatCompletionChunk =
                  JSON.parse(jsonString);
                chunks.push(jsonChunk);

                // Call the callback function to process the chunk
                contentCallBack(jsonChunk);
              } catch (err) {
                console.error('Failed to parse chunk:', jsonString, err);
              }
            }
          }
        }

        // Keep the last partial chunk in the buffer for the next iteration
        bufferedData = lines[lines.length - 1]!;

        // If the cancelStream callback signals to cancel, break the loop and abort the request
        if (cancelStream()) {
          controller.abort();
          break;
        }
      }

      // After finishing, accumulate the full chat completion
      chatCompletion = accumulateChatCompletion(chunks);
    } else {
      // Non-streaming case: Just return the full response
      const completion = await response.json();
      chatCompletion = completion;
    }
  } catch (error) {
    if (error instanceof Error) {
      const err = new Error(`Error during fetch call: ${error.message}`);
      err.cause = error;
      throw err;
    }
  }

  console.log('AI responded:', chatCompletion);
  return chatCompletion;
}

export function mapFunctionNames(
  toolNames: string[],
  tools: Record<string, ToolBase>,
): ToolBase[] {
  return toolNames?.map((t) => tools[t] as ToolBase).filter((t) => t);
}

export async function getOpenRouterGenerationInfo(
  generationId: string,
  headers: Record<string, string>,
) {
  let retryCount = 0;
  let delay = 5000; // first delay

  while (retryCount < 3) {
    const response = await fetch(
      `https://openrouter.ai/api/v1/generation?id=${generationId}`,
      {
        headers,
      },
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
        `Failed to get cost information for Openrouter.ai: ${generationId} - ${response.status}`,
      );
    }
  }
  throw new Error(
    `Failed to get generation info after 3 retries for ${generationId}`,
  );
}

export function enrichWithDelayedUsageInfos(
  task: TaskNode,
  taskManager: TyTaskManager,
  generationInfo?: OpenRouterGenerationInfo,
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
              true,
            );
          }
        });
      }
    }
  }
}

export const availableModels = asnycasyncTimeLruCache<Model[]>(
  10, // max 10 entries
  60 * 60 * 1000, //1h
  true, // use localStorage for persistence
  'modelCache', // save it here..
)(async (
  modelsUrl: string,
  apiKey: string,
  headers: Record<string, string>,
  invalidateCache = false,
): Promise<Model[]> => {
  try {
    // Construct the URL with an optional cache-busting query parameter
    const url = invalidateCache
      ? `${modelsUrl}?_=${new Date().getTime()}`
      : modelsUrl;

    // Setting up the Fetch request
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        ...headers,
        Authorization: `Bearer ${apiKey}`,
        //'Cache-Control': 'max-stale=3600',
        'Cache-Control': 'no-cache', // Ensure the freshest data is fetched as we're caching this function anyways...
      },
    });

    // Check if the response is ok (status in the range 200-299)
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    // Parse the JSON response
    const data = (await response.json()) as { data: Model[] };

    // Return the list of models directly
    return data.data;
  } catch (error) {
    console.error('Error fetching models:', error);
    throw error; // re-throwing the error to be handled by the calling code
  }
});
