import type OpenAI from 'openai'
import {
  callLLM,
  generateHeaders,
  getOpenRouterGenerationInfo,
  getTaskyonCosts,
} from '../taskyon/chat'
import {
  addPrompts,
  generateOpenAIToolDeclarations,
  yesnoToBoolean,
} from '../taskyon/promptCreation'
import type { TyTaskManager } from '../taskyon/taskManager'
import { type TaskWorkerController } from '../taskyon/taskWorker'
import type {
  partialTaskDraft,
  ToolBase,
  TaskNode,
  TaskNodeMeta,
  OpenRouterGenerationInfo,
} from '../taskyon/types'
import { FunctionCall } from '../taskyon/types'
import { ChatResponseType, getApiConfigCopy } from '../taskyon/types'
import { TaskProcessingError, type llmSettings } from '../taskyon/types'
import {
  makeTaskResult,
  type InternalTool,
  type internalToolFunctionSchema,
  type toolContext,
} from '../taskyon/tools'
import {
  deepCopy,
  fileToBase64,
  keysToLowerCase,
  normalizeFalsyValues,
  pickProperties,
  sleep,
} from '../utils'
import { isTaskyonKey } from '../taskyon/tyCrypto'
import { useNlpWorker } from '../taskyon/webWorkerApi'
import type { FileMappingDocType } from '../taskyon/rxdb'
import { dump, load } from 'js-yaml'

// this function processes all tasks which go to any sort of an LLM

// TODO: for configuration & allowedTools it would be good if we could add
// this from a "default" Configuration? And then have them as function parameters?
// t.configuration = finishedTask.configuration

export type Goals = 'SimpleCompletion' | 'AnalyzeError' | 'ChooseTool' | 'AnalyzeToolResult'

// TODO: refactor & clean up this function ;)
export async function processChatTask(
  goal: Goals,
  allowedTools: string[],
  toolDefs: Record<string, ToolBase>,
  currentTask: TaskNode,
  configuration: { model: string; chatApi: string },
  llmSettings: llmSettings,
  // can we get rid of taskManager here in order to make our task more functional :)?
  taskManager: TyTaskManager,
  taskWorkerController: TaskWorkerController,
  apiKeys: { [key: string]: string },
  lastTaskBeforeChatCompletion: TaskNode,
  streamTracker: (chunk: OpenAI.Chat.Completions.ChatCompletionChunk | undefined) => void,
) {
  //TODO: this code is duplicated, can we do this better?
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
    // TODO: this seems to be a little funny, why are we doing this? ^^
    api.selectedModel = selectedModel
    console.log('execute chat completion tool with prompt:', currentTask)
    //TODO: we can create more things here like giving it context form other tasks, lookup
    //      main objective, previous tasks etc....
    // TODO: accept a thread from outside this tool... and only convert it into an openai compatible format
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

    // TODO: save our "openAIConversationThread" inside debugdb for debuggin

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
        streamTracker, // track incoming streams...
        () => {
          return taskWorkerController.isInterrupted()
        },
      )

      return { chatCompletion: chatCompletion, openAIConversationThread }
    } else {
      throw new TaskProcessingError('The generated chat for chatCompletion is empty!')
    }
  } else {
    throw new TaskProcessingError('Task has no inference model selected!')
  }
}

async function addTaskCostInformation(
  chatResponse: ChatResponseType | undefined,
  taskId: string,
  llmSettings: llmSettings,
  apiKeys: { [key: string]: string },
): Promise<TaskNodeMeta> {
  let generationInfo: OpenRouterGenerationInfo | undefined
  const apiKey = llmSettings.selectedApi ? apiKeys[llmSettings.selectedApi] : undefined

  // TODO: it might be a good idea to simply replace this with a tasknode ;)
  if (chatResponse && llmSettings.selectedApi === 'openrouter.ai' && apiKey) {
    console.log('getting openrouter generation info')
    await sleep(10000)
    generationInfo = await getOpenRouterGenerationInfo(
      chatResponse.id,
      generateHeaders(apiKey, llmSettings.siteUrl, llmSettings.selectedApi || ''),
    )
  } else if (
    chatResponse &&
    llmSettings.selectedApi === 'taskyon' &&
    !chatResponse.model.endsWith(':free') &&
    apiKey &&
    !isTaskyonKey(apiKey, false)
  ) {
    // TODO: remove "configuration" here and get the information from the tasks function call parameters
    const api = getApiConfigCopy(llmSettings, llmSettings.selectedApi)
    if (api) {
      console.log('getting taskyon generation info')
      // our backend tries to get the finished costs
      // after ~4000ms, so we wait for 6000 here...
      await sleep(6000)
      generationInfo = await getTaskyonCosts(llmSettings, apiKey, api, chatResponse.id, taskId)
      console.log('taskyon generation info:', generationInfo)
    }
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
  llmSettings: llmSettings,
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
    deepCopy(llmSettings.allowedTools) || [],
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
    parsedYaml = normalizeFalsyValues(parsedYaml)
  } catch (err) {
    throw new TaskProcessingError('Error converting the response to yaml', {
      yamlString: yamlContent,
      error: err instanceof Error ? err.message : JSON.stringify(err),
    })
  }
  /* TODO: this is currently too difficult for LLMs, so we are doing this manually
  which is a lot more robust. We try to keep structured responses as simple as possible
  const structuredResponseResult =
    await StructuredResponse.safeParseAsync(parsedYaml);

  if (!structuredResponseResult.success) {
    // TODO: as our object is completly partial, this never gets caled
    // right now..  do we `need` to have any checks here?
    throw new TaskProcessingError(
      'ZOD parse error: Unknown response object type:',
      structuredResponseResult.error.format(),
    );
  }*/
  if (parsedYaml !== null && typeof parsedYaml === 'object' && !Array.isArray(parsedYaml))
    return parsedYaml as Record<string, unknown>
  throw new TaskProcessingError('Parse Error:  the structured response must have keys and values!')
}

// we use this to decide whether we should call a function or to continue
// this is usually not needed if we use llmTools (like built-in tools from openai API)
// TODO: ability to parse multiple commands/tasks...
function getCommandFromStructuredResponse(choice: ChatResponseType['choices'][0]): FunctionCall[] {
  const structResponse = parseYamlResponse2Record(choice.message.content || '')
  // depending on what role and tasktype the finishedTask has, we
  // expect different results from our structuredResponse
  // TODO: we need to do some plausibilitychecks here:
  //       - e.g. if use tool=true, but no command present
  // actually, it would be better to do this in the structreReponse processing ? :)

  // we immediatly generate a follow up response here based on the structResponse. This avoids
  // having to process it in another loop as we know the result already anyways.
  // the "structuredMessage" type is mainly there so that the LLM can see what it said :).
  // e.g. in case there is an error...
  // In fact we always decide right here, what we do *after* the structured response and simply add the
  // structured response as a normal "message" task to the chain...
  // this way we can put all the parsing logic & interpretation and all of this here. While
  // our tasks only have to process the actual data they are receiving
  const lowerStructResponse = keysToLowerCase(structResponse)
  const useTool =
    yesnoToBoolean(lowerStructResponse['use tool']) &&
    (!('try again' in lowerStructResponse) || yesnoToBoolean(lowerStructResponse['try again']))

  if (useTool) {
    let res = FunctionCall.safeParse(structResponse.command)
    if (res.error) {
      // try one more time using all lower case
      res = FunctionCall.safeParse(lowerStructResponse.command)
    }
    if (res.success) {
      const command = res.data
      return [command]
    }
    throw new TaskProcessingError(`The response (${JSON.stringify(pickProperties(structResponse, ['use tool', 'try again']))})
 suggests we should use a tool, but we could not parse the ${JSON.stringify(structResponse.command)} property.`)
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
 * @param taskWorkerController
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
  chatModel: string,
  llmTools: boolean,
  allTools: Record<string, ToolBase>,
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
  } else if (goal === 'SimpleCompletion' || llmTools) {
    // if we don't need to call a tool, we simply generate a normal message...
    // the same is true, if we have enabled native llmTools. In this case
    // we either got a function back already (functionCall[0]) or we
    // got a message back :)
    newTasks = [
      {
        role: 'assistant',
        content: { type: 'message', data: choice.message.content || '' },
      },
      {
        role: 'system',
        content: { type: 'return', data: 'assistant answered' },
      },
    ]
    console.log('No more follow up tasks!')
  } else if (goal === 'AnalyzeToolResult' || goal === 'ChooseTool' || goal === 'AnalyzeError') {
    // TODO: move the followup ask generation into a separate task/function! :)
    const commands = getCommandFromStructuredResponse(choice)
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
        createChatCompletionTask({
          model: chatModel,
          goal: 'SimpleCompletion',
        }),
      )
    }
  } else {
    // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
    throw new TaskProcessingError(`chatCompletion goal unknown: ${goal}`)
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
            id: task.id,
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
      // TODO: its probably a good idea to make this shorter in cas we have very long argumets...
      // TODO: not sure, if this is a good idea with OpenAI Functions, bcause openai seems to already have
      //       an idea about the functions which were provided with their descriptions,
      //       anyways So we should probably leave this out here...

      const functionArgs = dump({
        arguments: task.content.data.arguments,
        //...t.result?,
      })
      return [
        {
          role: 'system',
          // and the result of the function
          content: `You just used the following tool: ${functionCallName}. The parameters used were: ${functionArgs}`,
        },
      ]
    }
  } else if (task.content.type === 'toolresult') {
    // we can still slightly change the content of this message to make clear
    // TODO: instead of using a manual "result of the tool" use the description in the type!
    // maybe refer to the actual tool call here?
    if (task.priorID && useOpenAITools) {
      const message: OpenAI.ChatCompletionMessageParam = {
        role: 'tool',
        tool_call_id: task.priorID, // the tool call will get the parent ID as well! :)
        content: dump(task.content.data),
      }
      return [message]
    } else
      return [
        {
          role: 'system',
          content: dump({
            'The tool that you called returned the following result:': task.content.data,
          }),
        },
      ]
  } else if (task.content.type === 'message' && task.role != 'function') {
    const message: OpenAI.ChatCompletionMessageParam = {
      role: task.role,
      content: task.content.data,
    }
    return [message]
  } else if (task.content.type === 'files' && task.role != 'function') {
    const fileMappings = await Promise.all(task.content.data.map((uuid) => getFileMapping(uuid)))
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
      type: 'functioncall',
      data: {
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
  // we can provide a callback which gets call whenever our chatCompletion updates stream of some sort...
  streamCallback: (
    id: string,
    chunk: OpenAI.Chat.Completions.ChatCompletionChunk | undefined,
  ) => void,
): InternalTool {
  const fetchChatCompletion: internalToolFunctionSchema = async (
    { model, goal, llmTools, allowedTools }: ccArguments,
    context: toolContext,
  ) => {
    console.log('calling chat completion tool...', model, goal, llmTools)
    if (!context.currentTask) {
      throw new TaskProcessingError(`No current task found!`)
    }
    if (!llmSettings.selectedApi) {
      throw new TaskProcessingError('No API selected!')
    }

    const toolDefs = await taskManager.updateToolDefinitions(true)
    // refactor this below and make it all explicit, without passing llmSettings...
    // now add goal-specific prompts...
    const lastTaskBeforeChatCompletion = await taskManager.getTask(context.currentTask.priorID)
    if (!lastTaskBeforeChatCompletion)
      throw new TaskProcessingError(
        `chatCompletion Task needs a parent Task to work! ${context.currentTask.id}`,
      )
    const { chatCompletion, openAIConversationThread } = await processChatTask(
      goal ?? 'SimpleCompletion',
      allowedTools || [],
      toolDefs,
      context.currentTask,
      { model, chatApi: llmSettings.selectedApi },
      llmSettings,
      taskManager,
      taskWorkerController,
      apiKeys,
      lastTaskBeforeChatCompletion,
      (chunk) => {
        streamCallback(context.currentTask.id, chunk)
      },
    )

    // parse the response into our own type ...
    const resp = ChatResponseType.safeParse(chatCompletion)

    let metaInfo: TaskNodeMeta = {}
    // get token usage for this task..
    if (resp.success) {
      console.log('save token usage...')
      // openai & openrouter sends back the exact number of prompt tokens :)
      metaInfo = await saveTokenUsage(
        resp.data,
        openAIConversationThread,
        toolDefs,
        lastTaskBeforeChatCompletion.content,
        llmSettings,
      )
      // we run this asynchronously, because it fetches data in the
      // background and we don't want to wait here...
      void addTaskCostInformation(resp.data, context.currentTask.id, llmSettings, apiKeys).then(
        (newMeta) => {
          void taskManager.debugDb.upsert(context.currentTask.id, newMeta, 'shallow_merge')
        },
      )
    }

    const choice = resp.data?.choices[0]
    metaInfo.rawOutput = { choice }
    if (!choice)
      throw new TaskProcessingError(
        'Our ChatCompletion tool did not get a valid response!',
        resp.data,
      )

    const newTaskChain = generateFollowUpTasksFromResult(
      goal || 'SimpleCompletion',
      choice,
      model,
      !!llmTools,
      toolDefs,
    )

    if (newTaskChain[0]) {
      void taskManager.debugDb.upsert(context.currentTask.id, metaInfo, 'shallow_merge')
    }

    return makeTaskResult([newTaskChain])
  }

  const chatCompletion: InternalTool = {
    function: fetchChatCompletion,
    description: 'Generates a chat-based response using the OpenAI API for the previous message.',
    longDescription: `This tool interfaces with an OpenAI-compatible API to generate completions for
  conversation prompts. Useful for generating natural language responses in a chat setting.
  It will convert the chain pointed to by the previous Task (priorID) into openAI compatible message
  list and generate a response`,
    name: 'chatCompletion',
    renderOptions: { hideChat: true, hideLlm: true },
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
