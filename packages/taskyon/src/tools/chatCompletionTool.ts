import { createStream } from '@taskyon/shared/modules/frpBus'
import type {
  AssistantModelMessage,
  FilePart,
  ImagePart,
  LanguageModelResponseMetadata,
  ModelMessage,
  ReasoningOutput,
  streamText,
  SystemModelMessage,
  Tool,
  ToolCallPart,
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
import type OpenAI from 'openai'
import type { TyTaskManager } from '../core/taskManager'
import {
  compileTaskyonFunctionArguments,
  compileTaskyonMessageString,
  createTaskVariablePresentationService,
  extractTaskRefsFromValue,
  materializeTaskyonFunctionArguments,
  renderTaskyonVariableBlock,
} from '../core/taskVariables'
import { mapFunctionNames } from '../core/tools'
import { isTaskyonKey } from '../core/tyCrypto'
import type { Goals, PromptInjection } from '../llm/promptCreation'
import {
  getTaskyonCosts,
  getTyJwtPublicKey,
  mintToken,
  verifyServiceToken,
} from '../taskyon.space/taskyon.space_api'
import { TOKEN_SERVICE_BASE_URL, TOKEN_SERVICE_PREFIX } from '../taskyon.space/tokenservice.types'
import type { apiConfig, TaskNodeMeta } from '../types/chatCompletion'
import { getCurrentModel } from '../types/chatCompletion'
import type {
  Annotation,
  FileMapping,
  partialTaskDraft,
  TaskGetter,
  TaskNode,
} from '../types/taskNode'
import type { toolContext } from '../types/toolApi'
import { createTool, makeTaskResult, toolCall } from '../types/toolApi'
import type { ToolBase } from '../types/tools'
import { FunctionArguments, FunctionCall } from '../types/tools'
import { charHash } from '../utils/crypto'
import { humanizeError, serializeError } from '../utils/error'
import { convertFileToText } from '../utils/loadFiles'
import {
  createDeepTransformer,
  createDotPathTransformer,
  isEmpty,
  normalizeFalsyValues,
  pickProperties,
} from '../utils/objHelpers'
import type { Thunk } from '../utils/tsHelpers'
import { safeYamlDump } from '../utils/yamlUtils'

type WebSearchOptions = {
  maxResults: number
  searchContextSize: 'low' | 'high' | 'medium'
}

type TaskVariablePresentationService = ReturnType<typeof createTaskVariablePresentationService>

const augmentToolSchemaForTaskyonVariables = (schema: JSONSchema7): JSONSchema7 => {
  if (schema.type !== 'object') return schema

  return {
    ...schema,
    properties: {
      ...(schema.properties ?? {}),
      $use: {
        type: 'object',
        description:
          'Taskyon extension. Map argument paths to visible task variables when a whole argument should come from a previous task result.',
        additionalProperties: {
          type: 'string',
        },
        examples: [{ document: 'python1' }],
      },
    },
  }
}

const convertToChatCompletionTool = (t: ToolBase): Tool => {
  return tool({
    title: t.name,
    description: `${t.description}\n\nTaskyon note: whole arguments may use the reserved $use mapping to reference previous task results.`,
    inputSchema: jsonSchema(augmentToolSchemaForTaskyonVariables(t.parameters)),
  })
}

const systemMessage = (content: string): SystemModelMessage => ({ role: 'system', content })

const toPromptMessages = (
  prompts: string[],
  promptInjections: PromptInjection[],
): {
  prependMessages: SystemModelMessage[]
  appendMessages: SystemModelMessage[]
} => {
  const prependMessages = promptInjections.map(systemMessage)
  const appendMessages = prompts.map(systemMessage)
  return { prependMessages, appendMessages }
}

function generateToolDeclarations(
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
  },
  // can we get rid of taskManager here in order to make our task more functional :)?
  taskManager: TyTaskManager,
  lastTaskBeforeChatCompletion: TaskNode | undefined,
  prompts: string[],
  promptInjections: PromptInjection[],
  variableService?: TaskVariablePresentationService,
) {
  //TODO: we can create more things here like giving it context form other tasks, lookup
  //      main objective, previous tasks etc....
  //      actualy: this would be great for a new tool ;)
  // TODO: accept a thread from outside this tool... and only convert it into an openai compatible format
  let chatCompletionMessages: ModelMessage[]
  let originalThread: ModelMessage[] = []
  if (lastTaskBeforeChatCompletion) {
    const taskChain = await taskManager.getTaskChain(lastTaskBeforeChatCompletion.id)
    chatCompletionMessages = await convertTaskNodesToOpenAIChat(
      taskChain,
      taskManager.getFileMappingByUuid,
      taskManager.getUploadedFile,
      llmSettings.tryUsingVisionModels,
      llmTools,
      toolDefs,
      variableService
        ? {
            getTaskById: taskManager.getTask,
            variableService,
          }
        : {
            getTaskById: taskManager.getTask,
          },
    )
    originalThread = [...chatCompletionMessages]
  } else {
    chatCompletionMessages = []
  }
  const promptMessages = toPromptMessages(prompts, promptInjections)
  chatCompletionMessages = [
    ...promptMessages.prependMessages,
    ...chatCompletionMessages,
    ...promptMessages.appendMessages,
  ]

  if (chatCompletionMessages.length <= 0) {
    throw new Error('We were not able to convert our tasks into an AI-compatible format!')
  }

  let tools: ToolSet = {}
  if (llmTools) {
    tools = generateToolDeclarations(allowedTools || [], toolDefs)
  }

  return {
    chatCompletionMessageThread: chatCompletionMessages,
    tools,
    msgs: {
      prependMessages: promptMessages.prependMessages,
      modifiedOpenAIConversationThread: originalThread,
      appendMessages: promptMessages.appendMessages,
    },
  }
}

type streamOptsType = Parameters<typeof streamText>[0]
type streamChunk = Parameters<Required<streamOptsType>['onChunk']>[0]['chunk']

const normalizeChunkText = (value: unknown): string => {
  if (typeof value === 'string') return value
  return ''
}

const extractTextFromChunk = (chunk: streamChunk): string => {
  const c = chunk as unknown as Record<string, unknown>
  if (c['type'] === 'text-delta') return normalizeChunkText(c['textDelta'])
  if (c['type'] === 'text') return normalizeChunkText(c['text'])
  if (typeof c['textDelta'] === 'string') return c['textDelta']
  if (typeof c['text'] === 'string') return c['text']
  return ''
}

const cleanupRawStreamOutput = (rawOutput: string): string => {
  if (!rawOutput) return ''
  const cleaned = rawOutput
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.replace(/^data:\s*/, ''))
    .filter((line) => line && line !== '[DONE]')
    .join('\n')
    .trim()
  return cleaned
}

const normalizePromptInjections = (value: unknown): PromptInjection[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []

const classifyStreamingFailure = (
  err: unknown,
  aborted: boolean,
): {
  shortReason: string
  systemNote: string
  assistantPrefix: string
} => {
  const msg = humanizeError(err).toLowerCase()
  if (
    aborted ||
    /(abort|aborted|cancel|canceled|interrupt|stopped by user|stop signal)/.test(msg)
  ) {
    return {
      shortReason: 'interrupted',
      assistantPrefix: 'Generation was interrupted. Keeping the partial response below.',
      systemNote:
        'Chat completion was interrupted (likely user stop/abort signal). Partial assistant output was preserved.',
    }
  }
  if (/(timeout|timed out|deadline)/.test(msg)) {
    return {
      shortReason: 'timed out',
      assistantPrefix: 'Generation timed out. Keeping the partial response below.',
      systemNote:
        'Chat completion timed out before finishing. Partial assistant output was preserved.',
    }
  }
  return {
    shortReason: 'failed',
    assistantPrefix: 'Generation ended early due to an error. Keeping the partial response below.',
    systemNote: 'Chat completion failed before finishing. Partial assistant output was preserved.',
  }
}

async function llmRequest(
  openAIConversationThread: ModelMessage[],
  tools: ToolSet,
  selectedModel: string,
  api: apiConfig,
  apiKey: string,
  schema?: Record<string, unknown>,
  siteUrl?: string,
  webSearch?: WebSearchOptions,
  reasoningEffort?: 'low' | 'high' | 'medium' | 'none',
  verbosity?: OpenAI.ChatCompletionCreateParams['verbosity'],
) {
  // TODO:
  //     stream_options: { include_usage: true },
  //     store: false,
  //
  console.log('Creating chat completion request', {
    siteUrl,
    webSearch,
    reasoning_effort: reasoningEffort,
    verbosity,
  })
  let model
  const overrideOpts: Record<string, unknown> = {}
  switch (api.name) {
    case 'openai':
      {
        const { createOpenAI } = await import('@ai-sdk/openai')
        const openai = createOpenAI({
          apiKey,
        })
        model = openai(selectedModel)

        const gptReasoning = selectedModel.includes('gpt-5')
          ? ({ none: 'none', low: 'low', medium: 'medium', high: 'high' }[
              reasoningEffort ?? 'none'
            ] ?? null)
          : null
        overrideOpts.providerOptions = {
          openai: {
            reasoningEffort: gptReasoning,
            reasoningSummary: 'auto', // 'auto' for condensed or 'detailed' for comprehensive
          },
        }
        if (webSearch?.maxResults) {
          overrideOpts.tools = {
            ...tools,
            web_search: openai.tools.webSearch({
              // optional configuration:
              externalWebAccess: true,
              searchContextSize: webSearch.searchContextSize,
              /*userLocation: {
                type: 'approximate',
                city: 'San Francisco',
                region: 'California',
              },*/
            }),
          }
          // Force web search tool (optional):
          overrideOpts.toolChoice = { type: 'tool', toolName: 'web_search' }
        }
      }
      break
    case 'taskyon':
    case 'openrouter.ai': {
      const { createOpenRouter } = await import('@openrouter/ai-sdk-provider')
      const stripUserAgentFetch: typeof fetch = (input, init) => {
        if (init?.headers) {
          const h = new Headers(init.headers)
          h.delete('user-agent')
          h.delete('User-Agent')
          return fetch(input, { ...init, headers: h })
        }
        return fetch(input, init)
      }

      const openrouter = createOpenRouter({
        apiKey,
        ...(api.name === 'taskyon' ? { baseURL: api.baseURL + api.routes.chatCompletion } : {}),
        fetch: stripUserAgentFetch, // <-- this is the important part (if supported)
      })
      const opts: Parameters<typeof openrouter>[1] = {
        provider: {
          //only: ['GMICloud'],
          // TODO: we need to make this generic. and on certain errors, avoid specific providers...
          // gives back "bad" results..
          ignore: ['GMICloud'],
        },
        usage: { include: true },
      }
      // TODO: even if we disable reasnoning effort for openrouter and taskyon it is
      //       mandatory ( as of 2026/01/20)
      if (reasoningEffort && reasoningEffort !== 'none')
        opts.reasoning = {
          // One of the following (not both):
          // Can be "high", "medium", or "low" (OpenAI-style)
          // for other APIs, we use max_tokens
          effort: reasoningEffort,
          // max tokens can only be used if we don't use "effort"
          // max_tokens: 2000, // Specific token limit (Anthropic-style)
          // Optional: Default is false. All models support this.
          exclude: false, // Set to true to exclude reasoning tokens from response
          // Or enable reasoning with the default parameters:
          // enabled: true, // Default: inferred from `effort` or `max_tokens`
        }

      if (webSearch?.maxResults) {
        opts.plugins = [
          {
            id: 'web',
            engine: 'exa', // Optional: "native", "exa", or undefined
            max_results: webSearch.maxResults, // Defaults to 5
            /*docs from: https://openrouter.ai/docs/features/web-search
          A web search was conducted on `date`. Incorporate the following web search results into your response.

          IMPORTANT: Cite them using markdown links named using the domain of the source.
          Example: [nytimes.com](https://nytimes.com/some-page).

          //search_prompt: 'Some relevant web results:', // See default below*/
          },
          {
            id: 'file-parser',
            pdf: {
              engine: 'native',
            },
          },
        ]
        opts.extraBody = {
          web_search_options: {
            engine: 'exa',
            search_context_size: webSearch.searchContextSize,
            //TODO: user_location:
          },
        }
      }

      model = openrouter(selectedModel, opts)
      break
    }
    default: {
      const { createOpenAICompatible } = await import('@ai-sdk/openai-compatible')
      const openai = createOpenAICompatible({
        apiKey,
        baseURL: api.baseURL + api.routes.chatCompletion,
        name: api.name,
      })
      model = openai(selectedModel)
      break
      //throw new Error('Api is currently not supports', { cause: { api } })
    }
  }

  // https://ai-sdk.dev/docs/reference/ai-sdk-core/stream-text
  const streamOpts: streamOptsType = {
    model,
    messages: openAIConversationThread,
    tools,
    ...overrideOpts,
    /*onFinish({ text, finishReason, usage, response, steps, totalUsage, content }) {
        // your own logic, e.g. for saving the chat history or recording usage
        const messages = response.messages // messages that were generated
      },*/
  }

  if (schema)
    streamOpts.output = Output.object({
      schema: jsonSchema(schema),
    })

  return streamOpts
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
  options?: {
    getTaskById?: TaskGetter
    variableService?: TaskVariablePresentationService
  },
) {
  const tasksById = new Map<string, TaskNode>(taskChain.map((t) => [t.id, t]))
  const variableService = options?.variableService ?? createTaskVariablePresentationService()
  const getTaskById: TaskGetter =
    options?.getTaskById ?? ((taskId: string) => Promise.resolve(tasksById.get(taskId) ?? null))
  const renderedTaskIds = new Set<string>()
  const injectedTaskIds = new Set<string>()
  const messages: ModelMessage[] = []

  for (const task of taskChain) {
    const referencedTasks = await renderReferencedTasksForLlm(
      task,
      tasksById,
      renderedTaskIds,
      injectedTaskIds,
      variableService,
      getTaskById,
    )
    messages.push(...referencedTasks)

    const renderedMessages = await convertTaskNodeToOpenAIMessage(
      task,
      tasksById,
      tryUsingVisionModels,
      getFileMapping,
      getUploadedFile,
      useNativeTools,
      toolDefs,
      variableService,
      getTaskById,
    )
    if (renderedMessages?.length) messages.push(...renderedMessages)
    renderedTaskIds.add(task.id)
  }

  // Inject any missing tool response messages (this happens, if our tools create a recursive task chain)
  return ensureToolResponses(messages)
}

const renderTaskContentForLlm = (
  task: TaskNode,
  tasksById: Map<string, TaskNode>,
  variableService: TaskVariablePresentationService,
) => {
  const variableName = variableService.getOrAssignVariableName(task, tasksById)
  const content =
    task.content.type === 'message' ? String(task.content.data) : safeYamlDump(task.content.data)
  return renderTaskyonVariableBlock(variableName, content)
}

const renderReferencedTasksForLlm = async (
  task: TaskNode,
  tasksById: Map<string, TaskNode>,
  renderedTaskIds: Set<string>,
  injectedTaskIds: Set<string>,
  variableService: TaskVariablePresentationService,
  getTaskById: TaskGetter,
) => {
  const refs = extractTaskRefsFromValue(task.content.data)
  const injectedMessages: SystemModelMessage[] = []

  for (const taskId of refs) {
    if (renderedTaskIds.has(taskId) || injectedTaskIds.has(taskId)) continue
    const referencedTask = tasksById.get(taskId) ?? (await getTaskById(taskId))
    if (!referencedTask) {
      throw new Error(`Taskyon variable reference points to missing task ${taskId}`)
    }
    tasksById.set(taskId, referencedTask)
    injectedTaskIds.add(taskId)
    injectedMessages.push({
      role: 'system',
      content: renderTaskContentForLlm(referencedTask, tasksById, variableService),
    })
  }

  return injectedMessages
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

const extractTaggedToolCall = (
  message: string,
): { name: string; arguments: FunctionArguments } | undefined => {
  const toolNameMatch = /<tool_call>\s*([^<\s][^<]*)\s*/i.exec(message)
  const toolName = toolNameMatch?.[1]?.trim()
  if (!toolName) return

  const args: FunctionArguments = {}
  const argRegex =
    /<arg_key>\s*([\s\S]*?)\s*<\/arg_key>\s*<arg_value>\s*([\s\S]*?)\s*<\/arg_value>/gi

  let match = argRegex.exec(message)
  while (match) {
    const key = match[1]?.trim()
    const value = match[2]?.trim()
    if (key) args[key] = value ?? ''
    match = argRegex.exec(message)
  }

  return { name: toolName, arguments: args }
}

const createTaggedToolCallId = (input: string): string => {
  const normalized = input.slice(0, 64)
  let hash = 0
  for (let i = 0; i < normalized.length; i += 1) {
    hash = (hash * 31 + normalized.charCodeAt(i)) >>> 0
  }
  return `tagged-${hash.toString(36)}`
}

const normalizeAssistantMessageForToolCall = (
  message: AssistantModelMessage | ToolModelMessage,
  availableTools: Record<string, ToolBase>,
): AssistantModelMessage | ToolModelMessage => {
  if (message.role !== 'assistant') return message

  if (!Array.isArray(message.content)) {
    const taggedToolCall = extractTaggedToolCall(message.content)
    if (!taggedToolCall) return message
    if (!availableTools[taggedToolCall.name]) return message
    return {
      role: 'assistant',
      content: [
        {
          type: 'tool-call',
          toolCallId: createTaggedToolCallId(message.content),
          toolName: taggedToolCall.name,
          input: taggedToolCall.arguments,
        },
      ],
    } as AssistantModelMessage
  }

  // If the provider already returned native tool calls, keep them as-is.
  if (
    message.content.some((part): boolean => typeof part !== 'string' && part.type === 'tool-call')
  )
    return message

  const textPart = message.content.find(
    (part): part is { type: 'text'; text: string } =>
      typeof part !== 'string' && part.type === 'text',
  )
  if (!textPart) return message
  const taggedToolCall = extractTaggedToolCall(textPart.text)
  if (!taggedToolCall) return message
  if (!availableTools[taggedToolCall.name]) return message

  return {
    role: 'assistant',
    content: [
      {
        type: 'tool-call',
        toolCallId: createTaggedToolCallId(textPart.text),
        toolName: taggedToolCall.name,
        input: taggedToolCall.arguments,
      },
    ],
  } as AssistantModelMessage
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
function getCommandFromStructuredResponse(
  message: string,
  variableService?: TaskVariablePresentationService,
): FunctionCall[] {
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
      const command = variableService
        ? {
            ...parsed.data,
            arguments: compileTaskyonFunctionArguments(parsed.data.arguments, variableService),
          }
        : parsed.data
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
  sources: Annotation[],
  goal: Goals,
  message: ModelMessage,
  allowedTools: string[] | undefined,
  chatModel: string,
  llmTools: boolean,
  allTools: Record<string, ToolBase>,
  prompts: string[] | undefined,
  promptInjections: PromptInjection[] | undefined,
  variableService?: TaskVariablePresentationService,
): partialTaskDraft[] {
  console.log('generate follow up task')

  const newTasks: partialTaskDraft[] = []

  /*if(Array.isArray(message.content)){
    const sources = message.content.filter((m) => m.type === 'source')
  }*/

  let srcsAdded = false

  // TODO: what do we do in case of an empty user message, but only a file?
  //       right now, we assume, that user message always comes after uploaded file message :)
  for (const cont of message.content) {
    // I think we can do the next line, because we only get string messages from user! but this here is the AI response
    // where we alwazs get structured content!
    if (typeof cont === 'string') continue
    switch (cont.type) {
      // TODO: handle images, tool results, files etc. here as well!
      // case 'image':
      //case 'file':
      //case 'tool-result':
      //case "file":
      case 'tool-call':
        {
          // check if we have any function calls from the llm inference
          // in that case we shoud handle that first :)
          const functionCall = convertFunctionCall(cont, allTools, variableService)
          if (functionCall) {
            newTasks.push({
              role: 'function',
              content: { type: 'functioncall', data: functionCall },
            })
          }
        }
        break
      case 'text':
      default: {
        let txtContent
        if (typeof cont === 'string') {
          txtContent = cont
        } else if (cont.type === 'text') {
          txtContent = cont.text
        }
        if (txtContent) {
          const compiledTextContent = variableService
            ? compileTaskyonMessageString(txtContent, variableService)
            : txtContent

          if (goal === 'SimpleCompletion' || goal === 'WebSearch' || llmTools) {
            // if we don't need to call a tool, we simply generate a normal message...
            // the same is true, if we have enabled native llmTools. In this case
            // we either got a function back already (functionCall[0]) or we
            // got a message back :)
            const newMsg = {
              role: 'assistant',
              content: {
                type: 'message',
                data: compiledTextContent,
                ...(sources.length > 0 && !srcsAdded ? { ann: sources } : {}),
              },
            } as partialTaskDraft
            if (sources.length) srcsAdded = true

            newTasks.push(newMsg, {
              role: 'system',
              content: { type: 'return', data: 'assistant answered' },
            })
            console.log('No more follow up tasks!')
          } else if (goal === 'AnalyzeToolResult' || goal === 'ChooseTool') {
            const commands = getCommandFromStructuredResponse(compiledTextContent, variableService)
            if (commands.length > 0) {
              const command = commands[0]!
              if (!allowedTools?.includes(command.name)) {
                throw new Error(`Tool '${command.name}' is not in the list of allowed tools`, {
                  cause: { allowedTools, requestedTool: command.name },
                })
              }
            }
            newTasks.push({
              role: 'assistant',
              content: { type: 'structured', data: compiledTextContent },
            })
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
                    prompt_injections: promptInjections || [],
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
    }
  }
  return newTasks
}

export function convertFunctionCall(
  content: ToolCallPart,
  tools: Record<string, ToolBase>,
  variableService?: TaskVariablePresentationService,
) {
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
    arguments: variableService ? compileTaskyonFunctionArguments(fargs, variableService) : fargs,
  }
  if (tools[functionCallObj.name]) return functionCallObj
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
  variableService: TaskVariablePresentationService,
  getTaskById: TaskGetter,
  maxToolIdLength = 9, // the max length here is influenced by the Mistral model, which can only use 9 characters for tool ids
): Promise<ModelMessage[] | undefined> {
  if (task.content.type === 'functioncall') {
    const functionCallName = task.content.data.name
    if (toolCollection[functionCallName]?.renderOptions?.hideLlm) {
      return
    }
    const llmArguments = await materializeTaskyonFunctionArguments(task.content.data.arguments, {
      surface: 'llm',
      getTaskById,
      variableService,
      tasksById,
    })
    if (useNativeTools) {
      const functionMessage: AssistantModelMessage = {
        role: 'assistant',
        content: [
          {
            type: 'tool-call',
            toolCallId: await charHash(task.id, maxToolIdLength),
            toolName: task.content.data.name,
            input: llmArguments,
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
            (!isEmpty(llmArguments)
              ? ` The function arguments were: ${JSON.stringify(llmArguments)}`
              : ''),
        },
      ]
    }
  } else if (task.content.type === 'toolresult') {
    const variableName = variableService.getOrAssignVariableName(task, tasksById)
    const renderedBlock = renderTaskyonVariableBlock(variableName, safeYamlDump(task.content.data))
    if (task.parentID && useNativeTools) {
      // the parent task should be the tool call task...
      const toolCallTask = tasksById.get(task.parentID)
      const name =
        toolCallTask?.content.type === 'functioncall' ? toolCallTask.content.data.name : 'unknown'
      const output: ToolResultPart['output'] = {
        type: 'text',
        value: renderedBlock,
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
          content: renderedBlock,
        },
      ]
  } else if (task.content.type === 'message' && task.role != 'function') {
    const message: ModelMessage = {
      role: task.role,
      content: renderTaskyonVariableBlock(
        variableService.getOrAssignVariableName(task, tasksById),
        task.content.data,
      ),
    }
    return [message]
  } else if (task.content.type === 'error') {
    const message: SystemModelMessage = {
      role: 'system',
      content: renderTaskyonVariableBlock(
        variableService.getOrAssignVariableName(task, tasksById),
        humanizeError(task.content.data),
      ),
    }
    return [message]
  } else if (task.content.type === 'structured') {
    const message: AssistantModelMessage = {
      role: 'assistant',
      content: [
        {
          type: 'text',
          text: renderTaskyonVariableBlock(
            variableService.getOrAssignVariableName(task, tasksById),
            safeYamlDump(task.content.data),
          ),
        },
      ],
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

export const chatCompletionToolParameters = {
  type: 'object',
  additionalProperties: false,
  properties: {
    model: {
      type: 'string',
      description:
        'The name of the model to use for the completion. Optional, will choose default model if not provided',
    },
    goal: {
      enum: ['SimpleCompletion', 'ChooseTool', 'AnalyzeToolResult', 'WebSearch'],
      description:
        'Optional Parameter to define the goal of the chat completion. If not set, the goal is dynamically inferred from the input.',
    },
    llmTools: {
      type: 'boolean',
      title: 'Use LLM Native Tools',
      description: `Optional Parameter. If set to true, we will use native tool apis offered by llm providers to generate tool calls in json format. If undefined, it will be treated as false.`,
      default: false,
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
        'Optional Parameter. Append transient system prompts after the rendered task chat. These prompts augment the chatCompletion input only and are not stored as tasks.',
      items: {
        type: 'string',
      },
    },
    prompt_injections: {
      type: 'array',
      description:
        'Optional Parameter. Prepend transient system prompts before the rendered task chat. These prompts augment the chatCompletion input only and are not stored as tasks.',
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
      enum: ['low', 'high', 'medium', 'none'],
      description: 'How many reasoning tokens should models with reasoning capability use?',
      title: 'Reasoning Effort',
    },
    max_results: {
      type: 'integer',
      description:
        '[Optional] In case of a WebSearch, how many results should be retrieved at max?',
      title: 'Max Results',
      default: 5,
    },
    use_multimodal: {
      type: 'boolean',
      title: 'Use Vision',
      description:
        'Allow models to use their vision/audio & document undestanding capabilities if their are any files in the prompt.',
    },
    context_size: {
      type: 'integer',
      description:
        '[Optional] How many of the peceding tasks are going to be used for the chatCompletion?',
    },
    options: {
      type: 'object',
      description:
        '[Optional] This is where we can specify additional options for the chat completion.',
      additionalProperties: true,
      properties: {
        verbosity: {
          type: 'string',
          enum: ['low', 'high', 'medium'],
          description: 'how verbose should the reponse be?',
        },
        artificial_streaming: {
          type: 'boolean',
          description: 'Optional. If true, smooths output chunks for UI readability.',
          default: true,
        },
      },
    },
    timeouts: {
      type: 'object',
      description: '[Optional] We can specify different timeouts for the chat completion.',
      properties: {
        totalMs: {
          type: 'integer',
          description: 'Total timeout in milliseconds for the entire chat completion process.',
          default: 10 * 60 * 1000, // 10 minutes
        },
        stepMs: {
          type: 'integer',
          description:
            'Timeout in milliseconds for each individual step when interacting with agents.',
          default: 10 * 60 * 1000, // 10 minutes
        },
      },
    },
  },
} as const satisfies JSONSchema7

export function createChatCompletionTool(
  // TODO: move these apiSettings here right into the 'normal' chatCompletion parameters!
  apiSettings: Thunk<{
    selectedApi: string
    llmApis: Record<string, apiConfig>
    siteUrl: string
  }>,
  taskManager: TyTaskManager,
) {
  // TODO: detect whether selected API supports function calls natively... if not,
  //       fall back to taskyon function calling...
  //const { default: Ajv } = await import('ajv')
  const ajv = new Ajv()
  const variableService = createTaskVariablePresentationService()

  const chatCompletionStream = createStream<chunkStreamType>()
  const { selectedApi, llmApis, siteUrl } = apiSettings()
  const chatCompletion = createTool({
    description: 'Generates a chat-based response using the OpenAI API for the previous message.',
    longDescription: `This tool interfaces with an OpenAI-compatible API to generate completions for
  conversation prompts. Useful for generating natural language responses in a chat setting.
  It will convert the chain pointed to by the previous Task (priorID) into openAI compatible message
  list and generate a response`,
    name: chatCompletionToolName,
    renderOptions: { hideChat: true, hideLlm: true },
    parameters: chatCompletionToolParameters,
    function: async (opts, context: toolContext) => {
      //////////   INITIALIZATION
      const {
        model,
        goal,
        llmTools = false,
        allowedTools,
        prompts,
        prompt_injections,
        schema,
        reasoning_effort: reasoningEffort,
        options,
        // if we don't set it, choose the default setting...
        use_multimodal = true,
        timeouts,
      } = opts
      const { verbosity, artificial_streaming } = options || {}
      const promptInjections = normalizePromptInjections(prompt_injections)

      const timeout = {
        totalMs: timeouts?.totalMs ?? 10 * 60 * 1000,
        stepMs: timeouts?.stepMs ?? 10 * 60 * 1000,
        chunkMs: 120 * 1000,
      }
      const useArtificialStreaming = artificial_streaming ?? true
      const tools = allowedTools ?? []

      if (!selectedApi) {
        throw new Error('No API selected!')
      }
      const requestApi = llmApis[selectedApi]
      if (!requestApi) {
        throw new Error(`api doesn't exist! ${selectedApi || 'no api selected!'}`)
      }

      // maybe ask for the llm api secrets in the future?
      const apiKey = await context.getSecret(selectedApi, false, false)
      if (!apiKey || typeof apiKey !== 'string')
        throw new Error('We need to define an API key to process our chat Task!')
      let requestApiKey = apiKey
      let delegatedTokenJti: string | undefined

      if (selectedApi === 'taskyon') {
        const tokenServiceBaseUrl = TOKEN_SERVICE_BASE_URL + TOKEN_SERVICE_PREFIX
        let delegationToken = ''
        try {
          delegationToken = await mintToken(tokenServiceBaseUrl, apiKey)
          const publicKeyPromise = await getTyJwtPublicKey()
          if (publicKeyPromise) {
            delegatedTokenJti = (await verifyServiceToken(publicKeyPromise, delegationToken)).jti
          }
        } catch (err) {
          throw new Error('Failed to mint delegation token for taskyon backend.', {
            cause: err,
          })
        }
        requestApiKey = delegationToken
      }

      const selectedModel = model ?? getCurrentModel(requestApi)
      console.log('calling chat completion tool...', selectedModel, goal, llmTools)
      // the current task doesn't *have* to exist. We can also works solely with prompts...
      const currentTask = context.taskChain.at(-1)

      const toolDefs = await taskManager.updateToolDefinitions(true)

      //////////// END INITIALIZATION

      // refactor this below and make it all explicit, without passing llmSettings...
      // now add goal-specific prompts...
      const lastTaskBeforeChatCompletion = context.taskChain.at(-2)
      // TODO: can we get rid of taskManager here in order to make our task more functional :)?
      const chatInfo = await processChatTask(
        tools,
        toolDefs,
        llmTools,
        {
          tryUsingVisionModels: use_multimodal,
        },
        taskManager,
        lastTaskBeforeChatCompletion,
        prompts ?? [],
        promptInjections,
        variableService,
      )

      let rawOutput = ''
      let partialTextOutput = ''
      const streamOpts = await llmRequest(
        chatInfo.chatCompletionMessageThread,
        chatInfo.tools,
        selectedModel,
        requestApi,
        requestApiKey,
        // only add a schema if we want ot use native tools!
        llmTools ? schema : undefined,
        siteUrl,
        goal === 'WebSearch'
          ? {
              maxResults: opts.max_results ?? 5,
              searchContextSize: 'medium',
            }
          : undefined,
        reasoningEffort,
        verbosity,
      )

      let errorCapture: unknown
      const { streamText } = await import('ai')
      const chatCompletion = streamText({
        timeout,
        includeRawChunks: true,
        onChunk({ chunk }) {
          chatCompletionStream.emit({ taskId: currentTask?.id ?? 'N/A', chunk })
          if (chunk.type === 'raw') rawOutput += chunk.rawValue as string
          partialTextOutput += extractTextFromChunk(chunk)
        },
        onError(err) {
          errorCapture = err
          console.error('Error in chat completion stream:', err)
        },
        ...(useArtificialStreaming
          ? {
              experimental_transform: smoothStream({
                delayInMs: 5, // optional: defaults to 10ms
                chunking: 'line', // optional: defaults to 'word'
              }),
            }
          : {}),
        abortSignal: context.stopSignal,
        ...streamOpts,
      })

      let res: LanguageModelResponseMetadata & {
        messages: Array<AssistantModelMessage | ToolModelMessage>
      }
      try {
        const fin = await chatCompletion.rawFinishReason
        console.log('chat completion finished because of', fin)
        res = await chatCompletion.response
        console.log('chat completion response', res, await chatCompletion.output)
      } catch (err) {
        const effectiveErr = errorCapture ?? err
        const failure = classifyStreamingFailure(effectiveErr, context.stopSignal?.aborted ?? false)
        const humanized = humanizeError(effectiveErr)
        const lower = humanized.toLowerCase()
        const failureDetails = lower.includes('no endpoints found that support tool use')
          ? [
              'Provider routing failed: no endpoint supports tool use for this request.',
              `Request context: api=${selectedApi}, model=${selectedModel}, llmTools=${llmTools}, declaredTools=${Object.keys(chatInfo.tools).length}.`,
              'Suggested fix: use a model/provider route with tool-call support, relax provider filters, or disable tool use for this run.',
              'Reference: https://openrouter.ai/docs/guides/routing/provider-selection',
            ].join('\n')
          : humanized
        const partialContent = partialTextOutput.trim() || cleanupRawStreamOutput(rawOutput)
        if (currentTask) {
          void taskManager.metaUpsert(
            currentTask.id,
            {
              error: {
                humanized,
                serialized: serializeError(effectiveErr),
                ...(effectiveErr instanceof Error
                  ? {
                      name: effectiveErr.name,
                      message: effectiveErr.message,
                      stack: effectiveErr.stack,
                      cause: serializeError(effectiveErr.cause),
                    }
                  : {}),
                context: {
                  phase: 'chatCompletion.stream',
                  shortReason: failure.shortReason,
                  selectedApi,
                  selectedModel,
                  llmTools,
                  declaredToolCount: Object.keys(chatInfo.tools).length,
                  failureDetails,
                  rawOutput,
                  partialTextOutput,
                },
              },
            },
            'shallow_merge',
          )
        }
        console.log('chat completion error', {
          rawOutput,
          partialTextOutput,
          errorCapture,
          failure,
        })
        return makeTaskResult([
          ...(partialContent
            ? [
                {
                  role: 'assistant',
                  content: {
                    type: 'message',
                    data: `${failure.assistantPrefix}\n\n${partialContent}`,
                  },
                } as partialTaskDraft,
              ]
            : []),
          {
            role: 'system',
            content: {
              type: 'error',
              data: `${failure.systemNote}${partialContent ? '' : ' No partial output was available.'}\n\n${failureDetails}`,
            },
          },
          {
            role: 'system',
            content: { type: 'return', data: `chat completion ${failure.shortReason}` },
          },
        ])
      }

      if (currentTask && lastTaskBeforeChatCompletion) {
        const metaInfo: TaskNodeMeta = await getMetaInfos(
          chatInfo,
          chatCompletion,
          rawOutput,
          res,
          currentTask,
          siteUrl,
          apiKey,
          llmApis['taskyon']?.defaultHeaders?.apiKey ?? '',
          delegatedTokenJti,
          taskManager,
        )
        console.log('saving task metadata', metaInfo)
        void taskManager.metaUpsert(currentTask.id, metaInfo, 'shallow_merge')
      }

      // in case a schema was given, we simply use that schema and return it as a structured message
      // for further processing (e.g. a contextFunction)...
      const output = await chatCompletion.output
      // convert sources
      const sources = (await chatCompletion.sources)
        .map<Annotation | undefined>((source) => {
          switch (source.sourceType) {
            case 'url':
              return {
                type: source.sourceType,
                title: source.title,
                url: source.url,
                content: source.providerMetadata?.openrouter?.content as string | undefined,
              } as Annotation
            case 'document':
              return {
                type: source.sourceType,
                title: source.title,
              } as Annotation
          }
        })
        .filter((s): s is Annotation => s !== undefined)

      if (schema) {
        // convert the output manually here :)
        let structResponse
        if (typeof output === 'string') {
          console.log('parsing custom schema', schema)
          structResponse = parseYamlResponse2Record(output || '')

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
        } else structResponse = output
        return makeTaskResult([
          ...(sources.length > 0
            ? [
                {
                  role: 'assistant',
                  content: {
                    type: 'message',
                    data: 'Provided sources for the structured response.',
                    ann: sources,
                  },
                } as partialTaskDraft,
              ]
            : []),
          {
            role: 'assistant',
            content: { type: 'structured', data: structResponse },
          },
        ])
      }

      if (!res.messages[0])
        throw new Error('The AI gave us an incomplete response!', {
          cause: chatCompletion,
        })

      const normalizedFirstMessage = normalizeAssistantMessageForToolCall(res.messages[0], toolDefs)
      const newTaskChain = generateFollowUpTasksFromResult(
        sources,
        goal || 'SimpleCompletion',
        normalizedFirstMessage,
        allowedTools,
        selectedModel,
        llmTools,
        toolDefs,
        prompts,
        promptInjections,
        variableService,
      )

      return makeTaskResult([newTaskChain])
    },
  })

  return { chatCompletion, stream: chatCompletionStream.stream }
}

export type ChatCompletionTool = Awaited<
  ReturnType<typeof createChatCompletionTool>
>['chatCompletion']

export type chatCompletionParams = FromSchema<
  ChatCompletionTool['parameters'],
  { keepDefaultedPropertiesOptional: true }
>

export type ChatCompletionArgs = Omit<chatCompletionParams, 'schema'> & {
  schema?: JSONSchema7 & Record<string, unknown>
}

async function getMetaInfos(
  chatInfo: {
    chatCompletionMessageThread: ModelMessage[]
    tools: ToolSet
    msgs: {
      prependMessages: ModelMessage[]
      modifiedOpenAIConversationThread: ModelMessage[]
      appendMessages: ModelMessage[]
    }
  },
  chatCompletion: Awaited<ReturnType<typeof streamText>>,
  rawOutput: string,
  res: LanguageModelResponseMetadata & {
    messages: Array<AssistantModelMessage | ToolModelMessage>
  },
  currentTask: TaskNode,
  siteUrl: string,
  apiKey: string,
  taskyonKey: string,
  delegatedTokenJti: string | undefined,
  taskManager: TyTaskManager,
) {
  // need to make sure, that we remove audio, image and file data here!
  // TODO: make sure the following works..  e.g. with adding a file..

  const truncatedMsgs = createDotPathTransformer({
    '*.content.*.file.file_data': () => '[[file_data omitted]]',
    '*.content.*.image_url.url': () => '[[image_url omitted]]',
    '*.content.*.input_audio.data': () => '[[input_audio omitted]]',
  })(chatInfo.chatCompletionMessageThread)
  //const out = await chatCompletion.output // same as in messages...
  const content = await chatCompletion.content
  // const b = await chatCompletion.providerMetadata
  // const t = await chatCompletion.usage
  const f = await chatCompletion.totalUsage

  const metaInfo: TaskNodeMeta = {
    streamContent: rawOutput,
    taskPrompt: truncatedMsgs,
    tools: Object.values(chatInfo.tools),
    rawOutput: chatCompletion,
    promptTokens: f.inputTokens,
    resultTokens: f.outputTokens,
    taskTokens: f.totalTokens,
    // this doesn't work correctly for taskyon.space service right now...
    //taskCosts: (b?.openrouter?.usage as Record<string, unknown>)?.cost as number,
  }

  const cont = res.messages[0]?.content
  if (typeof cont !== 'string') {
    const reasoning = content.find(
      (c: { type: string }) => c.type === 'reasoning',
    ) as ReasoningOutput
    metaInfo.reasoning = reasoning?.text
  }

  // doing deepcopy here, because we're communicating to a worker
  // and need to make sure to dereference values (e.g. if they're vue reactive objects)
  /* metaInfo.estimatedTokens = await estimateChatTokens(
    deepCopy(content),
    openAIConversationThread,
    toolDefs,
    deepCopy(allowedTools) || [],
    typeof choice?.message.content === 'string' ? choice.message.content : '',
  ) */
  // we run this asynchronously, because it fetches data in the
  // background and we don't want to wait here...
  if (delegatedTokenJti) {
    const hasUserJwt = !!apiKey && !isTaskyonKey(apiKey, false)
    if (hasUserJwt) {
      console.log('getting taskyon generation info')
      void getTaskyonCosts(siteUrl, taskyonKey, apiKey, res.id, delegatedTokenJti, currentTask?.id)
        .then((costs) => {
          if (typeof costs === 'number') {
            console.log('found new task costs:', costs)
            void taskManager.metaUpsert(currentTask.id, { taskCosts: costs }, 'shallow_merge')
          }
        })
        .catch((err) =>
          console.warn(
            'Could not retrieve taskyon generation costs, skipping taskCosts metadata.',
            err,
          ),
        )
    }
  }

  metaInfo.rawOutput = { choice: res }
  return metaInfo
}
