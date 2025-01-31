import type OpenAI from 'openai'
import {
  callLLM,
  enrichWithUsageInfos,
  generateHeaders,
  getOpenRouterGenerationInfo,
  getTaskyonCosts,
} from '../taskyon/chat'
import { addPrompts, generateOpenAIToolDeclarations } from '../taskyon/promptCreation'
import type { TyTaskManager } from '../taskyon/taskManager'
import { type TaskWorkerController } from '../taskyon/taskWorker'
import type { partialTaskDraft, ToolBase } from '../taskyon/types'
import { FunctionCall } from '../taskyon/types'
import { ChatResponseType, getApiConfigCopy } from '../taskyon/types'
import { TaskProcessingError, type TaskNode, type llmSettings } from '../taskyon/types'
import {
  makeTaskResult,
  type InternalTool,
  type internalToolFunctionSchema,
  type toolContext,
} from '../taskyon/tools'
import { deepCopy, fileToBase64, sleep } from '../utils'
import { isTaskyonKey } from '../taskyon/tyCrypto'
import { useNlpWorker } from '../taskyon/webWorkerApi'
import type { FileMappingDocType } from '../taskyon/rxdb'
import { dump } from 'js-yaml'

// this function processes all tasks which go to any sort of an LLM

// TODO: for configuration & allowedTools it would be good if we could add
// this from a "default" Configuration? And then have them as function parameters?
// t.configuration = finishedTask.configuration

export type Goals = 'SimpleCompletion' | 'AnalyzeError' | 'ChooseTool' | 'AnalyzeToolResult'

// TODO: refactor & clean up this function ;)
export async function processChatTask(
  goal: Goals,
  allowedTools: string[],
  currentTask: TaskNode,
  configuration: { model: string; chatApi: string },
  llmSettings: llmSettings,
  // can we get rid of taskManager here in order to make our task more functional :)?
  taskManager: TyTaskManager,
  taskWorkerController: TaskWorkerController,
  apiKeys: { [key: string]: string },
) {
  const api = getApiConfigCopy(llmSettings, configuration.chatApi)
  const apiKey = llmSettings.selectedApi ? apiKeys[llmSettings.selectedApi] : undefined
  if (!apiKey)
    throw new TaskProcessingError('We need to define an API key to process our chat Task!')

  if (!api) {
    throw new TaskProcessingError(
      `api doesn't exist! ${llmSettings.selectedApi || 'no api selected!'}`,
    )
  }
  const selectedModel = configuration.model
  if (selectedModel) {
    api.selectedModel = selectedModel
    console.log('execute chat completion tool with prompt:', currentTask)
    //TODO: we can create more things here like giving it context form other tasks, lookup
    //      main objective, previous tasks etc....
    // TODO: accept a thread from outside this tool... and only convert it into an openai compatible format
    const toolDefs = await taskManager.updateToolDefinitions(true)
    const taskIdChain = await taskManager.getTaskIdChain(currentTask.id)
    let openAIConversationThread = await buildChatThread(
      llmSettings.tryUsingVisionModels,
      llmSettings.enableOpenAiTools,
      toolDefs,
      taskIdChain,
      taskManager.getTask,
      taskManager.getFileMappingByUuid,
      taskManager.getFile,
    )

    // now add goal-specific prompts...
    const lastTaskBeforeChatCompletion = await taskManager.getTask(currentTask.priorID)
    if (!lastTaskBeforeChatCompletion)
      throw new Error(`chatCompletion Task needs a parent Task to work! ${currentTask.id}`)

    // TODO: split llmSettings.enableOpenAiTools settings from addPrompts for refactoring
    // TODO: split "base" prompt from "addPrompts"  and maybe have a separate function for each
    //       goal...
    openAIConversationThread = addPrompts(
      lastTaskBeforeChatCompletion,
      toolDefs,
      llmSettings,
      openAIConversationThread,
      allowedTools,
      goal,
    )

    let tools: OpenAI.ChatCompletionTool[] = []
    if (llmSettings.enableOpenAiTools) {
      tools = generateOpenAIToolDeclarations(llmSettings.allowedTools || [], toolDefs)
    }

    if (openAIConversationThread.length > 0) {
      const chatCompletion = await callLLM(
        openAIConversationThread,
        tools,
        api,
        llmSettings.siteUrl,
        apiKey,
        // TODO: if the task runs in the "foreground", stream it :)
        // task.id == llmSettings.selectedTaskId ? true : false, // this doesn't work, for some reason it doesn't always detect if we're running something in the forground...
        true, // for now, we always want to stream our task...

        // this function receives chunks if we stream and senfs them into
        // our original task in the debugging property to be displayed
        // "live" (this only works if our tasks structure in task manager is
        // reactive)
        (chunk) => {
          if (chunk?.choices[0]?.delta?.tool_calls) {
            chunk?.choices[0]?.delta?.tool_calls.forEach((t) => {
              currentTask.debugging.toolStreamArgsContent =
                currentTask.debugging.toolStreamArgsContent || {}
              if (t.function?.name) {
                currentTask.debugging.toolStreamArgsContent[t.function.name] =
                  (currentTask.debugging.toolStreamArgsContent[t.function.name] || '') +
                  (t.function?.arguments || '')
              }
            })
          }
          if (chunk?.choices[0]?.delta?.content) {
            currentTask.debugging.streamContent =
              (currentTask.debugging.streamContent || '') + chunk.choices[0].delta.content
          }
        },
        () => {
          return taskWorkerController.isInterrupted()
        },
      )

      return chatCompletion
    }
  } else {
    throw new Error('Task has no inference model selected!')
  }
}

// TODO: use this function to enrich tasks with metadata (as a start in a separate database, we could use rxdb for this...)
// add this function right to where we produced the conversationthread in the chatCompletionTool... and add
// the cost information to some sort of a db, maybe postgres? :)
export async function addTaskCostInformation(
  result: unknown,
  task: Readonly<TaskNode>,
  taskManager: TyTaskManager,
  llmSettings: llmSettings,
  apiKey?: string,
) {
  // TODO: also get cost information for other tasks, than chatCompletion ;)!
  const chatResponse = getChatResponseFromResult(result)
  if (chatResponse) {
    // TODO: we don't need this here anymore, we should get this from inside the chatprocessor itself
    /*const { openAIConversationThread } = await generateCompleteChat(
      goal,
      task,
      llmSettings,
      taskManager,
    )*/

    // openai sends back the exact number of prompt tokens :)
    if (chatResponse.usage) {
      task.debugging.promptTokens = chatResponse.usage.prompt_tokens
      task.debugging.resultTokens = chatResponse.usage.completion_tokens
      task.debugging.taskTokens = chatResponse.usage.total_tokens
    }
    const allTools = await taskManager.updateToolDefinitions(true)
    task.debugging.estimatedTokens = await estimateChatTokens(
      // we are doing a deepCopy here in order to make sure we loose the^ reactivity...
      // TODO:  once our tasks are immutable and non-reactive, we can remove this..
      deepCopy(task),
      openAIConversationThread,
      allTools,
      llmSettings.allowedTools || [],
      chatResponse.choices[0]!.message.content ?? '',
    )

    // TODO: replace this below with a taskNode in lower hierachy which does this :)
    if (chatResponse && llmSettings.selectedApi === 'openrouter.ai' && apiKey) {
      console.log('getting openrouter generation info')
      void sleep(10000).then(() =>
        getOpenRouterGenerationInfo(
          chatResponse.id,
          generateHeaders(apiKey, llmSettings.siteUrl, llmSettings.selectedApi || ''),
        ).then((generationInfo) => enrichWithUsageInfos(task, taskManager, generationInfo)),
      )
    } else if (
      chatResponse &&
      llmSettings.selectedApi === 'taskyon' &&
      !chatResponse.model.endsWith(':free') &&
      apiKey &&
      !isTaskyonKey(apiKey, false)
    ) {
      // TODO: remove "configuration" here and get the information from the tasks function call parameters
      const api = getApiConfigCopy(llmSettings, task.configuration?.chatApi)
      if (api) {
        console.log('getting taskyon generation info')
        // our backend tries to get the finished costs
        // after ~4000ms, so we wait for 6000 here...
        void sleep(6000).then(() =>
          getTaskyonCosts(llmSettings, apiKey, api, chatResponse.id, task.id).then(
            (generationInfo) => {
              console.log('taskyon generation info:', generationInfo)
              void enrichWithUsageInfos(task, taskManager, generationInfo)
            },
          ),
        )
      }
    }
  }
}

// get worker function for our chat :)
const { estimateChatTokens } = useNlpWorker()

function getChatResponseFromResult(result: unknown) {
  const res = ChatResponseType.safeParse(result)
  return res.data
}

export function extractOpenAIFunctions(
  choice: ChatResponseType['choices'][0],
  tools: Record<string, ToolBase>,
) {
  const functionCalls: FunctionCall[] = []
  for (const toolCall of choice.message.tool_calls || []) {
    // if our response contained a call to a function...
    // TODO: update this to the new tools API from Openai
    console.log('A function call was returned...')
    // we convert the object into our own FunctionCall and afterwards parse it, to make
    // sure it really worked...
    const functionCallObj: FunctionCall = {
      name: toolCall.function.name,
      arguments: JSON.parse(toolCall.function.arguments),
    }
    const functionCall = FunctionCall.parse(functionCallObj)
    if (tools[functionCall.name]) {
      functionCalls.push(functionCall)
    }
  }
  return functionCalls
}

// TODO:  this functionis way too complex..  can we refactor this?
async function buildChatThread(
  useVisionModels: boolean,
  useOpenAITools: boolean,
  toolCollection: Record<string, ToolBase>,
  taskIdChain: string[],
  getTask: (id: string) => Promise<TaskNode | undefined>,
  getFileMapping: (uuid: string) => Promise<FileMappingDocType | null>,
  getFile: (uuid: string) => Promise<File | undefined>,
) {
  const openAIMessageThread = [] as OpenAI.ChatCompletionMessageParam[]

  if (taskIdChain) {
    // we are using the reverse, because we want to build the chain starting
    // from the lsat message, so that we have to add e.g. function descriptions etc...
    // only once..
    for (const mId of taskIdChain) {
      const task = await getTask(mId)
      if (task) {
        const messages = await convertTaskNodeToOpenAIMessage(
          task,
          useVisionModels,
          getFileMapping,
          getFile,
          useOpenAITools,
          toolCollection,
        )
        if (messages) openAIMessageThread.push(...messages)
      }
    }
  }

  return openAIMessageThread
}

// sometimes a single task can get converted to multiple messages
// and sometime we don't need it at all in the chat :)
async function convertTaskNodeToOpenAIMessage(
  task: TaskNode,
  useVisionModels: boolean,
  getFileMapping: (uuid: string) => Promise<FileMappingDocType | null>,
  getFile: (uuid: string) => Promise<File | undefined>,
  useOpenAITools: boolean,
  toolCollection: Record<string, ToolBase>,
): Promise<OpenAI.Chat.Completions.ChatCompletionMessageParam[] | undefined> {
  if ('functionCall' in task.content) {
    const functionCallName = task.content.functionCall.name
    if (!toolCollection[functionCallName]?.renderOptions?.llm) {
      return
    }
    if (useOpenAITools) {
      const functionMessage: OpenAI.ChatCompletionMessageParam = {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: task.id,
            type: 'function',
            function: {
              name: task.content.functionCall.name,
              arguments: JSON.stringify(task.content.functionCall.arguments),
            },
          },
        ],
      }
      return [functionMessage]
    } else {
      // the purpose of this is to inform the AI about what function was called and
      // the arguments in it.
      // TODO: its probably a good idea to make this shorter in cas we have very long argumets...
      // TODO: not sure, if this is a good idea with OpenAI Functions, bcause openai seems to already have
      //       an idea about the functions which were provided with their descriptions,
      //       anyways So we should probably leave this out here...

      const functionArgs = dump({
        arguments: task.content.functionCall.arguments,
        //...t.result?,
      })
      return [
        {
          role: 'assistant',
          // and the result of the function
          content: `I just used the following tool: ${functionCallName}. The parameters used were: ${functionArgs}`,
        },
      ]
    }
  } else if ('toolResult' in task.content) {
    // we can still slightly change the content of this message to make clear
    // TODO: instead of using a manual "result of the tool" use the description in the type!
    // maybe refer to the actual tool call here?
    if (task.priorID && useOpenAITools) {
      const message: OpenAI.ChatCompletionMessageParam = {
        role: 'tool',
        tool_call_id: task.priorID, // the tool call will get the parent ID as well! :)
        content: dump(task.content.toolResult),
      }
      return [message]
    } else
      return [
        {
          role: 'assistant',
          content: dump({
            'The tool that you called returned the following result:': task.content.toolResult,
          }),
        },
      ]
  } else if ('message' in task.content && task.role != 'function') {
    const message: OpenAI.ChatCompletionMessageParam = {
      role: task.role,
      content: task.content.message,
    }
    return [message]
  } else if ('uploadedFiles' in task.content && task.role != 'function') {
    const fileMappings = await Promise.all(
      task.content.uploadedFiles.map((uuid) => getFileMapping(uuid)),
    )
    const fileNames = fileMappings
      .map((fm) => '- ' + (fm?.name || fm?.opfs || 'unknown'))
      .join('\n')
    const message: OpenAI.ChatCompletionMessageParam = {
      role: 'system',
      content: `user uploaded files:\n${fileNames}`,
    }

    if (useVisionModels) {
      // build data strings for all of our images in order to send them to vision...
      const imageContent: OpenAI.ChatCompletionUserMessageParam['content'] =
        await convertFilesToOpenAIImageContent(fileMappings, getFile)

      const imageMessage: OpenAI.ChatCompletionMessageParam = {
        role: 'user',
        content: imageContent,
        // TODO: we need to experiment with sending additional text here?
        //{"type": "text", "text": "What’s in this image?"},
      }
      return [message, imageMessage]
    }
    return [message]
  }
  // TODO: we would also like to convert structured messages, and simply don't send them to
  //       the chat, if they're configured as "lower-hierarchy"
}

async function convertFilesToOpenAIImageContent(
  fileMappings: (FileMappingDocType | null)[],
  getFile: (uuid: string) => Promise<File | undefined>,
) {
  const imageContent: OpenAI.ChatCompletionUserMessageParam['content'] = []
  for (const fm of fileMappings) {
    if (fm) {
      const name = fm?.name || fm?.opfs || 'unknown'
      if (name.endsWith('png') || name.endsWith('jpg')) {
        const file: File | undefined = await getFile(fm.uuid)
        if (file) {
          const base64Image = await fileToBase64(file)
          const msgContent: OpenAI.Chat.Completions.ChatCompletionContentPartImage = {
            type: 'image_url',
            //TODO: enable "real" image urls from another webpage ....
            image_url: {
              url: `data:image/jpeg;base64,${base64Image}`,
              detail: 'auto',
            },
          }
          imageContent.push(msgContent)
        }
      }
    }
  }
  return imageContent
}

type ccArguments = { model: string; goal?: Goals; llmTools?: boolean; allowedTools?: string[] }

export function createChatCompletionTask(args: ccArguments): partialTaskDraft {
  return {
    role: 'function',
    content: {
      functionCall: {
        name: 'chatCompletion',
        arguments: args,
      },
    },
  }
}

export function createChatCompletionTool(
  llmSettings: llmSettings,
  taskManager: TyTaskManager,
  taskWorkerController: TaskWorkerController,
  apiKeys: { [key: string]: string },
): InternalTool {
  const fetchChatCompletion: internalToolFunctionSchema = async (
    { model, goal, llmTools, allowedTools }: ccArguments,
    context: toolContext,
  ) => {
    console.log('calling chat completion tool...', model, goal, llmTools)
    if (!context.currentTask) {
      throw new Error(`No current task found!`)
    }
    if (!llmSettings.selectedApi) {
      throw new TaskProcessingError('No API selected!')
    }
    const chatCompletion = await processChatTask(
      goal ?? 'SimpleCompletion',
      allowedTools || [],
      context.currentTask,
      { model, chatApi: llmSettings.selectedApi },
      llmSettings,
      taskManager,
      taskWorkerController,
      apiKeys,
    )

    // chatCompletion by definition completes a chat with a message
    // so we can just return the message here...
    if (chatCompletion?.choices[0]?.message.content) {
      console.log('received chat completion!', chatCompletion)
      const newTaskChain: partialTaskDraft[] = [
        {
          role: 'assistant',
          content: {
            message: chatCompletion.choices[0].message.content,
          },
        },
        {
          role: 'assistant',
          content: {
            termination: 'assistant answer received...',
          },
        },
      ]
      return makeTaskResult([newTaskChain])
    } else {
      throw new TaskProcessingError('No content in chat completion!')
    }
  }

  const chatCompletion: InternalTool = {
    function: fetchChatCompletion,
    description: 'Generates a chat-based response using the OpenAI API for the previous message.',
    longDescription: `This tool interfaces with an OpenAI-compatible API to generate completions for
  conversation prompts. Useful for generating natural language responses in a chat setting.
  It will convert the chain pointed to by the previous Task (priorID) into openAI compatible message
  list and generate a response`,
    name: 'chatCompletion',
    renderOptions: { chatWindow: false, llm: false },
    parameters: {
      type: 'object',
      properties: {
        model: {
          type: 'string',
          description:
            'The name of the model to use for the completion. The default is "auto" if parameter is not used. A model will automatically be chosen for the task',
          default: 'auto',
        },
        goal: {
          type: 'string',
          description:
            'Optional Parameter. Goals can be: "SimpleCompletion","AnalyzeError", "ChooseTool", "AnalyzeToolResult".',
          default: 'SimpleCompletion',
        },
        llmTools: {
          type: 'boolean',
          description:
            'Optional Parameter. If set to true, we will use a openai compatible tool api',
          default: false,
        },
        allowedTools: {
          type: 'array',
          description:
            'Optional Parameter. We can specify which tools are allowed to be called by the LLM',
          items: {
            type: 'string',
          },
          default: [],
        },
      },
      required: ['model'],
    },
  }

  return chatCompletion
}

export type chatCompletionTool = ReturnType<typeof createChatCompletionTool>
