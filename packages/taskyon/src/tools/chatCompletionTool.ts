import { createStream } from '@taskyon/common/modules/frpBus'
import type { JSONSchema7 } from 'json-schema'
import type { FromSchema } from 'json-schema-to-ts'
import type { ReadonlyDeep } from 'type-fest'
import {
  resolveChatCompletionConnection,
  type ChatCompletionMetadataEvent,
  type ChatCompletionStreamEvent,
} from '../types/chatCompletion'
import { createTool } from '../types/toolApi'
import {
  createChatCompletionRunner,
  type ChatCompletionToolCapabilities,
} from './chatCompletion/execution'

export {
  convertTaskNodesToOpenAIChat,
  prepareChatCompletionContext,
  resolveToolDefinitionsForTaskChain,
} from './chatCompletion/context'
export { convertFunctionCall, getCommandFromStructuredResponse } from './chatCompletion/response'

export const chatCompletionToolName = 'chatCompletion'

const chatCompletionParameters = {
  type: 'object',
  additionalProperties: false,
  properties: {
    model: {
      type: 'string',
      description: 'The model selected by the active provider profile for this chat completion.',
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
        'Optional websearch capability. When enabled, the model may choose provider-native search alongside ordinary tools; it is not forced to search.',
      additionalProperties: false,
      properties: {
        enabled: {
          type: 'boolean',
          title: 'Enabled',
          default: false,
          description:
            'Expose websearch to the model for this request. Provider-native search remains optional and uses automatic tool choice.',
        },
        mode: {
          type: 'string',
          enum: ['auto', 'required'],
          default: 'auto',
          description:
            'Use auto for normal model choice. Use required for an explicit search action when the provider supports forcing its search tool.',
        },
        max_results: {
          type: 'integer',
          description: 'How many web results should be retrieved at max when websearch is enabled.',
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
        'Optional request tracing. When enabled and the runtime installed a trace writer, Taskyon records the redacted provider request and response metadata.',
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
} as const satisfies JSONSchema7

const chatCompletionDescription =
  'Generates a chat-based response using the OpenAI API for the previous message.'

const chatCompletionLongDescription = `This tool interfaces with an OpenAI-compatible API to generate completions for
  conversation prompts. Useful for generating natural language responses in a chat setting.
  It will convert the chain pointed to by the previous Task (priorID) into openAI compatible message
    list and generate a response`

const chatCompletionRenderOptions = {
  hideChat: true,
  hideLlm: true,
  hideVector: true,
  hideVectorResult: true,
  hideToolSearch: true,
}

export type ChatCompletionToolConnection = ReadonlyDeep<{
  provider: string
  name: string
  baseURL: string
  streamSupport: boolean
  defaultHeaders?: Record<string, string> | undefined
  routes: {
    chatCompletion: string
    models: string
  }
}>

export function createChatCompletionTool(
  connection: ChatCompletionToolConnection,
  capabilities: ChatCompletionToolCapabilities,
) {
  const providerConnection = resolveChatCompletionConnection(connection)
  const chatCompletionStream = createStream<ChatCompletionStreamEvent>()
  const metadataStream = createStream<ChatCompletionMetadataEvent>()
  const run = createChatCompletionRunner({
    providerConnection,
    capabilities,
    emitChatCompletionStream: chatCompletionStream.emit,
    emitMetadata: metadataStream.emit,
  })
  const chatCompletion = createTool({
    description: chatCompletionDescription,
    longDescription: chatCompletionLongDescription,
    name: chatCompletionToolName,
    renderOptions: chatCompletionRenderOptions,
    parameters: chatCompletionParameters,
    function: run,
  })

  return {
    chatCompletion,
    stream: chatCompletionStream.stream,
    metadataStream: metadataStream.stream,
  }
}

export type ChatCompletionTool = Awaited<
  ReturnType<typeof createChatCompletionTool>
>['chatCompletion']

export type chatCompletionParams = FromSchema<
  typeof chatCompletionParameters,
  { keepDefaultedPropertiesOptional: true }
>

export type ChatCompletionArgs = Omit<chatCompletionParams, 'schema'> & {
  schema?: JSONSchema7 & Record<string, unknown>
}
