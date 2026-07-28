import { expose } from 'comlink'
import { mapFunctionNames } from '../core/tools'
import type { TaskNodeMeta } from '../types/chatCompletion'
import type { TaskNode } from '../types/taskNode'
import type { ToolBase } from '../types/tools'
import { getVector, loadModel, loadTokenizer } from './nlp'
import { getStaticEmbedding } from './staticEmbedding'

//import { getEncoding } from 'js-tiktoken';
async function loadTikTokenEncoder() {
  const { getEncoding } = await import(
    /* webpackChunkName: "tiktoken" */
    /* webpackMode: "lazy" */
    /* webpackExports: ["getEncoding"] */
    /* webpackFetchPriority: "low" */
    'js-tiktoken'
  )
  const enc = getEncoding('gpt2')
  return enc
}

export async function countStringTokens(txt: string) {
  const enc = await loadTikTokenEncoder()
  // Tokenize the content
  const content = enc.encode(txt)
  return content.length
}

type CountableMessage = object & { content?: unknown }

async function countChatTokens(chatMessages: CountableMessage[]) {
  let totalTokens = 0
  for (const message of chatMessages) {
    if (message.content && typeof message.content == 'string') {
      totalTokens += await countStringTokens(message.content)
    }
  }
  return totalTokens
}

export async function countToolTokens(functionList: ToolBase[]) {
  let totalTokens = 0

  // Iterate through each tool in the functionList array
  for (const tool of functionList) {
    // Get the description and stringify the parameters of the tool
    const description = tool.description
    const stringifiedParameters = JSON.stringify(tool.parameters, null, 2) // Pretty print the JSON string

    // Count the tokens in the description and stringified parameters using countStringTokens
    const descriptionTokens = await countStringTokens(description)
    const parametersTokens = await countStringTokens(stringifiedParameters)

    // Sum the tokens of the description and stringified parameters for this tool
    totalTokens += descriptionTokens + parametersTokens
  }

  return totalTokens
}

export function createNlpWorkerApi() {
  return {
    // TODO: make sure, we don't reload models & tokenizers all the time!!
    vectorizeText: async (text: string, modelName: string) => {
      return await getVector(text, modelName)
    },

    vectorizeStaticText: async (text: string, modelName?: string) => {
      return await getStaticEmbedding(text, modelName)
    },

    loadVecTokenizer: async (modelName: string) => {
      await loadTokenizer(modelName)
      console.log('tokenizer loaded:', modelName)
    },

    loadVecModel: async (modelName: string) => {
      await loadModel(modelName)
      console.log('model loaded:', modelName)
    },

    estimateChatTokens: async (
      content: TaskNode['content'],
      chat: CountableMessage[],
      tools: Record<string, ToolBase>,
      allowedTools?: string[],
      chatResult?: string,
    ): Promise<TaskNodeMeta['estimatedTokens']> => {
      const functions: ToolBase[] = mapFunctionNames(allowedTools || [], tools)
      const contentStr = JSON.stringify(content.data)
      const singlePromptTokens = await countStringTokens(contentStr)
      const promptTokens = await countChatTokens(chat)
      const functionTokens = Math.floor((await countToolTokens(functions)) * 0.7)
      const resultTokens = chatResult ? await countStringTokens(chatResult) : 0
      return {
        singlePromptTokens,
        promptTokens,
        functionTokens,
        resultTokens,
      }
    },
  }
}

const nlpWorker = createNlpWorkerApi()

export type NlpWorkerInterface = typeof nlpWorker

if (
  typeof self !== 'undefined' &&
  typeof (self as { addEventListener?: unknown }).addEventListener === 'function'
) {
  expose(nlpWorker)
}
