import type OpenAI from 'openai'
import z from 'zod'
import { assertType } from '../utils/tsHelpers'

export const OpenAIMessage = z.object({
  content: z.string().nullish(),
  //finish_reason: z.enum(['length', 'function_call', 'tool_calls', 'stop', 'content_filter']),
  tool_calls: z
    .array(
      z.object({
        function: z.object({ arguments: z.string(), name: z.string() }),
        type: z.literal('function'),
        id: z.string(),
      }),
    )
    .optional(),
  name: z.string().optional(),
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
  object: z.literal('chat.completion'),
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
        logprobs: z.unknown().optional(),
        reasoning: z.string().optional(),
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

// Use the function to trigger type checking
// This will cause TypeScript to report an error if the types don't match
//assertType<ChatResponseType>({} as SimplifyDeep<OpenAI.ChatCompletion>)
assertType<ChatResponseType>({} as OpenAI.ChatCompletion)

export interface OpenRouterGenerationInfo {
  id: string
  total_cost: number
  created_at: string // ISO 8601 date string
  model: string
  app_id: number
  streamed: boolean
  cancelled: boolean
  provider_name: string
  latency: number
  moderation_latency: null | number // can be null
  generation_time: number
  finish_reason: string
  tokens_prompt: number
  tokens_completion: number
  native_tokens_prompt: number
  native_tokens_completion: number
  num_media_prompt: null | number // can be null
  num_media_completion: null | number // can be null
  origin: string
  usage: number
}

export const TaskNodeMeta = z
  .object({
    threadMessage: z.any().optional(), // Replace with the correct Zod schema if available
    promptTokens: z.number().optional(),
    resultTokens: z.number().optional(),
    taskTokens: z.number().optional(),
    name: z.string().optional(),
    summary: z.string().optional(),
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
    error: z.unknown().optional(),
    taskPrompt: z.record(z.string(), z.unknown()).optional().meta({
      description: 'add any prompts that were used for a task...',
    }),
  })
  .partial()

export type TaskNodeMeta = z.infer<typeof TaskNodeMeta>
