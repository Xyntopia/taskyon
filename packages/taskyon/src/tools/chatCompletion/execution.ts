import { streamText, type ReasoningOutput } from 'ai'
import type { TyTaskManager } from '../../core/taskManager'
import type { ArtifactStore } from '../../core/artifactStore'
import { sanitizeTaskyonVariableCommentsOutsideCode } from '../../core/taskVariables'
import { isTaskyonKey } from '../../core/tyCrypto'
import type { PromptInjection } from '../../llm/promptMessages'
import {
  getTaskyonCosts,
  getTyJwtPublicKey,
  mintToken,
  createSettlementConfirmationLoader,
  verifyServiceToken,
} from '../../taskyon.space/taskyon.space_api'
import {
  TOKEN_SERVICE_BASE_URL,
  TOKEN_SERVICE_PREFIX,
} from '../../taskyon.space/tokenservice.types'
import type {
  ChatCompletionMetadataEvent,
  ChatCompletionProviderSettings,
  ChatCompletionStreamEvent,
  ProviderRequestTrace,
  TaskNodeMeta,
} from '../../types/chatCompletion'
import type { Annotation, partialTaskDraft, TaskGetter, TaskNode } from '../../types/taskNode'
import type { toolContext } from '../../types/toolApi'
import type { ContentHash, ToolBase } from '../../types/tools'
import { humanizeError, serializeError } from '../../utils/error'
import { createDotPathTransformer, serializeForJson } from '../../utils/objHelpers'
import { prepareChatCompletionContext, resolveToolDefinitionsForTaskChain } from './context'
import { buildChatProviderRequest, normalizeNativeStructuredOutputSchema } from './providerRequest'
import {
  convertProviderSourceToAnnotation,
  extractProviderWebSearchAnnotation,
  interpretAssistantMessage,
  normalizeAssistantMessageForToolCall,
  parseStructuredResponseWithTrailingText,
  validateStructuredResponse,
} from './response'
import { cleanupRawStreamOutput, runChatCompletionStream } from './streamResult'
import {
  isChatCompletionResponseTracingEnabled,
  isChatCompletionTracingEnabled,
  redactChatCompletionTraceValue,
  writeChatCompletionTrace,
} from '../chatCompletionTrace'
import { resolveNativeWebSearchSupport } from './webSearchSupport'
import { limitActiveTools } from './activeTools'
import {
  buildChatCompletionRetryDelayTask,
  buildNextChatCompletionRetry,
  findLatestChatCompletionRetry,
} from '../chatCompletionRetryTool'
import type { chatCompletionParams } from '../chatCompletionTool'

export type ChatCompletionToolCapabilities = {
  getTaskChain: TyTaskManager['getTaskChain']
  getTaskChainSelection: TyTaskManager['getTaskChainSelection']
  getTask: TaskGetter
  getArtifact?: ArtifactStore['get']
  listToolDefinitions: () => Promise<Record<string, ToolBase>>
  resolveToolDefinition?: (name: string, revision?: ContentHash) => Promise<ToolBase | undefined>
  fetch?: typeof fetch
}

export type ChatCompletionRunnerDeps = {
  providerConnection: Omit<ChatCompletionProviderSettings, 'model'>
  capabilities: ChatCompletionToolCapabilities
  emitChatCompletionStream: (event: ChatCompletionStreamEvent) => void
  emitMetadata: (event: ChatCompletionMetadataEvent) => void
}

const getChatCompletionContextOptions = (maxFollow: number | undefined) =>
  maxFollow === undefined ? undefined : { maxFollow }

const normalizePromptInjections = (value: unknown): PromptInjection[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []

const appendAnnotations = (
  annotations: readonly Annotation[] | undefined,
  extra: Annotation | undefined,
): Annotation[] | undefined => {
  const merged = [...(annotations ?? []), ...(extra ? [extra] : [])]
  return merged.length > 0 ? merged : undefined
}

const normalizeProviderUsage = (
  usage: Awaited<ReturnType<typeof streamText>['totalUsage']>,
): NonNullable<ProviderRequestTrace['usage']> => ({
  inputTokens: {
    ...(usage.inputTokens === undefined ? {} : { total: usage.inputTokens }),
    ...(usage.inputTokenDetails.noCacheTokens === undefined
      ? {}
      : { noCache: usage.inputTokenDetails.noCacheTokens }),
    ...(usage.inputTokenDetails.cacheReadTokens === undefined
      ? {}
      : { cacheRead: usage.inputTokenDetails.cacheReadTokens }),
    ...(usage.inputTokenDetails.cacheWriteTokens === undefined
      ? {}
      : { cacheWrite: usage.inputTokenDetails.cacheWriteTokens }),
  },
  outputTokens: {
    ...(usage.outputTokens === undefined ? {} : { total: usage.outputTokens }),
    ...(usage.outputTokenDetails.textTokens === undefined
      ? {}
      : { text: usage.outputTokenDetails.textTokens }),
    ...(usage.outputTokenDetails.reasoningTokens === undefined
      ? {}
      : { reasoning: usage.outputTokenDetails.reasoningTokens }),
  },
  ...(usage.totalTokens === undefined ? {} : { totalTokens: usage.totalTokens }),
})

const readProviderCosts = async (
  chatCompletion: Awaited<ReturnType<typeof streamText>>,
  provider: string,
) => {
  const providerMetadata = await chatCompletion.providerMetadata
  const providerUsage = providerMetadata?.openrouter?.usage as { cost?: unknown } | undefined
  return typeof providerUsage?.cost === 'number' &&
    Number.isFinite(providerUsage.cost) &&
    providerUsage.cost >= 0
    ? [{ amount: providerUsage.cost, source: provider, unit: 'USD' }]
    : []
}

type ChatCompletionStreamResult = Awaited<ReturnType<typeof runChatCompletionStream>>
type SuccessfulChatCompletionStreamResult = Extract<ChatCompletionStreamResult, { ok: true }>
type FailedChatCompletionStreamResult = Extract<ChatCompletionStreamResult, { ok: false }>
type ChatCompletionChatInfo = Awaited<ReturnType<typeof prepareChatCompletionContext>>

type ChatCompletionRequest = {
  selectedApi: string
  selectedModel: string
  schema: chatCompletionParams['schema']
  nativeStructuredSchema: ReturnType<typeof normalizeNativeStructuredOutputSchema>
  websearch: chatCompletionParams['websearch']
  reasoningEffort: chatCompletionParams['reasoning_effort']
  verbosity: NonNullable<chatCompletionParams['options']>['verbosity']
  activeTools: string[]
  useProviderToolCalling: boolean
  normalizedToolChoice: { type: 'tool'; toolName: string } | 'required' | 'auto' | undefined
  normalizedPrependSystemPrompts: PromptInjection[]
  effectiveAppendSystemPrompts: string[]
  useMultimodal: boolean
  contextSize: number | undefined
  timeout: { totalMs: number; stepMs: number; chunkMs: number }
  useArtificialStreaming: boolean
  supportsNativeWebSearch: boolean
  traceEnabled: boolean
  captureResponse: boolean
  traceLabel: string | undefined
}

type ChatCompletionAuth = {
  apiKey: string
  requestApiKey: string
  delegatedTokenJti: string | undefined
}

type ChatCompletionRun = {
  request: ChatCompletionRequest
  auth: ChatCompletionAuth
  context: toolContext
  deps: ChatCompletionRunnerDeps
  currentTask: TaskNode | undefined
  lastTaskBeforeChatCompletion: TaskNode | undefined
  taskChain: TaskNode[]
  toolDefs: Record<string, ToolBase>
  chatInfo: ChatCompletionChatInfo
  providerRequest: ProviderRequestTrace
  streamOpts: Parameters<typeof streamText>[0]
}

type ChatCompletionStreamRun = {
  streamResult: ChatCompletionStreamResult
  rawResponseChunks: unknown[]
}

type ChatCompletionFailureState = {
  effectiveErr: unknown
  failure: FailedChatCompletionStreamResult['failure']
  humanized: string
  retryState: ReturnType<typeof buildNextChatCompletionRetry> | undefined
  failureDetails: string
}

type ChatCompletionPartialOutput = {
  partialContent: string
  sanitizedPartialContent: ReturnType<typeof sanitizeTaskyonVariableCommentsOutsideCode> | undefined
  partialAssistantSanitation: NonNullable<TaskNodeMeta['assistantOutputSanitation']> | undefined
}

const assertRequiredWebSearchSupported = (
  websearch: chatCompletionParams['websearch'],
  supportsNativeWebSearch: boolean,
  selectedApi: string,
) => {
  if (websearch?.enabled === true && websearch.mode === 'required' && !supportsNativeWebSearch) {
    throw new Error(
      `Provider '${selectedApi}' does not support web search in required mode. Select a provider with web search support or disable web search.`,
    )
  }
}

const normalizeToolChoice = (
  toolChoice: chatCompletionParams['toolChoice'],
): ChatCompletionRequest['normalizedToolChoice'] =>
  toolChoice?.type === 'tool' && typeof toolChoice.toolName === 'string'
    ? { type: 'tool', toolName: toolChoice.toolName }
    : toolChoice?.type === 'required'
      ? 'required'
      : toolChoice?.type === 'auto'
        ? 'auto'
        : undefined

const resolveAppendSystemPrompts = (
  schema: chatCompletionParams['schema'],
  nativeStructuredSchema: ReturnType<typeof normalizeNativeStructuredOutputSchema>,
  appendSystemPrompts: chatCompletionParams['appendSystemPrompts'],
) => {
  const normalized = appendSystemPrompts ?? []
  return schema && !nativeStructuredSchema
    ? [
        ...normalized,
        `Return only JSON matching this schema exactly:\n${JSON.stringify(schema, null, 2)}`,
      ]
    : normalized
}

const resolveTimeout = (timeouts: chatCompletionParams['timeouts']) => ({
  totalMs: timeouts?.totalMs ?? 10 * 60 * 1000,
  stepMs: timeouts?.stepMs ?? 10 * 60 * 1000,
  chunkMs: 120 * 1000,
})

const resolveChatCompletionTools = (
  opts: chatCompletionParams,
  providerConnection: Omit<ChatCompletionProviderSettings, 'model'>,
) => {
  const activeTools = limitActiveTools(
    Array.from(new Set(opts.allowedTools ?? [])),
    providerConnection.maxActiveTools,
  )
  return {
    activeTools,
    useProviderToolCalling: activeTools.length > 0,
    normalizedToolChoice: normalizeToolChoice(opts.toolChoice),
  }
}

const resolveChatCompletionPromptConfig = (
  opts: chatCompletionParams,
  nativeStructuredSchema: ReturnType<typeof normalizeNativeStructuredOutputSchema>,
) => {
  const { artificial_streaming } = opts.options || {}
  return {
    normalizedPrependSystemPrompts: normalizePromptInjections(opts.prependSystemPrompts),
    effectiveAppendSystemPrompts: resolveAppendSystemPrompts(
      opts.schema,
      nativeStructuredSchema,
      opts.appendSystemPrompts,
    ),
    useMultimodal: opts.use_multimodal ?? true,
    contextSize: opts.context_size,
    timeout: resolveTimeout(opts.timeouts),
    useArtificialStreaming: artificial_streaming ?? true,
  }
}

const resolveChatCompletionTracing = (opts: chatCompletionParams) => ({
  traceEnabled: isChatCompletionTracingEnabled(opts.trace?.enabled === true),
  captureResponse: isChatCompletionResponseTracingEnabled(),
  traceLabel: typeof opts.trace?.label === 'string' ? opts.trace.label : undefined,
})

const resolveChatCompletionRequest = (
  opts: chatCompletionParams,
  providerConnection: Omit<ChatCompletionProviderSettings, 'model'>,
): ChatCompletionRequest => {
  const { verbosity } = opts.options || {}
  const selectedApi = providerConnection.provider
  const supportsNativeWebSearch = resolveNativeWebSearchSupport(providerConnection)
  assertRequiredWebSearchSupported(opts.websearch, supportsNativeWebSearch, selectedApi)
  if (!opts.model) throw new Error('chatCompletion requires an explicit model parameter.')
  const nativeStructuredSchema = opts.schema
    ? normalizeNativeStructuredOutputSchema(opts.schema)
    : undefined
  return {
    selectedApi,
    selectedModel: opts.model,
    schema: opts.schema,
    nativeStructuredSchema,
    websearch: opts.websearch,
    reasoningEffort: opts.reasoning_effort,
    verbosity,
    supportsNativeWebSearch,
    ...resolveChatCompletionTools(opts, providerConnection),
    ...resolveChatCompletionPromptConfig(opts, nativeStructuredSchema),
    ...resolveChatCompletionTracing(opts),
  }
}

const mintTaskyonDelegationToken = async (
  apiKey: string,
  settlementConfirmation: ReturnType<typeof createSettlementConfirmationLoader>,
): Promise<ChatCompletionAuth> => {
  const tokenServiceBaseUrl = TOKEN_SERVICE_BASE_URL + TOKEN_SERVICE_PREFIX
  let delegationToken = ''
  let delegatedTokenJti: string | undefined
  try {
    const cnf = await settlementConfirmation.get()
    delegationToken = await mintToken(tokenServiceBaseUrl, apiKey, cnf)
    const publicKeyPromise = await getTyJwtPublicKey()
    if (publicKeyPromise) {
      delegatedTokenJti = (await verifyServiceToken(publicKeyPromise, delegationToken)).jti
    }
  } catch (err) {
    throw new Error('Failed to mint delegation token for taskyon backend.', { cause: err })
  }
  return { apiKey, requestApiKey: delegationToken, delegatedTokenJti }
}

const resolveChatCompletionAuth = async (
  selectedApi: string,
  context: toolContext,
  settlementConfirmation: ReturnType<typeof createSettlementConfirmationLoader>,
): Promise<ChatCompletionAuth> => {
  const apiKey = await context.getSecret(selectedApi, false, false)
  if (!apiKey || typeof apiKey !== 'string')
    throw new Error('We need to define an API key to process our chat Task!')
  if (selectedApi !== 'taskyon')
    return { apiKey, requestApiKey: apiKey, delegatedTokenJti: undefined }
  return await mintTaskyonDelegationToken(apiKey, settlementConfirmation)
}

const resolveSelectedTaskChain = async (
  lastTaskBeforeChatCompletion: TaskNode | undefined,
  contextSize: number | undefined,
  capabilities: ChatCompletionToolCapabilities,
) => {
  if (!lastTaskBeforeChatCompletion) return { tasks: [], includedSubtaskTaskIds: [] }
  const contextOptions = getChatCompletionContextOptions(contextSize)
  return await capabilities.getTaskChainSelection(
    lastTaskBeforeChatCompletion.id,
    contextOptions?.maxFollow,
    { method: 'lineage' },
  )
}

const createProviderRequestTrace = (
  request: ChatCompletionRequest,
  currentTask: TaskNode | undefined,
): ProviderRequestTrace => ({
  provider: request.selectedApi,
  model: request.selectedModel,
  taskId: currentTask?.id ?? 'N/A',
  recordedAt: new Date().toISOString(),
  attempts: [],
})

const buildRunStreamOptions = async (
  request: ChatCompletionRequest,
  auth: ChatCompletionAuth,
  providerRequest: ProviderRequestTrace,
  chatInfo: ChatCompletionChatInfo,
  taskChain: TaskNode[],
  deps: ChatCompletionRunnerDeps,
): Promise<Parameters<typeof streamText>[0]> =>
  await buildChatProviderRequest({
    messages: chatInfo.messages,
    tools: chatInfo.tools,
    selectedModel: request.selectedModel,
    api: { ...deps.providerConnection, model: request.selectedModel },
    apiKey: auth.requestApiKey,
    ...(request.nativeStructuredSchema ? { schema: request.nativeStructuredSchema } : {}),
    ...(request.websearch?.enabled === true && request.supportsNativeWebSearch
      ? {
          webSearch: {
            maxResults: request.websearch.max_results ?? 5,
            searchContextSize: 'medium',
            mode: request.websearch.mode ?? 'auto',
          } as const,
        }
      : {}),
    ...(request.reasoningEffort ? { reasoningEffort: request.reasoningEffort } : {}),
    ...(request.verbosity ? { verbosity: request.verbosity } : {}),
    ...(request.normalizedToolChoice ? { toolChoice: request.normalizedToolChoice } : {}),
    ...(taskChain[0]?.id ? { promptCacheRootId: taskChain[0].id } : {}),
    providerRequest,
    ...(deps.capabilities.fetch ? { fetch: deps.capabilities.fetch } : {}),
  })

const loadChatCompletionTaskContext = async (
  request: ChatCompletionRequest,
  deps: ChatCompletionRunnerDeps,
  context: toolContext,
) => {
  const executionTaskChain = await context.getExecutionTaskChain()
  const currentTask = executionTaskChain.at(-1)
  const lastTaskBeforeChatCompletion = executionTaskChain.at(-2)
  const registeredToolDefs = await deps.capabilities.listToolDefinitions()
  const selectedTaskChain = await resolveSelectedTaskChain(
    lastTaskBeforeChatCompletion,
    request.contextSize,
    deps.capabilities,
  )
  const taskChain = selectedTaskChain.tasks
  const toolDefs = await resolveToolDefinitionsForTaskChain(
    taskChain,
    registeredToolDefs,
    deps.capabilities.resolveToolDefinition,
  )
  const chatInfo = await prepareChatCompletionContext({
    taskChain,
    allowedTools: request.activeTools,
    toolDefinitions: toolDefs,
    appendSystemPrompts: request.effectiveAppendSystemPrompts,
    prependSystemPrompts: request.normalizedPrependSystemPrompts,
    useVisionModels: request.useMultimodal,
    ...(deps.capabilities.getArtifact ? { getArtifact: deps.capabilities.getArtifact } : {}),
    getTaskById: deps.capabilities.getTask,
    subtaskHandoffTaskIds: new Set(selectedTaskChain.includedSubtaskTaskIds),
  })
  return { currentTask, lastTaskBeforeChatCompletion, taskChain, toolDefs, chatInfo }
}

const prepareChatCompletionRun = async (
  request: ChatCompletionRequest,
  auth: ChatCompletionAuth,
  deps: ChatCompletionRunnerDeps,
  context: toolContext,
): Promise<ChatCompletionRun> => {
  console.log(
    'calling chat completion tool...',
    request.selectedModel,
    request.useProviderToolCalling,
  )
  const taskContext = await loadChatCompletionTaskContext(request, deps, context)
  const providerRequest = createProviderRequestTrace(request, taskContext.currentTask)
  const streamOpts = await buildRunStreamOptions(
    request,
    auth,
    providerRequest,
    taskContext.chatInfo,
    taskContext.taskChain,
    deps,
  )
  return {
    request,
    auth,
    context,
    deps,
    ...taskContext,
    providerRequest,
    streamOpts,
  }
}

const runChatCompletionStreamWithEvents = async (
  run: ChatCompletionRun,
): Promise<ChatCompletionStreamRun> => {
  const rawResponseChunks: unknown[] = []
  const streamResult = await runChatCompletionStream({
    streamText,
    streamOptions: run.streamOpts,
    timeout: run.request.timeout,
    useArtificialStreaming: run.request.useArtificialStreaming,
    abortSignal: run.context.stopSignal,
    onChunk(chunk) {
      const event = { taskId: run.currentTask?.id ?? 'N/A', chunk }
      run.deps.emitChatCompletionStream(event)
      if (run.request.captureResponse && chunk.type === 'raw') {
        rawResponseChunks.push(redactChatCompletionTraceValue(chunk.rawValue))
      }
    },
  })
  return { streamResult, rawResponseChunks }
}

const buildFailureDetails = (input: {
  humanized: string
  failure: FailedChatCompletionStreamResult['failure']
  retryState: ReturnType<typeof buildNextChatCompletionRetry> | undefined
  selectedApi: string
  selectedModel: string
  useProviderToolCalling: boolean
  declaredToolCount: number
}): string => {
  if (input.humanized.toLowerCase().includes('no endpoints found that support tool use')) {
    return [
      'Provider routing failed: no endpoint supports tool use for this request.',
      `Request context: api=${input.selectedApi}, model=${input.selectedModel}, providerToolCalling=${input.useProviderToolCalling}, declaredTools=${input.declaredToolCount}.`,
      'Suggested fix: use a model/provider route with tool-call support, relax provider filters, or disable tool use for this run.',
      'Reference: https://openrouter.ai/docs/guides/routing/provider-selection',
    ].join('\n')
  }
  if (input.failure.shortReason === 'transient provider failure') {
    return [
      input.humanized,
      input.retryState
        ? `Taskyon will retry this chat completion in ${Math.ceil((input.retryState.retryAt - input.retryState.scheduledAt) / 1000)} seconds (visible retry ${input.retryState.retryNumber}); retries stop after ${new Date(input.retryState.retryDeadlineAt).toISOString()}.`
        : 'Taskyon stopped retrying because the 24-hour transient-provider recovery window expired.',
    ].join('\n')
  }
  return input.humanized
}

const resolveChatCompletionFailureState = (
  run: ChatCompletionRun,
  streamResult: FailedChatCompletionStreamResult,
): ChatCompletionFailureState => {
  const effectiveErr = streamResult.error
  const failure = streamResult.failure
  const humanized = humanizeError(effectiveErr)
  const retryState =
    failure.shortReason === 'transient provider failure'
      ? buildNextChatCompletionRetry(findLatestChatCompletionRetry(run.taskChain), Date.now())
      : undefined
  return {
    effectiveErr,
    failure,
    humanized,
    retryState,
    failureDetails: buildFailureDetails({
      humanized,
      failure,
      retryState,
      selectedApi: run.request.selectedApi,
      selectedModel: run.request.selectedModel,
      useProviderToolCalling: run.request.useProviderToolCalling,
      declaredToolCount: Object.keys(run.chatInfo.tools).length,
    }),
  }
}

const resolveChatCompletionPartialOutput = (
  streamResult: FailedChatCompletionStreamResult,
): ChatCompletionPartialOutput => {
  const partialContent =
    streamResult.partialTextOutput.trim() || cleanupRawStreamOutput(streamResult.rawOutput)
  const sanitizedPartialContent =
    partialContent.length > 0
      ? sanitizeTaskyonVariableCommentsOutsideCode(partialContent)
      : undefined
  if (sanitizedPartialContent && sanitizedPartialContent.removedComments.length > 0) {
    console.warn('Removed Taskyon variable comments from assistant output.', {
      original: partialContent,
      sanitized: sanitizedPartialContent.sanitized,
      removedComments: sanitizedPartialContent.removedComments,
    })
  }
  return {
    partialContent,
    sanitizedPartialContent,
    partialAssistantSanitation:
      sanitizedPartialContent && sanitizedPartialContent.removedComments.length > 0
        ? {
            rawIncomingMessage: partialContent,
            sanitizedMessage: sanitizedPartialContent.sanitized,
            removedComments: sanitizedPartialContent.removedComments,
          }
        : undefined,
  }
}

const buildChatCompletionFailureMetadata = (
  run: ChatCompletionRun,
  state: ChatCompletionFailureState,
  partial: ChatCompletionPartialOutput,
  streamResult: FailedChatCompletionStreamResult,
): TaskNodeMeta => ({
  error: {
    humanized: state.humanized,
    serialized: serializeError(state.effectiveErr),
    ...(state.effectiveErr instanceof Error
      ? {
          name: state.effectiveErr.name,
          message: state.effectiveErr.message,
          stack: state.effectiveErr.stack,
          cause: serializeError(state.effectiveErr.cause),
        }
      : {}),
    context: {
      phase: 'chatCompletion.stream',
      shortReason: state.failure.shortReason,
      selectedApi: run.request.selectedApi,
      selectedModel: run.request.selectedModel,
      providerToolCalling: run.request.useProviderToolCalling,
      declaredToolCount: Object.keys(run.chatInfo.tools).length,
      failureDetails: state.failureDetails,
      rawOutput: streamResult.rawOutput,
      partialTextOutput: streamResult.partialTextOutput,
    },
  },
  ...(partial.partialAssistantSanitation
    ? { assistantOutputSanitation: partial.partialAssistantSanitation }
    : {}),
  providerRequest: run.providerRequest,
  ...(streamResult.providerWebSearch ? { providerWebSearch: streamResult.providerWebSearch } : {}),
})

const emitChatCompletionFailureMetadata = (
  run: ChatCompletionRun,
  state: ChatCompletionFailureState,
  partial: ChatCompletionPartialOutput,
  streamResult: FailedChatCompletionStreamResult,
) => {
  if (run.currentTask) {
    run.deps.emitMetadata({
      taskId: run.currentTask.id,
      metadata: buildChatCompletionFailureMetadata(run, state, partial, streamResult),
    })
  }
  console.log('chat completion error', {
    rawOutput: streamResult.rawOutput,
    partialTextOutput: streamResult.partialTextOutput,
    error: state.effectiveErr,
    failure: state.failure,
  })
}

const writeChatCompletionFailureTrace = async (
  run: ChatCompletionRun,
  state: ChatCompletionFailureState,
  streamed: ChatCompletionStreamRun,
) => {
  const streamResult = streamed.streamResult
  if (!run.request.traceEnabled || streamResult.ok) return
  await writeChatCompletionTrace({
    taskId: run.providerRequest.taskId,
    ...(run.request.traceLabel ? { label: run.request.traceLabel } : {}),
    providerRequest: run.providerRequest,
    ...(run.request.captureResponse
      ? {
          providerResponse: {
            rawChunks: streamed.rawResponseChunks,
            error: redactChatCompletionTraceValue({
              name: state.effectiveErr instanceof Error ? state.effectiveErr.name : undefined,
              message: state.humanized,
            }),
            ...(streamResult.providerWebSearch
              ? { providerWebSearch: streamResult.providerWebSearch }
              : {}),
          },
        }
      : {}),
  })
}

const buildFailureAssistantDraft = (
  failure: ChatCompletionFailureState['failure'],
  sanitizedPartialContent: string,
): partialTaskDraft => ({
  role: 'assistant',
  content: {
    type: 'message',
    data: `${failure.assistantPrefix}\n\n${sanitizedPartialContent}`,
  },
})

const buildFailureErrorTask = (
  run: ChatCompletionRun,
  state: ChatCompletionFailureState,
  partial: ChatCompletionPartialOutput,
) => ({
  role: 'system' as const,
  ...(state.failure.shortReason === 'transient provider failure'
    ? { label: ['chatCompletion:transient-provider-failure'] }
    : {}),
  content: {
    type: 'error' as const,
    data: {
      message: `${state.failure.systemNote}${partial.partialContent ? '' : ' No partial output was available.'}\n\n${state.failureDetails}`,
      error: serializeForJson(state.effectiveErr),
      context: {
        shortReason: state.failure.shortReason,
        systemNote: state.failure.systemNote,
        failureDetails: state.failureDetails,
        hasPartialOutput: partial.partialContent.length > 0,
        selectedApi: run.request.selectedApi,
        selectedModel: run.request.selectedModel,
        providerToolCalling: run.request.useProviderToolCalling,
        declaredToolCount: Object.keys(run.chatInfo.tools).length,
      },
    },
  },
})

const buildFailureRetryTasks = (state: ChatCompletionFailureState) =>
  state.retryState
    ? [buildChatCompletionRetryDelayTask(state.retryState)]
    : [
        {
          role: 'system' as const,
          content: {
            type: 'return' as const,
            data: `chat completion ${state.failure.shortReason}`,
          },
        },
      ]

const buildChatCompletionFailureSubtasks = (
  run: ChatCompletionRun,
  state: ChatCompletionFailureState,
  partial: ChatCompletionPartialOutput,
) =>
  run.context.createSubtasksResult([
    ...(partial.sanitizedPartialContent
      ? [buildFailureAssistantDraft(state.failure, partial.sanitizedPartialContent.sanitized)]
      : []),
    buildFailureErrorTask(run, state, partial),
    ...buildFailureRetryTasks(state),
  ])

const buildChatCompletionFailureResult = async (
  run: ChatCompletionRun,
  streamed: ChatCompletionStreamRun,
  settlementConfirmation: ReturnType<typeof createSettlementConfirmationLoader>,
): Promise<unknown> => {
  const streamResult = streamed.streamResult
  if (streamResult.ok) throw new Error('Expected a failed chat completion stream result.')
  if (run.request.selectedApi === 'taskyon') settlementConfirmation.clear()
  const state = resolveChatCompletionFailureState(run, streamResult)
  const partial = resolveChatCompletionPartialOutput(streamResult)
  emitChatCompletionFailureMetadata(run, state, partial, streamResult)
  await writeChatCompletionFailureTrace(run, state, streamed)
  return buildChatCompletionFailureSubtasks(run, state, partial)
}

const emitProviderCostMetadata = async (
  run: ChatCompletionRun,
  streamResult: SuccessfulChatCompletionStreamResult,
) => {
  const currentTask = run.currentTask
  if (!currentTask) return
  const costs = await readProviderCosts(streamResult.completion, run.request.selectedApi)
  run.deps.emitMetadata({
    taskId: currentTask.id,
    metadata: {
      providerRequest: run.providerRequest,
      ...(streamResult.providerWebSearch
        ? { providerWebSearch: streamResult.providerWebSearch }
        : {}),
      ...(costs.length > 0 ? { costs } : {}),
    },
  })
}

const emitTaskMetadataWithMetaInfos = async (
  run: ChatCompletionRun,
  streamResult: SuccessfulChatCompletionStreamResult,
  totalUsage: Awaited<ReturnType<typeof streamText>['totalUsage']>,
) => {
  const currentTask = run.currentTask
  if (!currentTask) return
  const metaInfo: TaskNodeMeta = await getMetaInfos(
    run.chatInfo,
    streamResult.completion,
    streamResult.rawOutput,
    streamResult.response,
    currentTask,
    run.deps.providerConnection.defaultHeaders,
    run.auth.apiKey,
    run.deps.providerConnection.defaultHeaders?.apiKey ?? '',
    run.auth.delegatedTokenJti,
    run.deps.emitMetadata,
    totalUsage,
    run.request.selectedApi,
  )
  metaInfo.providerRequest = run.providerRequest
  if (streamResult.providerWebSearch) metaInfo.providerWebSearch = streamResult.providerWebSearch
  console.log('saving task metadata', {
    taskId: currentTask.id,
    providerAttempts: run.providerRequest.attempts.length,
  })
  run.deps.emitMetadata({ taskId: currentTask.id, metadata: metaInfo })
}

const emitChatCompletionSuccessMetadata = async (
  run: ChatCompletionRun,
  streamed: ChatCompletionStreamRun,
) => {
  const streamResult = streamed.streamResult
  if (!streamResult.ok) return
  const totalUsage = await streamResult.completion.totalUsage
  run.providerRequest.usage = normalizeProviderUsage(totalUsage)
  if (run.currentTask && run.lastTaskBeforeChatCompletion) {
    await emitTaskMetadataWithMetaInfos(run, streamResult, totalUsage)
  } else if (run.currentTask) {
    await emitProviderCostMetadata(run, streamResult)
  }
}

const writeChatCompletionSuccessTrace = async (
  run: ChatCompletionRun,
  streamed: ChatCompletionStreamRun,
  output: Awaited<ReturnType<typeof streamText>['output']>,
  providerSources: Awaited<ReturnType<typeof streamText>['sources']>,
) => {
  const streamResult = streamed.streamResult
  if (!run.request.traceEnabled || !streamResult.ok) return
  const finishReason = run.request.captureResponse
    ? await streamResult.completion.rawFinishReason
    : undefined
  await writeChatCompletionTrace({
    taskId: run.providerRequest.taskId,
    ...(run.request.traceLabel ? { label: run.request.traceLabel } : {}),
    providerRequest: run.providerRequest,
    ...(run.request.captureResponse
      ? {
          providerResponse: {
            rawChunks: streamed.rawResponseChunks,
            messages: redactChatCompletionTraceValue(streamResult.response.messages),
            sources: redactChatCompletionTraceValue(providerSources),
            output: redactChatCompletionTraceValue(output),
            ...(typeof finishReason === 'string' ? { finishReason } : {}),
            ...(streamResult.providerWebSearch
              ? { providerWebSearch: streamResult.providerWebSearch }
              : {}),
          },
        }
      : {}),
  })
}

const buildStructuredChatCompletionResult = (
  run: ChatCompletionRun,
  output: Awaited<ReturnType<typeof streamText>['output']>,
  sources: Annotation[],
  providerSearch: Annotation | undefined,
): unknown => {
  const schema = run.request.schema
  if (!schema) throw new Error('Expected a structured output schema.')
  const parsedResponse: { data: unknown; trailingText?: string } =
    typeof output === 'string'
      ? parseStructuredResponseWithTrailingText(output || '')
      : { data: output }
  if (typeof schema !== 'object' || schema === null) {
    throw new Error('Schema needs to be an object!', { cause: schema })
  }
  const structResponse = validateStructuredResponse(parsedResponse.data, schema)
  const annotations = appendAnnotations(sources, providerSearch)
  return run.context.createSubtasksResult([
    ...(parsedResponse.trailingText
      ? [
          {
            role: 'assistant' as const,
            content: { type: 'message' as const, data: parsedResponse.trailingText },
          },
        ]
      : []),
    {
      role: 'assistant',
      content: {
        type: 'structured',
        data: structResponse,
        ...(annotations ? { ann: annotations } : {}),
      },
    },
  ])
}

const buildToolCallDrafts = (
  outcome: Extract<ReturnType<typeof interpretAssistantMessage>, { kind: 'tool-calls' }>,
  providerSearch: Annotation | undefined,
): partialTaskDraft[] => [
  ...(outcome.assistantMessages ?? []).map<partialTaskDraft>((message) => ({
    role: 'assistant',
    content: {
      type: 'message',
      data: message.content,
      ...(message.annotations ? { ann: message.annotations } : {}),
    },
  })),
  ...outcome.calls.map<partialTaskDraft>((call, index) => {
    const annotations = index === 0 ? appendAnnotations(undefined, providerSearch) : undefined
    return {
      role: 'function',
      content: {
        type: 'functioncall',
        data: call,
        ...(annotations ? { ann: annotations } : {}),
      },
    }
  }),
]

const buildAnswerDrafts = (
  outcome: Extract<ReturnType<typeof interpretAssistantMessage>, { kind: 'answers' }>,
  providerSearch: Annotation | undefined,
): partialTaskDraft[] =>
  outcome.answers.flatMap<partialTaskDraft>((answer, index) => {
    const annotations = appendAnnotations(
      answer.annotations,
      index === 0 ? providerSearch : undefined,
    )
    return [
      {
        role: 'assistant',
        content: {
          type: 'message',
          data: answer.content,
          ...(annotations ? { ann: annotations } : {}),
        },
      },
      {
        role: 'system',
        content: { type: 'return', data: 'assistant answered' },
      },
    ]
  })

const buildOutcomeChatCompletionResult = (
  run: ChatCompletionRun,
  completion: SuccessfulChatCompletionStreamResult['completion'],
  res: Awaited<ReturnType<typeof streamText>['response']>,
  sources: Annotation[],
  providerSearch: Annotation | undefined,
): unknown => {
  if (!res.messages[0]) {
    throw new Error('The AI gave us an incomplete response!', { cause: completion })
  }
  const normalizedFirstMessage = normalizeAssistantMessageForToolCall(res.messages[0], run.toolDefs)
  const outcome = interpretAssistantMessage(
    sources,
    normalizedFirstMessage,
    run.request.useProviderToolCalling,
    run.toolDefs,
    run.chatInfo.variableService,
  )
  const assistantOutputSanitation = outcome.sanitation.at(-1)
  if (run.currentTask && assistantOutputSanitation) {
    run.deps.emitMetadata({
      taskId: run.currentTask.id,
      metadata: { assistantOutputSanitation },
    })
  }
  switch (outcome.kind) {
    case 'tool-calls':
      return run.context.createSubtasksResult([buildToolCallDrafts(outcome, providerSearch)])
    case 'answers':
      return run.context.createSubtasksResult([buildAnswerDrafts(outcome, providerSearch)])
    case 'empty':
      return run.context.createSubtasksResult([[]])
  }
}

const buildChatCompletionSuccessResult = async (
  run: ChatCompletionRun,
  streamed: ChatCompletionStreamRun,
): Promise<unknown> => {
  const streamResult = streamed.streamResult
  if (!streamResult.ok) throw new Error('Expected a successful chat completion stream result.')
  const { completion, response: res } = streamResult
  const output = await completion.output
  const providerSources = await completion.sources
  await writeChatCompletionSuccessTrace(run, streamed, output, providerSources)
  const sources = providerSources.map(convertProviderSourceToAnnotation)
  const providerSearch = extractProviderWebSearchAnnotation(
    res.messages,
    streamResult.providerWebSearch,
  )
  if (run.request.schema) {
    return buildStructuredChatCompletionResult(run, output, sources, providerSearch)
  }
  return buildOutcomeChatCompletionResult(run, completion, res, sources, providerSearch)
}

export const createChatCompletionRunner = (deps: ChatCompletionRunnerDeps) => {
  const settlementConfirmation = createSettlementConfirmationLoader(deps.providerConnection.baseURL)

  return async (opts: chatCompletionParams, context: toolContext): Promise<unknown> => {
    const request = resolveChatCompletionRequest(opts, deps.providerConnection)
    const auth = await resolveChatCompletionAuth(
      request.selectedApi,
      context,
      settlementConfirmation,
    )
    const run = await prepareChatCompletionRun(request, auth, deps, context)
    const streamed = await runChatCompletionStreamWithEvents(run)
    if (!streamed.streamResult.ok) {
      return await buildChatCompletionFailureResult(run, streamed, settlementConfirmation)
    }
    await emitChatCompletionSuccessMetadata(run, streamed)
    return await buildChatCompletionSuccessResult(run, streamed)
  }
}

const truncateChatMessages = (messages: ChatCompletionChatInfo['messages']) =>
  createDotPathTransformer({
    '*.content.*.file.file_data': () => '[[file_data omitted]]',
    '*.content.*.image_url.url': () => '[[image_url omitted]]',
    '*.content.*.input_audio.data': () => '[[input_audio omitted]]',
  })(messages)

const readReasoningText = (
  content: Awaited<ReturnType<typeof streamText>['content']>,
): string | undefined => {
  const reasoning = content.find((c: { type: string }) => c.type === 'reasoning') as ReasoningOutput
  return reasoning?.text
}

const emitTaskyonGenerationCosts = (input: {
  apiKey: string
  taskyonKey: string
  providerHeaders: Readonly<Record<string, string>> | undefined
  delegatedTokenJti: string
  responseId: string
  taskId: string
  emitMetadata: (event: ChatCompletionMetadataEvent) => void
}) => {
  const hasUserJwt = !!input.apiKey && !isTaskyonKey(input.apiKey, false)
  if (!hasUserJwt) return
  console.log('getting taskyon generation info')
  void getTaskyonCosts(
    input.providerHeaders,
    input.taskyonKey,
    input.apiKey,
    input.responseId,
    input.delegatedTokenJti,
    input.taskId,
  )
    .then((costs) => {
      if (typeof costs === 'number') {
        console.log('found new task costs:', costs)
        input.emitMetadata({ taskId: input.taskId, metadata: { taskCosts: costs } })
      }
    })
    .catch((err) =>
      console.warn(
        'Could not retrieve taskyon generation costs, skipping taskCosts metadata.',
        err,
      ),
    )
}

const buildChatCompletionMetaInfo = async (
  chatInfo: ChatCompletionChatInfo,
  chatCompletion: Awaited<ReturnType<typeof streamText>>,
  rawOutput: string,
  totalUsage: Awaited<ReturnType<typeof streamText>['totalUsage']>,
  provider: string,
): Promise<TaskNodeMeta> => {
  const providerCost = await readProviderCosts(chatCompletion, provider)
  return {
    streamContent: rawOutput,
    taskPrompt: truncateChatMessages(chatInfo.messages),
    tools: Object.values(chatInfo.tools),
    rawOutput: chatCompletion,
    promptTokens: totalUsage.inputTokens,
    resultTokens: totalUsage.outputTokens,
    taskTokens: totalUsage.totalTokens,
    ...(providerCost.length > 0 ? { costs: providerCost } : {}),
  }
}

async function getMetaInfos(
  chatInfo: ChatCompletionChatInfo,
  chatCompletion: Awaited<ReturnType<typeof streamText>>,
  rawOutput: string,
  res: Awaited<ReturnType<typeof streamText>['response']>,
  currentTask: TaskNode,
  providerHeaders: Readonly<Record<string, string>> | undefined,
  apiKey: string,
  taskyonKey: string,
  delegatedTokenJti: string | undefined,
  emitMetadata: (event: ChatCompletionMetadataEvent) => void,
  totalUsage: Awaited<ReturnType<typeof streamText>['totalUsage']>,
  provider: string,
) {
  const content = await chatCompletion.content
  const metaInfo = await buildChatCompletionMetaInfo(
    chatInfo,
    chatCompletion,
    rawOutput,
    totalUsage,
    provider,
  )
  const cont = res.messages[0]?.content
  if (typeof cont !== 'string') {
    metaInfo.reasoning = readReasoningText(content)
  }
  if (delegatedTokenJti) {
    emitTaskyonGenerationCosts({
      apiKey,
      taskyonKey,
      providerHeaders,
      delegatedTokenJti,
      responseId: res.id,
      taskId: currentTask.id,
      emitMetadata,
    })
  }
  metaInfo.rawOutput = { choice: res }
  return metaInfo
}
