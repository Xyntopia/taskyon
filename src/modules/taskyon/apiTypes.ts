import type { DeepPartial } from '../utils'
import type { profile } from './types'
import { FunctionArguments, ToolBase, partialTaskDraft } from './types'
import { z } from 'zod'

const RemoteFunctionBase = z.object({
  functionName: z.string().meta({
    description: 'the name of the function',
  }),
})

export const RemoteFunctionCall = RemoteFunctionBase.extend({
  type: z.literal('functionCall').meta({
    description: 'Field to indicate what kind of a message we have here.',
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

//export type partialTyConfiguration = PartialDeep<storedSettings>
export type partialTyConfiguration = DeepPartial<profile>
//export type partialTyConfiguration = PartialDeep<storedSettings>

const TaskMessage = z
  .object({
    type: z.literal('task').meta({
      description: 'Field to indicate what kind of a message we have here.',
    }),
    task: partialTaskDraft,
    // TODO: we don't need this anymore..   any functioncall task is one that should be "executed"
    execute: z.boolean().default(false).meta({
      description: 'should the task be queued for execution?',
    }),
    duplicateTaskName: z
      .boolean()
      .default(true)
      .describe(
        `Only add the task if a task with this name doesn't exist. We do this, because otherwise tasks get
            added on every page-load if we configure our app through an iframe parent.`,
      ),
  })
  .meta({
    description:
      'With this message type we can send tasks to taskyon from outside, e.g. a parent to a taskyon iframe',
  })

const FunctionDescriptionMessage = ToolBase.extend({
  type: z.literal('functionDescription').meta({
    description: 'Field to indicate that this is a function description message.',
  }),
})

const tyConfigurationMessage = z.object({
  type: z.literal('configurationMessage').meta({
    description: 'Field to indicate that this is a function description message.',
  }),
  conf: z.record(z.string(), z.unknown()),
})

const TyReadyMessage = z.object({ type: z.literal('taskyonReady') }).meta({
  description: 'simple message which signals, that our API is ready!',
})

export const BaseMessage = z.object({ origin: z.string().optional() })

export const TaskWorkerMessage = z.discriminatedUnion('type', [
  z.object({ ...BaseMessage.shape, ...RemoteFunctionCall.shape }),
  z.object({ ...BaseMessage.shape, ...RemoteFunctionResponse.shape }),
])

export type TaskWorkerMessage = z.infer<typeof TaskWorkerMessage>

export const TaskyonMessage = z.discriminatedUnion('type', [
  z.object({ ...BaseMessage.shape, ...RemoteFunctionCall.shape }),
  z.object({ ...BaseMessage.shape, ...RemoteFunctionResponse.shape }),
  z.object({ ...BaseMessage.shape, ...TaskMessage.shape }),
  z.object({ ...BaseMessage.shape, ...FunctionDescriptionMessage.shape }),
  z.object({ ...BaseMessage.shape, ...TyReadyMessage.shape }),
  z.object({ ...BaseMessage.shape, ...tyConfigurationMessage.shape }),
])

export type TaskyonMessage = z.infer<typeof TaskyonMessage>
