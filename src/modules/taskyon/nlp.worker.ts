import { expose } from 'comlink';
import { getVector } from './nlp';
import type OpenAI from 'openai';
import type { OpenAIMessage, ToolBase, TaskNode } from './types';
import { mapFunctionNames } from './tools';
import { loadModel, loadTokenizer } from './mlModels';

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

const nlpWorker = {
  // TODO: make sure, we don't reload models & tokenizers all the time!!
  async vectorizeText(text: string, modelName: string) {
    return await getVector(text, modelName);
  },

  async loadVecTokenizer(modelName: string) {
    await loadTokenizer(modelName);
    console.log('tokenizer loaded:', modelName);
  },

  async loadVecModel(modelName: string) {
    await loadModel(modelName);
    console.log('model loaded:', modelName);
  },

  async estimateChatTokens(
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
  },
};

export type NlpWorkerInterface = typeof nlpWorker;

expose(nlpWorker);
