import { createStream } from '@taskyon/common/modules/frpBus'
import { streamText, type ReasoningOutput } from 'ai'
import { default as Ajv } from 'ajv'
import type { JSONSchema7 } from 'json-schema'
import type { FromSchema } from 'json-schema-to-ts'
import type { TyTaskManager } from '../core/taskManager'
import { sanitizeTaskyonVariableCommentsOutsideCode } from '../core/taskVariables'
import { isTaskyonKey } from '../core/tyCrypto'
import type { PromptInjection } from '../llm/promptMessages'
import {
  getTaskyonCosts,
  getTyJwtPublicKey,
  mintToken,
  verifyServiceToken,
} from '../taskyon.space/taskyon.space_api'
import { TOKEN_SERVICE_BASE_URL, TOKEN_SERVICE_PREFIX } from '../taskyon.space/tokenservice.types'
import type { apiConfig, ProviderRequestTrace, TaskNodeMeta } from '../types/chatCompletion'
import { getCurrentModel, type ChatCompletionStreamEvent } from '../types/chatCompletion'
import type { Annotation, partialTaskDraft, TaskNode } from '../types/taskNode'
import type { toolContext } from '../types/toolApi'
import { createTool } from '../types/toolApi'
import { humanizeError, serializeError } from '../utils/error'
import { createDotPathTransformer } from '../utils/objHelpers'
import type { Thunk } from '../utils/tsHelpers'
import { prepareChatCompletionContext } from './chatCompletion/context'
import { buildChatProviderRequest } from './chatCompletion/providerRequest'
import {
  interpretAssistantMessage,
  normalizeAssistantMessageForToolCall,
  parseStructuredResponse,
} from './chatCompletion/response'
import { cleanupRawStreamOutput, runChatCompletionStream } from './chatCompletion/streamResult'
import { writeChatCompletionTrace } from './chatCompletionTrace'

export {
  convertTaskNodesToOpenAIChat,
  prepareChatCompletionContext,
} from './chatCompletion/context'
export { convertFunctionCall, getCommandFromStructuredResponse } from './chatCompletion/response'

const getChatCompletionContextOptions = (maxFollow: number | undefined) =>
  maxFollow === undefined ? undefined : { maxFollow }

const normalizePromptInjections = (value: unknown): PromptInjection[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []

export const chatCompletionToolName = 'chatCompletion'

export function createChatCompletionTool(
  apiSettings: Thunk<{
    selectedApi: string
    llmApis: Record<string, apiConfig>
    siteUrl: string
  }>,
  capabilities: {
    getTaskChain: TyTaskManager['getTaskChain']
    getTask: TyTaskManager['getTask']
    getFileMappingByUuid: TyTaskManager['getFileMappingByUuid']
    getUploadedFile: TyTaskManager['getUploadedFile']
    updateToolDefinitions: TyTaskManager['updateToolDefinitions']
    metaUpsert: TyTaskManager['metaUpsert']
  },
) {
  const ajv = new Ajv()
  const chatCompletionStream = createStream<ChatCompletionStreamEvent>()
  const chatCompletion = createTool({
    description: 'Generates a chat-based response using the OpenAI API for the previous message.',
    longDescription: `This tool interfaces with an OpenAI-compatible API to generate completions for
  conversation prompts. Useful for generating natural language responses in a chat setting.
  It will convert the chain pointed to by the previous Task (priorID) into openAI compatible message
    list and generate a response`,
    name: chatCompletionToolName,
    renderOptions: { hideChat: true, hideLlm: true, hideVector: true },
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        model: {
          type: 'string',
          description:
            'The name of the model to use for the completion. Optional, will choose default model if not provided',
        },
        allowedTools: {
          type: 'array',
          description:
            'Optional Parameter. If provided, chatCompletion enables provider-native tool calling and limits calls to this tool set.',
          items: {
            type: 'string',
          },
        },
        toolChoice: {
          type: 'object',
          description:
            'Optional Parameter. Use to explicitly control provider-native tool choice when allowedTools are provided.',
          additionalProperties: false,
          properties: {
            type: {
              type: 'string',
              enum: ['auto', 'required', 'tool'],
            },
            toolName: {
              type: 'string',
              description: 'Required when type is "tool". Names one allowed tool to call.',
            },
          },
          required: ['type'],
        },
        appendSystemPrompts: {
          type: 'array',
          description:
            'Optional Parameter. Append transient system prompts after the rendered task chat. Use this for volatile late context such as current time or editor state.',
          items: {
            type: 'string',
          },
        },
        prependSystemPrompts: {
          type: 'array',
          description:
            'Optional Parameter. Prepend stable system prompts before the rendered task chat. Keep these cache-friendly and avoid volatile values.',
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
        websearch: {
          type: 'object',
          description:
            'Optional websearch configuration. Websearch runs only when enabled is true.',
          additionalProperties: false,
          properties: {
            enabled: {
              type: 'boolean',
              title: 'Enabled',
              default: false,
              description: 'Explicitly enable websearch for this request.',
            },
            max_results: {
              type: 'integer',
              description:
                'How many web results should be retrieved at max when websearch is enabled.',
              title: 'Max Results',
              default: 5,
            },
          },
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
        trace: {
          type: 'object',
          description:
            'Optional request tracing. When enabled and the runtime installed a trace writer, Taskyon records the exact LLM input and output separately.',
          additionalProperties: false,
          properties: {
            enabled: {
              type: 'boolean',
              default: false,
              description: 'Enable request/response tracing for this chatCompletion call.',
            },
            label: {
              type: 'string',
              description:
                'Optional stable label added to trace file names, for example a benchmark task id.',
            },
          },
        },
      },
    } as const satisfies JSONSchema7,
    function: async (opts, context: toolContext) => {
      //////////   INITIALIZATION
      const {
        model,
        allowedTools,
        toolChoice,
        appendSystemPrompts,
        prependSystemPrompts,
        schema,
        websearch,
        reasoning_effort: reasoningEffort,
        options,
        // if we don't set it, choose the default setting...
        use_multimodal = true,
        context_size,
        timeouts,
        trace,
      } = opts
      const { verbosity, artificial_streaming } = options || {}
      const normalizedPrependSystemPrompts = normalizePromptInjections(prependSystemPrompts)
      const normalizedAppendSystemPrompts = appendSystemPrompts ?? []

      const timeout = {
        totalMs: timeouts?.totalMs ?? 10 * 60 * 1000,
        stepMs: timeouts?.stepMs ?? 10 * 60 * 1000,
        chunkMs: 120 * 1000,
      }
      const useArtificialStreaming = artificial_streaming ?? true
      const tools = allowedTools ?? []
      const useProviderToolCalling = tools.length > 0
      const normalizedToolChoice =
        toolChoice?.type === 'tool' && typeof toolChoice.toolName === 'string'
          ? { type: 'tool' as const, toolName: toolChoice.toolName }
          : toolChoice?.type === 'required'
            ? ('required' as const)
            : toolChoice?.type === 'auto'
              ? ('auto' as const)
              : undefined
      const { selectedApi, llmApis, siteUrl } = apiSettings()

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
      console.log('calling chat completion tool...', selectedModel, useProviderToolCalling)
      // the current task doesn't *have* to exist. We can also works solely with prompts...
      const executionTaskChain = await context.getExecutionTaskChain()
      const currentTask = executionTaskChain.at(-1)

      const toolDefs = await capabilities.updateToolDefinitions(true)

      //////////// END INITIALIZATION

      const lastTaskBeforeChatCompletion = executionTaskChain.at(-2)
      const contextOptions = getChatCompletionContextOptions(context_size)
      const taskChain = lastTaskBeforeChatCompletion
        ? await capabilities.getTaskChain(
            lastTaskBeforeChatCompletion.id,
            contextOptions?.maxFollow,
            {
              method: 'lineage',
            },
          )
        : []
      const chatInfo = await prepareChatCompletionContext({
        taskChain,
        allowedTools: tools,
        toolDefinitions: toolDefs,
        appendSystemPrompts: normalizedAppendSystemPrompts,
        prependSystemPrompts: normalizedPrependSystemPrompts,
        useVisionModels: use_multimodal,
        getFileMapping: capabilities.getFileMappingByUuid,
        getUploadedFile: capabilities.getUploadedFile,
        getTaskById: capabilities.getTask,
      })

      const traceTaskId = currentTask?.id ?? 'N/A'
      const traceLabel = typeof trace?.label === 'string' ? trace.label : undefined
      const providerRequest: ProviderRequestTrace = {
        provider: selectedApi,
        model: selectedModel,
        taskId: traceTaskId,
        attempts: [],
      }
      const streamOpts = await buildChatProviderRequest({
        messages: chatInfo.messages,
        tools: chatInfo.tools,
        selectedModel,
        api: requestApi,
        apiKey: requestApiKey,
        ...(schema ? { schema } : {}),
        ...(siteUrl ? { siteUrl } : {}),
        ...(websearch?.enabled === true
          ? {
              webSearch: {
                maxResults: websearch.max_results ?? 5,
                searchContextSize: 'medium',
              } as const,
            }
          : {}),
        ...(reasoningEffort ? { reasoningEffort } : {}),
        ...(verbosity ? { verbosity } : {}),
        ...(normalizedToolChoice ? { toolChoice: normalizedToolChoice } : {}),
        providerRequest,
      })
      const traceEnabled = trace?.enabled === true

      const streamResult = await runChatCompletionStream({
        streamText,
        streamOptions: streamOpts,
        timeout,
        useArtificialStreaming,
        abortSignal: context.stopSignal,
        onChunk(chunk) {
          chatCompletionStream.emit({ taskId: currentTask?.id ?? 'N/A', chunk })
        },
      })
      const { completion: chatCompletion, rawOutput, partialTextOutput } = streamResult

      if (!streamResult.ok) {
        const effectiveErr = streamResult.error
        const failure = streamResult.failure
        const humanized = humanizeError(effectiveErr)
        const lower = humanized.toLowerCase()
        const failureDetails = lower.includes('no endpoints found that support tool use')
          ? [
              'Provider routing failed: no endpoint supports tool use for this request.',
              `Request context: api=${selectedApi}, model=${selectedModel}, providerToolCalling=${useProviderToolCalling}, declaredTools=${Object.keys(chatInfo.tools).length}.`,
              'Suggested fix: use a model/provider route with tool-call support, relax provider filters, or disable tool use for this run.',
              'Reference: https://openrouter.ai/docs/guides/routing/provider-selection',
            ].join('\n')
          : failure.shortReason === 'transient provider failure'
            ? [
                humanized,
                'Suggested autonomous recovery: retry the same immediate objective once after the task tree records this error. If it repeats, reduce context or pause with the exact provider error instead of looping indefinitely.',
              ].join('\n')
            : humanized
        const partialContent = partialTextOutput.trim() || cleanupRawStreamOutput(rawOutput)
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
        const partialAssistantSanitation:
          | NonNullable<TaskNodeMeta['assistantOutputSanitation']>
          | undefined =
          sanitizedPartialContent && sanitizedPartialContent.removedComments.length > 0
            ? {
                rawIncomingMessage: partialContent,
                sanitizedMessage: sanitizedPartialContent.sanitized,
                removedComments: sanitizedPartialContent.removedComments,
              }
            : undefined
        if (currentTask) {
          void capabilities.metaUpsert(
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
                  providerToolCalling: useProviderToolCalling,
                  declaredToolCount: Object.keys(chatInfo.tools).length,
                  failureDetails,
                  rawOutput,
                  partialTextOutput,
                },
              },
              ...(partialAssistantSanitation
                ? { assistantOutputSanitation: partialAssistantSanitation }
                : {}),
              providerRequest,
            },
            'shallow_merge',
          )
        }
        console.log('chat completion error', {
          rawOutput,
          partialTextOutput,
          error: effectiveErr,
          failure,
        })
        if (traceEnabled) {
          await writeChatCompletionTrace({
            taskId: traceTaskId,
            ...(traceLabel ? { label: traceLabel } : {}),
            providerRequest,
          })
        }
        return context.createSubtasksResult([
          ...(sanitizedPartialContent
            ? [
                {
                  role: 'assistant',
                  content: {
                    type: 'message',
                    data: `${failure.assistantPrefix}\n\n${sanitizedPartialContent.sanitized}`,
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
      const res = streamResult.response

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
          capabilities.metaUpsert,
        )
        metaInfo.providerRequest = providerRequest
        console.log('saving task metadata', {
          taskId: currentTask.id,
          providerAttempts: providerRequest.attempts.length,
        })
        void capabilities.metaUpsert(currentTask.id, metaInfo, 'shallow_merge')
      } else if (currentTask) {
        void capabilities.metaUpsert(currentTask.id, { providerRequest }, 'shallow_merge')
      }

      // in case a schema was given, we simply use that schema and return it as a structured message
      // for further processing (e.g. a contextFunction)...
      const output = await chatCompletion.output
      if (traceEnabled) {
        await writeChatCompletionTrace({
          taskId: traceTaskId,
          ...(traceLabel ? { label: traceLabel } : {}),
          providerRequest,
        })
      }
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
          structResponse = parseStructuredResponse(output || '')

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
        return context.createSubtasksResult([
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
      const outcome = interpretAssistantMessage(
        sources,
        normalizedFirstMessage,
        useProviderToolCalling,
        toolDefs,
        chatInfo.variableService,
      )
      const assistantOutputSanitation = outcome.sanitation.at(-1)
      if (currentTask && assistantOutputSanitation) {
        void capabilities.metaUpsert(
          currentTask.id,
          {
            assistantOutputSanitation,
          },
          'shallow_merge',
        )
      }

      switch (outcome.kind) {
        case 'tool-calls':
          return context.createSubtasksResult([
            outcome.calls.map<partialTaskDraft>((call) => ({
              role: 'function',
              content: { type: 'functioncall', data: call },
            })),
          ])
        case 'answers':
          return context.createSubtasksResult([
            outcome.answers.flatMap<partialTaskDraft>((answer) => [
              {
                role: 'assistant',
                content: {
                  type: 'message',
                  data: answer.content,
                  ...(answer.annotations ? { ann: answer.annotations } : {}),
                },
              },
              {
                role: 'system',
                content: { type: 'return', data: 'assistant answered' },
              },
            ]),
          ])
        case 'empty':
          return context.createSubtasksResult([[]])
      }
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
  chatInfo: Awaited<ReturnType<typeof prepareChatCompletionContext>>,
  chatCompletion: Awaited<ReturnType<typeof streamText>>,
  rawOutput: string,
  res: Awaited<ReturnType<typeof streamText>['response']>,
  currentTask: TaskNode,
  siteUrl: string,
  apiKey: string,
  taskyonKey: string,
  delegatedTokenJti: string | undefined,
  upsertMeta: TyTaskManager['metaUpsert'],
) {
  // need to make sure, that we remove audio, image and file data here!
  // TODO: make sure the following works..  e.g. with adding a file..

  const truncatedMsgs = createDotPathTransformer({
    '*.content.*.file.file_data': () => '[[file_data omitted]]',
    '*.content.*.image_url.url': () => '[[image_url omitted]]',
    '*.content.*.input_audio.data': () => '[[input_audio omitted]]',
  })(chatInfo.messages)
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
            void upsertMeta(currentTask.id, { taskCosts: costs }, 'shallow_merge')
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
