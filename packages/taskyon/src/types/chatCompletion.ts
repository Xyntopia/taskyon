import z from 'zod'
import { Annotation } from './taskNode'

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

export const apiConfig = z
  .object({
    name: z.string().meta({
      description: 'The name of the API.',
    }),
    baseURL: z.string().meta({
      description: 'Base URL of the api.',
    }),
    defaultModel: z.string().meta({
      description: 'the default model which should be used for this API.',
    }),
    selectedModel: z.string().optional().meta({
      description: 'which model is currently selected.',
    }),
    models: z
      .object({
        instruction: z.string(),
        chat: z.string(),
        free: z.string(),
      })
      .partial()
      .optional()
      .meta({
        description: 'Define default models for some tasks.',
      }),
    streamSupport: z.boolean().meta({
      description: 'Does the API support streaming?',
    }),
    defaultHeaders: z.record(z.string(), z.string()).optional().meta({
      description: 'If the API needs some special headers for communication (e.g. an API key.)',
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
    description: 'Definition of an OpenAI Compatible API.',
  })
export type apiConfig = z.infer<typeof apiConfig>

export function getCurrentModel(api: apiConfig) {
  return api.selectedModel || api.defaultModel || api.models?.free || 'No model selected!'
}
