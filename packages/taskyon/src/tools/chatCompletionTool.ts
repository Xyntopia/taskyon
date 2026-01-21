import type {
  AssistantModelMessage,
  FilePart,
  ImagePart,
  ModelMessage,
  streamText,
  SystemModelMessage,
  Tool,
  ToolModelMessage,
  ToolResultPart,
  ToolSet,
  UserModelMessage,
} from 'ai'
import { jsonSchema, Output, smoothStream, tool } from 'ai'
import { default as Ajv } from 'ajv'
import { load } from 'js-yaml'
import type { JSONSchema7 } from 'json-schema'
import type { FromSchema } from 'json-schema-to-ts'
import { isEmpty } from 'lodash'
import type OpenAI from 'openai'
import type { ReadonlyDeep } from 'type-fest'
import { z } from 'zod'
import type { TyTaskManager } from '../core/taskManager'
import { mapFunctionNames } from '../core/tools'
import { isTaskyonKey } from '../core/tyCrypto'
import type { WebSearchOptions } from '../llm/chat'
import { generateHeaders, getOpenRouterGenerationInfo, getTaskyonCosts } from '../llm/chat'
import type { Goals } from '../llm/promptCreation'
import { addPrompts } from '../llm/promptCreation'
import type { apiConfig, ChatResponseType, TaskNodeMeta } from '../types/chatCompletion'
import { getCurrentModel } from '../types/chatCompletion'
import type { OpenRouterGenerationInfo } from '../types/chatCompletionService'
import type { FileMapping, partialTaskDraft, TaskNode } from '../types/node'
import type { llmSettings } from '../types/profiles'
import type { toolContext } from '../types/toolApi'
import { createTool, makeTaskResult, toolCall } from '../types/toolApi'
import type { ToolBase } from '../types/tools'
import { FunctionArguments } from '../types/tools'
import { FunctionCall } from '../types/tools'
import { sleep } from '../utils/asyncUtils'
import { charHash } from '../utils/crypto'
import { humanizeError } from '../utils/error'
import type { frpBus } from '../utils/frpBus'
import { createStream } from '../utils/frpBus'
import { convertFileToText } from '../utils/loadFiles'
import {
  createDeepTransformer,
  createDotPathTransformer,
  deepCopy,
  normalizeFalsyValues,
  pickProperties,
} from '../utils/objHelpers'
import type { Thunk } from '../utils/tsHelpers'
import { useNlpWorker } from '../utils/webWorkerApi'
import { safeYamlDump } from '../utils/yamlUtils'
import { ContentFilterFinishReasonError } from 'openai/error'
import { Content } from 'openai/resources/containers/files/content.mjs'

const convertToChatCompletionTool = (t: ToolBase): Tool => {
  return tool({
    title: t.name,
    description: t.description,
    inputSchema: jsonSchema(t.parameters),
  })
}

function generateOpenAIToolDeclarations(
  allowedTools: string[],
  toolCollection: Record<string, ToolBase>,
): ToolSet {
  const tools: ToolBase[] = mapFunctionNames(allowedTools || [], toolCollection) || []
  const aiTools = tools.reduce((prev, curr) => {
    prev[curr.name] = convertToChatCompletionTool(curr)
    return prev
  }, {} as ToolSet)
  return aiTools
}

// this function processes all tasks which go to any sort of an LLM
// TODO: for configuration & allowedTools it would be good if we could add
// this from a "default" Configuration? And then have them as function parameters?
// t.configuration = finishedTask.configuration
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
  let chatCompletionMessages: ModelMessage[]
  if (lastTaskBeforeChatCompletion) {
    const taskChain = await taskManager.getTaskChain(lastTaskBeforeChatCompletion.id)
    chatCompletionMessages = await convertTaskNodesToOpenAIChat(
      taskChain,
      taskManager.getFileMappingByUuid,
      taskManager.getUploadedFile,
      llmSettings.tryUsingVisionModels,
      llmTools,
      toolDefs,
    )
  } else {
    chatCompletionMessages = []
  }

  const msgs = addPrompts(
    toolDefs,
    llmTools,
    llmTools, // we turn on/off native structured & tools ith the same setting here!
    llmSettings.useBasePrompt,
    llmSettings.taskChatTemplates,
    chatCompletionMessages,
    prompts,
    allowedTools,
    lastTaskBeforeChatCompletion?.content.data,
    goal,
    schema,
  )

  chatCompletionMessages = [
    ...msgs.prependMessages,
    ...msgs.modifiedOpenAIConversationThread,
    ...msgs.appendMessages,
  ]

  if (chatCompletionMessages.length <= 0) {
    throw new Error('We were not able to convert our tasks into an AI-compatible format!')
  }

  let tools: ToolSet = {}
  if (llmTools) {
    tools = generateOpenAIToolDeclarations(allowedTools || [], toolDefs)
  }

  return { openAIConversationThread: chatCompletionMessages, tools, msgs: msgs ?? {} }
}

type streamOptsType = Parameters<typeof streamText>[0]
type streamChunk = Parameters<Required<streamOptsType>['onChunk']>[0]['chunk']

async function llmRequest(
  openAIConversationThread: ModelMessage[],
  tools: ToolSet,
  selectedModel: string,
  stopSignal: AbortSignal,
  api: apiConfig,
  apiKey: string,
  streamTracker: (chunk: streamChunk) => void,
  schema?: Record<string, unknown>,
  siteUrl?: string,
  webSearch?: WebSearchOptions,
  reasoning_effort?: 'low' | 'high' | 'medium',
  verbosity?: OpenAI.ChatCompletionCreateParams['verbosity'],
) {
  console.log({ siteUrl, webSearch, reasoning_effort, verbosity })
  /*const { createOpenRouter } = await import('@openrouter/ai-sdk-provider')
    const openrouter = createOpenRouter({
      apiKey,
      baseURL: siteUrl,
    })*/
  //import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
  const { streamText } = await import('ai')

  const { createOpenAI } = await import('@ai-sdk/openai')
  const openai = createOpenAI({
    apiKey,
  })

  // https://ai-sdk.dev/docs/reference/ai-sdk-core/stream-text
  const streamOpts: streamOptsType = {
    model: openai(selectedModel),
    messages: openAIConversationThread,
    tools,
    abortSignal: stopSignal,
    onChunk({ chunk }) {
      streamTracker(chunk)
    },
    experimental_transform: smoothStream({
      delayInMs: 20, // optional: defaults to 10ms
      chunking: 'line', // optional: defaults to 'word'
    }),
    /*onFinish({ text, finishReason, usage, response, steps, totalUsage, content }) {
        // your own logic, e.g. for saving the chat history or recording usage
        const messages = response.messages // messages that were generated
      },*/
  }

  if (schema)
    streamOpts.output = Output.object({
      schema: jsonSchema(schema),
    })

  const result = streamText(streamOpts)
  return result
}

// Ensures that every assistant.tool_calls is paired with a role:"tool" message.
function ensureToolResponses(messages: ModelMessage[]) {
  // 1) Pre‑scan all tool responses
  const responded = new Set<string>()
  for (const m of messages) {
    // we can use [0] here because we only ever have a single tool call
    // multiple parallel tool calls are handled in taskyon itself.
    if (m.role === 'tool' && m.content[0]?.type === 'tool-result') {
      responded.add(m.content[0]?.toolCallId)
    }
  }

  // 2) Rebuild, injecting only the missing ones
  const result: ModelMessage[] = []
  for (const msg of messages) {
    result.push(msg)

    if (msg.role === 'assistant') {
      for (const call of msg.content) {
        if (typeof call !== 'string' && call.type === 'tool-call')
          if (!responded.has(call.toolCallId)) {
            result.push({
              role: 'tool',
              content: [
                {
                  type: 'tool-result',
                  toolCallId: call.toolCallId, // the tool call will get the parent ID as well! :)
                  toolName: call.toolName,
                  output: { type: 'text', value: 'No response was recorded from the tool.' },
                },
              ],
            })
            responded.add(call.toolCallId)
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
  useNativeTools: boolean,
  toolDefs: Record<string, ToolBase>,
) {
  const tasksById = new Map<string, TaskNode>(taskChain.map((t) => [t.id, t]))

  const messages = (
    await Promise.all(
      taskChain.map((task) =>
        convertTaskNodeToOpenAIMessage(
          task,
          tasksById,
          tryUsingVisionModels,
          getFileMapping,
          getUploadedFile,
          useNativeTools,
          toolDefs,
        ),
      ),
    )
  )
    .flat()
    .filter<ModelMessage>((message) => message != undefined)

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
  openAIConversationThread: ModelMessage[],
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

  const choice = chatResponse.choices[0]
  // doing deepcopy here, because we're communicating to a worker
  // and need to make sure to dereference values (e.g. if they're vue reactive objects)
  costInfo.estimatedTokens = await estimateChatTokens(
    deepCopy(content),
    openAIConversationThread,
    toolDefs,
    deepCopy(allowedTools) || [],
    typeof choice?.message.content === 'string' ? choice.message.content : '',
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
function getCommandFromStructuredResponse(message: string): FunctionCall[] {
  // all of the following is done in order to make this as robust as possible
  // thats also why we don't just simply use zod validation on this.
  const structResponse = parseYamlResponse2Record(message || '')
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
  message: AssistantModelMessage,
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
  for (const cont of message.content) {
    // check if we have any function calls from the llm inference
    // in that case we shoud handle that first :)
    const functionCall = extractFunctionCall(cont, allTools)
    if (functionCall) {
      newTasks.push(
        // this functionCall will be executed in the next step, so we don't need any additional tasks here
        {
          role: 'function',
          content: { type: 'functioncall', data: functionCall },
        },
      )
    }
    let txtContent
    if (typeof cont === 'string') {
      txtContent = cont
    } else if (cont.type === 'text') {
      txtContent = cont.text
    }
    if (txtContent) {
      if (goal === 'SimpleCompletion' || goal === 'WebSearch' || llmTools) {
        // if we don't need to call a tool, we simply generate a normal message...
        // the same is true, if we have enabled native llmTools. In this case
        // we either got a function back already (functionCall[0]) or we
        // got a message back :)
        newTasks = [
          {
            role: 'assistant',
            content: {
              type: 'message',
              data: txtContent,
              // TODO: add annotations once we can extract them from vercel ai sdk
            },
          },
          {
            role: 'system',
            content: { type: 'return', data: 'assistant answered' },
          },
        ]
        console.log('No more follow up tasks!')
      } else if (goal === 'AnalyzeToolResult' || goal === 'ChooseTool' || goal === 'AnalyzeError') {
        const commands = getCommandFromStructuredResponse(txtContent)
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
            content: { type: 'structured', data: txtContent },
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
    }
  }
  return newTasks
}

export function extractFunctionCall(
  content: ModelMessage['content'][0],
  tools: Record<string, ToolBase>,
) {
  if (typeof content === 'string') return
  if ('type' in content && content.type === 'tool-call') {
    // if our response contained a call to a function...
    // TODO: update this to the new tools API from Openai
    console.log('A function call was returned...')
    // we convert the object into our own FunctionCall and afterwards parse it, to make
    // sure it really worked...
    let fargs: FunctionArguments = {}
    const { input, toolName } = content
    //if (!('function' in toolCall))
    //  throw new Error("toolCall doesn't contain a function", { cause: toolCall })
    try {
      //fargs = JSON.parse(toolCall.function.arguments)
      fargs = FunctionArguments.parse(input)
    } catch (error) {
      console.warn('Failed to parse arguments as JSON:', error)
      /*if (message.finish_reason === 'cancelled')
          fargs = { cancelled: toolCall.function.arguments }
        else
          throw new Error(
            `We cold not parse the function arguments as json:
${toolCall.function.arguments}`,
          )*/
    }
    const functionCallObj: FunctionCall = {
      name: toolName,
      arguments: fargs,
    }
    if (tools[functionCallObj.name]) return functionCallObj
  }
}

// sometimes a single task can get convserted to multiple messages
// and sometime we don't need it at all in the chat :)
async function convertTaskNodeToOpenAIMessage(
  task: TaskNode,
  tasksById: Map<string, TaskNode>,
  useVisionModels: boolean,
  getFileMapping: (uuid: string) => Promise<FileMapping | null>,
  getUploadedFile: (uuid: string) => Promise<File | undefined>,
  useNativeTools: boolean,
  toolCollection: Record<string, ToolBase>,
  maxToolIdLength = 9, // the max length here is influenced by the Mistral model, which can only use 9 characters for tool ids
): Promise<ModelMessage[] | undefined> {
  if (task.content.type === 'functioncall') {
    const functionCallName = task.content.data.name
    if (toolCollection[functionCallName]?.renderOptions?.hideLlm) {
      return
    }
    if (useNativeTools) {
      const functionMessage: AssistantModelMessage = {
        role: 'assistant',
        content: [
          {
            type: 'tool-call',
            toolCallId: await charHash(task.id, maxToolIdLength),
            toolName: task.content.data.name,
            input: task.content.data.arguments,
          },
        ],
      }
      return [functionMessage]
    } else {
      // the purpose of this is to inform the AI about what function was called and
      // the arguments in it.
      return [
        {
          role: 'assistant',
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
    if (task.parentID && useNativeTools) {
      // the parent task should be the tool call task...
      const toolCallTask = tasksById.get(task.parentID)
      const name =
        toolCallTask?.content.type === 'functioncall' ? toolCallTask.content.data.name : 'unknown'
      const output: ToolResultPart['output'] = {
        type: 'text',
        // TODO: not sure, if it makes senese to use type 'json' here at some point in the future?
        //       its not very generic...
        value: safeYamlDump(task.content.data),
      }
      const message: ToolModelMessage = {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: await charHash(task.parentID, maxToolIdLength), // the tool call will get the parent ID as well! :)
            toolName: name,
            output,
          },
        ],
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
    const message: ModelMessage = {
      role: task.role,
      content: task.content.data,
    }
    return [message]
  } else if (task.content.type === 'error') {
    const message: SystemModelMessage = {
      role: 'system',
      content: humanizeError(task.content.data),
    }
    return [message]
  } else if (task.content.type === 'files') {
    const fileMappings = await Promise.all(task.content.data.map((uuid) => getFileMapping(uuid)))
    const fileNames = fileMappings
      .map((fm) => '- ' + (fm?.opfs || fm?.name || 'unknown'))
      .join('\n')

    const sysMessage: SystemModelMessage = {
      role: 'system',
      content: `User uploaded files:\n${fileNames}`,
    }

    const fileContent = await makeFilesAiReadable(fileMappings, getUploadedFile, useVisionModels)

    if (fileContent.length > 0) {
      const userMessage: UserModelMessage = {
        role: 'user',
        content: fileContent,
      }
      return [sysMessage, userMessage]
    }

    return [sysMessage]
  }
}

// TODO:  move this into utils file utils and merge with our old function...
async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer()
  let binary = ''
  const bytes = new Uint8Array(buf)
  const chunkSize = 0x8000

  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }

  const base64 = btoa(binary)

  // 🔒 Sanity check: OpenAI spec wants *raw* base64, not "data:...;base64,"
  if (base64.startsWith('data:')) {
    throw new Error('fileToBase64 returned a data URL, expected raw base64 only')
  }

  return base64
}

async function makeFilesAiReadable(
  fileMappings: (FileMapping | null)[],
  getFile: (uuid: string) => Promise<File | undefined>,
  nativeModelProcessing: boolean,
): Promise<(FilePart | ImagePart)[]> {
  const fileContent: (FilePart | ImagePart)[] = []
  for (const fm of fileMappings) {
    if (!fm) continue
    const name = fm.name || fm.opfs || 'unknown'
    const lower = name.toLowerCase()
    const file: File | undefined = await getFile(fm.id)
    if (!file) continue

    // Images
    if (/\.(png|jpe?g|gif|webp)$/i.test(lower) && nativeModelProcessing) {
      const base64 = await fileToBase64(file)
      fileContent.push({
        type: 'image',
        mediaType: file.type,
        image: `data:${file.type};base64,${base64}`,
      })
    }
    // TODO: support image URLs

    // Audio (OpenAI spec requires base64 + format)
    else if (/\.(wav|mp3)$/i.test(lower) && nativeModelProcessing) {
      const base64 = await fileToBase64(file)
      const mediaType = lower.endsWith('.wav') ? 'audio/wav' : 'audio/mpeg'
      fileContent.push({
        type: 'file',
        mediaType,
        data: base64,
      })
    }

    // PDF files
    else if (/\.pdf$/i.test(lower) && nativeModelProcessing) {
      const base64 = await fileToBase64(file)
      const mime = file.type || 'application/pdf'
      fileContent.push({
        type: 'file',
        mediaType: mime,
        data: `data:${mime};base64,${base64}`, // ✅ OpenAI expects full data URL
        filename: name,
      })
    }

    // Unsupported file types (skip or handle differently)
    else {
      try {
        const text = await convertFileToText(file)

        fileContent.push({
          type: 'file',
          mediaType: 'text/plain',
          data: `Contents of file: ${name}\n\n` + "'''" + text + "'''",
        })
      } catch (err) {
        fileContent.push({
          type: 'file',
          mediaType: 'text/plain',
          data: `Skipping unsupported file type: ${name}`,
        })
        console.warn(`Skipping unsupported file type for OpenAI: ${name}`, err)
        // Or throw if you want stricter behavior
      }
    }
  }
  return fileContent
}

export const chatCompletionToolName = 'chatCompletion'

export type chunkStreamType = {
  taskId: string
  chunk: streamChunk
}

export function createChatCompletionTool(
  llmSettings: Thunk<ReadonlyDeep<llmSettings>>,
  taskManager: TyTaskManager,
) {
  //const { default: Ajv } = await import('ajv')
  const ajv = new Ajv()

  const chatCompletionStream = createStream<chunkStreamType>()

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
        reasoning_effort: {
          enum: ['low', 'high', 'medium'],
          description: 'How many reasoning tokens should models with reasonin capability use?',
        },
        verbosity: {
          type: 'string',
          enum: ['low', 'high', 'medium'],
          description: 'how verbose should the reponse be?',
        },
        use_multimodal: {
          type: 'boolean',
          description:
            'Allow models to use their vision/audio document undestanding capabilities if their are any files in the prompt.',
        },
        contextSize: {
          type: 'integer',
          description:
            '[Optional] How many of the peceding tasks are going to be used for the chatCompletion?',
        },
      },
    } as const satisfies JSONSchema7,
    function: async (opts, context: toolContext) => {
      //////////   INITIALIZATION
      const {
        useBasePrompt,
        selectedApi,
        llmApis,
        enableOpenAiTools,
        taskChatTemplates,
        tryUsingVisionModels,
        siteUrl,
      } = llmSettings()
      const {
        model,
        goal,
        llmTools,
        allowedTools,
        prompts,
        schema,
        reasoning_effort,
        verbosity,
        // if we don't set it, choose the default setting...
        use_multimodal = tryUsingVisionModels,
      } = opts
      const tools = allowedTools ?? []

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
          tryUsingVisionModels: use_multimodal,
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
        reasoning_effort,
        verbosity,
      )

      // parse the response into our own type ...
      const res = await chatCompletion.response

      // TODO: get token usage for this task..
      const metrics = false
      if (currentTask && lastTaskBeforeChatCompletion && metrics) {
        // need to make sure, that we remove audio, image and file data here!
        /*const truncatedMsgs = createDotPathTransformer({
          'modifiedOpenAIConversationThread.*.content.*.file.file_data': () =>
            '[[file_data omitted]]',
          'modifiedOpenAIConversationThread.*.content.*.image_url.url': () =>
            '[[image_url omitted]]',
          'modifiedOpenAIConversationThread.*.content.*.input_audio.data': () =>
            '[[input_audio omitted]]',
        })(chatInfo.msgs)
        let metaInfo: TaskNodeMeta = {
          taskPrompt: truncatedMsgs,
          tools: chatInfo.tools,
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

        metaInfo.rawOutput = { choice: res }
        console.log('saving task metadata', metaInfo)
        void taskManager.metaUpsert(currentTask.id, metaInfo, 'shallow_merge')*/
      }

      if (!res.messages[0])
        throw new Error('The AI gave us an incomplete response!', {
          cause: chatCompletion,
        })

      // in case a schema was given, we simply use that schema and return it as a structured message
      // for further processing (e.g. a contextFunction)...
      const customValidation = false
      if (schema && customValidation) {
        console.log('parsing custom schema', schema)
        const structResponse = parseYamlResponse2Record(res.messages[0].content || '')

        if (typeof schema === 'object' && schema !== null) {
          // I *think* we can simply cast our schema here t ajv, because it
          // will spit out an error anyways if our schema isn't compatible..
          const validate = ajv.compile(schema)
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
      } else if (schema) {
        const structResponse = await chatCompletion.output
        return makeTaskResult({
          role: 'assistant',
          content: { type: 'structured', data: structResponse },
        })
      }

      const newTaskChain = generateFollowUpTasksFromResult(
        goal || 'SimpleCompletion',
        res.messages[0],
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
