import type OpenAI from 'openai'
import {
  callLLM,
  enrichWithUsageInfos,
  generateHeaders,
  getOpenRouterGenerationInfo,
  getTaskyonCosts,
} from '../taskyon/chat'
import { generateCompleteChat, generateOpenAIToolDeclarations } from '../taskyon/promptCreation'
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
import { deepCopy, sleep } from '../utils'
import { isTaskyonKey } from '../taskyon/tyCrypto'
import { useNlpWorker } from '../taskyon/webWorkerApi'

// this function processes all tasks which go to any sort of an LLM

// TODO: for configuration & allowedTools it would be good if we could add
// this from a "default" Configuration? And then have them as function parameters?
// t.configuration = finishedTask.configuration

export type Goals = 'SimpleCompletion' | 'AnalyzeError' | 'ChooseTool' | 'AnalyzeToolResult'

// TODO: refactor & clean up this function ;)
export async function processChatTask(
  goal: Goals,
  allowedTools: string[],
  task: TaskNode,
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
    console.log('execute chat completion tool with prompt:', task)
    //TODO: also do this, if we start the task "autonomously" in which we basically
    //      allow it to create new tasks...
    //TODO: we can create more things here like giving it context form other tasks, lookup
    //      main objective, previous tasks etc....
    // TODO: accept a thread from outside this tool... and only convert it into an openai compatible format
    const { openAIConversationThread, toolDefs } = await generateCompleteChat(
      goal,
      task,
      llmSettings,
      taskManager,
    )
    let tools: OpenAI.ChatCompletionTool[] = []
    if (llmSettings.enableOpenAiTools) {
      tools = generateOpenAIToolDeclarations(task, toolDefs)
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
              task.debugging.toolStreamArgsContent = task.debugging.toolStreamArgsContent || {}
              if (t.function?.name) {
                task.debugging.toolStreamArgsContent[t.function.name] =
                  (task.debugging.toolStreamArgsContent[t.function.name] || '') +
                  (t.function?.arguments || '')
              }
            })
          }
          if (chunk?.choices[0]?.delta?.content) {
            task.debugging.streamContent =
              (task.debugging.streamContent || '') + chunk.choices[0].delta.content
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
    const { openAIConversationThread } = await generateCompleteChat(
      goal,
      task,
      llmSettings,
      taskManager,
    )

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

export function createChatCompletionTool(
  llmSettings: llmSettings,
  taskManager: TyTaskManager,
  taskWorkerController: TaskWorkerController,
  apiKeys: { [key: string]: string },
): InternalTool {
  const fetchChatCompletion: internalToolFunctionSchema = async (
    {
      model,
      goal,
      llmTools,
      allowedTools,
    }: { model: string; goal: Goals; llmTools: true; allowedTools: string[] },
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
      goal,
      allowedTools,
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
    description: 'Generates a chat-based response using the OpenAI API.',
    longDescription: `This tool interfaces with an OpenAI-compatible API to generate completions for
  conversation prompts. Useful for generating natural language responses in a chat setting.`,
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
