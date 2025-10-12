import type { AnySchema } from 'ajv'
import { load } from 'js-yaml'
import type { JSONSchema7 } from 'json-schema'
import type { FromSchema } from 'json-schema-to-ts'
import { isEmpty } from 'lodash'
import type OpenAI from 'openai'
import { z } from 'zod'
import type { TyTaskManager } from '../core/taskManager'
import { mapFunctionNames } from '../core/tools'
import { isTaskyonKey } from '../core/tyCrypto'
import type { ChatCompletionChunk, WebSearchOptions } from '../llm/chat'
import {
  callLLM,
  createChatCompletionRequest,
  generateHeaders,
  getOpenRouterGenerationInfo,
  getTaskyonCosts,
} from '../llm/chat'
import type { Goals } from '../llm/promptCreation'
import { addPrompts } from '../llm/promptCreation'
import type {
  apiConfig,
  ChatResponseType,
  OpenRouterGenerationInfo,
  TaskNodeMeta,
} from '../types/chatCompletion'
import { getCurrentModel } from '../types/chatCompletion'
import type { FileMapping, partialTaskDraft, TaskNode } from '../types/node'
import type { llmSettings } from '../types/profiles'
import type { toolContext } from '../types/toolApi'
import { createTool, makeTaskResult, toolCall } from '../types/toolApi'
import type { FunctionArguments, ToolBase } from '../types/tools'
import { FunctionCall } from '../types/tools'
import { charHash } from '../utils/crypto'
import { humanizeError } from '../utils/error'
import { fileToBase64 } from '../utils/fileUtils'
import { createStream } from '../utils/frpBus'
import { joinUrl } from '../utils/httpUtils'
import {
  createDeepTransformer,
  deepCopy,
  normalizeFalsyValues,
  pickProperties,
} from '../utils/objHelpers'
import type { Thunk } from '../utils/tsHelpers'
import { useNlpWorker } from '../utils/webWorkerApi'
import { safeYamlDump } from '../utils/yamlUtils'
import { sleep } from '../utils/asyncUtils'

function generateOpenAIToolDeclarations(
  allowedTools: string[],
  toolCollection: Record<string, ToolBase>,
): OpenAI.ChatCompletionTool[] {
  const tools: ToolBase[] = mapFunctionNames(allowedTools || [], toolCollection) || []
  const openAITools: OpenAI.ChatCompletionTool[] = tools.map((t) => {
    const functionDef: OpenAI.FunctionDefinition = {
      name: t.name,
      parameters: t.parameters as unknown as Record<string, unknown>,
      description: t.description,
    }
    return {
      function: functionDef,
      type: 'function',
    }
  })
  return openAITools
}

// this function processes all tasks which go to any sort of an LLM
// TODO: for configuration & allowedTools it would be good if we could add
// this from a "default" Configuration? And then have them as function parameters?
// t.configuration = finishedTask.configuration
// TODO: refactor & clean up this function ;)
export async function processChatTask(
  allowedTools: string[],
  toolDefs: Record<string, ToolBase>,
  llmTools: boolean,
  llmSettings: {
    tryUsingVisionModels: boolean
    useBasePrompt: boolean
    taskChatTemplates: Parameters<typeof addPrompts>[4]
  },
  // can we get rid of taskManager here in order to make our task more functional :)?
  taskManager: TyTaskManager,
  lastTaskBeforeChatCompletion: TaskNode | undefined,
  prompts: string[],
  goal?: Goals,
  schema?: Record<string, unknown>,
) {
  //TODO: we can create more things here like giving it context form other tasks, lookup
  //      main objective, previous tasks etc....
  //      actualy: this would be great for a new tool ;)
  // TODO: accept a thread from outside this tool... and only convert it into an openai compatible format
  let openAIConversationThread: OpenAI.Chat.Completions.ChatCompletionMessageParam[]
  if (lastTaskBeforeChatCompletion) {
    const taskChain = await taskManager.getTaskChain(lastTaskBeforeChatCompletion.id)
    openAIConversationThread = await convertTaskNodesToOpenAIChat(
      taskChain,
      taskManager.getFileMappingByUuid,
      taskManager.getOpfsUploadedFile,
      llmSettings.tryUsingVisionModels,
      llmTools,
      toolDefs,
    )
  } else {
    openAIConversationThread = []
  }

  const msgs = addPrompts(
    toolDefs,
    llmTools,
    llmTools, // we turn on/off native structured & tools ith the same setting here!
    llmSettings.useBasePrompt,
    llmSettings.taskChatTemplates,
    openAIConversationThread,
    prompts,
    allowedTools,
    lastTaskBeforeChatCompletion?.content.data,
    goal,
    schema,
  )

  openAIConversationThread = [
    ...msgs.prependMessages,
    ...msgs.modifiedOpenAIConversationThread,
    ...msgs.appendMessages,
  ]

  if (openAIConversationThread.length <= 0) {
    throw new Error('We were not able to convert our tasks into an AI-compatible format!')
  }

  let tools: OpenAI.ChatCompletionTool[] = []
  if (llmTools) {
    tools = generateOpenAIToolDeclarations(allowedTools || [], toolDefs)
  }

  return { openAIConversationThread, tools, msgs: msgs ?? {} }
}

async function llmRequest(
  openAIConversationThread: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  tools: OpenAI.ChatCompletionTool[],
  selectedModel: string,
  stopSignal: AbortSignal,
  api: apiConfig,
  apiKey: string,
  streamTracker: (chunk: ChatCompletionChunk | undefined) => void,
  schema?: Record<string, unknown>,
  siteUrl?: string,
  webSearch?: WebSearchOptions,
) {
  const streamTask = true
  const request = await createChatCompletionRequest(
    apiKey,
    { ...api, selectedModel, endpoint: joinUrl(api.baseURL, api.routes.chatCompletion) },
    openAIConversationThread,
    schema,
    streamTask, // for now, we always want to stream our task...
    tools,
    webSearch,
    siteUrl,
  )
  const chatCompletion = await callLLM(
    request,
    streamTask,
    streamTracker, // track incoming streams...
    stopSignal,
    // we are using a pretty big timeout, bceause apparentl chat API from openAI needs thiw right now..
    request.timeout, // Timeout in milliseconds for waiting for first streamed response
    3, // Maximum number of retry attempts
  )

  return chatCompletion
}

// Ensures that every assistant.tool_calls is paired with a role:"tool" message.
function ensureToolResponses(messages: OpenAI.ChatCompletionMessageParam[]) {
  // 1) Pre‑scan all tool responses
  const responded = new Set<string>()
  for (const m of messages) {
    if (m.role === 'tool' && 'tool_call_id' in m) {
      responded.add(m.tool_call_id)
    }
  }

  // 2) Rebuild, injecting only the missing ones
  const result: OpenAI.ChatCompletionMessageParam[] = []
  for (const msg of messages) {
    result.push(msg)

    if (msg.role === 'assistant' && Array.isArray(msg.tool_calls)) {
      for (const call of msg.tool_calls) {
        if (!responded.has(call.id)) {
          result.push({
            role: 'tool',
            tool_call_id: call.id,
            content: '',
          })
          responded.add(call.id)
        }
      }
    }
  }

  return result
}

// we use this function here in other spots as well...
export async function convertTaskNodesToOpenAIChat(
  taskChain: TaskNode[],
  getFileMapping: (uuid: string) => Promise<FileMapping | null>,
  getUploadedFile: (uuid: string) => Promise<File | undefined>,
  tryUsingVisionModels: boolean,
  enableOpenAiTools: boolean,
  toolDefs: Record<string, ToolBase>,
) {
  const messages = (
    await Promise.all(
      taskChain.map((task) =>
        convertTaskNodeToOpenAIMessage(
          task,
          tryUsingVisionModels,
          getFileMapping,
          getUploadedFile,
          enableOpenAiTools,
          toolDefs,
        ),
      ),
    )
  )
    .flat()
    .filter<OpenAI.ChatCompletionMessageParam>((message) => message != undefined)

  // Inject any missing tool response messages (this happens, if our tools create a recursive task chain)
  return ensureToolResponses(messages)
}

async function addTaskCostInformation(
  chatResponse: ChatResponseType | undefined,
  taskId: string,
  selectedApi: string | null,
  siteUrl: string,
  apiKey: string,
  anonymousTaskyonKey: string,
  api: apiConfig | undefined,
): Promise<TaskNodeMeta> {
  let generationInfo: OpenRouterGenerationInfo | undefined
  // TODO: it might be a good idea to simply replace this with a tasknode ;)
  if (chatResponse && selectedApi === 'openrouter.ai') {
    console.log('getting openrouter generation info')
    await sleep(10000)
    generationInfo = await getOpenRouterGenerationInfo(
      chatResponse.id,
      generateHeaders(apiKey, selectedApi || '', siteUrl),
    )
  } else if (
    chatResponse &&
    selectedApi === 'taskyon' &&
    !chatResponse.model.endsWith(':free') &&
    !isTaskyonKey(apiKey, false) &&
    api
  ) {
    console.log('getting taskyon generation info')
    // our backend tries to get the finished costs
    // after ~4000ms, so we wait for 6000 here...
    await sleep(6000)
    generationInfo = await getTaskyonCosts(
      siteUrl,
      anonymousTaskyonKey,
      apiKey,
      api,
      chatResponse.id,
      taskId,
    )
    console.log('taskyon generation info:', generationInfo)
  }
  if (generationInfo?.native_tokens_completion && generationInfo.native_tokens_prompt) {
    // we get the useage data very often in an asynchronous form.
    // thats why we need to
    // openai sends back the exact number of prompt tokens :)
    return {
      promptTokens: generationInfo.native_tokens_prompt,
      resultTokens: generationInfo.native_tokens_completion,
      taskCosts: generationInfo.usage,
      taskTokens: generationInfo.native_tokens_prompt + generationInfo.native_tokens_completion,
    }
  }
  return {}
}

// get worker function for our chat :)
const { estimateChatTokens } = useNlpWorker()

async function saveTokenUsage(
  chatResponse: ChatResponseType,
  openAIConversationThread: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  toolDefs: Record<string, ToolBase>,
  content: TaskNode['content'],
  allowedTools: string[] | undefined,
): Promise<TaskNodeMeta> {
  let costInfo: TaskNodeMeta = {}
  if (chatResponse.usage) {
    costInfo = {
      promptTokens: chatResponse.usage.prompt_tokens,
      resultTokens: chatResponse.usage.completion_tokens,
      taskTokens: chatResponse.usage.total_tokens,
    }
  }
  // doing deepcopy here, because we're communicating to a worker
  // and need to make sure to dereference values (e.g. if they're vue reactive objects)
  costInfo.estimatedTokens = await estimateChatTokens(
    deepCopy(content),
    openAIConversationThread,
    toolDefs,
    deepCopy(allowedTools) || [],
    chatResponse.choices[0]!.message.content ?? '',
  )
  return costInfo
}

function parseYamlResponse2Record(message: string): Record<string, unknown> {
  // parse the response and create a new task filled with the correct parameters
  let yamlContent = message.trim()
  // Use exec() to find a match
  const yamlBlockRegex = /```(?:yaml|YAML|[^\n]*)\n?([\s\S]*?)\n?```/
  const yamlMatch = yamlBlockRegex.exec(yamlContent)
  if (yamlMatch && yamlMatch[1]) {
    yamlContent = yamlMatch[1] // Use the captured group
  }

  // TODO: if we haven't found anything,  search for anything that looks like yaml!!
  let parsedYaml: unknown = undefined
  try {
    // Parse the extracted or original YAML content
    parsedYaml = load(yamlContent)
  } catch (err) {
    const errmsg = err instanceof Error ? err.message : JSON.stringify(err)
    throw new Error(
      `Not able to convert the response to yaml:

We got:

${message}

and the Error:

${errmsg}
`,
      {
        cause: {
          yamlString: yamlContent,
          error: err,
        },
      },
    )
  }
  return parsedYaml as Record<string, unknown>
}

const robustKeys = createDeepTransformer({
  keyFn: (key) => {
    return String(key)
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
  },
})

// we use this to decide whether we should call a function or to continue
// this is usually not needed if we use llmTools (like built-in tools from openai API)
// TODO: ability to parse multiple commands/tasks...
function getCommandFromStructuredResponse(choice: ChatResponseType['choices'][0]): FunctionCall[] {
  // all of the following is done in order to make this as robust as possible
  // thats also why we don't just simply use zod validation on this.
  const structResponse = parseYamlResponse2Record(choice.message.content || '')
  const structResponseN = normalizeFalsyValues()(structResponse)
  const lowerStruct = robustKeys(structResponseN) as Record<string, string | boolean>

  // primary “call?” signal
  const hasUseToolKey = 'usetool' in lowerStruct
  const useTool = !!lowerStruct['usetool']

  // if no useTool is present fallback
  // const hasDWHTKey = 'dowehavetouseatool' in lowerStruct
  const dwht = !!lowerStruct['dowehavetouseatool']
  const whichToolKey = lowerStruct['whichtool']

  const tryAgain = !!lowerStruct['tryagain']

  // attempt parse of a FunctionCall
  let parsed = FunctionCall.safeParse(structResponse.command)
  if (!parsed.success) {
    parsed = FunctionCall.safeParse(lowerStruct.command)
  }

  // 3. only proceed if we really want to call a tool
  if (
    (!hasUseToolKey && dwht && parsed.success && parsed.data.name === whichToolKey) ||
    useTool ||
    (tryAgain && useTool) ||
    (dwht && tryAgain) ||
    (dwht && useTool)
  ) {
    if (parsed.success) {
      const command = parsed.data
      return [command]
    }
    throw new Error(`The response (${JSON.stringify(pickProperties(structResponse, ['use tool', 'try again']))})
suggests we should use a tool, but we could not parse the ${JSON.stringify(structResponse.command)}
property correctly.`)
  }
  return []
}

/**
 * This function takes a task and generates follow up tasks automatically
 * based on content of the result!.
 * it also checks whether we should immediatly execute them or not...
 * basically we need to decide here what kind of a follow up task we are going to do
 *
 * @param finishedTask
 * @param llmSettings
 * @param taskManager
 * @returns
 *
 * following different types of task contents are possible:
 *
 *
 *
 *
 * here is a chart of the relations & possible transitions between tasks:
 *
 * - [Transition Map](/docs/conversations/taskyon_description)
 *
 *
 */
// TODO: make this function a lot mor eexplicit in that it represents our task transition map
// TODO: get rid of taskManager, if thats possible! :) I don#t see why we would need taskmanager in order to create
//       follow-up tasks?
// we return 2D list of tasks here..   each list represents a chain of linked tasks through priorID
// TODO:  move all of this function into its own Tool as well! this would be our "planner" tool/function :)
//        this tool would analyze the results of the previous function and create new tasks!
function generateFollowUpTasksFromResult(
  goal: Goals,
  choice: ChatResponseType['choices'][0],
  allowedTools: string[] | undefined,
  chatModel: string,
  llmTools: boolean,
  allTools: Record<string, ToolBase>,
  prompts: string[] | undefined,
): partialTaskDraft[] {
  console.log('generate follow up task')

  let newTasks: partialTaskDraft[] = []
  // TODO: what do we do in case of an empty user message, but only a file?
  //       right now, we assume, that user message always comes after uploaded file message :)

  // check if we have any functioncalls from the llm inference
  // in that case we shoud handle that first :)
  const functionCall = extractOpenAIFunctions(choice, allTools)
  if (functionCall[0]) {
    // TODO: enable multiple parallel function calls
    newTasks = [
      // this functionCall will be executed in the next step, so we don't need any additional tasks here
      {
        role: 'function',
        content: { type: 'functioncall', data: functionCall[0] },
      },
    ]
  } else if (goal === 'SimpleCompletion' || goal === 'WebSearch' || llmTools) {
    // if we don't need to call a tool, we simply generate a normal message...
    // the same is true, if we have enabled native llmTools. In this case
    // we either got a function back already (functionCall[0]) or we
    // got a message back :)
    newTasks = [
      {
        role: 'assistant',
        content: {
          type: 'message',
          data: choice.message.content || '',
          ...(choice.annotations ? { ann: choice.annotations } : {}),
        },
      },
      {
        role: 'system',
        content: { type: 'return', data: 'assistant answered' },
      },
    ]
    console.log('No more follow up tasks!')
  } else if (goal === 'AnalyzeToolResult' || goal === 'ChooseTool' || goal === 'AnalyzeError') {
    const commands = getCommandFromStructuredResponse(choice)
    if (commands.length > 0) {
      const command = commands[0]!
      if (!allowedTools?.includes(command.name)) {
        throw new Error(`Tool '${command.name}' is not in the list of allowed tools`, {
          cause: { allowedTools, requestedTool: command.name },
        })
      }
    }
    newTasks = [
      {
        role: 'assistant',
        content: { type: 'structured', data: choice.message.content || '' },
      },
    ]
    if (commands.length > 0) {
      console.log('Define tool call')
      newTasks.push({
        role: 'function',
        content: { type: 'functioncall', data: commands[0]! },
      })
    } else {
      console.log('no more tools to call, finalize the result :)')
      newTasks.push(
        toolCall<chatCompletionParams>({
          name: 'chatCompletion',
          arguments: {
            prompts: prompts || [],
            model: chatModel,
            goal: 'SimpleCompletion',
          },
        }),
      )
    }
  } else {
    // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
    throw new Error(`chatCompletion goal unknown: ${goal}`)
  }
  return newTasks
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
    let fargs: FunctionArguments = {}
    if (!('function' in toolCall))
      throw new Error("toolCall doesn't contain a function", { cause: toolCall })
    try {
      fargs = JSON.parse(toolCall.function.arguments)
    } catch (error) {
      console.warn('Failed to parse arguments as JSON:', error)
      if (choice.finish_reason === 'cancelled') fargs = { cancelled: toolCall.function.arguments }
      else
        throw new Error(
          `We cold not parse the function arguments as json:

${toolCall.function.arguments}`,
        )
    }
    const functionCallObj: FunctionCall = {
      name: toolCall.function.name,
      arguments: fargs,
    }
    const functionCall = FunctionCall.parse(functionCallObj)
    if (tools[functionCall.name]) {
      functionCalls.push(functionCall)
    }
  }
  return functionCalls
}

// sometimes a single task can get convserted to multiple messages
// and sometime we don't need it at all in the chat :)
async function convertTaskNodeToOpenAIMessage(
  task: TaskNode,
  useVisionModels: boolean,
  getFileMapping: (uuid: string) => Promise<FileMapping | null>,
  getUploadedFile: (uuid: string) => Promise<File | undefined>,
  useOpenAITools: boolean,
  toolCollection: Record<string, ToolBase>,
  maxToolIdLength = 9, // the max length here is influenced by the Mistral model, which can only use 9 characters for tool ids
): Promise<OpenAI.Chat.Completions.ChatCompletionMessageParam[] | undefined> {
  if (task.content.type === 'functioncall') {
    const functionCallName = task.content.data.name
    if (toolCollection[functionCallName]?.renderOptions?.hideLlm) {
      return
    }
    if (useOpenAITools) {
      const functionMessage: OpenAI.ChatCompletionMessageParam = {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: await charHash(task.id, maxToolIdLength),
            type: 'function',
            function: {
              name: task.content.data.name,
              arguments: JSON.stringify(task.content.data.arguments),
            },
          },
        ],
      }
      return [functionMessage]
    } else {
      // the purpose of this is to inform the AI about what function was called and
      // the arguments in it.
      return [
        {
          role: 'system',
          // and the result of the function
          content:
            `The following tool was used: ${functionCallName}.` +
            (!isEmpty(task.content.data.arguments)
              ? ` The function arguments were: ${JSON.stringify(task.content.data.arguments)}`
              : ''),
        },
      ]
    }
  } else if (task.content.type === 'toolresult') {
    if (task.parentID && useOpenAITools) {
      const message: OpenAI.ChatCompletionMessageParam = {
        role: 'tool',
        tool_call_id: await charHash(task.parentID, maxToolIdLength), // the tool call will get the parent ID as well! :)
        content: safeYamlDump(task.content.data),
      }
      return [message]
    } else
      return [
        {
          role: 'system',
          content: safeYamlDump({
            'The tool that you called returned the following result:': task.content.data,
          }),
        },
      ]
  } else if (task.content.type === 'message' && task.role != 'function') {
    const message: OpenAI.ChatCompletionMessageParam = {
      // TODO: we need to dynamically generate task roles here!! and move it into the task type,  if its a message!
      role: task.role,
      content: task.content.data,
    }
    return [message]
  } else if (task.content.type === 'error') {
    const message: OpenAI.ChatCompletionMessageParam = {
      // TODO: we need to dynamically generate task roles here!! and move it into the task type,  if its a message!
      role: 'system',
      content: humanizeError(task.content.data),
    }
    return [message]
  } else if (task.content.type === 'files') {
    const fileMappings = await Promise.all(task.content.data.map((uuid) => getFileMapping(uuid)))
    const fileNames = fileMappings
      .map((fm) => '- ' + (fm?.opfs || fm?.name || 'unknown'))
      .join('\n')
    const message: OpenAI.ChatCompletionMessageParam = {
      role: 'system',
      content: `user uploaded files to opfs:\n${fileNames}`,
    }

    if (useVisionModels) {
      // build data strings for all of our images in order to send them to vision...
      const imageContent: OpenAI.ChatCompletionUserMessageParam['content'] =
        await convertFilesToOpenAIImageContent(fileMappings, getUploadedFile)

      const imageMessage: OpenAI.ChatCompletionMessageParam = {
        role: 'user',
        content: imageContent,
      }
      return [message, imageMessage]
    }
    return [message]
  }
}

async function convertFilesToOpenAIImageContent(
  fileMappings: (FileMapping | null)[],
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

export const chatCompletionToolName = 'chatCompletion'

export async function createChatCompletionTool(
  llmSettings: Thunk<llmSettings>,
  taskManager: TyTaskManager,
) {
  const Ajv = await import(
    /* webpackPrefetch: true */
    /* webpackChunkName: "codemirror" */
    /* webpackMode: "lazy" */
    /* webpackFetchPriority: "low" */
    'ajv'
  )
  const ajv = new Ajv.default() // options can be passed, e.g. {allErrors: true}

  const chatCompletionStream = createStream<{
    taskId: string
    chunk: ChatCompletionChunk | undefined
  }>()

  const chatCompletion = createTool({
    description: 'Generates a chat-based response using the OpenAI API for the previous message.',
    longDescription: `This tool interfaces with an OpenAI-compatible API to generate completions for
  conversation prompts. Useful for generating natural language responses in a chat setting.
  It will convert the chain pointed to by the previous Task (priorID) into openAI compatible message
  list and generate a response`,
    name: chatCompletionToolName,
    renderOptions: { hideChat: true, hideLlm: true },
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        model: {
          type: 'string',
          description:
            'The name of the model to use for the completion. Optional, will choose default model if not provided',
        },
        goal: {
          enum: [
            'SimpleCompletion',
            'AnalyzeError',
            'ChooseTool',
            'AnalyzeToolResult',
            'WebSearch',
          ],
          description:
            'Optional Parameter to define the goal of the chat completion. If not set, the goal is dynamically inferred from the input.',
        },
        llmTools: {
          type: 'boolean',
          description:
            'Optional Parameter. If set to true, we will use a openai compatible tool api. If undefined, it will be treated as false.',
        },
        allowedTools: {
          type: 'array',
          description:
            'Optional Parameter. We can specify which tools are allowed to be called by the LLM',
          items: {
            type: 'string',
          },
        },
        prompts: {
          type: 'array',
          description:
            "Optional Parameter. We can add a custom prompt to the chatCompletion which doesn't get recorded as a task and therefore disappears during message thread conversion.",
          items: {
            type: 'string',
          },
        },
        schema: {
          type: 'object',
          description:
            'A json schema object which we can use to generate a specific response and parse it.',
          additionalProperties: true,
        },
      },
    } as const satisfies JSONSchema7,
    function: async (
      { model, goal, llmTools, allowedTools, prompts, schema },
      context: toolContext,
    ) => {
      //////////   INITIALIZATION
      const tools = allowedTools ?? []
      const {
        useBasePrompt,
        selectedApi,
        llmApis,
        enableOpenAiTools,
        taskChatTemplates,
        tryUsingVisionModels,
        siteUrl,
      } = llmSettings()
      if (!selectedApi) {
        throw new Error('No API selected!')
      }
      const api = llmApis[selectedApi]
      if (!api) {
        throw new Error(`api doesn't exist! ${selectedApi || 'no api selected!'}`)
      }

      // maybe ask for the llm api secrets in the future?
      const apiKey = await context.getSecret(selectedApi, false, false)
      if (!apiKey || typeof apiKey !== 'string')
        throw new Error('We need to define an API key to process our chat Task!')

      const usellmTools = llmTools ?? enableOpenAiTools
      const selectedModel = model ?? getCurrentModel(api)
      console.log('calling chat completion tool...', selectedModel, goal, llmTools)
      // the current task doesn't *have* to exist. We can also works solely with prompts...
      const currentTask = context.taskChain.at(-1)

      const toolDefs = await taskManager.updateToolDefinitions(true)

      //////////// END INITIALIZATION

      // refactor this below and make it all explicit, without passing llmSettings...
      // now add goal-specific prompts...
      const lastTaskBeforeChatCompletion = context.taskChain.at(-2)
      // in case there was an error, we want to make sure, that we allow using the same tool(s)
      // that were in use when the error was created...
      const lastTaskBeforeError = context.taskChain.at(-3)
      let allowedToolsFromError: string[] = []
      if (goal === 'AnalyzeError' && lastTaskBeforeError?.content.type === 'functioncall') {
        if (lastTaskBeforeError.content.data.name === 'chatCompletion') {
          // Check if allowedTools is an array of strings using zod
          const AllowedToolsSchema = z.array(z.string())
          const res = AllowedToolsSchema.safeParse(
            lastTaskBeforeError.content.data.arguments.allowedTools,
          )
          if (res.success) allowedToolsFromError = res.data
        } else {
          // otherwise we might want to repeat the actual tool call with different parameters!
          allowedToolsFromError = [lastTaskBeforeError.content.data.name]
        }
      }

      // TODO: can we get rid of taskManager here in order to make our task more functional :)?
      const chatInfo = await processChatTask(
        [...tools, ...allowedToolsFromError],
        toolDefs,
        usellmTools,
        {
          taskChatTemplates: taskChatTemplates,
          tryUsingVisionModels: tryUsingVisionModels,
          useBasePrompt: useBasePrompt,
        },
        taskManager,
        lastTaskBeforeChatCompletion,
        prompts ?? [],
        goal,
        schema,
      )

      const chatCompletion = await llmRequest(
        chatInfo.openAIConversationThread,
        chatInfo.tools,
        selectedModel,
        context.stopSignal,
        api,
        apiKey,
        (chunk) => {
          chatCompletionStream.emit({ taskId: currentTask?.id ?? 'N/A', chunk })
        },
        schema,
        siteUrl,
        goal === 'WebSearch'
          ? {
              maxResults: 5,
              searchContextSize: 'medium',
            }
          : undefined,
      )

      // parse the response into our own type ...
      const choice = chatCompletion?.choices[0]

      // get token usage for this task..
      if (currentTask && lastTaskBeforeChatCompletion) {
        let metaInfo: TaskNodeMeta = {
          taskPrompt: chatInfo,
          rawOutput: chatCompletion,
        }
        if (chatCompletion) {
          console.log('save token usage...')
          // openai & openrouter  sends back the exact number of prompt tokens :)
          metaInfo = {
            ...metaInfo,
            ...(await saveTokenUsage(
              chatCompletion,
              chatInfo.openAIConversationThread,
              toolDefs,
              lastTaskBeforeChatCompletion?.content,
              allowedTools,
            )),
          }
          // we run this asynchronously, because it fetches data in the
          // background and we don't want to wait here...

          // TODO: remove "configuration" here and get the information from the tasks function call parameters
          //       this would require us to have "defaultsettings" implemented...
          if (api)
            void addTaskCostInformation(
              chatCompletion,
              currentTask?.id,
              selectedApi,
              siteUrl,
              apiKey,
              llmApis['taskyon']?.defaultHeaders?.apiKey ?? '',
              api,
            ).then((newMeta) => {
              console.log('found new task costs:', newMeta)
              void taskManager.metaUpsert(currentTask.id, newMeta, 'shallow_merge')
            })
        }

        metaInfo.rawOutput = { choice }
        void taskManager.metaUpsert(currentTask.id, metaInfo, 'shallow_merge')
      }

      if (!choice)
        throw new Error('The AI gave us an incomplete response!', {
          cause: chatCompletion,
        })

      // in case a schema was given, we simply use that schema and return it as a structured message
      // for further processing (e.g. a contextFunction)...
      if (schema) {
        console.log('parsing custom schema', schema)
        const structResponse = parseYamlResponse2Record(choice.message.content || '')

        if (typeof schema === 'object' && schema !== null) {
          // I *think* we can simply cast our schema here t ajv, because it
          // will spit out an error anyways if our schema isn't compatible..
          const validate = ajv.compile(schema as unknown as AnySchema)
          const valid = validate(structResponse)
          if (!valid) {
            throw new Error(
              'Chat response has the wrong format: ' + ajv.errorsText(validate.errors),
            )
          }
        } else {
          throw new Error('Schema needs to be an object!', { cause: schema })
        }

        return makeTaskResult([
          [
            {
              role: 'assistant',
              content: { type: 'structured', data: structResponse },
            },
          ],
        ])
      }

      const newTaskChain = generateFollowUpTasksFromResult(
        goal || 'SimpleCompletion',
        choice,
        allowedTools,
        selectedModel,
        usellmTools,
        toolDefs,
        prompts,
      )

      return makeTaskResult([newTaskChain])
    },
  })

  return { chatCompletion, stream: chatCompletionStream.stream }
}

export type chatCompletionParams = FromSchema<
  Awaited<ReturnType<typeof createChatCompletionTool>>['chatCompletion']['parameters']
>

export type ChatCompletionArgs = Omit<chatCompletionParams, 'schema'> & {
  schema?: JSONSchema7 & Record<string, unknown>
}
