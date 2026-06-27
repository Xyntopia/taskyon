import z from 'zod'
import { FunctionArguments } from './tools'

const RemoteFunctionBase = z.object({
  functionName: z.string().meta({
    description: 'the name of the function',
  }),
  requestId: z.string().meta({
    description: 'unique request id used to correlate a remote function call with its response',
  }),
})

export const REMOTE_FUNCTION_TIMEOUT_MS = 30_000
export const MAX_REMOTE_FUNCTION_TIMEOUT_MS = 10 * 60 * 1000

export const RemoteFunctionCall = RemoteFunctionBase.extend({
  type: z.literal('functionCall').meta({
    description: 'Field to indicate what kind of a message we have here.',
  }),
  taskId: z.string().optional().meta({
    description: 'Task id whose function call is being executed, when available.',
  }),
  arguments: FunctionArguments.optional().meta({
    description: 'the arguments for the function as a json object',
  }),
}).meta({
  description:
    'This type is used for sending messages with function calls between windows. E.g. from iframe to parent',
})
export type RemoteFunctionCall = z.infer<typeof RemoteFunctionCall>

export const RemoteFunctionResponse = RemoteFunctionBase.extend({
  type: z.literal('functionResponse').meta({
    description: 'Field to indicate what kind of a message we have here.',
  }),
  response: z.unknown().optional().meta({
    description: 'response of a FunctionCall, e.g. through postMessage with iframes.',
  }),
  error: z
    .unknown()
    .optional()
    .meta({ description: 'if an error occurs in the remote function, we can use this property' }),
}).meta({
  description:
    'This type is used for sending messages with the result of a remote function call between windows. E.g. from parent to taskyon iframe',
})
export type RemoteFunctionResponse = z.infer<typeof RemoteFunctionResponse>

export const RemoteFunctionCancel = RemoteFunctionBase.extend({
  type: z.literal('functionCancel').meta({
    description: 'Field to indicate that an in-flight function call should be cancelled.',
  }),
  reason: z.string().optional().meta({
    description: 'Optional human-readable reason for the cancellation.',
  }),
}).meta({
  description: 'Cancels a pending remote function call identified by requestId.',
})
export type RemoteFunctionCancel = z.infer<typeof RemoteFunctionCancel>
