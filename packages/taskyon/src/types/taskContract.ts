import type { JSONSchema7 } from 'json-schema'

export type TaskContractResult =
  | { mode: 'message' }
  | {
      mode: 'structured'
      schema: JSONSchema7 & Record<string, unknown>
    }

export type TaskContract = {
  objective: string
  agentInstructions?: string
  doneWhen?: string[]
  result: TaskContractResult
}

export const taskContractResultSchema = {
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        mode: { const: 'message' },
      },
      required: ['mode'],
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        mode: {
          const: 'structured',
        },
        schema: {
          type: 'object',
          additionalProperties: true,
          description: 'JSON Schema for the structured task result.',
        },
      },
      required: ['mode', 'schema'],
    },
  ],
} as const satisfies JSONSchema7

export const taskContractSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    objective: {
      type: 'string',
      description: 'The concrete objective for this task.',
    },
    agentInstructions: {
      type: 'string',
      description:
        'Optional task-specific behavior instructions rendered once as a system message.',
    },
    doneWhen: {
      type: 'array',
      items: { type: 'string' },
      description: 'Semantic criteria that define when the task is complete.',
    },
    result: taskContractResultSchema,
  },
  required: ['objective', 'result'],
} as const satisfies JSONSchema7
