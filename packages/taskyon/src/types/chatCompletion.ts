import z from 'zod'
import type { streamText } from 'ai'
import { Annotation } from './taskNode'

type StreamOptions = Parameters<typeof streamText>[0]
export type ChatCompletionStreamChunk = Parameters<Required<StreamOptions>['onChunk']>[0]['chunk']
export type ChatCompletionStreamEvent = {
  taskId: string
  chunk: ChatCompletionStreamChunk
}

export const OpenAIMessage = z.object({
  content: z.string().nullish(),
  //finish_reason: z.enum(['length', 'function_call', 'tool_calls', 'stop', 'content_filter']),
  tool_calls: z
    .array(
      z.union([
        z.object({
          function: z.object({ arguments: z.string(), name: z.string() }),
          type: z.literal('function'),
          id: z.string(),
        }),
        z.object({
          custom: z.object({ input: z.string, name: z.string() }),
          id: z.string(),
          type: z.string(), // e.g. "custom"
          // custom tool calls may have extra fields like "name" or "parameters"
        }),
      ]),
    )
    .optional(),
  refusal: z.string().nullish(),
  audio: z.unknown().optional(),
  name: z
    .string()
    .optional()
    .describe('Optional name to differentiate between different participants of same role.'),
  role: z.enum(['system', 'user', 'assistant', 'function', 'tool', 'developer']),
}) // we are allowing additional properties here, because different providers sometimes returns additional properties
export type OpenAIMessage = z.infer<typeof OpenAIMessage>

// TODO: get rid of OpenAI dependency...
// we are defining a "minimal" subset of openai chatcompletion which we need to have in our
// our own app!
// TODO: combine this type here with the previous, duplicate ones we have declared!! (e.g. OpenAIMessage)
// we are removing properties which we don't need for our purposes but compare it with the
// official OpenAI API.
// TODO: move all of our OpenAI functionality into chatCompletionTool...
export const ChatResponseType = z.object({
  id: z.string().default('N/A'),
  model: z.string().default('N/A'),
  choices: z
    .array(
      z.object({
        message: OpenAIMessage,
        finish_reason: z.enum([
          'length',
          'tool_calls',
          'stop',
          'content_filter',
          'function_call',
          'cancelled',
          'unknown',
        ]),
        // TODO: move annotations into message!
        annotations: Annotation.array().optional(),
        reasoning: z.string().optional(),
        logprobs: z.unknown().optional(),
      }),
    )
    .default([]),
  usage: z
    .object({
      prompt_tokens: z.number(),
      completion_tokens: z.number(),
      total_tokens: z.number(),
      prompt_tokens_details: z
        .object({
          cached_tokens: z.number(),
          audio_tokens: z.number(),
        })
        .partial()
        .optional(),
      completion_tokens_details: z
        .object({
          reasoning_tokens: z.number(),
          audio_tokens: z.number(),
          accepted_prediction_tokens: z.number(),
          rejected_prediction_tokens: z.number(),
        })
        .partial()
        .optional(),
    })
    .nullish()
    .optional(),
})
export type ChatResponseType = z.infer<typeof ChatResponseType>

export const TaskDebugError = z
  .object({
    humanized: z.string().optional(),
    serialized: z.unknown().optional(),
    name: z.string().optional(),
    message: z.string().optional(),
    stack: z.string().optional(),
    cause: z.unknown().optional(),
    context: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough()

const ProviderRequestAttempt = z.object({
  method: z.string(),
  url: z.string(),
  requestHeaders: z.record(z.string(), z.string()),
  requestBody: z.unknown().optional(),
  response: z
    .object({
      status: z.number(),
      headers: z.record(z.string(), z.string()),
      requestId: z.string().optional(),
      errorBody: z.unknown().optional(),
    })
    .optional(),
  error: z
    .object({
      name: z.string().optional(),
      message: z.string(),
    })
    .optional(),
})

export const ProviderRequestTrace = z.object({
  provider: z.string(),
  model: z.string(),
  taskId: z.string(),
  recordedAt: z.string().optional(),
  usage: z
    .object({
      inputTokens: z.object({
        total: z.number().optional(),
        noCache: z.number().optional(),
        cacheRead: z.number().optional(),
        cacheWrite: z.number().optional(),
      }),
      outputTokens: z.object({
        total: z.number().optional(),
        text: z.number().optional(),
        reasoning: z.number().optional(),
      }),
      totalTokens: z.number().optional(),
    })
    .optional(),
  attempts: z.array(ProviderRequestAttempt),
})
export type ProviderRequestTrace = z.infer<typeof ProviderRequestTrace>

export const TaskNodeMeta = z
  .object({
    threadMessage: z.any().optional(), // Replace with the correct Zod schema if available
    promptTokens: z.number().optional(),
    resultTokens: z.number().optional(),
    taskTokens: z.number().optional(),
    name: z.string().optional(),
    summary: z.string().optional(),
    reasoning: z.string().optional(),
    estimatedTokens: z
      .object({
        resultTokens: z.number().optional(),
        taskCosts: z.number().optional(),
        functionTokens: z.number().optional(),
        promptTokens: z.number().optional(),
        singlePromptTokens: z.number().optional(),
      })
      .optional(),
    toolStreamArgsContent: z.record(z.string(), z.string()).optional(),
    streamContent: z.string().optional(),
    taskCosts: z.number().optional(),
    rawOutput: z.unknown().optional().meta({
      description:
        'We can optionally add some raw result data for debugging purposes, e.g. chatcompletion ...',
    }), // Replace with the correct Zod schema if available
    providerRequest: ProviderRequestTrace.optional().meta({
      description:
        'Redacted provider-wire request and response metadata captured for each chat completion attempt.',
    }),
    assistantOutputSanitation: z
      .object({
        rawIncomingMessage: z.string(),
        sanitizedMessage: z.string(),
        removedComments: z.string().array(),
      })
      .optional()
      .meta({
        description:
          'Debug data captured when Taskyon removed reserved variable comments from an assistant answer before saving it.',
      }),
    error: z.union([TaskDebugError, z.unknown()]).optional(),
    taskPrompt: z.record(z.string(), z.unknown()).array().optional().meta({
      description: 'add any prompts that were used for a task...',
    }),
    tools: z.unknown().array().optional().meta({
      description: 'any tools from our chat, that we allowed!',
    }),
  })
  .partial()

export type TaskNodeMeta = z.infer<typeof TaskNodeMeta>

export const providerEndpointConfig = z
  .object({
    name: z.string().meta({
      description: 'The name of the API.',
    }),
    baseURL: z.string().meta({
      description: 'Base URL of the api.',
    }),
    streamSupport: z.boolean().meta({
      description: 'Does the API support streaming?',
    }),
    defaultHeaders: z.record(z.string(), z.string()).optional().meta({
      description:
        'Static non-secret headers required by this provider. Credentials belong in the secret store.',
    }),
    auth: z
      .object({
        type: z.enum(['oauth', 'apikey', 'none']).optional().meta({
          description: 'Optional auth strategy metadata for UI/client flows.',
        }),
        oauth: z
          .object({
            authorizationUrl: z.string().optional(),
            tokenUrl: z.string().optional(),
            clientId: z.string().optional(),
            scope: z.string().optional(),
            authorizeQuery: z.record(z.string(), z.string()).optional().meta({
              description: 'Additional query parameters added to the OAuth authorize request.',
            }),
            tokenExchange: z
              .object({
                tokenUrl: z.string().optional(),
                requestedToken: z.string().optional(),
                subjectTokenType: z.string().optional(),
              })
              .optional()
              .meta({
                description:
                  'Optional post-login token exchange settings (for providers that mint API tokens from id_token).',
              }),
          })
          .optional()
          .meta({
            description: 'OAuth configuration for interactive login flows.',
          }),
      })
      .optional()
      .meta({
        description:
          'Optional authentication configuration. Keep request headers in defaultHeaders; keep login settings here.',
      }),
    routes: z.object({
      chatCompletion: z.string().meta({
        description: 'Endpoint for chatcompletion.',
      }),
      models: z.string().meta({
        description: 'Endpoint for list of models.',
      }),
    }),
  })
  .meta({
    description: 'Connection settings for an OpenAI-compatible API.',
  })
export type ProviderEndpointConfig = z.infer<typeof providerEndpointConfig>

export const chatCompletionProviderSettings = providerEndpointConfig
  .extend({
    provider: z.string().meta({
      description: 'Stable provider ID used to select the matching secret.',
    }),
    model: z.string().meta({
      description: 'The model selected for this provider profile.',
    }),
  })
  .meta({
    description: 'Provider-owned chatCompletion settings stored in a toolchain profile.',
  })
export type ChatCompletionProviderSettings = z.infer<typeof chatCompletionProviderSettings>

export const chatCompletionConnectionSettings = chatCompletionProviderSettings
  .omit({ model: true })
  .meta({
    description:
      'Immutable provider connection captured when Taskyon creates the chatCompletion tool.',
  })
export const resolveChatCompletionConnection = (settings: unknown) =>
  chatCompletionConnectionSettings.parse(settings)
